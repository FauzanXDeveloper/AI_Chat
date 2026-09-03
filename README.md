# Nexus — AI Chat

A chat interface for the [OpenRouter](https://openrouter.ai) API in plain HTML, CSS and JavaScript.
No build step, no framework, no backend. Styled after VS Code.

## Running it

```bash
cd AI-Interface
python -m http.server 5500
# open http://localhost:5500
```

Or right-click [index.html](index.html) → **Open with Live Server** in VS Code.

A local server matters more than it used to: the service worker (which makes the app installable
on phones) only registers over `http://`, not `file://`.

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

**Agents**
- Five built-ins — General, Engineer, Writer, Analyst, Tutor — each with its own role, preferred
  model and temperature
- Create your own in **Settings → Agents**; built-ins can be edited but not deleted
- Switch per conversation from the top bar (`Ctrl+J`)

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

**Usage**

**Settings → Usage** shows credits spent against your balance with a progress bar (amber past 70%,
red past 90%), your tier, rate limit, and local prompt/output token totals.

**Models**
- Live catalogue with search and Free / Vision / Saved filters
- Price per million tokens and context length on every row; star to pin
- Audio-only models (`lyria`, `gpt-audio`) are filtered out — they cannot answer a chat

**Interface**
- Dark / light / system, five accents, adjustable message width and font size
- Drag the sidebar edge to resize (double-click resets, arrow keys nudge)
- Installable on iPhone, iPad, Android and desktop via **Add to Home Screen** / the install icon
- Safe-area insets for notches, 16px inputs so iOS doesn't zoom, larger touch targets,
  full-screen modals on phones

**Keyboard**

| Shortcut | Action |
| --- | --- |
| `Enter` | Send (auto-disabled on touch devices) |
| `Shift+Enter` | New line |
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

- Assets are versioned (`?v=6`). After editing CSS or JS, bump that number or hard-reload
  (`Ctrl+Shift+R`) — browser caching will otherwise hide your changes.
- All data is in `localStorage` under `nexus.*`. **Settings → Data** exports, imports or wipes it.
- Free models usually require Prompt Logging enabled at
  [openrouter.ai/settings/privacy](https://openrouter.ai/settings/privacy), and are capped per day.
- Token counts come from the API when reported, otherwise estimated at `chars / 4`. Real billing is
  at [openrouter.ai/activity](https://openrouter.ai/activity).
