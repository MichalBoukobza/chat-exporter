// Recover conversation data embedded in a saved HTML page.
//
// Chat UIs ship the transcript in one of several serialized forms:
//   - <script type="application/json" id="__NEXT_DATA__">
//   - window.__remixContext = {...} / window.__reactRouterContext = {...}
//   - self.__next_f.push([1, "..."]) React Flight chunks
//   - Google's af_initDataCallback({key: ..., data: [...]})
//   - plain JSON fragments inside inline scripts
// We try all of them and keep whichever yields the richest transcript.

import { parseHtml, queryAll, textContent } from './html.mjs';
import { findConversation } from './json-scan.mjs';

function tryParseJson(text) {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Tolerate JS-ish JSON: trailing commas, undefined, NaN, single quotes.
    try {
      const cleaned = trimmed
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/\bundefined\b/g, 'null')
        .replace(/\bNaN\b/g, 'null');
      return JSON.parse(cleaned);
    } catch {
      return undefined;
    }
  }
}

/** Slice the balanced {...} or [...] literal that starts at `start`. */
export function balancedSlice(text, start) {
  const open = text[start];
  if (open !== '{' && open !== '[') return null;
  let depth = 0;
  let inString = false;
  let quote = '';
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function findEnclosingLiteral(text, keyIndex) {
  // Walk backwards from the key to the nearest opening brace/bracket and try
  // to parse an object that contains it.
  let tries = 0;
  const lowerBound = Math.max(0, keyIndex - 20000);
  for (let i = keyIndex - 1; i >= lowerBound && tries < 120; i--) {
    const ch = text[i];
    if (ch !== '{' && ch !== '[') continue;
    tries++;
    const slice = balancedSlice(text, i);
    if (!slice) continue;
    if (!slice.includes('"') && !slice.includes("'")) continue;
    const parsed = tryParseJson(slice) ?? tryParseJson(slice.replace(/([{,]\s*)'/g, '$1"').replace(/'\s*([,}])/g, '"$1'));
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

const CONVERSATION_KEYS = ['"mapping"', '"chat_messages"', '"linear_conversation"', '"messages"', '"contents"'];

function scanKeyedLiterals(text, snippets) {
  // Avoid walking huge documents that cannot contain a transcript.
  if (!text.includes('"role"') && !text.includes('"sender"') && !text.includes('"mapping"')) return;
  for (const key of CONVERSATION_KEYS) {
    let index = text.indexOf(key);
    let scanned = 0;
    while (index !== -1 && scanned < 40) {
      scanned++;
      const parsed = findEnclosingLiteral(text, index);
      if (parsed !== undefined) snippets.push(parsed);
      index = text.indexOf(key, index + key.length);
    }
  }
}

function pushIfConversation(parsed, found) {
  if (parsed === undefined || parsed === null) return;
  const candidate = findConversation(parsed);
  if (candidate && candidate.messages.length) found.push(candidate);
}

/** Extract candidate conversations from every serialized data channel in the page. */
export function scanEmbeddedData(html) {
  if (!html) return [];
  const found = [];
  const root = parseHtml(html);

  const scripts = queryAll(root, 'script');
  for (const script of scripts) {
    const type = (script.attrs.type || '').toLowerCase();
    const id = (script.attrs.id || '').toLowerCase();
    const raw = textContent(script);
    if (!raw || raw.length > 40_000_000) continue;

    if (type.includes('json') || id === '__next_data__' || id.includes('data')) {
      const parsed = tryParseJson(raw);
      if (parsed !== undefined) {
        pushIfConversation(parsed, found);
        continue;
      }
    }

    const direct = tryParseJson(raw);
    if (direct !== undefined) pushIfConversation(direct, found);

    if (raw.includes('__remixContext') || raw.includes('__reactRouterContext')) {
      const eq = raw.search(/__remixContext\s*=|__reactRouterContext\s*=/);
      if (eq !== -1) {
        const brace = raw.indexOf('{', eq);
        const bracket = raw.indexOf('[', eq);
        const start = [brace, bracket].filter((n) => n !== -1).sort((a, b) => a - b)[0];
        if (start !== undefined) {
          const slice = balancedSlice(raw, start);
          const parsed = tryParseJson(slice);
          if (parsed !== undefined) pushIfConversation(parsed, found);
        }
      }
    }

    if (/af_initdata0?callback/i.test(raw)) {
      const dataMatch = /data\s*:\s*([[{])/.exec(raw);
      if (dataMatch) {
        const start = dataMatch.index + dataMatch[0].length - 1;
        const slice = balancedSlice(raw, start);
        const parsed = tryParseJson(slice);
        if (parsed !== undefined) {
          pushIfConversation(parsed, found);
          // Google payloads are positional arrays; also flatten to strings.
          const flattened = flattenStrings(parsed);
          if (flattened.length > 2) {
            const fromStrings = transcriptFromStrings(flattened);
            if (fromStrings.length) found.push({ kind: 'gemini-batched', messages: fromStrings, title: null, score: 0 });
          }
        }
      }
    }

    // React Flight chunks and inline JS string literals escape the JSON.
    if (raw.includes('self.__next_f') || raw.includes('\\"mapping\\"') || raw.includes('\\"chat_messages\\"')) {
      const unescaped = raw.replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n').replace(/\\u0026/g, '&');
      const objects = [];
      scanKeyedLiterals(unescaped, objects);
      for (const parsed of objects) pushIfConversation(parsed, found);
    }
  }

  // Last resort: scan the raw document for JSON literals around known keys.
  const bare = html.replace(/\\"/g, '"');
  const loose = [];
  scanKeyedLiterals(bare, loose);
  for (const parsed of loose) pushIfConversation(parsed, found);

  found.sort((a, b) => (b.messages?.length || 0) - (a.messages?.length || 0));
  return found;
}

function flattenStrings(value, depth = 0, out = []) {
  if (depth > 30 || value == null) return out;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 1 && trimmed.length < 20000) out.push(trimmed);
    return out;
  }
  if (typeof value !== 'object') return out;
  const values = Array.isArray(value) ? value : Object.values(value);
  for (const entry of values) flattenStrings(entry, depth + 1, out);
  return out;
}

/**
 * Gemini's share payload is a positional array with no role labels. Treat long
 * text strings as alternating turns, starting with the user's prompt.
 */
function transcriptFromStrings(strings) {
  const useful = strings.filter(
    (s) => s.length > 12 && !/^(https?:\/\/|gemini\.google\.com|www\.)/i.test(s) && !/^[A-Za-z0-9_-]{40,}$/.test(s),
  );
  if (useful.length < 2) return [];
  // Drop obvious UI chrome.
  const chrome = /^(send|stop|copied|copy|share|new chat|show more|edit|regenerate|thumbs|settings|gemini|sign in|google)/i;
  const messages = [];
  let role = 'user';
  for (const text of useful) {
    if (chrome.test(text)) continue;
    messages.push({ role, text });
    role = role === 'user' ? 'assistant' : 'user';
  }
  return messages.length >= 2 ? messages : [];
}