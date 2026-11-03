// Orchestrates the extraction layers for a link:
//   1. public share JSON API (fastest, cleanest)
//   2. JSON serialized inside the page
//   3. rendered DOM markup
//   4. visible text / pasted transcript
// Each attempt is recorded so the UI can explain what happened.

import {
  ExportError,
  detectTarget,
  httpGet,
  looksLikeChallenge,
  looksLikeLoginWall,
  pageTitle,
} from './providers.mjs';
import { scanEmbeddedData } from './lib/embedded.mjs';
import { extractFromDom, parseTranscript, visibleText } from './lib/dom.mjs';
import { buildConversation } from './lib/conversation.mjs';
import { findConversation } from './lib/json-scan.mjs';

export function sniffProvider(html) {
  const source = String(html || '');
  if (/data-message-author-role|__remixContext|chatgpt\.com\/share|chatgpt\.com\/backend-api/.test(source)) return 'chatgpt';
  if (/font-claude-message|claude\.ai\/api\/share|data-testid="user-message"/.test(source)) return 'claude';
  if (/<user-query|<model-response|gemini\.google\.com\/share|af_initDataCallback/.test(source)) return 'gemini';
  if (/ds-markdown|chat\.deepseek\.com/.test(source)) return 'deepseek';
  return 'generic';
}

/**
 * Guess the provider from the shape of an embedded payload, when the URL gives
 * no hint (e.g. a saved HTML file dropped into the UI).
 */
function providerFromCandidate(candidate, source) {
  if (candidate.kind === 'mapping') return 'chatgpt';
  if (candidate.kind === 'gemini-batched') return 'gemini';
  if (source.includes('chat_messages')) return 'claude';
  return null;
}

/**
 * A real transcript alternates speakers. Page chrome ("Claude", a copyright
 * footer, a nav item) can look like a lone speaker line, so heuristic layers
 * must clear this bar before anything is shown to the user.
 */
function hasConversationShape(messages) {
  if (!Array.isArray(messages) || messages.length < 2) return false;
  const roles = new Set(messages.map((message) => message.role));
  return roles.has('user') && roles.has('assistant');
}

/**
 * Extract a conversation from raw HTML (saved page, copied source, or fetch).
 * Returns a conversation object or null when nothing usable is found.
 */
export function extractFromHtml(html, { url = null, provider = 'generic' } = {}) {
  const source = String(html || '');
  if (source.trim().length < 20) return null;

  const providerKey = provider && provider !== 'generic' ? provider : sniffProvider(source);

  const embedded = scanEmbeddedData(source);
  for (const candidate of embedded) {
    if (!candidate.messages || !candidate.messages.length) continue;
    const inferred = providerKey === 'generic' ? providerFromCandidate(candidate, source) || 'generic' : providerKey;
    const conversation = buildConversation({
      provider: inferred,
      title: candidate.title || pageTitle(source),
      sourceUrl: url,
      messages: candidate.messages,
      method: 'embedded-json',
      skipped: candidate.skipped,
    });
    if (conversation.messages.length) return conversation;
  }

  const domMessages = extractFromDom(source, providerKey);
  if (domMessages.length && hasConversationShape(domMessages)) {
    const conversation = buildConversation({
      provider: providerKey,
      title: pageTitle(source),
      sourceUrl: url,
      messages: domMessages,
      method: 'rendered-html',
    });
    if (conversation.messages.length) return conversation;
  }

  const fromText = parseTranscript(visibleText(source));
  if (fromText.length && hasConversationShape(fromText)) {
    const conversation = buildConversation({
      provider: providerKey,
      title: pageTitle(source),
      sourceUrl: url,
      messages: fromText,
      method: 'page-text',
    });
    if (conversation.messages.length) return conversation;
  }

  return null;
}

function blockedError(target, attempts, extra = {}) {
  return new ExportError(
    'BOT_WALL',
    `${target.providerLabel} blocked the automated request.`,
    {
      hint: 'The site runs as a single-page app or sits behind bot protection, so the transcript is not in the HTML.',
      suggestions: [
        'Open the link in your browser, then use "Capture from browser" to copy the conversation.',
        'Or save the page with Ctrl+S and drop the HTML file here.',
      ],
      attempts,
      ...extra,
    },
  );
}

/**
 * Extract a conversation from a share URL.
 * Returns { ok: true, conversation, attempts } or throws ExportError.
 */
export async function extractFromUrl(rawInput, options = {}) {
  const target = detectTarget(rawInput, options);
  const attempts = [];
  // A definitive "gone/private" answer from the provider's own API is more
  // precise than anything the page shell can tell us.
  let apiNotFound = false;

  if (target.kind === 'chat') {
    attempts.push({ strategy: 'share-api', detail: 'private chat link, no public endpoint' });
  }

  // Layer 1: public share JSON endpoint.
  if (target.apiUrl) {
    try {
      const response = await httpGet(target.apiUrl, { accept: 'application/json, text/plain, */*' });
      attempts.push({ strategy: 'share-api', status: response.status });
      const trimmed = response.text.trim();
      if (response.status === 404) apiNotFound = true;
      if (response.ok && trimmed.startsWith('{')) {
        let parsed;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          parsed = undefined;
        }
        if (parsed) {
          const candidate = findConversation(parsed);
          if (candidate && candidate.messages.length) {
            const conversation = buildConversation({
              provider: target.provider,
              title: candidate.title || null,
              sourceUrl: target.url,
              messages: candidate.messages,
              method: 'share-api',
            });
            if (conversation.messages.length) {
              attempts[attempts.length - 1].detail = `${candidate.messages.length} messages`;
              return { ok: true, conversation, attempts };
            }
          }
          const reason = String(parsed?.detail?.message || parsed?.error?.message || parsed?.detail?.reason || '').slice(0, 240);
          attempts[attempts.length - 1].detail = reason || 'response contained no transcript';
        }
      }
    } catch (error) {
      attempts.push({ strategy: 'share-api', error: error.message });
    }
  }

  // Layer 2-4: fetch the page itself.
  let page;
  try {
    page = await httpGet(target.url);
    attempts.push({ strategy: 'page', status: page.status, bytes: page.text.length });
  } catch (error) {
    if (error instanceof ExportError) {
      throw new ExportError(error.code, error.message, {
        hint: error.hint,
        suggestions: error.suggestions,
        attempts: [...attempts, ...error.attempts],
      });
    }
    throw error;
  }

  if (!page.ok) {
    if (page.status === 404) {
      throw new ExportError('NOT_FOUND', 'That conversation could not be found.', {
        hint: 'The share link may be deleted, expired, or set to private.',
        suggestions: ['Double-check the link in a browser.', 'Use browser capture for private conversations.'],
        attempts,
        status: 404,
      });
    }
    if (looksLikeChallenge(page.status, page.text, page.contentType)) {
      throw blockedError(target, attempts, { status: page.status });
    }
    throw new ExportError('FETCH_FAILED', `${target.providerLabel} returned HTTP ${page.status}.`, {
      attempts,
      status: page.status,
    });
  }

  const conversation = extractFromHtml(page.text, { url: target.url, provider: target.provider });
  if (conversation) {
    if (target.kind === 'chat') {
      conversation.note = 'Read directly from the chat page (no share link was needed).';
    }
    attempts.push({ strategy: 'page-parse', detail: `${conversation.messages.length} messages via ${conversation.method}` });
    return { ok: true, conversation, attempts };
  }

  if (looksLikeLoginWall(page.text)) {
    throw new ExportError('LOGIN_REQUIRED', `${target.providerLabel} needs a signed-in browser for this page.`, {
      hint: 'Private chats are only readable with your own session, not by a plain server request.',
      suggestions: [
        'Open the conversation normally, then click "Capture from browser".',
        'Or share the conversation publicly first and paste that share link.',
      ],
      attempts,
    });
  }

  if (apiNotFound) {
    throw new ExportError('NOT_FOUND', 'That conversation is not publicly available.', {
      hint: 'The share link was deleted, expired, or never made public — so only the app shell loaded.',
      suggestions: [
        'Open the link in your browser: if it loads, use "Capture from browser" to copy it.',
        'Or open the share menu in the app again and paste the fresh link.',
      ],
      attempts,
      status: 404,
    });
  }

  if (looksLikeChallenge(page.status, page.text, page.contentType)) {
    throw blockedError(target, attempts);
  }

  throw new ExportError('NO_CONVERSATION', `Reached ${target.providerLabel}, but found no conversation text.`, {
    hint: 'The page loaded without the transcript (usually a login wall or a JavaScript-only app).',
    suggestions: [
      'Use "Capture from browser" while the conversation is open.',
      'Or save the page with Ctrl+S and drop the HTML file here.',
      'Check that the link is a public share link.',
    ],
    attempts,
  });
}

/** Build a conversation from a pasted transcript. */
export function extractFromTranscript(text, { provider = 'generic', url = null, title = null } = {}) {
  const source = String(text || '');
  if (source.trim().length < 4) {
    throw new ExportError('EMPTY_TEXT', 'Paste some conversation text first.');
  }
  const messages = parseTranscript(source);
  if (messages.length >= 1) {
    return buildConversation({ provider, title, sourceUrl: url, messages, method: 'pasted-text' });
  }
  // No speaker labels: keep the text intact as a single message instead of losing it.
  const conversation = buildConversation({
    provider,
    title,
    sourceUrl: url,
    messages: [{ role: 'user', text: source }],
    method: 'pasted-text',
  });
  conversation.note = 'No speaker labels were found, so the whole text was kept as one message.';
  return conversation;
}