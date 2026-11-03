import test from 'node:test';
import assert from 'node:assert/strict';

import { detectTarget, ExportError } from '../src/providers.mjs';
import { extractFromHtml, extractFromTranscript, sniffProvider } from '../src/extract.mjs';
import { toMarkdown } from '../src/lib/conversation.mjs';

import * as fixtures from './fixtures/data.mjs';

function throwsCode(fn, code) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ExportError, `expected ExportError, got ${error?.name}`);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`expected throw with code ${code}`);
}

test('detect: chatgpt share link', () => {
  const target = detectTarget('https://chatgpt.com/share/68a1b2c3-d4e5-6789-abcd-ef0123456789');
  assert.equal(target.provider, 'chatgpt');
  assert.equal(target.kind, 'share');
  assert.equal(target.id, '68a1b2c3-d4e5-6789-abcd-ef0123456789');
  assert.equal(target.apiUrl, 'https://chatgpt.com/backend-api/share/68a1b2c3-d4e5-6789-abcd-ef0123456789');
});

test('detect: chatgpt private chat has no public API', () => {
  const target = detectTarget('https://chatgpt.com/c/abc123def456');
  assert.equal(target.kind, 'chat');
  assert.equal(target.apiUrl, null);
});

test('detect: claude share link', () => {
  const target = detectTarget('https://claude.ai/share/0f1e2d3c-4b5a-6978-8765-43210fedcba9');
  assert.equal(target.provider, 'claude');
  assert.equal(target.apiUrl, 'https://claude.ai/api/share/0f1e2d3c-4b5a-6978-8765-43210fedcba9');
});

test('detect: gemini and deepseek links', () => {
  assert.equal(detectTarget('https://gemini.google.com/share/abcdef123456').provider, 'gemini');
  const deepseekShare = detectTarget('https://chat.deepseek.com/share/abc123xyz');
  assert.equal(deepseekShare.provider, 'deepseek');
  assert.equal(deepseekShare.kind, 'share');
  const deepseekChat = detectTarget('https://chat.deepseek.com/a/chat/s/abc123xyz');
  assert.equal(deepseekChat.kind, 'chat');
});

test('detect: missing scheme is accepted', () => {
  const target = detectTarget('chatgpt.com/share/abc123def456');
  assert.equal(target.provider, 'chatgpt');
  assert.equal(target.id, 'abc123def456');
});

test('detect: unknown host is rejected unless opted in', () => {
  const error = throwsCode(() => detectTarget('https://example.com/some/page'), 'UNKNOWN_HOST');
  assert.ok(error.suggestions.length > 0);
  const target = detectTarget('https://example.com/some/page', { allowAnyHost: true });
  assert.equal(target.provider, 'generic');
});

test('detect: private and local addresses stay blocked', () => {
  throwsCode(() => detectTarget('http://127.0.0.1:8080/chat', { allowAnyHost: true }), 'BLOCKED_HOST');
  throwsCode(() => detectTarget('http://localhost:3000/', { allowAnyHost: true }), 'BLOCKED_HOST');
  throwsCode(() => detectTarget('http://192.168.1.20/admin', { allowAnyHost: true }), 'BLOCKED_HOST');
});

test('detect: garbage input', () => {
  throwsCode(() => detectTarget(''), 'BAD_URL');
  throwsCode(() => detectTarget('   '), 'BAD_URL');
});

test('extract-html: chatgpt embedded payload', () => {
  const conversation = extractFromHtml(fixtures.chatgptNextHtml, { url: 'https://chatgpt.com/share/x' });
  assert.ok(conversation);
  assert.equal(conversation.provider, 'chatgpt');
  assert.equal(conversation.method, 'embedded-json');
  assert.deepEqual(conversation.messages.map((m) => m.role), ['user', 'assistant']);
  assert.match(conversation.messages[1].text, /A qubit is/);
  assert.equal(conversation.title, 'What is a qubit?');
});

test('extract-html: chatgpt rendered fallback', () => {
  const conversation = extractFromHtml(fixtures.chatgptDomHtml, { provider: 'chatgpt' });
  assert.ok(conversation);
  assert.equal(conversation.method, 'rendered-html');
  assert.equal(conversation.messages.length, 2);
  assert.match(toMarkdown(conversation), /```js/);
});

test('extract-html: claude rendered fallback', () => {
  const conversation = extractFromHtml(fixtures.claudeDomHtml, { provider: 'claude' });
  assert.ok(conversation);
  assert.deepEqual(conversation.messages.map((m) => m.role), ['user', 'assistant']);
});

test('extract-html: gemini and deepseek rendered fallback', () => {
  const gemini = extractFromHtml(fixtures.geminiHtml, { provider: 'gemini' });
  assert.equal(gemini.messages.length, 4);
  const deepseek = extractFromHtml(fixtures.deepseekHtml, { provider: 'deepseek' });
  assert.deepEqual(deepseek.messages.map((m) => m.role), ['user', 'assistant']);
});

test('extract-html: unknown pages yield nothing', () => {
  assert.equal(extractFromHtml('<html><body><h1>Nothing here</h1></body></html>'), null);
  assert.equal(extractFromHtml(''), null);
});

test('extract-html: app shell with site footer is not a conversation', () => {
  // This is the Claude "Untitled conversation / 1 message" false positive:
  // a shell page whose only text is the legal footer.
  assert.equal(extractFromHtml(fixtures.claudeShellHtml, { provider: 'claude' }), null);
  assert.equal(extractFromHtml(fixtures.claudeShellHtml), null);
});

test('extract-html: a lone message is rejected', () => {
  assert.equal(extractFromHtml(fixtures.singleMessageHtml, { provider: 'chatgpt' }), null);
});

test('sniff: provider detection from markup', () => {
  assert.equal(sniffProvider(fixtures.chatgptDomHtml), 'chatgpt');
  assert.equal(sniffProvider(fixtures.claudeDomHtml), 'claude');
  assert.equal(sniffProvider(fixtures.geminiHtml), 'gemini');
  assert.equal(sniffProvider(fixtures.deepseekHtml), 'deepseek');
  assert.equal(sniffProvider('<html><body>plain</body></html>'), 'generic');
});

test('extract-text: parses a pasted chatgpt transcript', () => {
  const conversation = extractFromTranscript(fixtures.chatgptCopyTranscript, { provider: 'chatgpt' });
  assert.equal(conversation.method, 'pasted-text');
  assert.equal(conversation.messages.length, 4);
  assert.equal(conversation.stats.turns, 2);
});

test('extract-text: keeps unlabeled text instead of failing', () => {
  const conversation = extractFromTranscript('A long paragraph without any speaker labels at all.');
  assert.equal(conversation.messages.length, 1);
  assert.match(conversation.note, /No speaker labels/);
});

test('extract-text: empty input is an error', () => {
  throwsCode(() => extractFromTranscript('   '), 'EMPTY_TEXT');
});