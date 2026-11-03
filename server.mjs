// Local-only web server for the exporter UI.
// Binds to 127.0.0.1: nothing is exposed to the network.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFromHtml, extractFromTranscript, extractFromUrl } from './src/extract.mjs';
import { ExportError } from './src/providers.mjs';
import { toJson, toMarkdown, toPlainText } from './src/lib/conversation.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const MAX_BODY_BYTES = 30 * 1024 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ExportError('TOO_LARGE', 'That input is too big (30 MB limit).'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ExportError('BAD_JSON', 'Malformed request body.'));
      }
    });
    req.on('error', reject);
  });
}

// Attach the exact text the UI copies/downloads, so both stay in sync.
function withFiles(payload) {
  const conversation = payload.conversation;
  if (!conversation) return payload;
  return {
    ...payload,
    files: {
      markdown: toMarkdown(conversation),
      text: toPlainText(conversation),
      json: toJson(conversation),
    },
  };
}

function errorPayload(error) {
  if (error instanceof ExportError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        hint: error.hint,
        suggestions: error.suggestions || [],
        attempts: error.attempts || [],
        status: error.status ?? null,
      },
    };
  }
  return {
    ok: false,
    error: {
      code: 'INTERNAL',
      message: error?.message || 'Something went wrong.',
      hint: 'Check the server console for details.',
      suggestions: [],
      attempts: [],
      status: null,
    },
  };
}

async function serveStatic(res, pathname) {
  let relative;
  try {
    relative = decodeURIComponent(pathname === '/' ? 'index.html' : pathname).replace(/^\/+/, '');
  } catch {
    return sendJson(res, 400, { ok: false, error: { code: 'BAD_PATH', message: 'Bad path.' } });
  }
  const target = path.resolve(PUBLIC_DIR, relative);
  const insidePublic = target === PUBLIC_DIR || target.startsWith(PUBLIC_DIR + path.sep);
  const type = MIME_TYPES[path.extname(target).toLowerCase()];
  if (!insidePublic || !type) {
    return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Not found.' } });
  }
  try {
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': type,
      'content-length': body.length,
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Not found.' } });
  }
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, node: process.version });
    }
    if (url.pathname.startsWith('/api/')) {
      return sendJson(res, 405, { ok: false, error: { code: 'METHOD', message: 'Use POST for this endpoint.' } });
    }
    return serveStatic(res, url.pathname);
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: { code: 'METHOD', message: 'Method not allowed.' } });
  }

  try {
    const body = await readBody(req);

    if (url.pathname === '/api/extract') {
      const result = await extractFromUrl(body.url, {
        providerHint: body.provider || null,
        allowAnyHost: Boolean(body.allowAnyHost),
      });
      return sendJson(res, 200, withFiles(result));
    }

    if (url.pathname === '/api/extract-html') {
      const conversation = extractFromHtml(body.html, {
        url: body.url || null,
        provider: body.provider || 'generic',
      });
      if (!conversation) {
        throw new ExportError('NO_CONVERSATION', 'That HTML did not contain a recognizable conversation.', {
          hint: 'Save the page with Ctrl+S ("Webpage, HTML only") after the whole chat has rendered.',
          suggestions: ['Scroll to the bottom of the chat first.', 'Or use the browser capture snippet instead.'],
        });
      }
      return sendJson(res, 200, withFiles({ ok: true, conversation, attempts: [{ strategy: 'saved-html' }] }));
    }

    if (url.pathname === '/api/extract-text') {
      const conversation = extractFromTranscript(body.text, {
        provider: body.provider || 'generic',
        url: body.url || null,
        title: body.title || null,
      });
      return sendJson(res, 200, withFiles({ ok: true, conversation, attempts: [{ strategy: 'pasted-text' }] }));
    }

    return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'Unknown endpoint.' } });
  } catch (error) {
    const payload = errorPayload(error);
    if (payload.error.code === 'INTERNAL') console.error(error);
    return sendJson(res, 400, payload);
  }
}

export function createServer() {
  return http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      console.error(error);
      if (!res.headersSent) sendJson(res, 500, errorPayload(error));
    });
  });
}

async function listen(port, attemptsLeft = 12) {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE' && attemptsLeft > 0) {
        listen(port + 1, attemptsLeft - 1).then(resolve, reject);
        return;
      }
      reject(error);
    });
    server.listen(port, '127.0.0.1', () => resolve({ server, port }));
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  const basePort = Number(process.env.PORT || 8765);
  const { port } = await listen(basePort);
  console.log(`\n  Chat Exporter is running:  http://127.0.0.1:${port}\n`);
  console.log('  Paste a share link into the page, or press Ctrl+C to stop.');
  if (process.argv.includes('--open')) {
    const { exec } = await import('node:child_process');
    const url = `http://127.0.0.1:${port}`;
    exec(process.platform === 'win32' ? `start "" "${url}"` : `open "${url}"`);
  }
}