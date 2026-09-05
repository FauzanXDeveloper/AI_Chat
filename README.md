# Nexus — AI Chat

A chat interface for the [OpenRouter](https://openrouter.ai) API in plain HTML, CSS and JavaScript.
No build step, no framework, no backend. Dark violet ground with an ambient wash, frosted panels,
a 5px corner everywhere and drawn icons throughout — the same layout on a desktop, a tablet and a phone.

## Running it

```bash
cd AI-Interface
python -m http.server 5500
# open http://localhost:5500
```

Or right-click [index.html](index.html) → **Open with Live Server** in VS Code.

A local server matters more than it used to: the service worker (which makes the app installable
on phones) only registers over `http://`, not `file://`.

## Hosting it

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) publishes the repository to GitHub
Pages on every push to `main`, and can be run by hand from the **Actions** tab. There is nothing to
build: the job copies the repo (minus `.git`, `.github` and the colour helper), drops a `.nojekyll`
marker in, and force-pushes the result to the `gh-pages` branch, which is what Pages serves.

It publishes by pushing a branch rather than through the Pages deployment API on purpose. That API
needs Pages set to *GitHub Actions* as its source, and a repository whose Actions token is
read-only cannot set that itself — the deploy fails before the site is ever uploaded. Pushing a
branch is an ordinary write, and creating `gh-pages` is what switched Pages on here in the first
place.

The site lands at **https://fauzanxdeveloper.github.io/AI_Chat/**. Every path in the app is
relative, so serving it from a subfolder works as-is, and because Pages is `https` the browser
grants the File System Access API — **Open folder**, editing and **Apply changes** all write to
disk there, exactly as they do on `localhost`.

Your OpenRouter key never leaves the browser it was typed into: it lives in `localStorage` and is
sent only to `openrouter.ai`. Nothing is stored on the host.

## First run

1. Get a key at [openrouter.ai/keys](https://openrouter.ai/keys).
2. Settings opens automatically — paste it into **API → OpenRouter API key**.
3. Click **Save key & load models**.

The key lives in this browser's `localStorage` and is sent only to `openrouter.ai`.

## Features

**Chat**
- Streaming replies with a live caret and a Stop button that keeps partial output
- Sticky-bottom scrolling: it follows new output, and stops the moment you scroll away
- Markdown with tables, syntax-highlighted code and per-block copy buttons
- Copy / regenerate / delete on any message; edit-and-resend on your own
- Image attachments for vision models — clip button, paste, or drag onto the page
- Errors show the real upstream reason plus the raw OpenRouter payload

**Auto model**

Switch it on from the **+** menu or **Settings → Parameters**, set a daily budget, and each turn is
routed on its own:

- The request is read first — length, code, analysis words, attachments, workspace context and the
  file you asked for all move it between *light*, *standard* and *heavy*
- A model is then chosen from the live catalogue at the price the tier deserves, preferring the
  strong families and longer context when the price is equal
- Every reply's real token usage is priced and added to the day's total; as the budget runs low the
  picks step down, and once it is gone only free models are used
- The top bar shows **Auto ·** and the model it landed on, and the day's spend has its own meter

**Agents**
- Five built-ins — General, Engineer, Writer, Analyst, Tutor — each with its own role, preferred
  model and temperature
- Create your own in **Settings → Agents**; built-ins can be edited but not deleted
- Switch per conversation from the top bar (`Ctrl+J`)

**Output panel**

When a reply contains code or a table, it also opens beside the conversation:

- Opens by itself as the reply streams in, and fills in line by line while the model writes
- One tab per file or table — every one the conversation has produced, not just the last reply —
  with code shown with line numbers and highlighting, and tables as a real grid with column
  letters and row numbers
- The top bar carries a counter of the files in the chat; click it to open the panel or close it
- Delete a file from the panel header or from the **Artifacts** tab — it leaves the file set, the
  count and the card under the reply, while the reply itself keeps the text; **Restore removed
  files** at the foot of the Artifacts tab brings them all back
- Copy or download what is on screen — a `.py`, `.js`, `.sql` file, or that one sheet as `.xlsx` —
  and **Save all** takes the whole reply as a workbook or a zip
- Picking **Spreadsheet** in the composer opens the panel on the table when the reply lands, so the
  `.xlsx` is one click away rather than something to hunt for
- Drag its left edge to resize; it slides over the conversation on narrow screens, `Esc` closes it
- The card under the reply reopens it later

**File generation**

Every reply has an **Export** button, and the top bar exports the whole conversation:

| Format | What it does |
| --- | --- |
| `.md` | Raw Markdown |
| `.docx` | Headings, paragraphs, lists, tables and code become real Word structure |
| `.xlsx` | Each Markdown table becomes a sheet, named from the heading above it |
| `.pptx` | Each heading becomes a slide, with the bullets beneath it |
| `.zip` | Each code block becomes a file, named from its fence or the line above |

The **file icon** in the composer works the other way round: pick a target format *before* asking,
and the request is shaped so the reply converts cleanly — tables for spreadsheets, slide bullets
for decks, complete named files for code.

Generator libraries load on demand, so startup stays fast if you never export.

**Workspace**

Clicking **Workspace** switches the whole window into an editor layout, laid out the way an editor
is: an activity rail of view icons on the far left, the file tree beside it, the file you are
editing in the middle with breadcrumbs above it and the terminal panel below, the conversation down
the right-hand side, and a status bar across the bottom carrying the folder, unsaved count, model,
`Ln`/`Col`, indentation, encoding and language.

Each view carries its own layout: **Workspace** puts the conversation down the right-hand side,
while **Chats** and **Artifacts** return to the ordinary centred conversation — from the rail or
from the rows in the sidebar, either way. The button beside Export toggles the same thing, the
divider between editor and chat drags, and below 1100px the whole thing folds back on its own.

**Open folder** reads a real project, and the middle column becomes a small editor over it:

- Click a file in the tree to open it as a tab in the side panel — line numbers, highlighting,
  editable, `Ctrl+S` to write it back. A dot on the tab and in the tree marks unsaved changes.
- Tick a file's box to send it to the model; the tabs and the assistant's own files share one strip
- Whenever a folder is open the model is told about it on every turn — the project name, the full
  file listing, whatever is open in the editor (including unsaved edits), the files you ticked, and
  how to write a file back. Before this it received nothing unless you ticked something first.
- It can also ask for a file it has not been given, with a ```` ```read ```` block of paths. The app
  reads them out of the folder, drops an *Attached main.py* note into the transcript and lets the
  reply continue — twice per question, so it cannot loop. Tool-call tokens from tool-tuned models
  (`<|tool_call_start|>[read(path='…')]`) are read as the same request and never shown raw, and a
  hallucinated absolute path still resolves if the file name matches something in the folder.
- When a reply contains files, a bar appears above the editor — *The assistant changed 2 files* —
  with **Review** (a line-by-line diff against disk, accepted or skipped per file) and **Apply all**
- **Write files without asking** in the **+** menu skips the review and writes each reply straight
  to the folder
- **Terminal output** sits under the tree: paste a stack trace, a failing test or a build log (or
  load a `.log` file) and it rides along with your next message, so the model sees the error it is
  fixing. A web page cannot run commands, so this is the honest half — you run them, it reads them.
- With the File System Access API (Chrome, Edge, Brave, Opera over `http://localhost` or any https
  site, GitHub Pages included) the folder opens with handles, so editing and applying write to disk
- Everywhere else — Firefox, iOS, an embedded preview, or the page opened as `file://` — the button
  falls back to a folder picker that reads the tree read-only. The panel then says which case it is
  and offers the way out: **Reopen with write access** where the handle API is available, or **Open
  this app in a browser tab** when the page is stuck inside a preview pane.
- `node_modules`, `.git`, build folders and binaries are skipped; files over 200 KB are left out

**Usage**

**Settings → Usage** shows credits spent against your balance with a progress bar (amber past 70%,
red past 90%), your tier, rate limit, and local prompt/output token totals.

**Models**
- Live catalogue with search and Free / Vision / Saved filters
- Price per million tokens and context length on every row; star to pin
- Audio-only models (`lyria`, `gpt-audio`) are filtered out — they cannot answer a chat

**Interface**
- The rail lists Chats, Artifacts, Workspace and Agents; conversations can be pinned to the top,
  and **Artifacts** collects every file and table the assistant has written, across all chats
- One **+** in the composer holds attachments (`Ctrl+U`), the project folder, the chat's system
  prompt, the file to ask for, and the **Web search** and **Auto model** switches; whatever is on
  shows as a chip above the composer that turns it off when clicked
- **Web search** routes the turn through OpenRouter's `:online` suffix, so replies can cite live pages
- The loader counts up while the model thinks, and streamed text lights up as it lands
- Dark / light / system, six gradient accents, adjustable message width and font size
- The conversation sits on a frosted card over a slow violet wash; hover lifts, focus rings and
  short menu transitions carry the interaction (all of it dropped under `prefers-reduced-motion`)
- Drag the sidebar edge to resize (double-click resets, arrow keys nudge)
- Installable on iPhone, iPad, Android and desktop via **Add to Home Screen** / the install icon
- Under 860px the rail becomes an overlay drawer that starts closed; suggestion cards stack,
  the composer keeps its controls on a second row and touch targets grow
- Safe-area insets for notches, 16px inputs so iOS doesn't zoom, larger touch targets,
  full-screen modals on phones

**Keyboard**

| Shortcut | Action |
| --- | --- |
| `Enter` | Send |
| `Shift+Enter` | New line |
| `Ctrl/Cmd + Enter` | Send, even with **Enter sends** turned off |
| `Ctrl/Cmd + K` | New chat |
| `Ctrl/Cmd + B` | Toggle sidebar |
| `Ctrl/Cmd + J` | Agent picker |
| `Ctrl/Cmd + M` | Model picker |
| `Ctrl/Cmd + /` | Search conversations |
| `Ctrl/Cmd + ,` | Settings |
| `Esc` | Stop generating, or close the open panel |

## Files

| File | Contents |
| --- | --- |
| [index.html](index.html) | Markup: shell, composer, pickers, settings, agent editor |
| [styles.css](styles.css) | Tokens, themes, layout, Markdown, responsive and touch rules |
| [app.js](app.js) | State, persistence, OpenRouter calls, streaming, agents, file generation |
| [sw.js](sw.js) | Service worker — network-first, so it never serves stale code |
| [manifest.json](manifest.json) | Install metadata |

`marked`, `DOMPurify` and `highlight.js` load from cdnjs up front. `SheetJS`, `JSZip`, `docx` and
`PptxGenJS` load only when you export.

## Notes

- Assets are versioned (`?v=22`). After editing CSS or JS, bump that number or hard-reload
  (`Ctrl+Shift+R`) — browser caching will otherwise hide your changes.
- All data is in `localStorage` under `nexus.*`. **Settings → Data** exports, imports or wipes it.
- Free models usually require Prompt Logging enabled at
  [openrouter.ai/settings/privacy](https://openrouter.ai/settings/privacy), and are capped per day.
- Token counts come from the API when reported, otherwise estimated at `chars / 4`. Real billing is
  at [openrouter.ai/activity](https://openrouter.ai/activity).
