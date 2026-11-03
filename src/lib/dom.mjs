// DOM-based extraction: for saved pages and the bookmarklet fallback.

import { parseHtml, queryAll, queryOne, textContent, toMarkdown } from './html.mjs';
import { normalizeRole } from './json-scan.mjs';

const CHROME_SELECTOR = 'script, style, noscript, template, svg, nav, header, footer, form, input, textarea, button, select';

function contentOf(node, candidates) {
  for (const selector of candidates) {
    const found = queryOne(node, selector);
    if (found) return found;
  }
  return node;
}

/**
 * Each rule maps elements to a role and the subtree holding the message body.
 * Specific selectors come first so nested matches can be deduplicated by text.
 */
const RULES = {
  chatgpt: [
    {
      selector: '[data-message-author-role]',
      role: (node) => node.attrs['data-message-author-role'],
      content: (node) => contentOf(node, ['.markdown', '.prose', '.whitespace-pre-wrap']),
    },
    {
      selector: '[data-testid^="conversation-turn"]',
      role: (node) => {
        const inner = queryOne(node, '[data-message-author-role]');
        return inner ? inner.attrs['data-message-author-role'] : null;
      },
      content: (node) => node,
    },
  ],
  claude: [
    { selector: '[data-testid="user-message"]', role: () => 'user', content: (node) => node },
    {
      selector: '[data-testid="assistant-message"], [data-is-streaming]',
      role: () => 'assistant',
      content: (node) => contentOf(node, ['.font-claude-message', '.prose', '.markdown']),
    },
    { selector: '.font-claude-message', role: () => 'assistant', content: (node) => node },
  ],
  gemini: [
    { selector: 'user-query', role: () => 'user', content: (node) => contentOf(node, ['.query-text', '.query-content']) },
    {
      selector: 'model-response',
      role: () => 'assistant',
      content: (node) => contentOf(node, ['.markdown', '.model-response-text', '.response-content']),
    },
    { selector: '.query-text', role: () => 'user', content: (node) => node },
    { selector: '.model-response-text', role: () => 'assistant', content: (node) => node },
  ],
  deepseek: [
    {
      selector: '[data-role], [data-author], [data-message-role]',
      role: (node) =>
        node.attrs['data-role'] || node.attrs['data-author'] || node.attrs['data-message-role'] || null,
      content: (node) => contentOf(node, ['.ds-markdown', '.markdown']),
    },
    { selector: '.ds-markdown', role: (node) => ancestorRole(node) || 'assistant', content: (node) => node },
  ],
  generic: [
    {
      selector: '[data-message-author-role], [data-role], [data-author], [data-message-role]',
      role: (node) =>
        node.attrs['data-message-author-role'] ||
        node.attrs['data-role'] ||
        node.attrs['data-author'] ||
        node.attrs['data-message-role'] ||
        null,
      content: (node) => contentOf(node, ['.markdown', '.prose', '.ds-markdown']),
    },
    { selector: 'article', role: () => null, content: (node) => node },
  ],
};

function documentOrder(root) {
  const order = new Map();
  let index = 0;
  const walk = (node) => {
    order.set(node, index++);
    for (const child of node.children) walk(child);
  };
  for (const child of root.children) walk(child);
  return order;
}

export function providerDomRules(provider) {
  const own = RULES[provider] || [];
  const generic = RULES.generic;
  return [...own, ...generic];
}

/** Role declared on an enclosing element, for sites that only label containers. */
function ancestorRole(node) {
  let current = node.parent;
  let depth = 0;
  while (current && current.tag !== '#root' && depth++ < 10) {
    const attrs = current.attrs || {};
    const declared =
      attrs['data-message-author-role'] || attrs['data-role'] || attrs['data-author'] || attrs['data-message-role'];
    const role = normalizeRole(declared);
    if (role) return role;
    current = current.parent;
  }
  return null;
}

/** Build messages from rendered DOM markup. */
export function extractFromDom(html, provider = 'generic') {
  const root = parseHtml(html);
  const order = documentOrder(root);
  const rules = providerDomRules(provider);
  const hits = [];

  for (const rule of rules) {
    for (const node of queryAll(root, rule.selector)) {
      const role = normalizeRole(rule.role(node)) || ancestorRole(node);
      if (!role) continue;
      const content = rule.content(node);
      const text = toMarkdown(content);
      if (!text || text.length < 2) continue;
      hits.push({ node, role, text, order: order.get(node) ?? 0, span: textContent(node).length });
    }
  }

  // Deduplicate nested or identical matches, keeping the first (most specific).
  hits.sort((a, b) => a.order - b.order);
  const messages = [];
  for (const hit of hits) {
    const duplicate = messages.some((existing) => {
      if (existing.role !== hit.role) return false;
      if (existing.text === hit.text) return true;
      // A nested container repeats its child's text: keep the shorter, specific one.
      return existing.text.includes(hit.text) || hit.text.includes(existing.text);
    });
    if (duplicate) continue;
    messages.push({ role: hit.role, text: hit.text });
  }

  return messages;
}

/** Strip page chrome and return readable text. */
export function visibleText(html) {
  const root = parseHtml(html);
  for (const node of queryAll(root, CHROME_SELECTOR)) {
    node.children.length = 0;
  }
  return toMarkdown(root);
}

const SPEAKER_WORDS =
  'you|user|human|me|assistant|chatgpt|gpt-?[0-9a-z.\\-]*|claude|gemini|bard|deepseek|ai|model|bot|system';
const SPEAKER_LINE = new RegExp(
  `^\\s*(?:#{1,6}\\s*)?\\**\\s*(${SPEAKER_WORDS})\\s*\\**\\s*(?:said|wrote|says|replied)?\\s*:?\\s*\\**\\s*$`,
  'i',
);
const SPEAKER_INLINE = new RegExp(
  `^\\s*(?:#{1,6}\\s*)?(${SPEAKER_WORDS})\\s*(?:said|wrote|says|replied)?\\s*:\\s*(.*)$`,
  'i',
);

function speakerRole(word) {
  const normalized = normalizeRole(word);
  if (normalized) return normalized;
  if (/^(chatgpt|gpt|claude|gemini|bard|deepseek|ai|model|bot|openai)\b/i.test(String(word))) return 'assistant';
  return null;
}

/**
 * Parse a pasted transcript ("You said: ... ChatGPT said: ...", "User: ...",
 * or the Markdown this app exports).
 */
export function parseTranscript(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const messages = [];
  let current = null;

  const start = (role, seed) => {
    if (current) {
      const previous = current.lines.join('\n').trim();
      if (previous) messages.push({ role: current.role, text: previous });
    }
    current = { role, lines: seed ? [seed] : [] };
  };

  for (const line of lines) {
    const inline = SPEAKER_INLINE.exec(line);
    if (inline) {
      const role = speakerRole(inline[1]);
      if (role) {
        const rest = (inline[2] || '').trim();
        // "Note: ..." style lines are not speaker turns unless the body is long.
        if (rest || !current) {
          start(role, rest);
          continue;
        }
        start(role, '');
        continue;
      }
    }
    const marker = SPEAKER_LINE.exec(line);
    if (marker) {
      const role = speakerRole(marker[1]);
      if (role) {
        start(role, '');
        continue;
      }
    }
    if (current) current.lines.push(line);
  }
  if (current) {
    const textValue = current.lines.join('\n').trim();
    if (textValue) messages.push({ role: current.role, text: textValue });
  }

  // Merge accidental splits of the same speaker.
  const merged = [];
  for (const message of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === message.role) last.text += '\n\n' + message.text;
    else merged.push({ ...message });
  }
  return merged.filter((m) => m.text.trim().length > 0);
}