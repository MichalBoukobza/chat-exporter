// Provider detection and HTTP access for share links.

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export class ExportError extends Error {
  constructor(code, message, { hint = null, suggestions = [], attempts = [], status = null } = {}) {
    super(message);
    this.name = 'ExportError';
    this.code = code;
    this.hint = hint;
    this.suggestions = suggestions;
    this.attempts = attempts;
    this.status = status;
  }
}

const HOST_PROVIDERS = {
  'chatgpt.com': 'chatgpt',
  'www.chatgpt.com': 'chatgpt',
  'chat.openai.com': 'chatgpt',
  'claude.ai': 'claude',
  'www.claude.ai': 'claude',
  'gemini.google.com': 'gemini',
  'chat.deepseek.com': 'deepseek',
  'www.chat.deepseek.com': 'deepseek',
};

const PATH_PATTERNS = {
  chatgpt: [
    { re: /^\/share\/(?:e\/)?([A-Za-z0-9-]{6,})\/?$/, kind: 'share' },
    { re: /^\/g\/[^/]+\/c\/([A-Za-z0-9-]{6,})\/?$/, kind: 'chat' },
    { re: /^\/c\/([A-Za-z0-9-]{6,})\/?$/, kind: 'chat' },
  ],
  claude: [
    { re: /^\/share\/([A-Za-z0-9_-]{6,})\/?$/, kind: 'share' },
    { re: /^\/chat\/([A-Za-z0-9_-]{6,})\/?$/, kind: 'chat' },
  ],
  gemini: [{ re: /^\/share\/([A-Za-z0-9_-]{4,})\/?$/, kind: 'share' }],
  deepseek: [
    { re: /^\/share\/([A-Za-z0-9_-]{4,})\/?$/, kind: 'share' },
    { re: /^\/a\/chat\/s\/([A-Za-z0-9_-]{4,})\/?$/, kind: 'chat' },
    { re: /^\/chat\/s\/([A-Za-z0-9_-]{4,})\/?$/, kind: 'chat' },
  ],
};

export const PROVIDER_META = {
  chatgpt: {
    label: 'ChatGPT',
    hosts: ['chatgpt.com', 'chat.openai.com'],
    shareUrl: (id) => `https://chatgpt.com/share/${id}`,
  },
  claude: { label: 'Claude', hosts: ['claude.ai'], shareUrl: (id) => `https://claude.ai/share/${id}` },
  gemini: { label: 'Gemini', hosts: ['gemini.google.com'], shareUrl: (id) => `https://gemini.google.com/share/${id}` },
  deepseek: {
    label: 'DeepSeek',
    hosts: ['chat.deepseek.com'],
    shareUrl: (id) => `https://chat.deepseek.com/share/${id}`,
  },
};

function isPrivateHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }
  if (host === '::1' || host === '0.0.0.0') return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^(fc|fd|fe80)/i.test(host)) return true;
  return false;
}

/**
 * Turn user input into a concrete extraction target.
 * Throws ExportError for unusable or disallowed URLs.
 */
export function detectTarget(rawInput, { providerHint = null, allowAnyHost = false } = {}) {
  const input = String(rawInput || '').trim();
  if (!input) {
    throw new ExportError('BAD_URL', 'Paste a conversation link first.', {
      hint: 'Example: https://chatgpt.com/share/xxxxxxxx',
    });
  }

  let url;
  try {
    const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    url = new URL(withScheme);
  } catch {
    throw new ExportError('BAD_URL', 'That does not look like a valid URL.', { hint: 'Check the link and try again.' });
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ExportError('BAD_URL', 'Only http(s) links are supported.');
  }

  const host = url.hostname.toLowerCase();
  const detected = HOST_PROVIDERS[host] || null;
  const provider = detected || (providerHint && providerHint !== 'generic' ? providerHint : 'generic');

  if (!detected && !allowAnyHost) {
    throw new ExportError('UNKNOWN_HOST', `I don't know how to read ${host}.`, {
      hint: 'Supported share links: ChatGPT, Claude, Gemini and DeepSeek. Generic page scraping is available as an opt-in.',
      suggestions: ['Enable "Allow any site" to try generic extraction.', 'Or use the browser capture instead.'],
    });
  }
  if (allowAnyHost && isPrivateHostname(host)) {
    throw new ExportError('BLOCKED_HOST', 'Local and private network addresses are not allowed.');
  }

  let id = null;
  let kind = 'unknown';
  for (const pattern of PATH_PATTERNS[provider] || []) {
    const match = pattern.re.exec(url.pathname);
    if (match) {
      id = match[1];
      kind = pattern.kind;
      break;
    }
  }

  const apiUrl =
    kind === 'share' && id && provider === 'chatgpt'
      ? `https://chatgpt.com/backend-api/share/${encodeURIComponent(id)}`
      : kind === 'share' && id && provider === 'claude'
        ? `https://claude.ai/api/share/${encodeURIComponent(id)}`
        : null;

  return {
    provider,
    providerLabel: PROVIDER_META[provider]?.label || 'Chat',
    kind,
    id,
    url: url.toString(),
    host,
    apiUrl,
    allowAnyHost,
  };
}

export async function httpGet(url, { accept = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', timeoutMs = 25000 } = {}) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        'user-agent': UA,
        accept,
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error?.cause?.code || error?.name || 'network error';
    throw new ExportError('NETWORK', `Could not reach ${new URL(url).host}.`, {
      hint: 'Check the connection, or open the link in a browser first. The site may be blocking automated requests.',
      suggestions: ['Retry in a moment.', 'Use browser capture if the site keeps refusing.'],
      attempts: [{ strategy: 'fetch', error: String(reason) }],
    });
  }

  const text = response.status === 204 ? '' : await response.text();
  return {
    ok: response.ok,
    status: response.status,
    finalUrl: response.url,
    contentType: response.headers.get('content-type') || '',
    text,
    headers: response.headers,
  };
}

export function pageTitle(html) {
  if (!html) return null;
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const ogMatch = /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(html);
  let title = (titleMatch?.[1] || ogMatch?.[1] || '').trim();
  if (!title) return null;
  title = title.replace(/\s*[|\u2013\u2014-]\s*(ChatGPT|Claude|Gemini|DeepSeek)\s*$/i, '');
  title = title.replace(/^(ChatGPT|Claude|Gemini|DeepSeek)\s*[|\u2013\u2014-]\s*/i, '');
  if (/^(chatgpt|claude|gemini|deepseek|just a moment|attention required)$/i.test(title)) return null;
  return title.slice(0, 300) || null;
}

export function looksLikeChallenge(status, text, contentType = '') {
  if (status === 401 || status === 403) return true;
  if (status === 429) return true;
  if (status === 202) return true;
  if (status >= 500) return true;
  if (!/html/i.test(contentType) && status !== 200) return false;
  const head = String(text || '').slice(0, 4000).toLowerCase();
  return (
    head.includes('just a moment') ||
    head.includes('cf-chl') ||
    head.includes('enable javascript and cookies') ||
    head.includes('attention required') ||
    head.includes('verify you are human') ||
    head.includes('captcha') ||
    head.includes('access denied')
  );
}

export function looksLikeLoginWall(html) {
  const head = String(html || '').slice(0, 200000).toLowerCase();
  return (
    head.includes('/auth/login') ||
    head.includes('sign in to continue') ||
    head.includes('log in to continue') ||
    head.includes('"isloggedin":false') ||
    head.includes('please log in')
  );
}