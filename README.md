# Chat Exporter

Paste a **ChatGPT**, **Claude**, **Gemini** or **DeepSeek** link and copy the entire conversation as Markdown, JSON or plain text.

Runs locally in your browser — no account, no upload, no cloud service.

```powershell
npm start
```

Then open the printed URL (default <http://127.0.0.1:8765>) and paste a share link.

- `PORT=9000 npm start` — choose a port (it steps to the next free one if busy).
- `npm start -- --open` — open the browser automatically.
- `node server.mjs --open` — same thing without npm.

---

## What it does

1. **Link mode.** Paste a public share link and press *Export conversation*.
   The app asks the provider's own public share endpoint first, then the page's
   embedded JSON, then the rendered markup.
2. **Preview.** Every message is shown with its role, ready to copy one by one.
3. **Copy or save.** *Copy Markdown* puts the whole transcript on the clipboard;
   with *Copy after export* ticked (default) that already happened as soon as the
   export finished. The `.md` / `.txt` / `.json` buttons save files.

Automatic extraction works best with **public share links**. ChatGPT's public
share endpoint is verified end to end against live share links; the other
providers use the same layered approach and fall back to browser capture when a
site refuses automated requests.

| Provider | Public link form | Link mode |
| --- | --- | --- |
| ChatGPT | `https://chatgpt.com/share/…` | Public share API, then page data |
| Claude | `https://claude.ai/share/…` | Public share API, then page data |
| DeepSeek | `https://chat.deepseek.com/share/…` | Best effort (bot protection often blocks it) |
| Gemini | `https://gemini.google.com/share/…` | Best effort (usually requires a signed-in browser) |

Anything private — a normal `/c/…` or `/chat/…` link, a chat behind a login, a
provider that blocks server requests — goes through **browser capture** instead.
That is not a limitation of this tool: those transcripts only exist inside your
logged-in browser session.

## Private chats, step by step

Private conversations (`/c/…`, `/chat/…`, anything behind your login) can't be
read by a server request — the text only exists inside your browser session. So
capture it from the page you already have open:

1. Start the app (`npm start`) and open <http://127.0.0.1:8765>.
2. In **Capture from your browser → One-click capture**, drag the *Copy conversation*
   button onto your bookmarks bar. (No bookmarks bar? `Ctrl`+`Shift`+`B` shows it.)
3. Open the private chat in ChatGPT / Claude / Gemini / DeepSeek and scroll to the
   top once, so every message has rendered.
4. Click the bookmark. You'll get a popup like
   *“copied 24 messages (12 user / 12 assistant)”* and the whole chat is on your clipboard.
5. Back in the app, open the **Paste text** tab and click
   *Paste the captured text here* — or paste manually and press *Build conversation*.
6. Now copy Markdown or save `.md` / `.txt` / `.json` like a normal export.

If step 4 reports *only replies were found*, the site's markup hid the user
turns. Use **Saved page HTML** instead: `Ctrl`+`S` the chat (“Webpage, HTML only”),
then drop the file into the app.

No bookmark bar, or a site blocks bookmarklets? Use the console route: click
*Copy snippet for the console*, open DevTools (`F12`) → Console on the chat page,
paste, press Enter.

Nothing is uploaded: the script reads the DOM locally, and the app stores results
in memory only.

## Browser capture (works everywhere)

The page has three capture methods, all local:

- **One-click capture** — drag the *Copy conversation* button to your bookmarks
  bar. Open any chat, click the bookmark, and the whole transcript lands in your
  clipboard as Markdown. (Or copy the snippet and paste it into DevTools → Console.)
- **Saved page HTML** — press `Ctrl`+`S` on the chat, save as “Webpage, HTML only”,
  then drop the file into the app.
- **Paste text** — paste anything with speaker labels (`You said:`, `ChatGPT said:`,
  `User:`, `Assistant:`) or the Markdown this app exports.

After copying from the browser, click *Paste the captured text here* in the
*Paste text* panel to turn it into `.md` / `.txt` / `.json` files.

## Command line

The same engine is available as a CLI:

```powershell
node cli.mjs https://chatgpt.com/share/xxxx --json
node cli.mjs https://claude.ai/share/xxxx --stdout
node cli.mjs https://example.com/post --allow-any-host -o exports
```

Options: `-o/--out <dir>`, `--json`, `--txt`, `--stdout`,
`--provider chatgpt|claude|gemini|deepseek`, `--allow-any-host`.

## Tests

```powershell
npm test
```

46 tests cover the HTML parser, the JSON payload scanner, each provider's DOM
markup, transcript parsing, the HTTP API and the Markdown/JSON writers. Run them
after changing a parser.

## How it works

```
server.mjs                 local HTTP server (127.0.0.1 only)
src/extract.mjs            extraction pipeline
src/providers.mjs          URL/provider detection, fetch, error hints
src/lib/embedded.mjs       conversation JSON inside page scripts
src/lib/json-scan.mjs      finds transcript shapes in arbitrary JSON
src/lib/dom.mjs            rendered-markup and transcript parsing
src/lib/html.mjs           dependency-free HTML parser → Markdown
src/lib/conversation.mjs   normalization and .md/.txt/.json writers
public/                    UI + bookmarklet
```

Extraction is layered, and each layer is recorded so the UI can show what ran:

1. provider share API (JSON)
2. JSON serialized in the page (`__NEXT_DATA__`, React Router/Flight, `af_initDataCallback`, keyed literals)
3. rendered DOM (provider selectors, then generic role attributes)
4. visible text split on speaker markers

## Privacy and safety

- The server binds to `127.0.0.1` only; the UI never leaves your machine.
- Links are restricted to known chat hosts. *Allow any site* is opt-in, and local,
  private and link-local addresses are always refused (anti-SSRF guard).
- Nothing is stored: extraction happens in memory per request.
- Clipboard access happens in your browser, on your click.

## Limitations

- Only **public** share links can be read automatically; private chats need capture.
- Share pages change. If a provider redesigns, re-run `npm test` and update the
  selectors in `src/lib/dom.mjs` / `public/bookmarklet.js`.
- Very large saved pages (over 30 MB) are rejected.
- The Markdown is faithful to what the providers expose: images become links or
  placeholders, and tool/system turns are dropped by default.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| “Blocked the automated request” | Use browser capture — the transcript is not in the HTML. |
| “Could not be found” | The share link was deleted, expired or made private. |
| Nothing extracted from a saved page | Scroll the whole chat first, then save. Try the bookmarklet. |
| Port already in use | The server picks the next free port; check the printed URL. |
| Clipboard empty after capture | Allow clipboard permission for the chat site, then click again. |build/)  ; git add . ; set GIT_AUTHOR_DATE=2026-11-03T09:15:00 ; set GIT_COMMITTERMINAL_DATE=2026-11-03T09:15:00 ; git commit -m \Initial" project "scaffold\ ; echo.  ; echo ## Local development  
  
`powershell  
npm install  
npm test  
`  
 
## Local development 
 
```powershell 
npm install 
npm test 
``` 
