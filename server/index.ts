/**
 * CLM API server — runs inside the Docker container alongside nginx.
 * Proxies all agentOS calls server-to-server so the browser never touches
 * the plain-HTTP agentOS endpoint (avoids Mixed Content errors entirely).
 *
 * Routes (all require Authorization: Bearer <key> from the browser):
 *   POST /api/upload          → agentOS /agentos/api/files/upload
 *   POST /api/chat/:slug      → agentOS /agentos/api/chat-agents/:slug/chat/completions
 *
 * The agentOS base URL is read from AGENTOS_BASE_URL (default points to the
 * TechXchange server).  This lets the URL be overridden via a Code Engine
 * environment variable without rebuilding the image.
 */
import express from 'express';
import type { Request, Response } from 'express';

const app = express();
const PORT = parseInt(process.env.API_PORT ?? '3001', 10);
const AGENTOS = (process.env.AGENTOS_BASE_URL ?? 'http://ibm-techxchange.sirioncloud.io:8000').replace(/\/$/, '');

app.use(express.json({ limit: '50mb' }));

// ── POST /api/upload ─────────────────────────────────────────────────────────
// Accepts multipart/form-data with a `file` field, forwards to agentOS,
// returns { id: string }.
app.post('/api/upload', async (req: Request, res: Response) => {
  // Read the raw body as a buffer and forward it as-is, preserving the
  // original multipart boundary sent by the browser.
  const contentType = req.headers['content-type'];
  const auth = req.headers['authorization'];

  if (!auth) { res.status(401).json({ error: 'Missing Authorization header' }); return; }
  if (!contentType?.startsWith('multipart/form-data')) {
    res.status(400).json({ error: 'Expected multipart/form-data' }); return;
  }

  try {
    // Collect the raw request body
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);

    const upstream = await fetch(`${AGENTOS}/agentos/api/files/upload`, {
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Type': contentType,
      },
      // @ts-ignore — Node fetch accepts Buffer
      body,
    });

    const text = await upstream.text();
    res.status(upstream.status).set('Content-Type', 'application/json').send(text);
  } catch (err: any) {
    res.status(502).json({ error: `Upstream error: ${err.message}` });
  }
});

// ── POST /api/chat/:slug ─────────────────────────────────────────────────────
// Accepts JSON body, forwards to agentOS chat completions, returns JSON.
app.post('/api/chat/:slug', async (req: Request, res: Response) => {
  const auth = req.headers['authorization'];
  const sessionId = req.headers['x-session-id'] as string | undefined;
  const { slug } = req.params;

  if (!auth) { res.status(401).json({ error: 'Missing Authorization header' }); return; }

  try {
    const headers: Record<string, string> = {
      'Authorization': auth,
      'Content-Type': 'application/json',
    };
    if (sessionId) headers['X-Session-Id'] = sessionId;

    const upstream = await fetch(
      `${AGENTOS}/agentos/api/chat-agents/${slug}/chat/completions`,
      { method: 'POST', headers, body: JSON.stringify(req.body) }
    );

    const text = await upstream.text();
    res.status(upstream.status).set('Content-Type', 'application/json').send(text);
  } catch (err: any) {
    res.status(502).json({ error: `Upstream error: ${err.message}` });
  }
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok', agentos: AGENTOS }));

app.listen(PORT, () => {
  console.log(`CLM API server listening on :${PORT}  →  agentOS: ${AGENTOS}`);
});
