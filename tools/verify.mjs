const base = `http://127.0.0.1:${process.env.PORT || 8765}`;

const results = [];

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await check('GET / (UI)', async () => {
  const res = await fetch(base + '/');
  const html = await res.text();
  assert(res.status === 200, `status ${res.status}`);
  assert(html.includes('Chat Exporter'), 'missing title');
  assert(html.includes('id="export-form"'), 'missing form');
  return `${html.length} bytes`;
});

await check('GET assets', async () => {
  const sizes = {};
  for (const path of ['/styles.css', '/app.js', '/bookmarklet.js', '/favicon.svg']) {
    const res = await fetch(base + path);
    const text = await res.text();
    assert(res.status === 200, `${path} status ${res.status}`);
    sizes[path] = text.length;
  }
  return JSON.stringify(sizes);
});

await check('POST /api/extract-text', async () => {
  const res = await fetch(base + '/api/extract-text', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text: 'You said:\nWhat is 2 + 2?\n\nChatGPT said:\nIt is 4.\n\nYou said:\nWhy?\n\nChatGPT said:\nBecause addition counts items.',
    }),
  });
  const json = await res.json();
  assert(json.ok, JSON.stringify(json.error || json));
  assert(json.conversation.messages.length === 4, `got ${json.conversation.messages.length} messages`);
  assert(json.files.markdown.includes('## User'), 'markdown missing user heading');
  assert(json.files.markdown.includes('Because addition counts items.'), 'markdown missing content');
  return `${json.conversation.messages.length} messages, ${json.files.markdown.length} md bytes`;
});

await check('POST /api/extract-html (gemini fixture)', async () => {
  const html = `<html><body><user-query><div class="query-text">What is a supernova?</div></user-query><model-response><div class="markdown"><p>A supernova is the explosive death of a massive star.</p></div></model-response></body></html>`;
  const res = await fetch(base + '/api/extract-html', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ html, provider: 'gemini' }),
  });
  const json = await res.json();
  assert(json.ok, JSON.stringify(json.error || json));
  assert(json.conversation.messages.length === 2, 'expected 2 messages');
  assert(json.conversation.provider === 'gemini', 'provider should be gemini');
  return json.files.markdown.split('\n')[0];
});

await check('POST /api/extract (dead ChatGPT share link)', async () => {
  const res = await fetch(base + '/api/extract', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://chatgpt.com/share/00000000-0000-0000-0000-000000000000' }),
  });
  const json = await res.json();
  assert(!json.ok, 'expected a graceful failure');
  assert(['NOT_FOUND', 'NO_CONVERSATION', 'BOT_WALL'].includes(json.error.code), json.error.code);
  assert(Array.isArray(json.error.attempts) && json.error.attempts.length > 0, 'no attempts recorded');
  return `${json.error.code}: ${json.error.message} | attempts=${json.error.attempts.map((a) => a.strategy).join(',')}`;
});

await check('POST /api/extract (unknown host)', async () => {
  const res = await fetch(base + '/api/extract', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/whatever' }),
  });
  const json = await res.json();
  assert(json.error.code === 'UNKNOWN_HOST', json.error.code);
  return 'refused as expected';
});

console.log('');
for (const { name, ok, detail } of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exitCode = failed ? 1 : 0;