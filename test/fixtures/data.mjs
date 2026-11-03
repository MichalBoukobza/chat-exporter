// Fixtures modelled on the real payload shapes each provider uses.
// Kept as JS modules so HTML/JSON escaping stays readable.

const chatgptMapping = {
  root: { id: 'root', message: null, parent: null, children: ['u1'] },
  u1: {
    id: 'u1',
    message: {
      id: 'u1',
      author: { role: 'user', name: null, metadata: {} },
      create_time: 1730000000.1,
      content: { content_type: 'text', parts: ['Explain what a qubit is, in one sentence.'] },
      status: 'finished_successfully',
    },
    parent: 'root',
    children: ['a1', 'a2'],
  },
  a1: {
    id: 'a1',
    message: {
      id: 'a1',
      author: { role: 'assistant', name: null, metadata: {} },
      create_time: 1730000001.1,
      content: { content_type: 'text', parts: ['An old answer that was regenerated.'] },
      status: 'finished_successfully',
    },
    parent: 'u1',
    children: [],
  },
  a2: {
    id: 'a2',
    message: {
      id: 'a2',
      author: { role: 'assistant', name: null, metadata: {} },
      create_time: 1730000002.1,
      content: {
        content_type: 'text',
        parts: [
          'A qubit is the quantum equivalent of a bit: it can hold **0**, **1**, or a superposition of both.\n\n```python\nfrom math import sqrt\nstate = sqrt(0.5) * (zero + one)\n```',
        ],
      },
      status: 'finished_successfully',
    },
    parent: 'u1',
    children: [],
  },
};

export const chatgptApi = {
  id: 'conv-123',
  title: 'What is a qubit?',
  create_time: 1730000000,
  update_time: 1730000003,
  mapping: chatgptMapping,
  current_node: 'a2',
  moderation_results: [],
};

export const chatgptNextHtml = `<!doctype html>
<html><head><title>What is a qubit?</title></head>
<body>
<div id="__next"><div id="root"></div></div>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: {
    pageProps: {
      serverResponse: {
        data: { title: 'What is a qubit?', mapping: chatgptMapping, current_node: 'a2' },
      },
    },
  },
})}</script>
</body></html>`;

export const chatgptFlightHtml = `<!doctype html>
<html><head><title>Flight payload</title></head><body>
<div id="root"></div>
<script>self.__next_f=self.__next_f||[];self.__next_f.push([1,"${JSON.stringify({ mapping: chatgptMapping })
  .replace(/"/g, '\\"')}"])</script>
</body></html>`;

export const chatgptDomHtml = `<!doctype html>
<html><head><title>ChatGPT - Rendered conversation</title></head><body>
<main>
  <div data-message-author-role="user" data-message-id="m1">
    <div class="markdown"><p>Hello <strong>there</strong></p></div>
  </div>
  <div data-message-author-role="assistant" data-message-id="m2">
    <div class="markdown">
      <p>Hi! Here is some code:</p>
      <pre><code class="language-js">console.log("hi");</code></pre>
      <ul><li>first</li><li>second</li></ul>
    </div>
  </div>
</main>
</body></html>`;

export const claudeApi = {
  name: 'Entropy questions',
  chat_messages: [
    {
      uuid: 'h1',
      sender: 'human',
      text: 'Explain entropy like I am five.',
      content: [{ type: 'text', text: 'Explain entropy like I am five.' }],
    },
    {
      uuid: 'a1',
      sender: 'assistant',
      text: 'Entropy is how many ways the parts of something can be arranged.',
      content: [
        { type: 'text', text: 'Entropy is how many ways the parts of something can be arranged.' },
        { type: 'tool_use', id: 'tool-1', name: 'calculator', input: {} },
      ],
    },
  ],
};

export const claudeDomHtml = `<!doctype html>
<html><head><title>Claude</title></head><body>
<div class="conversation">
  <div data-testid="user-message"><p>Explain entropy like I am five.</p></div>
  <div data-testid="assistant-message">
    <div class="font-claude-message"><p>Entropy is how many ways the parts can be arranged.</p></div>
  </div>
</div>
</body></html>`;

export const geminiHtml = `<!doctype html>
<html><head><title>Gemini</title></head><body>
<chat-window>
  <user-query><div class="query-text">What is a supernova?</div></user-query>
  <model-response><div class="markdown"><p>A supernova is the explosive death of a massive star.</p></div></model-response>
  <user-query><div class="query-text">How bright is it?</div></user-query>
  <model-response><div class="markdown"><p>For a few weeks it can outshine an entire galaxy.</p></div></model-response>
</chat-window>
</body></html>`;

export const deepseekHtml = `<!doctype html>
<html><head><title>DeepSeek</title></head><body>
<div class="chat">
  <div data-role="user"><div class="ds-markdown"><p>Explain recursion.</p></div></div>
  <div data-role="assistant"><div class="ds-markdown"><p>Recursion is a function calling itself.</p></div></div>
</div>
</body></html>`;

export const chatgptCopyTranscript = `You said:
What is 2 + 2?

ChatGPT said:
2 + 2 equals 4. Anything else?

You said:
Explain why.

ChatGPT said:
Because addition counts how many items you have in total.`;

export const markdownTranscript = `## User

Hello, who are you?

## Assistant

I am the assistant in this exported transcript.

## User

Great, thanks.`;

export const geminiBatchedHtml = `<!doctype html><html><body><script>
AF_initDataCallback({key: 'ds:5', hash: '7', data:[null,null,[["What is the tallest mountain?","A really long synthetic identifier value here"],["Mount Everest is the tallest mountain above sea level.","Another very long synthetic identifier that should be dropped from output"]],null],sideChannel: {}});
</script></body></html>`;

// Regression: a Claude share page that is only an app shell. The visible text
// happens to contain "Claude" (nav) followed by the legal footer, which the old
// heuristic happily exported as a one-message "conversation".
export const claudeShellHtml = `<!doctype html>
<html><head><title>Claude</title></head><body>
<div id="root">
  <div class="app">
    <nav><a href="/">Claude</a></nav>
    <main><div id="conversation"></div></main>
    <footer>
      <p>Anthropic PBC | 사업자등록번호 86-1969045</p>
      <p>Anthropic PBC | 사업자등록번호 86-1969045 (미국 델라웨어) | 다리오 아모데이</p>
      <p>통신판매업 신고: 2025-공정-0020호 | 사업자정보확인 | 호스팅제공자: AWS Cloud Services | 이용약관</p>
      <p>주소: 500 Howard Street, San Francisco, California U.S. | 대표전화: 1-415-505-5563</p>
    </footer>
  </div>
</div>
<script src="/_next/static/chunks/main.js"></script>
</body></html>`;

// Regression: a single stray message is not a conversation.
export const singleMessageHtml = `<!doctype html>
<html><head><title>ChatGPT</title></head><body>
<div data-message-author-role="assistant"><div class="markdown"><p>Something ChatGPT said in a banner.</p></div></div>
</body></html>`;