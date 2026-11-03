// One-click capture for the live chat page.
// Runs as a bookmarklet or pasted into DevTools on chatgpt.com, claude.ai,
// gemini.google.com or chat.deepseek.com. Copies the transcript as Markdown.
(() => {
  const host = location.hostname.toLowerCase();

  const RULES = {
    'chatgpt.com': [
      { sel: '[data-message-author-role]', role: (el) => el.getAttribute('data-message-author-role'), body: '.markdown, .prose, .whitespace-pre-wrap' },
    ],
    'chat.openai.com': [
      { sel: '[data-message-author-role]', role: (el) => el.getAttribute('data-message-author-role'), body: '.markdown, .prose, .whitespace-pre-wrap' },
    ],
    'claude.ai': [
      { sel: '[data-testid="user-message"]', role: () => 'user', body: null },
      { sel: '[data-testid="assistant-message"], .font-claude-message', role: () => 'assistant', body: '.font-claude-message, .prose, .markdown' },
    ],
    'gemini.google.com': [
      { sel: 'user-query', role: () => 'user', body: '.query-text, .query-content' },
      { sel: 'model-response', role: () => 'assistant', body: '.markdown, .model-response-text, .response-content' },
    ],
    'chat.deepseek.com': [
      { sel: '[data-role], [data-author], [data-message-role]', role: (el) => el.getAttribute('data-role') || el.getAttribute('data-author') || el.getAttribute('data-message-role'), body: '.ds-markdown, .markdown' },
      { sel: '.ds-markdown', role: (el) => guessRole(el), body: null },
    ],
  };

  const GENERIC = [
    { sel: '[data-message-author-role], [data-role], [data-author], [data-message-role]', role: (el) => el.getAttribute('data-message-author-role') || el.getAttribute('data-role') || el.getAttribute('data-author') || el.getAttribute('data-message-role'), body: '.markdown, .prose, .ds-markdown' },
  ];

  function providerKey() {
    if (/claude\.ai$/.test(host)) return 'claude.ai';
    if (/gemini\.google\.com$/.test(host)) return 'gemini.google.com';
    if (/deepseek\.com$/.test(host)) return 'chat.deepseek.com';
    if (/chatgpt\.com$|openai\.com$/.test(host)) return 'chatgpt.com';
    return null;
  }

  function guessRole(el) {
    let node = el;
    let depth = 0;
    while (node && node !== document.body && depth++ < 8) {
      const cls = String(node.className || '');
      if (/(^|\s|-)(user|human|me)(\s|-|$)/i.test(cls)) return 'user';
      if (/(assistant|bot|model|ai)(\s|-|$)/i.test(cls)) return 'assistant';
      const attr = node.getAttribute && (node.getAttribute('data-role') || node.getAttribute('data-author'));
      if (attr) return attr;
      node = node.parentElement;
    }
    return null;
  }

  const BLOCK = /^(address|article|aside|blockquote|div|dl|dd|dt|figure|figcaption|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)$/i;

  function md(node) {
    let out = '';
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        out += child.nodeValue.replace(/\s+/g, ' ');
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toLowerCase();

      if (tag === 'script' || tag === 'style' || tag === 'svg' || tag === 'noscript' || tag === 'template') continue;
      if (tag === 'br') { out += '\n'; continue; }
      if (tag === 'hr') { out += '\n\n---\n\n'; continue; }
      if (tag === 'img') {
        const alt = child.getAttribute('alt') || '';
        const src = child.getAttribute('src') || '';
        if (alt || src) out += '![' + alt + '](' + src + ')';
        continue;
      }
      if (tag === 'pre') {
        const codeEl = child.querySelector('code') || child;
        const langMatch = /(?:language|lang)-([A-Za-z0-9_+#-]+)/.exec(String(codeEl.className || '') + ' ' + String(child.className || ''));
        const code = (codeEl.textContent || '').replace(/^\n+|\n+$/g, '');
        const fence = code.indexOf('```') !== -1 ? '~~~~' : '```';
        out += '\n\n' + fence + (langMatch ? langMatch[1] : '') + '\n' + code + '\n' + fence + '\n\n';
        continue;
      }
      if (tag === 'code') {
        const raw = child.textContent || '';
        if (raw) out += '`' + raw + '`';
        continue;
      }
      if (tag === 'a') {
        const href = child.getAttribute('href') || '';
        const label = md(child).trim();
        if (!label) continue;
        out += href && !/^javascript:/i.test(href) ? '[' + label + '](' + href + ')' : label;
        continue;
      }
      if (tag === 'strong' || tag === 'b') {
        const inner = md(child).trim();
        if (inner) out += '**' + inner + '**';
        continue;
      }
      if (tag === 'em' || tag === 'i') {
        const inner = md(child).trim();
        if (inner) out += '*' + inner + '*';
        continue;
      }
      if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
        const inner = md(child).trim();
        if (inner) out += '\n\n' + '#'.repeat(Number(tag[1])) + ' ' + inner + '\n\n';
        continue;
      }
      if (tag === 'li') {
        const inner = md(child).trim();
        if (inner) out += '\n- ' + inner;
        continue;
      }
      if (tag === 'blockquote') {
        const inner = md(child).trim();
        if (inner) out += '\n\n' + inner.split('\n').map((line) => '> ' + line).join('\n') + '\n\n';
        continue;
      }
      if (tag === 'td' || tag === 'th') {
        out += ' ' + md(child).trim() + ' |';
        continue;
      }
      if (tag === 'tr') {
        out += '\n|' + md(child);
        continue;
      }
      const inner = md(child);
      out += BLOCK.test(tag) ? '\n\n' + inner + '\n\n' : inner;
    }
    return out;
  }

  function clean(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\s+|\s+$/g, '');
  }

  function collect(rules) {
    const found = [];
    for (const rule of rules) {
      let elements;
      try {
        elements = document.querySelectorAll(rule.sel);
      } catch {
        continue;
      }
      for (const el of elements) {
        let role = null;
        try {
          role = rule.role(el);
        } catch {
          role = null;
        }
        role = String(role || '').toLowerCase();
        if (role === 'human') role = 'user';
        if (role === 'ai' || role === 'model' || role === 'bot') role = 'assistant';
        if (role !== 'user' && role !== 'assistant' && role !== 'system' && role !== 'tool') continue;

        let body = el;
        if (rule.body) {
          try {
            body = el.querySelector(rule.body) || el;
          } catch {
            body = el;
          }
        }
        const text = clean(md(body));
        if (text.length < 2) continue;
        found.push({ el, role, text });
      }
    }

    // Drop nested duplicates (a container repeats its children). Compare
    // elements, not text: text matching would delete a legit short reply.
    const kept = [];
    for (const hit of found) {
      const duplicate = kept.some((other) => {
        if (other.role !== hit.role) return false;
        if (other.el === hit.el) return true;
        try {
          return other.el.contains(hit.el) || hit.el.contains(other.el);
        } catch {
          return other.text === hit.text;
        }
      });
      if (duplicate) continue;
      kept.push(hit);
    }
    return kept.map(({ role, text }) => ({ role, text }));
  }

  function fromVisibleText() {
    const lines = (document.body.innerText || '').split('\n');
    const marker = /^\s*(you|user|human|assistant|chatgpt|claude|gemini|deepseek|ai|model)\s*(said|wrote|says)?\s*:\s*$/i;
    const messages = [];
    let current = null;
    for (const line of lines) {
      const match = marker.exec(line);
      if (match) {
        if (current) messages.push(current);
        const word = match[1].toLowerCase();
        current = {
          role: /^(you|user|human)$/.test(word) ? 'user' : 'assistant',
          lines: [],
        };
        continue;
      }
      if (current) current.lines.push(line);
    }
    if (current) messages.push(current);
    return messages
      .map((message) => ({ role: message.role, text: clean(message.lines.join('\n')) }))
      .filter((message) => message.text.length > 1);
  }

  function buildMarkdown(messages) {
    const title = clean(document.title.replace(/\s*[|\u2013\u2014-]\s*(ChatGPT|Claude|Gemini|DeepSeek)\s*$/i, '')) || 'Conversation';
    const words = messages.reduce((sum, message) => sum + (message.text.match(/\S+/g) || []).length, 0);
    const lines = [
      '# ' + title,
      '',
      '> Captured from ' + location.hostname + ' on ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' · ' + messages.length + ' messages · ' + words + ' words',
      '>',
      '> Source: ' + location.href,
      '',
      '---',
      '',
    ];
    for (const message of messages) {
      lines.push('## ' + (message.role === 'user' ? 'User' : message.role === 'assistant' ? 'Assistant' : message.role), '', message.text, '');
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.top = '-1000px';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy') ? resolve() : reject(new Error('copy failed'));
        area.remove();
      } catch (error) {
        reject(error);
      }
    });
  }

  try {
    const key = providerKey();
    const rules = key ? RULES[key].concat(GENERIC) : GENERIC;
    let messages = collect(rules);

    // Fallbacks: a site may render messages without role attributes.
    if (messages.length < 2) {
      const textMessages = fromVisibleText();
      if (textMessages.length > messages.length) messages = textMessages;
    }
    if (messages.length < 2) {
      const articles = collect([{ sel: 'article', role: (el) => guessRole(el), body: null }]);
      if (articles.length > messages.length) messages = articles;
    }

    if (!messages.length) {
      alert('Chat Exporter: no conversation found on this page.\n\nMake sure the chat is fully loaded, then try again.');
      return;
    }

    const markdown = buildMarkdown(messages);
    const userCount = messages.filter((message) => message.role === 'user').length;
    const assistantCount = messages.length - userCount;
    const warning =
      userCount === 0
        ? '\n\nHeads-up: only replies were found, no user turns. If that looks wrong, save the page (Ctrl+S) and use "Saved page HTML" instead.'
        : '';

    copy(markdown)
      .then(() => {
        const words = messages.reduce((sum, message) => sum + (message.text.match(/\S+/g) || []).length, 0);
        alert(
          'Chat Exporter: copied ' + messages.length + ' messages (' + userCount + ' user / ' + assistantCount + ' assistant, ' +
            words.toLocaleString() + ' words) as Markdown.\n\n' +
            'Paste it into the Chat Exporter page ("Paste text" tab) to save .md / .json / .txt files.' +
            warning,
        );
      })
      .catch(() => {
        const win = window.open('', '_blank');
        if (win) {
          win.document.write('<pre></pre>');
          win.document.querySelector('pre').textContent = markdown;
        } else {
          alert('Chat Exporter: could not access the clipboard. Allow clipboard access and try again.');
        }
      });
  } catch (error) {
    alert('Chat Exporter failed: ' + (error && error.message ? error.message : error));
  }
})();