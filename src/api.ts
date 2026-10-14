import type { AgentConfig, Message } from './types';

// ── Correct endpoints discovered by live testing ────────────────────────────
// Chat:        POST /agentos/api/chat-agents/{slug}/chat/completions
// File upload: POST /agentos/api/files/upload

// If the app is served over HTTPS but the configured URL is plain HTTP,
// upgrade it automatically to avoid a browser mixed-content block.
function safeBase(url: string): string {
  const stripped = url.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    return stripped.replace(/^http:\/\//i, 'https://');
  }
  return stripped;
}

export async function uploadFile(config: AgentConfig, file: File): Promise<string> {
  const base = safeBase(config.baseUrl);
  const url = `${base}/agentos/api/files/upload`;

  const form = new FormData();
  form.append('file', file);

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`File upload failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  if (!data.id) throw new Error('Upload succeeded but no file ID was returned.');
  return data.id as string;
}

export async function sendMessage(
  config: AgentConfig,
  messages: Message[],
  sessionId: string,
  fileId?: string
): Promise<string> {
  const base = safeBase(config.baseUrl);
  const url = `${base}/agentos/api/chat-agents/${config.agentSlug}/chat/completions`;

  // Build message payload — attach file to last user message if provided
  const payload = messages.map((m, idx) => {
    if (fileId && idx === messages.length - 1 && m.role === 'user') {
      return {
        role: m.role,
        content: [
          { type: 'text', text: m.content },
          { type: 'file', file: { file_id: fileId } },
        ],
      };
    }
    return { role: m.role, content: m.content };
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'X-Session-Id': sessionId,
    },
    body: JSON.stringify({
      model: `agent:${config.agentSlug}`,
      messages: payload,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Agent call failed (${res.status}): ${text}`);
  }

  const data = await res.json();

  if (data.error) {
    throw new Error(
      typeof data.error === 'string' ? data.error : (data.error.message ?? JSON.stringify(data.error))
    );
  }

  // Return the full response body as JSON string so the parser can access annotations
  return JSON.stringify(data);
}
