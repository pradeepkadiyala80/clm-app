import type { AgentConfig, Message } from './types';

// ── API client ───────────────────────────────────────────────────────────────
// The browser never calls agentOS directly.  All requests go to the CLM API
// server (/api/*) which forwards them to agentOS server-to-server.
// This eliminates Mixed Content errors when the app is served over HTTPS.
//
// Routes handled by server/index.ts (and proxied by Vite in dev):
//   POST /api/upload          ← file upload
//   POST /api/chat/:slug      ← chat completions

export async function uploadFile(config: AgentConfig, file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);

  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'X-Agentos-Base-Url': config.baseUrl,
    },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`File upload failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  if (!data.id) throw new Error('Upload succeeded but no file ID was returned.');
  // Return all chunk IDs joined so sendMessage can attach each one
  return data.ids && data.ids.length > 1
    ? (data.ids as string[]).join(',')
    : data.id as string;
}

export async function sendMessage(
  config: AgentConfig,
  messages: Message[],
  sessionId: string,
  fileId?: string
): Promise<string> {
  // Build message payload — attach file to last user message if provided
  const fileIds = fileId ? fileId.split(',') : [];
  const payload = messages.map((m, idx) => {
    if (fileIds.length > 0 && idx === messages.length - 1 && m.role === 'user') {
      return {
        role: m.role,
        content: [
          { type: 'text', text: m.content },
          ...fileIds.map(id => ({ type: 'file', file: { file_id: id } })),
        ],
      };
    }
    return { role: m.role, content: m.content };
  });

  const res = await fetch(`/api/chat/${config.agentSlug}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'X-Session-Id': sessionId,
      'X-Agentos-Base-Url': config.baseUrl,
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
