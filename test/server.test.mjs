import test from 'node:test';
import assert from 'node:assert/strict';

import { createServer } from '../server.mjs';
import * as fixtures from './fixtures/data.mjs';

let server;
let base;

test.before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

async function post(path, body) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

test('http: serves the UI and assets', async () => {
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  const html = await page.text();
  assert.match(html, /Chat Exporter/);
  assert.match(html, /\/app\.js/);

  for (const [path, type] of [
    ['/styles.css', /text\/css/],
    ['/app.js', /javascript/],
    ['/bookmarklet.js', /javascript/],
    ['/favicon.svg', /image\/svg/],
  ]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, `${path} should exist`);
    assert.match(response.headers.get('content-type'), type);
  }
});

test('http: health endpoint', async () => {
  const response = await fetch(base + '/api/health');
  const payload = await response.json();
  assert.equal(payload.ok, true);
});

test('http: extract from saved HTML returns copyable files', async () => {
  const { status, json } = await post('/api/extract-html', {
    html: fixtures.claudeDomHtml,
    provider: 'claude',
  });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.conversation.messages.length, 2);
  assert.match(json.files.markdown, /## User/);
  assert.match(json.files.markdown, /## Assistant/);
  const parsed = JSON.parse(json.files.json);
  assert.equal(parsed.provider, 'claude');
  assert.match(json.files.text, /\[User\]/);
});

test('http: extract from pasted text', async () => {
  const { status, json } = await post('/api/extract-text', { text: fixtures.chatgptCopyTranscript });
  assert.equal(status, 200);
  assert.equal(json.conversation.messages.length, 4);
  assert.equal(json.conversation.method, 'pasted-text');
});

test('http: unusable HTML is reported clearly', async () => {
  const { status, json } = await post('/api/extract-html', { html: '<html><body><footer>hi</footer></body></html>' });
  assert.equal(status, 400);
  assert.equal(json.ok, false);
  assert.equal(json.error.code, 'NO_CONVERSATION');
  assert.ok(json.error.suggestions.length > 0);
});

test('http: link validation errors', async () => {
  const bad = await post('/api/extract', { url: 'not a url at all' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, 'BAD_URL');

  const unknown = await post('/api/extract', { url: 'https://example.com/post/1' });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.json.error.code, 'UNKNOWN_HOST');
});

test('http: unknown routes', async () => {
  const response = await fetch(base + '/nope');
  assert.equal(response.status, 404);
  const method = await fetch(base + '/api/extract');
  assert.equal(method.status, 405);
});