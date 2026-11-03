// Conversation normalization and output formats.

const ROLE_LABELS = {
  user: 'User',
  assistant: 'Assistant',
  system: 'System',
  tool: 'Tool',
  other: 'Message',
};

export const PROVIDER_LABELS = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  generic: 'Chat',
};

export function roleLabel(role) {
  return ROLE_LABELS[role] || ROLE_LABELS.other;
}

function cleanText(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u200b|\ufeff/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

/**
 * Normalize a list of {role, text} hits: drop empties, fold unknown roles,
 * remove consecutive duplicates and make sure the transcript starts on a turn.
 */
export function normalizeMessages(messages, { keepSystem = true, keepTool = false } = {}) {
  const out = [];
  let skipped = 0;
  for (const raw of messages || []) {
    if (!raw) continue;
    const text = cleanText(raw.text);
    if (!text) {
      skipped++;
      continue;
    }
    let role = raw.role === 'system' || raw.role === 'tool' || raw.role === 'user' || raw.role === 'assistant'
      ? raw.role
      : 'assistant';
    if (role === 'system' && !keepSystem) {
      skipped++;
      continue;
    }
    if (role === 'tool' && !keepTool) {
      skipped++;
      continue;
    }
    const last = out[out.length - 1];
    if (last && last.role === role && last.text === text) continue;
    out.push({ role, text, timestamp: raw.timestamp ?? null });
  }
  return { messages: out, skipped };
}

export function conversationStats(messages) {
  const chars = messages.reduce((sum, m) => sum + m.text.length, 0);
  const words = messages.reduce((sum, m) => sum + (m.text.match(/\S+/g) || []).length, 0);
  return {
    messages: messages.length,
    turns: messages.filter((m) => m.role === 'user').length,
    characters: chars,
    words,
    codeBlocks: messages.reduce((sum, m) => sum + Math.floor((m.text.match(/```/g) || []).length / 2), 0),
  };
}

function formatStamp(date) {
  const d = date instanceof Date ? date : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function toMarkdown(conversation) {
  const provider = PROVIDER_LABELS[conversation.provider] || PROVIDER_LABELS.generic;
  const stats = conversationStats(conversation.messages);
  const lines = [];
  if (conversation.title) lines.push(`# ${conversation.title}`, '');
  const meta = [
    `Exported from ${provider}`,
    `on ${formatStamp(new Date())}`,
    `${stats.messages} messages`,
    `${stats.words} words`,
  ].join(' · ');
  lines.push(`> ${meta}`);
  if (conversation.sourceUrl) lines.push(`>`, `> Source: ${conversation.sourceUrl}`);
  lines.push('', '---', '');

  for (const message of conversation.messages) {
    lines.push(`## ${roleLabel(message.role)}`, '', message.text, '');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function toPlainText(conversation) {
  const provider = PROVIDER_LABELS[conversation.provider] || PROVIDER_LABELS.generic;
  const lines = [];
  if (conversation.title) lines.push(conversation.title, '');
  lines.push(`Exported from ${provider} · ${formatStamp(new Date())}`);
  if (conversation.sourceUrl) lines.push(`Source: ${conversation.sourceUrl}`);
  lines.push('');
  for (const message of conversation.messages) {
    lines.push(`[${roleLabel(message.role)}]`, message.text, '');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function toJson(conversation) {
  return JSON.stringify(
    {
      provider: conversation.provider,
      providerLabel: PROVIDER_LABELS[conversation.provider] || PROVIDER_LABELS.generic,
      title: conversation.title || null,
      sourceUrl: conversation.sourceUrl || null,
      exportedAt: new Date().toISOString(),
      extractionMethod: conversation.method || null,
      stats: conversationStats(conversation.messages),
      messages: conversation.messages.map((message, index) => ({
        index,
        role: message.role,
        text: message.text,
        ...(message.timestamp ? { timestamp: message.timestamp } : {}),
      })),
    },
    null,
    2,
  );
}

export function buildConversation({ provider, title, sourceUrl, messages, method, skipped, note }) {
  const normalized = normalizeMessages(messages);
  const conversation = {
    provider: provider || 'generic',
    title: title || null,
    sourceUrl: sourceUrl || null,
    method: method || 'unknown',
    messages: normalized.messages,
    stats: conversationStats(normalized.messages),
    skipped: (skipped || 0) + normalized.skipped,
    note: note || null,
  };
  return conversation;
}

/** Recompute derived fields after a merge/edit. */
export function refreshConversation(conversation) {
  const normalized = normalizeMessages(conversation.messages);
  return { ...conversation, messages: normalized.messages, stats: conversationStats(normalized.messages) };
}