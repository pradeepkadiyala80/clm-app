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
import mammoth from 'mammoth';

const app = express();
const PORT = parseInt(process.env.API_PORT ?? '3001', 10);
const AGENTOS = (process.env.AGENTOS_BASE_URL ?? 'http://ibm-techxchange.sirioncloud.io:8000').replace(/\/$/, '');

// ── Multipart parser — extracts a single file field from a multipart body ────
async function extractFileFromMultipart(
  body: Buffer, contentType: string
): Promise<{ filename: string; mimetype: string; data: Buffer } | null> {
  const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
  if (!boundaryMatch) return null;
  const boundary = Buffer.from('--' + boundaryMatch[1]);

  // Split body on boundary markers
  let start = body.indexOf(boundary) + boundary.length;
  // Skip past the \r\n after the first boundary
  while (start < body.length && (body[start] === 0x0d || body[start] === 0x0a)) start++;

  // Read headers section (up to first blank line \r\n\r\n)
  const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), start);
  if (headerEnd === -1) return null;
  const headerStr = body.slice(start, headerEnd).toString();

  const nameMatch = headerStr.match(/name="([^"]+)"/);
  const filenameMatch = headerStr.match(/filename="([^"]+)"/);
  const mimeMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);
  if (!nameMatch || nameMatch[1] !== 'file') return null;

  const filename = filenameMatch?.[1] ?? 'upload';
  const mimetype = mimeMatch?.[1]?.trim() ?? 'application/octet-stream';

  // File data starts after headers + \r\n\r\n
  const dataStart = headerEnd + 4;
  // Find next boundary
  const nextBoundary = body.indexOf(boundary, dataStart);
  const dataEnd = nextBoundary === -1 ? body.length : nextBoundary - 2; // -2 for \r\n before boundary
  const data = body.slice(dataStart, dataEnd);

  return { filename, mimetype, data };
}

// ── POST /api/upload ─────────────────────────────────────────────────────────
// Accepts multipart/form-data with a `file` field.
// For .docx files: extracts text via mammoth and uploads that instead,
// working around the agentOS ~10KB multipart body size limit.
app.post('/api/upload', async (req: Request, res: Response) => {
  const contentType = req.headers['content-type'];
  const auth = req.headers['authorization'];
  const agentOs = ((req.headers['x-agentos-base-url'] as string) || AGENTOS).replace(/\/$/, '');

  if (!auth) { res.status(401).json({ error: 'Missing Authorization header' }); return; }
  if (!contentType?.startsWith('multipart/form-data')) {
    res.status(400).json({ error: 'Expected multipart/form-data' }); return;
  }

  try {
    // Collect the raw request body
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const rawBody = Buffer.concat(chunks);

    // Parse the file out of the multipart body
    const fileInfo = await extractFileFromMultipart(rawBody, contentType);
    if (!fileInfo) {
      res.status(400).json({ error: 'Could not parse file from multipart body' });
      return;
    }

    // .docx → extract plain text; split into chunks to stay under agentOS limit
    const isDocx = fileInfo.filename.toLowerCase().endsWith('.docx') ||
      fileInfo.mimetype.includes('wordprocessingml');

    const CHUNK_SIZE = 9000; // safe margin under the ~10.5KB agentOS body limit

    // Helper: upload one Buffer chunk, return file ID
    const uploadChunk = async (chunk: Buffer, filename: string, mime: string): Promise<string> => {
      const boundary = '----CLMBoundary' + Date.now() + Math.random().toString(36).slice(2);
      const partHeader = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`;
      const partFooter = `\r\n--${boundary}--\r\n`;
      const body = Buffer.concat([Buffer.from(partHeader), chunk, Buffer.from(partFooter)]);
      const up = await fetch(`${agentOs}/agentos/api/files/upload`, {
        method: 'POST',
        headers: {
          Authorization: auth!,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(body.length),
        },
        // @ts-ignore
        body,
      });
      if (!up.ok) throw new Error(`agentOS upload failed (${up.status}): ${await up.text()}`);
      const json = await up.json() as { id: string };
      return json.id;
    };

    let ids: string[];
    if (isDocx) {
      // Extract plain text and split into chunks
      const { value: text } = await mammoth.extractRawText({ buffer: fileInfo.data });
      const textBuf = Buffer.from(text, 'utf8');
      const baseName = fileInfo.filename.replace(/\.docx$/i, '');
      const chunks: Buffer[] = [];
      for (let i = 0; i < textBuf.length; i += CHUNK_SIZE) {
        chunks.push(textBuf.slice(i, i + CHUNK_SIZE));
      }
      ids = await Promise.all(
        chunks.map((chunk, i) =>
          uploadChunk(chunk, `${baseName}_part${i + 1}.txt`, 'text/plain')
        )
      );
    } else {
      // Non-docx: upload directly (or in chunks if large)
      const chunks: Buffer[] = [];
      for (let i = 0; i < fileInfo.data.length; i += CHUNK_SIZE) {
        chunks.push(fileInfo.data.slice(i, i + CHUNK_SIZE));
      }
      ids = await Promise.all(
        chunks.map((chunk, i) => {
          const name = chunks.length === 1
            ? fileInfo.filename
            : `${fileInfo.filename}_part${i + 1}`;
          return uploadChunk(chunk, name, fileInfo.mimetype);
        })
      );
    }

    // Return all IDs — client attaches each as a separate file content part
    res.json({ id: ids[0], ids });
  } catch (err: any) {
    res.status(502).json({ error: `Upstream error: ${err.message}` });
  }
});

// ── POST /api/chat/:slug ─────────────────────────────────────────────────────
// Accepts JSON body, forwards to agentOS chat completions, returns JSON.
app.post('/api/chat/:slug', express.json({ limit: '50mb' }), async (req: Request, res: Response) => {
  const auth = req.headers['authorization'];
  const sessionId = req.headers['x-session-id'] as string | undefined;
  const agentOs = ((req.headers['x-agentos-base-url'] as string) || AGENTOS).replace(/\/$/, '');
  const { slug } = req.params;

  if (!auth) { res.status(401).json({ error: 'Missing Authorization header' }); return; }

  try {
    const headers: Record<string, string> = {
      'Authorization': auth,
      'Content-Type': 'application/json',
    };
    if (sessionId) headers['X-Session-Id'] = sessionId;

    const upstream = await fetch(
      `${agentOs}/agentos/api/chat-agents/${slug}/chat/completions`,
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
