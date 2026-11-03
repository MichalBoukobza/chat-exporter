// Minimal, dependency-free HTML parser + query helpers.
// Scope: enough to read server-rendered chat transcripts and saved pages.
// It is tolerant of malformed markup and never throws on bad input.

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr',
]);

// Tags whose content is text, not markup.
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  hellip: '\u2026', mdash: '\u2014', ndash: '\u2013', lsquo: '\u2018',
  rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', copy: '\u00a9',
  reg: '\u00ae', trade: '\u2122', middot: '\u00b7', bull: '\u2022',
  times: '\u00d7', divide: '\u00f7', laquo: '\u00ab', raquo: '\u00bb',
  deg: '\u00b0', euro: '\u20ac', pound: '\u00a3', yen: '\u00a5',
};

export function decodeEntities(text) {
  if (!text || text.indexOf('&') === -1) return text;
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (full, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return full;
      try {
        return String.fromCodePoint(code);
      } catch {
        return full;
      }
    }
    const named = NAMED_ENTITIES[body];
    return named === undefined ? full : named;
  });
}

function findTagEnd(html, start) {
  let quote = null;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

const ATTR_RE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function parseAttributes(source) {
  const attrs = Object.create(null);
  ATTR_RE.lastIndex = 0;
  let match;
  while ((match = ATTR_RE.exec(source))) {
    const name = match[1].toLowerCase();
    if (!name || name === '/' || name.startsWith('--')) continue;
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[name] = decodeEntities(value);
  }
  return attrs;
}

function element(tag, attrs, parent) {
  return { tag, attrs, children: [], parent };
}

function textNode(text, parent) {
  return { tag: '#text', text, attrs: Object.create(null), children: [], parent };
}

/**
 * Parse an HTML document into a lightweight tree.
 * Node shape: { tag, attrs, children, parent } and text nodes { tag: '#text', text }.
 */
export function parseHtml(html) {
  const source = String(html ?? '');
  const root = { tag: '#root', attrs: Object.create(null), children: [], parent: null };
  const stack = [root];
  let current = root;
  let i = 0;

  const appendText = (raw) => {
    if (!raw) return;
    current.children.push(textNode(decodeEntities(raw), current));
  };

  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt === -1) {
      appendText(source.slice(i));
      break;
    }
    if (lt > i) appendText(source.slice(i, lt));

    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    // Doctype / processing instructions / CDATA.
    if (source.startsWith('<!', lt) || source.startsWith('<?', lt)) {
      const end = source.indexOf('>', lt);
      i = end === -1 ? source.length : end + 1;
      continue;
    }

    const end = findTagEnd(source, lt + 1);
    if (end === -1) {
      appendText(source.slice(lt));
      break;
    }

    const raw = source.slice(lt + 1, end);
    i = end + 1;

    if (raw[0] === '/') {
      const name = raw.slice(1).trim().toLowerCase();
      for (let s = stack.length - 1; s >= 1; s--) {
        if (stack[s].tag === name) {
          stack.length = s;
          current = stack[s - 1];
          break;
        }
      }
      continue;
    }

    const selfClosing = /\/\s*$/.test(raw);
    const body = selfClosing ? raw.replace(/\/\s*$/, '') : raw;
    const nameMatch = /^([a-zA-Z][^\s/>]*)/.exec(body);
    if (!nameMatch) continue;

    const tag = nameMatch[1].toLowerCase();
    const node = element(tag, parseAttributes(body.slice(nameMatch[0].length)), current);
    current.children.push(node);

    if (RAW_TEXT_TAGS.has(tag) && !selfClosing) {
      const lower = source.toLowerCase();
      const close = lower.indexOf('</' + tag, i);
      const contentEnd = close === -1 ? source.length : close;
      const content = source.slice(i, contentEnd);
      if (content) {
        const isCode = tag === 'script' || tag === 'style';
        node.children.push(textNode(isCode ? content : decodeEntities(content), node));
      }
      if (close === -1) {
        i = source.length;
      } else {
        const closeEnd = source.indexOf('>', close);
        i = closeEnd === -1 ? source.length : closeEnd + 1;
      }
      continue;
    }

    if (!selfClosing && !VOID_TAGS.has(tag)) {
      stack.push(node);
      current = node;
    }
  }

  return root;
}

// ---------------------------------------------------------------- selectors

function parseCompound(compound) {
  const spec = { tag: null, classes: [], attrs: [] };
  let rest = compound;
  const tagMatch = /^([a-zA-Z][a-zA-Z0-9-]*|\*)/.exec(rest);
  if (tagMatch) {
    spec.tag = tagMatch[1] === '*' ? null : tagMatch[1].toLowerCase();
    rest = rest.slice(tagMatch[0].length);
  }
  let guard = 0;
  while (rest.length && guard++ < 200) {
    if (rest[0] === '.') {
      const m = /^\.([A-Za-z0-9_-]+)/.exec(rest);
      if (!m) break;
      spec.classes.push(m[1]);
      rest = rest.slice(m[0].length);
      continue;
    }
    if (rest[0] === '#') {
      const m = /^#([A-Za-z0-9_-]+)/.exec(rest);
      if (!m) break;
      spec.attrs.push({ name: 'id', op: '=', value: m[1] });
      rest = rest.slice(m[0].length);
      continue;
    }
    if (rest[0] === '[') {
      const close = rest.indexOf(']');
      if (close === -1) break;
      const inner = rest.slice(1, close).trim();
      const m = /^([A-Za-z0-9_:-]+)\s*(?:([*^$~|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]]*)))?$/.exec(inner);
      if (m) {
        spec.attrs.push({ name: m[1].toLowerCase(), op: m[2] || null, value: (m[3] ?? m[4] ?? m[5] ?? '') });
      }
      rest = rest.slice(close + 1);
      continue;
    }
    break;
  }
  return spec;
}

function attrIsTrue(value) {
  // React SSR renders boolean attributes as ""
  return value !== undefined && value !== 'false';
}

function matchesCompound(node, spec) {
  if (!node || node.tag === '#text' || node.tag === '#root') return false;
  if (spec.tag && node.tag !== spec.tag) return false;
  for (const cls of spec.classes) {
    const list = (node.attrs.class || '').split(/\s+/);
    if (!list.includes(cls)) return false;
  }
  for (const { name, op, value } of spec.attrs) {
    const actual = node.attrs[name];
    if (actual === undefined) return false;
    if (!op) {
      if (!attrIsTrue(actual)) return false;
      continue;
    }
    if (op === '=') {
      if (actual !== value) return false;
    } else if (op === '*=') {
      if (!actual.includes(value)) return false;
    } else if (op === '^=') {
      if (!actual.startsWith(value)) return false;
    } else if (op === '$=') {
      if (!actual.endsWith(value)) return false;
    } else if (op === '~=') {
      if (!actual.split(/\s+/).includes(value)) return false;
    } else if (op === '|=') {
      if (actual !== value && !actual.startsWith(value + '-')) return false;
    }
  }
  return true;
}

const selectorCache = new Map();

function compileSelector(selector) {
  const key = String(selector);
  if (selectorCache.has(key)) return selectorCache.get(key);
  const groups = key
    .split(',')
    .map((group) => group.trim().split(/\s+/).filter(Boolean).map(parseCompound))
    .filter((chain) => chain.length);
  selectorCache.set(key, groups);
  return groups;
}

function* descendants(node) {
  const stack = [...node.children].reverse();
  while (stack.length) {
    const next = stack.pop();
    yield next;
    if (next.children.length) {
      for (let i = next.children.length - 1; i >= 0; i--) stack.push(next.children[i]);
    }
  }
}

/** All descendants matching any selector group (supports descendant chains). */
export function queryAll(root, selector) {
  if (!root) return [];
  const groups = compileSelector(selector);
  const results = [];
  const seen = new Set();
  for (const chain of groups) {
    let frontier = [root];
    for (const spec of chain) {
      const next = [];
      const visited = new Set();
      for (const node of frontier) {
        for (const child of descendants(node)) {
          if (visited.has(child)) continue;
          if (matchesCompound(child, spec)) {
            visited.add(child);
            next.push(child);
          }
        }
      }
      frontier = next;
      if (!frontier.length) break;
    }
    for (const node of frontier) {
      if (!seen.has(node)) {
        seen.add(node);
        results.push(node);
      }
    }
  }
  // Document order.
  const order = new Map();
  let index = 0;
  for (const node of descendants(root)) order.set(node, index++);
  results.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return results;
}

export function queryOne(root, selector) {
  return queryAll(root, selector)[0] || null;
}

export function closest(node, selector) {
  const groups = compileSelector(selector);
  let current = node;
  while (current && current.tag !== '#root') {
    for (const chain of groups) {
      if (matchesCompound(current, chain[chain.length - 1])) return current;
    }
    current = current.parent;
  }
  return null;
}

export function tagOf(node) {
  return node && node.tag !== '#text' ? node.tag : null;
}

export function attr(node, name) {
  return node && node.attrs ? node.attrs[String(name).toLowerCase()] : undefined;
}

export function textContent(node) {
  if (!node) return '';
  if (node.tag === '#text') return node.text;
  let out = '';
  for (const child of node.children) out += textContent(child);
  return out;
}

// ------------------------------------------------------------- to markdown

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'dd', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section',
  'summary', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'ul', 'user-query',
  'model-response', 'message', 'chat-message',
]);

function normalizeInline(text) {
  return text.replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n');
}

/** Render a subtree to readable Markdown-ish text. */
export function toMarkdown(node, options = {}) {
  const parts = [];
  const render = (n, ctx) => {
    if (!n) return '';
    if (n.tag === '#text') return n.text;

    const tag = n.tag;
    const children = () => n.children.map((c) => render(c, ctx)).join('');

    if (tag === 'br') return '\n';
    if (tag === 'hr') return '\n\n---\n\n';
    if (tag === 'img') {
      const alt = n.attrs.alt || '';
      const src = n.attrs.src || '';
      return alt || src ? `![${alt}](${src})` : '';
    }
    if (tag === 'script' || tag === 'style' || tag === 'template' || tag === 'noscript') return '';
    if (tag === 'pre') {
      const codeEl = queryOne(n, 'code');
      const target = codeEl || n;
      let code = textContent(target).replace(/^\n+|\n+$/g, '');
      let lang = '';
      const cls = (target.attrs.class || '') + ' ' + (n.attrs.class || '');
      const langMatch = /(?:language|lang)-([A-Za-z0-9_+#-]+)/.exec(cls);
      if (langMatch) lang = langMatch[1];
      const fence = code.includes('```') ? '~~~~' : '```';
      return `\n\n${fence}${lang}\n${code}\n${fence}\n\n`;
    }
    if (tag === 'code') {
      const raw = textContent(n);
      if (!raw) return '';
      const fence = raw.includes('`') ? '``' : '`';
      return `${fence}${raw}${fence}`;
    }
    if (tag === 'a') {
      const href = n.attrs.href || '';
      const label = children().trim();
      if (!label) return '';
      if (!href || href.startsWith('javascript:')) return label;
      return `[${label}](${href})`;
    }
    if (tag === 'strong' || tag === 'b') {
      const inner = children().trim();
      return inner ? `**${inner}**` : '';
    }
    if (tag === 'em' || tag === 'i') {
      const inner = children().trim();
      return inner ? `*${inner}*` : '';
    }
    if (tag === 'del' || tag === 's') {
      const inner = children().trim();
      return inner ? `~~${inner}~~` : '';
    }
    const headingMatch = /^h([1-6])$/.exec(tag);
    if (headingMatch) {
      const inner = children().trim();
      return inner ? `\n\n${'#'.repeat(Number(headingMatch[1]))} ${inner}\n\n` : '';
    }
    if (tag === 'li') {
      const inner = children().trim();
      const marker = ctx.ordered ? `${ctx.ordered}. ` : '- ';
      return inner ? `\n${marker}${inner}` : '';
    }
    if (tag === 'ul' || tag === 'ol') {
      const ordered = tag === 'ol';
      const inner = n.children.map((c) => render(c, { ...ctx, ordered })).join('');
      return `\n${inner}\n`;
    }
    if (tag === 'blockquote') {
      const inner = children().trim();
      if (!inner) return '';
      return '\n\n' + inner.split('\n').map((line) => `> ${line}`).join('\n') + '\n\n';
    }
    if (tag === 'table') {
      const rows = queryAll(n, 'tr');
      if (rows.length) {
        const lines = rows.map((row) => {
          const cells = queryAll(row, 'th, td').map((c) => normalizeInline(textContent(c)).trim());
          return `| ${cells.join(' | ')} |`;
        });
        if (lines.length > 1) {
          const headerCells = queryAll(rows[0], 'th, td').length;
          lines.splice(1, 0, `| ${Array(headerCells).fill('---').join(' | ')} |`);
        }
        return `\n\n${lines.join('\n')}\n\n`;
      }
    }
    if (BLOCK_TAGS.has(tag)) {
      const inner = children();
      const cleaned = inner.replace(/^\n+|\n+$/g, '');
      if (!cleaned) return '';
      return `\n\n${cleaned}\n\n`;
    }
    return children();
  };

  for (const child of node.children) parts.push(render(child, {}));
  return normalizeInline(parts.join(''))
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+$/g, '\n')
    .trim();
}

export function innerText(node) {
  return textContent(node).replace(/[ \t\u00a0]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}