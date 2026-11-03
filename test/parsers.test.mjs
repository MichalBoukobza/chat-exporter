import test from 'node:test';
import assert from 'node:assert/strict';

import { parseHtml, queryAll, queryOne, textContent, toMarkdown, decodeEntities } from '../src/lib/html.mjs';
import { findConversation, mappingToMessages, normalizeRole, textFromContent } from '../src/lib/json-scan.mjs';
import { scanEmbeddedData } from '../src/lib/embedded.mjs';
import { extractFromDom, parseTranscript } from '../src/lib/dom.mjs';
import { toMarkdown as conversationMarkdown, toJson, toPlainText, buildConversation } from '../src/lib/conversation.mjs';

import * as fixtures from './fixtures/data.mjs';

test('html: decodes entities', () => {
  const decoded = decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &nbsp;&#39;x&#x41;&#x42;&#39;');
  assert.equal(decoded, 'a & b <c> "d" ' + '\u00a0' + "'xAB'");
  assert.match(decoded, /\u00a0/);
  assert.equal(decodeEntities('no entities here'), 'no entities here');
});

test('html: builds a tree and reads text', () => {
  const root = parseHtml('<div class="a"><p>Hello <strong>world</strong></p><br><img src="x.png" alt="pic"></div>');
  const div = queryOne(root, 'div.a');
  assert.ok(div, 'div with class matches');
  assert.equal(textContent(div).trim(), 'Hello world');
  assert.equal(queryAll(root, 'p').length, 1);
  assert.equal(queryOne(root, 'img').attrs.alt, 'pic');
});

test('html: toMarkdown handles code, lists, links and headings', () => {
  const html = `
    <h2>Title</h2>
    <p>See <a href="https://example.com">this</a> and <code>inline()</code>.</p>
    <pre><code class="language-python">print("hi")\nprint("there")</code></pre>
    <ul><li>one</li><li>two</li></ul>`;
  const output = toMarkdown(parseHtml(html));
  assert.match(output, /^## Title/m);
  assert.match(output, /\[this\]\(https:\/\/example\.com\)/);
  assert.match(output, /`inline\(\)`/);
  assert.match(output, /```python\nprint\("hi"\)\nprint\("there"\)\n```/);
  assert.match(output, /- one/);
  assert.match(output, /- two/);
});

test('json-scan: chatgpt mapping keeps the displayed branch', () => {
  const messages = mappingToMessages(fixtures.chatgptApi.mapping);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'user');
  assert.match(messages[0].text, /qubit/);
  assert.equal(messages[1].role, 'assistant');
  assert.match(messages[1].text, /A qubit is/);
  assert.doesNotMatch(messages[1].text, /old answer/);
});

test('json-scan: finds the richest conversation in a wrapped payload', () => {
  const payload = {
    props: { pageProps: { serverResponse: { data: { title: 'Qubits', mapping: fixtures.chatgptApi.mapping } } } },
  };
  const found = findConversation(payload);
  assert.ok(found);
  assert.equal(found.messages.length, 2);
  assert.equal(found.title, 'Qubits');
});

test('json-scan: claude chat_messages with content blocks', () => {
  const found = findConversation(fixtures.claudeApi);
  assert.ok(found);
  assert.equal(found.title, 'Entropy questions');
  assert.deepEqual(found.messages.map((m) => m.role), ['user', 'assistant']);
  assert.match(found.messages[1].text, /many ways/);
  assert.doesNotMatch(found.messages[1].text, /calculator/);
});

test('json-scan: plain messages array with parts', () => {
  const found = findConversation({
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    ],
  });
  assert.equal(found.messages.length, 2);
  assert.equal(found.messages[1].text, 'hello');
});

test('json-scan: helpers', () => {
  assert.equal(normalizeRole('Human'), 'user');
  assert.equal(normalizeRole('assistant'), 'assistant');
  assert.equal(normalizeRole('narrator'), null);
  assert.equal(textFromContent({ parts: ['a', { type: 'text', text: 'b' }, { type: 'image_url', url: 'x' }] }), 'a\nb');
});

test('embedded: __NEXT_DATA__ payload', () => {
  const found = scanEmbeddedData(fixtures.chatgptNextHtml);
  assert.ok(found.length >= 1);
  assert.equal(found[0].messages.length, 2);
});

test('embedded: React Flight escaped payload', () => {
  const found = scanEmbeddedData(fixtures.chatgptFlightHtml);
  assert.ok(found.length >= 1, 'flight chunk should be parsed');
  assert.match(found[0].messages[1].text, /A qubit is/);
});

test('embedded: Google AF_initDataCallback payload', () => {
  const found = scanEmbeddedData(fixtures.geminiBatchedHtml);
  assert.ok(found.length >= 1);
  const combined = found[0].messages.map((m) => m.text).join('\n');
  assert.match(combined, /tallest mountain/i);
});

test('dom: chatgpt rendered markup', () => {
  const messages = extractFromDom(fixtures.chatgptDomHtml, 'chatgpt');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'user');
  assert.match(messages[0].text, /Hello \*\*there\*\*/);
  assert.match(messages[1].text, /```js\nconsole\.log\("hi"\);\n```/);
});

test('dom: claude rendered markup', () => {
  const messages = extractFromDom(fixtures.claudeDomHtml, 'claude');
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant']);
  assert.match(messages[1].text, /arranged/);
});

test('dom: gemini rendered markup', () => {
  const messages = extractFromDom(fixtures.geminiHtml, 'gemini');
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.match(messages[0].text, /supernova/);
});

test('dom: deepseek rendered markup', () => {
  const messages = extractFromDom(fixtures.deepseekHtml, 'deepseek');
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant']);
  assert.match(messages[1].text, /calling itself/);
});

test('transcript: chatgpt copy format', () => {
  const messages = parseTranscript(fixtures.chatgptCopyTranscript);
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.match(messages[1].text, /equals 4/);
});

test('transcript: this app markdown format', () => {
  const messages = parseTranscript(fixtures.markdownTranscript);
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.match(messages[0].text, /who are you/);
});

test('transcript: returns nothing without speaker markers', () => {
  assert.deepEqual(parseTranscript('just a block of text\nwith no labels'), []);
});

test('conversation: markdown, text and json outputs', () => {
  const conversation = buildConversation({
    provider: 'chatgpt',
    title: 'Demo chat',
    sourceUrl: 'https://chatgpt.com/share/abc',
    messages: [
      { role: 'user', text: 'Hi' },
      { role: 'assistant', text: 'Hello there' },
    ],
    method: 'share-api',
  });
  const markdown = conversationMarkdown(conversation);
  assert.match(markdown, /^# Demo chat/);
  assert.match(markdown, /Exported from ChatGPT/);
  assert.match(markdown, /## User\n\nHi/);
  assert.match(markdown, /## Assistant\n\nHello there/);
  assert.match(markdown, /Source: https:\/\/chatgpt\.com\/share\/abc/);

  const json = JSON.parse(toJson(conversation));
  assert.equal(json.provider, 'chatgpt');
  assert.equal(json.messages.length, 2);
  assert.equal(json.messages[1].role, 'assistant');
  assert.equal(json.stats.messages, 2);

  const text = toPlainText(conversation);
  assert.match(text, /\[User\]\nHi/);
});

test('conversation: drops empty and duplicate turns', () => {
  const conversation = buildConversation({
    provider: 'claude',
    messages: [
      { role: 'user', text: '  ' },
      { role: 'user', text: 'same' },
      { role: 'user', text: 'same' },
      { role: 'assistant', text: 'reply' },
    ],
    method: 'test',
  });
  assert.deepEqual(conversation.messages.map((m) => m.text), ['same', 'reply']);
});