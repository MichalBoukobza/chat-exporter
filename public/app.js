// Chat Exporter UI: link input, conversation preview, copy/download, browser capture.

const $ = (selector) => document.querySelector(selector);

const PROVIDER_LABELS = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  generic: 'Chat',
};

const METHOD_LABELS = {
  'share-api': 'via share API',
  'embedded-json': 'from page data',
  'rendered-html': 'from rendered page',
  'page-text': 'from page text',
  'pasted-text': 'from pasted text',
};

const els = {
  form: $('#export-form'),
  url: $('#url'),
  pasteBtn: $('#paste-btn'),
  provider: $('#provider'),
  allowAny: $('#allow-any'),
  autoCopy: $('#auto-copy'),
  exportBtn: $('#export-btn'),
  hint: $('#detected-hint'),
  status: $('#status'),

  result: $('#result'),
  resultProvider: $('#result-provider'),
  resultMethod: $('#result-method'),
  resultTitle: $('#result-title'),
  resultMeta: $('#result-meta'),
  resultNote: $('#result-note'),
  messages: $('#messages'),
  copyMd: $('#copy-md'),
  copyJson: $('#copy-json'),

  error: $('#error'),
  errorTitle: $('#error-title'),
  errorMessage: $('#error-message'),
  errorHint: $('#error-hint'),
  errorSuggestions: $('#error-suggestions'),
  errorAttemptsWrap: $('#error-attempts-wrap'),
  errorAttempts: $('#error-attempts'),
  errorCapture: $('#error-capture'),

  capture: $('#capture'),
  bookmarkletLink: $('#bookmarklet-link'),
  copySnippet: $('#copy-snippet'),
  bookmarkletToText: $('#bookmarklet-to-text'),

  dropZone: $('#drop-zone'),
  htmlFile: $('#html-file'),
  pickFile: $('#pick-file'),
  htmlFileName: $('#html-file-name'),
  htmlText: $('#html-text'),
  htmlExtract: $('#html-extract'),

  textInput: $('#text-input'),
  textExtract: $('#text-extract'),

  toast: $('#toast'),
  footerOrigin: $('#footer-origin'),
};

const state = {
  conversation: null,
  files: null,
  busy: false,
};

// ------------------------------------------------------------ tiny markdown

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function inlineMarkup(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  html = html.replace(
    /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  return html;
}

function renderMarkdown(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const output = [];
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push(`<p>${paragraph.map(inlineMarkup).join('<br>')}</p>`);
    paragraph = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      flushParagraph();
      const language = line.slice(3).trim();
      i++;
      const code = [];
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      const cls = language ? ` class="language-${escapeHtml(language)}"` : '';
      output.push(`<pre><code${cls}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (/^\s*$/.test(line)) {
      flushParagraph();
      i++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      output.push(`<h${level}>${inlineMarkup(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) {
      flushParagraph();
      output.push('<hr>');
      i++;
      continue;
    }

    if (/^\s*>/.test(line)) {
      flushParagraph();
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      }
      output.push(`<blockquote>${quote.map(inlineMarkup).join('<br>')}</blockquote>`);
      continue;
    }

    const listStart = /^\s*([-*+]|\d+[.)])\s+/.exec(line);
    if (listStart) {
      flushParagraph();
      const ordered = /\d/.test(listStart[1]);
      const items = [];
      while (i < lines.length) {
        const item = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (!item) break;
        items.push(`<li>${inlineMarkup(item[2])}</li>`);
        i++;
      }
      output.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      flushParagraph();
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (row) =>
        row
          .replace(/^\s*\|/, '')
          .replace(/\|\s*$/, '')
          .split('|')
          .map((cell) => cell.trim());
      const header = cells(rows[0] || '');
      const body = rows.slice(2).map(cells);
      const head = `<thead><tr>${header.map((cell) => `<th>${inlineMarkup(cell)}</th>`).join('')}</tr></thead>`;
      const rowsHtml = body
        .map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkup(cell)}</td>`).join('')}</tr>`)
        .join('');
      output.push(`<table>${head}<tbody>${rowsHtml}</tbody></table>`);
      continue;
    }

    paragraph.push(line);
    i++;
  }

  flushParagraph();
  return output.join('');
}

// ------------------------------------------------------------------- toast

let toastTimer = null;

function showToast(message, kind = 'ok') {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.toggle('is-error', kind === 'error');
  els.toast.hidden = false;
  requestAnimationFrame(() => els.toast.classList.add('is-visible'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove('is-visible');
    setTimeout(() => {
      els.toast.hidden = true;
    }, 220);
  }, 2400);
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage || 'Copied to clipboard');
    return true;
  } catch {
    // Clipboard API needs a secure context or permission; fall back to a hidden textarea.
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      showToast(ok ? successMessage || 'Copied to clipboard' : 'Copy failed — select the text manually', ok ? 'ok' : 'error');
      return ok;
    } catch {
      showToast('Copy failed — select the text manually', 'error');
      return false;
    }
  }
}

// "Copy after export": try immediately so a pasted link ends on the clipboard.
function maybeAutoCopy(payload) {
  if (!els.autoCopy || !els.autoCopy.checked) return;
  if (!payload || !payload.files || !payload.files.markdown) return;
  copyText(payload.files.markdown, 'Whole conversation copied to clipboard');
}

// ------------------------------------------------------------------ status

function setStatus(kind, text) {
  if (!els.status) return;
  els.status.hidden = false;
  els.status.className = `status ${kind === 'loading' ? '' : kind === 'error' ? 'is-error' : 'is-ok'}`;
  els.status.innerHTML = '';
  const dot = document.createElement('span');
  dot.className = 'dot' + (kind === 'loading' ? ' pulse' : '');
  const label = document.createElement('span');
  label.textContent = text;
  els.status.append(dot, label);
}

function hideStatus() {
  if (els.status) els.status.hidden = true;
}

function setBusy(busy) {
  state.busy = busy;
  els.exportBtn.disabled = busy;
  els.exportBtn.classList.toggle('is-loading', busy);
  const label = els.exportBtn.querySelector('.btn-label');
  if (label) label.textContent = busy ? 'Working…' : 'Export conversation';
}

// --------------------------------------------------------- provider detection

const CLIENT_RULES = [
  {
    provider: 'chatgpt',
    host: /^(www\.)?(chatgpt\.com|chat\.openai\.com)$/,
    share: /^\/share\/(?:e\/)?[A-Za-z0-9-]{6,}/,
    chat: /^\/(c|g\/[^/]+\/c)\/[A-Za-z0-9-]{6,}/,
  },
  { provider: 'claude', host: /^(www\.)?claude\.ai$/, share: /^\/share\/[A-Za-z0-9_-]{6,}/, chat: /^\/chat\/[A-Za-z0-9_-]{6,}/ },
  { provider: 'gemini', host: /^gemini\.google\.com$/, share: /^\/share\/[A-Za-z0-9_-]{4,}/, chat: null },
  {
    provider: 'deepseek',
    host: /^(www\.)?chat\.deepseek\.com$/,
    share: /^\/share\/[A-Za-z0-9_-]{4,}/,
    chat: /^\/(a\/chat\/s|chat\/s)\/[A-Za-z0-9_-]{4,}/,
  },
];

function inspectLink(value) {
  const input = String(value || '').trim();
  if (!input) return null;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const rule = CLIENT_RULES.find((candidate) => candidate.host.test(host));
  if (!rule) return { provider: 'generic', host, kind: 'unknown' };
  if (rule.share && rule.share.test(url.pathname)) return { provider: rule.provider, host, kind: 'share' };
  if (rule.chat && rule.chat.test(url.pathname)) return { provider: rule.provider, host, kind: 'chat' };
  return { provider: rule.provider, host, kind: 'unknown' };
}

function updateHint() {
  const info = inspectLink(els.url.value);
  if (!info) {
    els.hint.textContent = 'Paste a public share link. Private chats stay private — use browser capture instead.';
    els.hint.classList.remove('hint-warn');
    return;
  }
  const label = PROVIDER_LABELS[info.provider] || info.host;
  if (info.kind === 'share') {
    els.hint.textContent = `${label} share link detected — public links can be read directly.`;
    els.hint.classList.remove('hint-warn');
  } else if (info.kind === 'chat') {
    els.hint.textContent = `${label} private chat link — needs browser capture, or share the chat publicly first.`;
    els.hint.classList.add('hint-warn');
  } else if (info.provider === 'generic') {
    els.hint.textContent = `Unknown site — tick “Allow any site” to try generic extraction.`;
    els.hint.classList.add('hint-warn');
  } else {
    els.hint.textContent = `${label} link — make sure it is a share link, not a private chat.`;
    els.hint.classList.add('hint-warn');
  }
}

// -------------------------------------------------------------- result/error

function renderResult(payload) {
  const conversation = payload.conversation;
  state.conversation = conversation;
  state.files = payload.files || null;

  els.resultProvider.textContent = PROVIDER_LABELS[conversation.provider] || 'Chat';
  els.resultMethod.textContent = METHOD_LABELS[conversation.method] || conversation.method || '';
  els.resultTitle.textContent = conversation.title || 'Untitled conversation';

  const stats = conversation.stats || {};
  els.resultMeta.textContent = [
    `${stats.messages ?? conversation.messages.length} messages`,
    `${(stats.words ?? 0).toLocaleString()} words`,
    stats.codeBlocks ? `${stats.codeBlocks} code blocks` : null,
    conversation.sourceUrl ? conversation.sourceUrl.replace(/^https?:\/\//, '') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  els.resultNote.hidden = !conversation.note;
  els.resultNote.textContent = conversation.note || '';
  if (!conversation.note && conversation.method === 'page-text') {
    // Last-resort layer: say so instead of implying a clean machine read.
    els.resultNote.hidden = false;
    els.resultNote.textContent = 'Read heuristically from the page text — check the messages before relying on them.';
  }

  els.messages.innerHTML = '';
  conversation.messages.forEach((message, index) => {
    const article = document.createElement('article');
    article.className = 'message';
    article.dataset.role = message.role;

    const head = document.createElement('header');
    head.className = 'message-head';

    const pill = document.createElement('span');
    pill.className = 'role-pill';
    pill.textContent = message.role === 'user' ? 'User' : message.role === 'assistant' ? 'Assistant' : message.role;

    const counter = document.createElement('span');
    counter.className = 'message-index';
    counter.textContent = `#${index + 1}`;

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn btn-chip message-copy';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => copyText(message.text, `Message ${index + 1} copied`));

    head.append(pill, counter, copyBtn);

    const body = document.createElement('div');
    body.className = 'msg-body';
    body.innerHTML = renderMarkdown(message.text);

    article.append(head, body);
    els.messages.append(article);
  });

  els.result.hidden = false;
  els.error.hidden = true;
  els.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderError(error) {
  const info = error || {};
  els.errorTitle.textContent = info.code === 'NO_CONVERSATION' ? 'No conversation found' : 'Export failed';
  els.errorMessage.textContent = info.message || 'Something went wrong.';

  els.errorHint.hidden = !info.hint;
  els.errorHint.textContent = info.hint || '';

  els.errorSuggestions.innerHTML = '';
  const suggestions = Array.isArray(info.suggestions) ? info.suggestions : [];
  els.errorSuggestions.hidden = suggestions.length === 0;
  for (const suggestion of suggestions) {
    const item = document.createElement('li');
    item.textContent = suggestion;
    els.errorSuggestions.append(item);
  }

  const attempts = Array.isArray(info.attempts) ? info.attempts : [];
  els.errorAttemptsWrap.hidden = attempts.length === 0;
  els.errorAttempts.innerHTML = '';
  for (const attempt of attempts) {
    const row = document.createElement('tr');
    const step = document.createElement('td');
    step.textContent = attempt.strategy || 'attempt';
    const result = document.createElement('td');
    result.textContent =
      attempt.error || attempt.detail || (attempt.status ? `HTTP ${attempt.status}` : 'no result');
    row.append(step, result);
    els.errorAttempts.append(row);
  }

  els.error.hidden = false;
  els.result.hidden = true;
  els.error.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// -------------------------------------------------------------- export flows

async function requestJson(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw { message: `The server returned an unexpected response (HTTP ${response.status}).` };
  }
  if (!payload.ok) throw payload.error || { message: `Request failed (HTTP ${response.status}).` };
  return payload;
}

async function runLinkExport() {
  if (state.busy) return;
  const url = els.url.value.trim();
  if (!url) {
    els.url.focus();
    setStatus('error', 'Paste a conversation link first.');
    return;
  }

  setBusy(true);
  setStatus('loading', 'Fetching the conversation…');
  els.error.hidden = true;

  try {
    const payload = await requestJson('/api/extract', {
      url,
      provider: els.provider.value === 'auto' ? null : els.provider.value,
      allowAnyHost: els.allowAny.checked,
    });
    renderResult(payload);
    maybeAutoCopy(payload);
    setStatus('ok', `Done — ${payload.conversation.stats.messages} messages ready to copy.`);
    setTimeout(hideStatus, 5000);
  } catch (error) {
    renderError(error);
    setStatus('error', 'Could not read that link. See the details below.');
  } finally {
    setBusy(false);
  }
}

async function runHtmlExport(html, label) {
  if (state.busy) return;
  const trimmed = String(html || '').trim();
  if (trimmed.length < 40) {
    showToast('That HTML looks empty', 'error');
    return;
  }
  setBusy(true);
  setStatus('loading', 'Reading the saved page…');
  try {
    const payload = await requestJson('/api/extract-html', {
      html: trimmed,
      url: null,
      provider: els.provider.value === 'auto' ? null : els.provider.value,
    });
    renderResult(payload);
    maybeAutoCopy(payload);
    setStatus('ok', `Found ${payload.conversation.stats.messages} messages in ${label || 'the saved page'}.`);
    setTimeout(hideStatus, 5000);
  } catch (error) {
    renderError(error);
    setStatus('error', 'No conversation found in that HTML.');
  } finally {
    setBusy(false);
  }
}

async function runTextExport() {
  if (state.busy) return;
  const text = els.textInput.value;
  if (!text.trim()) {
    els.textInput.focus();
    showToast('Paste some conversation text first', 'error');
    return;
  }
  setBusy(true);
  setStatus('loading', 'Building the conversation…');
  try {
    const payload = await requestJson('/api/extract-text', {
      text,
      provider: els.provider.value === 'auto' ? null : els.provider.value,
    });
    renderResult(payload);
    maybeAutoCopy(payload);
    setStatus('ok', `Built ${payload.conversation.stats.messages} messages from the pasted text.`);
    setTimeout(hideStatus, 5000);
  } catch (error) {
    renderError(error);
    setStatus('error', 'Could not parse that text.');
  } finally {
    setBusy(false);
  }
}

// ----------------------------------------------------------------- downloads

function slugify(text) {
  return (
    String(text || 'conversation')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'conversation'
  );
}

function downloadFile(extension, content, mime) {
  if (!state.files) return;
  const conversation = state.conversation;
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `${slugify(conversation?.title)}-${conversation?.provider || 'chat'}-${stamp}.${extension}`;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  showToast(`Saved ${name}`);
}

// -------------------------------------------------------------------- events

els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  runLinkExport();
});

els.url.addEventListener('input', updateHint);
els.url.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    runLinkExport();
  }
});

els.pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) {
      els.url.focus();
      showToast('Clipboard is empty', 'error');
      return;
    }
    els.url.value = text.trim();
    updateHint();
    els.url.focus();
    showToast('Link pasted');
  } catch {
    els.url.focus();
    showToast('Use Ctrl+V to paste', 'error');
  }
});

els.copyMd.addEventListener('click', () => {
  if (state.files) copyText(state.files.markdown, 'Whole conversation copied as Markdown');
});

els.copyJson.addEventListener('click', () => {
  if (state.files) copyText(state.files.json, 'Whole conversation copied as JSON');
});

for (const button of document.querySelectorAll('[data-download]')) {
  button.addEventListener('click', () => {
    const kind = button.dataset.download;
    if (!state.files) return;
    if (kind === 'md') downloadFile('md', state.files.markdown, 'text/markdown;charset=utf-8');
    if (kind === 'txt') downloadFile('txt', state.files.text, 'text/plain;charset=utf-8');
    if (kind === 'json') downloadFile('json', state.files.json, 'application/json;charset=utf-8');
  });
}

els.errorCapture.addEventListener('click', () => {
  els.capture.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => els.bookmarkletLink.focus?.(), 400);
});

// Tabs
for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    for (const other of document.querySelectorAll('.tab')) {
      const active = other === tab;
      other.classList.toggle('is-active', active);
      other.setAttribute('aria-selected', String(active));
    }
    for (const panel of document.querySelectorAll('.tab-panel')) {
      panel.classList.toggle('is-active', panel.dataset.panel === tab.dataset.tab);
    }
  });
}

// Bookmarklet
async function initBookmarklet() {
  try {
    const response = await fetch('/bookmarklet.js');
    const code = (await response.text()).trim();
    if (!code || response.status !== 200) throw new Error('missing');
    els.bookmarkletLink.href = `javascript:${encodeURIComponent(code)}`;
    els.bookmarkletLink.title = 'Drag me to the bookmarks bar';

    els.copySnippet.addEventListener('click', () =>
      copyText(code, 'Snippet copied — paste it into the browser console on the chat page'),
    );
  } catch {
    els.copySnippet.textContent = 'Bookmarklet unavailable';
    els.copySnippet.disabled = true;
  }
}

els.bookmarkletToText.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) {
      showToast('Clipboard is empty — run the capture first', 'error');
      return;
    }
    els.textInput.value = text;
    document.querySelector('.tab[data-tab="text"]').click();
    els.capture.scrollIntoView({ behavior: 'smooth', block: 'start' });
    runTextExport();
  } catch {
    showToast('Allow clipboard access, then try again', 'error');
  }
});

// Saved HTML
els.pickFile.addEventListener('click', () => els.htmlFile.click());

els.htmlFile.addEventListener('change', async () => {
  const file = els.htmlFile.files && els.htmlFile.files[0];
  if (!file) return;
  const text = await file.text();
  els.htmlFileName.textContent = `${file.name} · ${(file.size / 1024).toFixed(0)} KB`;
  els.htmlText.value = '';
  els.htmlText.placeholder = 'Loaded from file.';
  els.capture.scrollIntoView({ behavior: 'smooth', block: 'start' });
  runHtmlExport(text, 'the saved HTML file');
});

for (const zone of [els.dropZone, els.htmlText]) {
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    els.dropZone.classList.add('is-over');
  });
  zone.addEventListener('dragleave', () => els.dropZone.classList.remove('is-over'));
  zone.addEventListener('drop', async (event) => {
    event.preventDefault();
    els.dropZone.classList.remove('is-over');
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    const text = await file.text();
    els.htmlFileName.textContent = `${file.name} · ${(text.length / 1024).toFixed(0)} KB`;
    els.htmlText.value = '';
    els.htmlText.placeholder = 'Loaded from drag & drop.';
    runHtmlExport(text, 'the dropped file');
  });
}

els.htmlExtract.addEventListener('click', () => runHtmlExport(els.htmlText.value, 'the pasted source'));

// Pasted text
els.textExtract.addEventListener('click', runTextExport);
els.textInput.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    runTextExport();
  }
});

// ---------------------------------------------------------------- bootstrap

function bootstrap() {
  if (els.footerOrigin && location.hostname) els.footerOrigin.textContent = location.hostname;
  initBookmarklet();

  const params = new URLSearchParams(location.search);
  const preset = params.get('url');
  if (preset) {
    els.url.value = preset;
    updateHint();
    runLinkExport();
  } else {
    els.url.focus();
  }

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'c' && state.files) {
      event.preventDefault();
      copyText(state.files.markdown, 'Whole conversation copied as Markdown');
    }
  });
}

bootstrap();