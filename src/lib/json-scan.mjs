// Find conversation-shaped payloads inside arbitrary JSON.
//
// Share endpoints and embedded page state disagree on shape and wrapper names,
// so instead of hard-coding one path we walk the whole document and score every
// object that looks like a chat transcript. This is what makes the exporter
// survive "page data moved one level deeper" style changes.

const SKIP_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function normalizeRole(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (['user', 'human', 'prompt', 'you', 'customer'].includes(raw)) return 'user';
  if (['assistant', 'ai', 'model', 'bot', 'gpt', 'chatgpt', 'chatgpt-4o', 'gpt-4', 'gpt-4o', 'gpt-5', 'openai', 'chatbot', 'claude', 'gemini', 'deepseek'].includes(raw)) {
    return 'assistant';
  }
  if (['system', 'developer', 'instructions'].includes(raw)) return 'system';
  if (['tool', 'function', 'tool_result', 'observation'].includes(raw)) return 'tool';
  return null;
}

function textFromPart(part) {
  if (part == null) return '';
  if (typeof part === 'string') return part;
  if (typeof part === 'number' || typeof part === 'boolean') return String(part);
  if (Array.isArray(part)) return part.map(textFromPart).filter(Boolean).join('\n');
  if (typeof part === 'object') {
    const type = String(part.type ?? '').toLowerCase();
    if (type === 'image' || type === 'image_url' || type === 'image_asset_pointer') return '';
    if (type === 'thinking' || type === 'redacted_thinking') return '';
    if (type === 'tool_use' || type === 'tool_result') return '';
    if (typeof part.text === 'string') return part.text;
    if (typeof part.content === 'string') return part.content;
    if (typeof part.value === 'string') return part.value;
    if (typeof part.result === 'string') return part.result;
    if (Array.isArray(part.parts)) return part.parts.map(textFromPart).filter(Boolean).join('\n');
    if (Array.isArray(part.content)) return part.content.map(textFromPart).filter(Boolean).join('\n');
    return '';
  }
  return '';
}

/** Pull display text out of every content representation we know about. */
export function textFromContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(textFromPart).filter(Boolean).join('\n');
  if (typeof content === 'object') {
    if (Array.isArray(content.parts)) {
      const fromParts = content.parts.map(textFromPart).filter(Boolean).join('\n');
      if (fromParts) return fromParts;
    }
    if (typeof content.text === 'string') return content.text;
    if (Array.isArray(content.content)) return content.content.map(textFromPart).filter(Boolean).join('\n');
    if (typeof content.result === 'string') return content.result;
  }
  return '';
}

function nodeRole(node) {
  const msg = node && (node.message || node);
  if (!msg) return null;
  const author = msg.author;
  return normalizeRole(author && typeof author === 'object' ? author.role : author ?? msg.role ?? msg.sender);
}

function nodeText(node) {
  const msg = node && (node.message || node);
  if (!msg) return '';
  return textFromContent(msg.content ?? msg.text ?? msg.parts ?? msg.blocks ?? msg.message);
}

function nodeTimestamp(node) {
  const msg = (node && node.message) || node || {};
  const value = msg.create_time ?? msg.created_at ?? msg.timestamp ?? msg.createdAt ?? null;
  return typeof value === 'number' ? value : null;
}

/**
 * ChatGPT stores conversations as a graph: { mapping: { id: node } } where each
 * node points at its parent and children. The visible transcript is the deepest
 * root-to-leaf chain (edits and regenerations stay as side branches).
 */
export function mappingToMessages(mapping) {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return [];
  const byId = new Map();
  for (const [key, value] of Object.entries(mapping)) {
    if (value && typeof value === 'object') {
      const id = value.id || key;
      byId.set(id, { ...value, id });
      if (key !== id) byId.set(key, byId.get(id));
    }
  }
  if (!byId.size) return [];

  const nodes = [...new Set(byId.values())];
  const roots = nodes.filter((node) => {
    const parentId = node.parent;
    if (!parentId) return true;
    return !byId.has(parentId);
  });
  const startPoints = roots.length ? roots : nodes.filter((n) => !n.children || !n.children.length);

  let bestChain = [];
  for (const root of startPoints) {
    let current = root;
    const chain = [];
    const seen = new Set();
    while (current && !seen.has(current.id) && chain.length < 10000) {
      seen.add(current.id);
      chain.push(current);
      const kids = (Array.isArray(current.children) ? current.children : [])
        .map((id) => byId.get(id))
        .filter((child) => child && !seen.has(child.id));
      if (!kids.length) break;
      // Last child is the branch that is currently displayed.
      current = kids[kids.length - 1];
    }
    if (chain.length > bestChain.length) bestChain = chain;
  }

  return bestChain
    .filter((node) => {
      const message = node.message;
      if (!message) return false;
      const meta = message.metadata || {};
      // Share payloads include hidden plumbing: system prompts, custom-instruction
      // placeholders and reasoning summaries. They are not part of the transcript.
      if (meta.is_visually_hidden_from_conversation === true) return false;
      if (meta.is_user_system_message === true) return false;
      const contentType = String(message.content?.content_type || '');
      if (['thoughts', 'reasoning_recap', 'model_editable_context', 'user_editable_context', 'system_error'].includes(contentType)) {
        return false;
      }
      const role = nodeRole(node);
      return role === 'user' || role === 'assistant';
    })
    .map((node) => ({ role: nodeRole(node), text: nodeText(node), timestamp: nodeTimestamp(node) }))
    .filter((m) => m.role && m.text.trim());
}

function arrayToMessages(list) {
  const out = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const message = entry.message || entry;
    const meta = message.metadata || entry.metadata || {};
    // Same hidden-plumbing filter as mappingToMessages (ChatGPT share payloads
    // also expose a linear_conversation array).
    if (meta.is_visually_hidden_from_conversation === true) continue;
    if (meta.is_user_system_message === true) continue;
    const contentType = String(message.content?.content_type || entry.content?.content_type || '');
    if (['thoughts', 'reasoning_recap', 'model_editable_context', 'user_editable_context', 'system_error'].includes(contentType)) {
      continue;
    }
    const role = nodeRole(entry) || normalizeRole(entry.type === 'human' ? 'human' : entry.type);
    const text = nodeText(entry) || textFromContent(entry.content);
    if (!role || !text.trim()) continue;
    if (role === 'system' || role === 'tool') continue;
    out.push({ role, text, timestamp: nodeTimestamp(entry) });
  }
  return out;
}

function titleOf(object) {
  for (const key of ['title', 'name', 'conversation_title', 'chat_title', 'subject']) {
    const value = object[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function looksLikeMapping(object) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return false;
  const values = Object.values(object).slice(0, 200);
  if (!values.length) return false;
  let hits = 0;
  for (const value of values) {
    if (value && typeof value === 'object' && (value.message || value.children || value.parent !== undefined)) {
      hits++;
    }
  }
  return hits >= Math.max(1, Math.floor(values.length * 0.6));
}

function messagesFromArrayField(list) {
  if (!Array.isArray(list) || list.length === 0) return [];
  let withRoles = 0;
  for (const entry of list.slice(0, 40)) {
    if (entry && typeof entry === 'object' && nodeRole(entry)) withRoles++;
  }
  if (withRoles < Math.min(2, list.length)) return [];
  return arrayToMessages(list);
}

function collectCandidates(value, depth, out, seenObjects) {
  if (depth > 12 || value == null) return;
  if (typeof value !== 'object') return;
  if (seenObjects.has(value)) return;
  seenObjects.add(value);

  if (Array.isArray(value)) {
    const messages = messagesFromArrayField(value);
    if (messages.length) {
      out.push({ kind: 'messages-array', messages, title: null, raw: value });
    }
    for (const entry of value.slice(0, 500)) collectCandidates(entry, depth + 1, out, seenObjects);
    return;
  }

  const title = titleOf(value);

  // ChatGPT graph. Nested wrappers ({data:{mapping}}, {conversation:{...}})
  // are handled by the recursion below, which keeps the right title attached.
  const mappingCandidate =
    (value.mapping && looksLikeMapping(value.mapping) && value.mapping) || null;
  if (mappingCandidate) {
    const messages = mappingToMessages(mappingCandidate);
    if (messages.length) out.push({ kind: 'mapping', messages, title, raw: value });
  }

  for (const key of ['linear_conversation', 'chat_messages', 'messages', 'contents', 'conversation', 'turns', 'transcript']) {
    const candidate = value[key];
    if (!Array.isArray(candidate)) continue;
    const messages = messagesFromArrayField(candidate);
    if (messages.length) out.push({ kind: key, messages, title: title || titleOf(candidate[0] || {}), raw: value });
  }

  // Some APIs nest the transcript inside { data: { ... } } / { serverResponse: ... }
  for (const [key, child] of Object.entries(value)) {
    if (SKIP_KEYS.has(key)) continue;
    if (depth === 0 || key.length < 40) collectCandidates(child, depth + 1, out, seenObjects);
  }
}

function signature(messages) {
  return messages.map((m) => (m.role || '') + ':' + (m.text || '').length).join('|');
}

/** Return the best conversation candidate found anywhere in the JSON tree. */
export function findConversation(root) {
  const candidates = [];
  collectCandidates(root, 0, candidates, new WeakSet());
  if (!candidates.length) return null;

  const scored = candidates.map((candidate) => {
    const chars = candidate.messages.reduce((sum, m) => sum + m.text.length, 0);
    const hasUser = candidate.messages.some((m) => m.role === 'user');
    const hasAssistant = candidate.messages.some((m) => m.role === 'assistant');
    return {
      ...candidate,
      score: candidate.messages.length * 10 + Math.min(chars / 200, 60) + (hasUser ? 15 : 0) + (hasAssistant ? 15 : 0),
    };
  });
  scored.sort((a, b) => b.score - a.score);

  const unique = [];
  const signatures = new Set();
  for (const candidate of scored) {
    const sig = signature(candidate.messages);
    if (signatures.has(sig)) continue;
    signatures.add(sig);
    unique.push(candidate);
  }

  const best = unique[0];
  return { ...best, candidates: unique.slice(0, 5) };
}