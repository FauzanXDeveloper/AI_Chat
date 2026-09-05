/* ============================================================
 * Nexus — AI Chat interface for the OpenRouter API
 * Vanilla HTML / CSS / JavaScript. No build step.
 * ============================================================ */

(() => {
'use strict';

const API = 'https://openrouter.ai/api/v1';

/* Without a console on a phone, an early exception just leaves a blank screen.
   Painting it into the page is the difference between "it is broken" and a
   report anyone can act on. */
function showFatal(what, err) {
  const detail = (err && (err.stack || err.message)) || String(err || 'unknown');
  let box = document.getElementById('fatalError');
  if (!box) {
    box = document.createElement('div');
    box.id = 'fatalError';
    box.className = 'fatal-error';
    document.body.appendChild(box);
  }
  box.innerHTML =
    '<h2>Something broke while starting up</h2>' +
    '<p>' + escapeHtml(what) + '</p>' +
    '<pre>' + escapeHtml(detail) + '</pre>' +
    '<p class="fatal-hint">' + escapeHtml(navigator.userAgent) + '</p>' +
    '<button type="button" onclick="location.reload()">Reload</button>';
}

addEventListener('error', (e) => showFatal('Script error', e.error || e.message));
addEventListener('unhandledrejection', (e) => showFatal('Unhandled promise rejection', e.reason));

const KEYS = {
  chats:    'nexus.chats',
  settings: 'nexus.settings',
  apiKey:   'nexus.apiKey',
  models:   'nexus.models',
  favs:     'nexus.favs',
  current:  'nexus.currentChat',
  agents:   'nexus.agents',
};

const DEFAULTS = {
  model: 'openai/gpt-4o-mini',
  systemPrompt: 'You are a helpful assistant. Be accurate and concise, and use Markdown for structure and code.',
  temperature: 0.7,
  topP: 1,
  maxTokens: 2048,
  freqPenalty: 0,
  presPenalty: 0,
  historyLimit: 20,
  stream: true,
  theme: 'dark',
  accent: 'brand',
  msgWidth: 760,
  fontSize: 14,
  autoScroll: true,
  enterSends: true,
  sidebarCollapsed: false,
  sidebarW: 260,
  allowAsk: true,
  defaultAgentId: 'general',
  auto: false,                 // let the app choose the model
  autoBudget: 1,               // dollars per day for auto mode
  autoSpend: null,             // { day: 'YYYY-MM-DD', amount: 0 }
  web: false,                  // route through OpenRouter's :online search
  ide: false,                  // workspace layout: explorer | editor | chat
  autoApply: false,            // write the reply's files without a review first
};

/* Touch devices get a soft keyboard whose Enter key should insert a newline. */
const IS_TOUCH = matchMedia('(pointer: coarse)').matches;

const DEFAULT_AGENTS = [
  { id: 'general', icon: '◉', name: 'General', builtin: true, temperature: 0.7, model: '',
    systemPrompt: 'You are a helpful assistant. Be accurate and concise, and use Markdown for structure and code.' },
  { id: 'coder', icon: '❯', name: 'Engineer', builtin: true, temperature: 0.3, model: '',
    systemPrompt: 'You are a senior software engineer. Give production-quality code with brief explanations. Name every file you output, call out edge cases, and prefer standard library solutions over dependencies.' },
  { id: 'writer', icon: '✎', name: 'Writer', builtin: true, temperature: 0.8, model: '',
    systemPrompt: 'You are a sharp writer and editor. Produce clear, well-structured prose with meaningful headings. Cut filler, prefer concrete detail, and preserve the author’s voice.' },
  { id: 'analyst', icon: '▤', name: 'Analyst', builtin: true, temperature: 0.4, model: '',
    systemPrompt: 'You are a data analyst. Lay out findings as Markdown tables with clear column headers, state your assumptions, and finish with a short list of recommendations.' },
  { id: 'tutor', icon: '✲', name: 'Tutor', builtin: true, temperature: 0.6, model: '',
    systemPrompt: 'You are a patient tutor. Explain step by step, build from what the learner already knows, use analogies, and check understanding with a question at the end.' },
];

/* Appended to the system prompt so the reply is shaped for the requested file. */
const DELIVERABLES = {
  xlsx: { label: 'Spreadsheet (.xlsx)', instruction:
    'The user wants a spreadsheet. Present all data as GitHub-flavoured Markdown tables. Put a short "## Heading" before each table — it becomes the sheet name. Keep each record on a single row, use consistent column headers, and avoid merged or nested cells.' },
  docx: { label: 'Document (.docx)', instruction:
    'The user wants a written document. Structure the reply as one "# Title", then "## Section" headings with ordinary paragraphs and bullet lists. Write flowing prose rather than terse notes, and avoid code blocks unless explicitly asked.' },
  pptx: { label: 'Presentation (.pptx)', instruction:
    'The user wants slides. Use "## Slide title" for each slide, followed by 3-5 short bullet points. One idea per bullet, no paragraphs, and no more than about 12 words per bullet.' },
  zip:  { label: 'Codebase (.zip)', instruction:
    'The user wants a runnable project. Output every file as its own fenced code block. On the line immediately before each block, put the file path alone in backticks, e.g. `src/app.js`. Give complete file contents, never fragments or ellipses.' },
};

/* ------------------------------------------------------------
 * Tiny helpers
 * ---------------------------------------------------------- */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const uid = () =>
  (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Rough token estimate — good enough for a UI counter, not for billing. */
const estTokens = (text) => Math.ceil((text || '').length / 4);

const fmtNum = (n) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` :
  n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn('Storage write failed', err);
    toast('Local storage is full — older chats may not be saved.', 'err');
    return false;
  }
}

/* ------------------------------------------------------------
 * State
 * ---------------------------------------------------------- */

const state = {
  settings: { ...DEFAULTS, ...readJSON(KEYS.settings, {}) },
  apiKey:   localStorage.getItem(KEYS.apiKey) || '',
  chats:    readJSON(KEYS.chats, []),
  models:   readJSON(KEYS.models, []),
  favs:     readJSON(KEYS.favs, []),
  currentId: localStorage.getItem(KEYS.current) || null,
  attachments: [],
  controller: null,   // AbortController for the in-flight request
  streaming: false,
  modelFilter: 'all',
  modelQuery: '',
  stick: true,        // follow new output only while the reader is at the bottom
  agents: readJSON(KEYS.agents, null) || DEFAULT_AGENTS.map((a) => ({ ...a })),
  deliverable: null,  // pending "give me a file" request
  readRounds: 0,      // file requests already served for this exchange
  wsContext: '',      // workspace files attached to the current turn
  editingAgentId: null,
  usage: null,
};

const saveSettings = () => writeJSON(KEYS.settings, state.settings);
const saveChats    = () => writeJSON(KEYS.chats, state.chats);
const saveFavs     = () => writeJSON(KEYS.favs, state.favs);
const saveAgents   = () => writeJSON(KEYS.agents, state.agents);

const agentById = (id) => state.agents.find((a) => a.id === id) || null;

const currentChat = () => state.chats.find((c) => c.id === state.currentId) || null;

function newChat(activate = true) {
  const chat = {
    id: uid(),
    title: 'New chat',
    messages: [],
    model: state.settings.model,
    agentId: state.settings.defaultAgentId,
    systemPrompt: null,           // null = inherit from the agent
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  state.chats.unshift(chat);
  if (activate) setCurrent(chat.id);
  saveChats();
  return chat;
}

function setCurrent(id) {
  if (typeof closeArtifact === 'function') closeArtifact();
  state.currentId = id;
  localStorage.setItem(KEYS.current, id);
  renderChatList();
  renderMessages();
  syncModelUI();
  syncAgentUI();
  updateWorkspaceUI();
}

/** Returns the active chat, creating one if the app has none. */
function ensureChat() {
  return currentChat() || newChat();
}

/* ------------------------------------------------------------
 * Elements
 * ---------------------------------------------------------- */

const el = {
  app:          $('#app'),
  sidebar:      $('#sidebar'),
  sidebarScrim: $('#sidebarScrim'),
  chatList:     $('#chatList'),
  searchInput:  $('#searchInput'),
  messages:     $('#messages'),
  welcome:      $('#welcome'),
  scrollRegion: $('#scrollRegion'),
  scrollDown:   $('#scrollDownBtn'),
  composer:     $('#composer'),
  artifact:     $('#artifactPanel'),
  artifactBody: $('#artifactBody'),
  artifactTabs: $('#artifactTabs'),
  input:        $('#input'),
  sendBtn:      $('#sendBtn'),
  stopBtn:      $('#stopBtn'),
  attachments:  $('#attachments'),
  fileInput:    $('#fileInput'),
  charCount:    $('#charCount'),
  ctxInfo:      $('#ctxInfo'),
  statusLine:   $('#statusLine'),
  topbarTitle:  $('#topbarTitle'),
  usageText:    $('#usageText'),
  modelPicker:  $('#modelPicker'),
  modelBtn:     $('#modelBtn'),
  modelMenu:    $('#modelMenu'),
  modelMenuList:$('#modelMenuList'),
  modelLabel:   $('#modelLabel'),
  modelDot:     $('#modelDot'),
  modelSearch:  $('#modelSearch'),
  modelCount:   $('#modelCount'),
  settingsModal:$('#settingsModal'),
  sysModal:     $('#sysModal'),
  sysChatInput: $('#sysChatInput'),
  apiKeyInput:  $('#apiKeyInput'),
  keyStatus:    $('#keyStatus'),
  toastStack:   $('#toastStack'),
  hljsTheme:    $('#hljsTheme'),
};

/* ------------------------------------------------------------
 * Toasts
 * ---------------------------------------------------------- */

/** Clipboard API needs a secure context; a phone on the LAN has none. */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the legacy path */ }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function toast(message, kind = '', ms = 3200) {
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  el.toastStack.appendChild(node);
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 240);
  }, ms);
}

/* ------------------------------------------------------------
 * Markdown
 * ---------------------------------------------------------- */

/* Claude-style asterisk loader: rays pulse in sequence while the whole
   figure turns, so it reads as thought rather than as a spinner. */
const THINKING_HTML =
  '<div class="thinking" role="status" aria-label="Thinking">' +
    '<svg class="think-star" viewBox="0 0 24 24" aria-hidden="true">' +
      '<g>' +
        '<line x1="12" y1="2.5" x2="12" y2="21.5"/>' +
        '<line x1="2.5" y1="12" x2="21.5" y2="12"/>' +
        '<line x1="5.3" y1="5.3" x2="18.7" y2="18.7"/>' +
        '<line x1="18.7" y1="5.3" x2="5.3" y2="18.7"/>' +
      '</g>' +
    '</svg>' +
    '<span class="thinking-text">Thinking' + '…' + '</span>' +
    '<span class="think-time"></span>' +
  '</div>';

const COPY_SVG = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>';

if (window.marked) {
  const renderer = new marked.Renderer();

  renderer.code = (code, infostring) => {
    const lang = (infostring || '').trim().split(/\s+/)[0].toLowerCase();
    const valid = lang && window.hljs?.getLanguage(lang) ? lang : '';
    let body;
    try {
      body = valid ? hljs.highlight(code, { language: valid }).value : escapeHtml(code);
    } catch {
      body = escapeHtml(code);
    }
    return `<div class="code-block">
      <div class="code-head">
        <span>${escapeHtml(valid || 'text')}</span>
        <button class="copy-code" data-action="copy-code" type="button">${COPY_SVG}<span>Copy</span></button>
      </div>
      <pre><code class="hljs language-${escapeHtml(valid)}">${body}</code></pre>
    </div>`;
  };

  // Wide tables get their own horizontal scroller so the page never scrolls sideways.
  renderer.table = (header, body) =>
    `<div class="table-scroll"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>`;

  renderer.link = (href, title, text) =>
    `<a href="${escapeHtml(href || '')}" title="${escapeHtml(title || '')}" target="_blank" rel="noopener noreferrer">${text}</a>`;

  marked.setOptions({ renderer, gfm: true, breaks: true, headerIds: false, mangle: false });
}

function renderMarkdown(text) {
  const raw = window.marked ? marked.parse(text || '') : escapeHtml(text || '').replace(/\n/g, '<br>');
  return window.DOMPurify
    ? DOMPurify.sanitize(raw, { ADD_ATTR: ['target', 'rel'] })
    : raw;
}

/* ------------------------------------------------------------
 * Models
 * ---------------------------------------------------------- */

function modelById(id) {
  return state.models.find((m) => m.id === id) || null;
}

function isVision(m) {
  const mods = m.architecture?.input_modalities || [];
  return mods.includes('image') || /image/.test(m.architecture?.modality || '');
}

/**
 * A handful of catalogue entries are audio generators — google/lyria-* is a music
 * model, openai/gpt-audio* speaks its replies. They advertise "text" output but
 * answer a plain chat completion with a provider error, and this UI could not play
 * the result anyway. Models that emit images alongside text are fine: we show the text.
 */
function canChat(m) {
  const out = m.architecture?.output_modalities;
  return !Array.isArray(out) || !out.includes('audio');
}

function isFree(m) {
  const p = Number(m.pricing?.prompt ?? 0);
  const c = Number(m.pricing?.completion ?? 0);
  return p === 0 && c === 0;
}

/** openrouter/auto reports -1 — its real price depends on the model it routes to. */
function isVariablePrice(m) {
  return Number(m.pricing?.prompt ?? 0) < 0 || Number(m.pricing?.completion ?? 0) < 0;
}

function priceLabel(m) {
  if (!m?.pricing) return '';
  if (isVariablePrice(m)) return '<span style="opacity:.7">varies</span>';
  if (isFree(m)) return '<span class="tag-free">FREE</span>';
  const inTok  = Number(m.pricing.prompt) * 1e6;
  const outTok = Number(m.pricing.completion) * 1e6;
  const fmt = (v) => (v >= 1 ? v.toFixed(2) : v.toFixed(3));
  return `$${fmt(inTok)} / $${fmt(outTok)}<br><span style="opacity:.6">per M tok</span>`;
}

async function loadModels({ silent = false } = {}) {
  try {
    const res = await fetch(`${API}/models`, {
      headers: state.apiKey ? { Authorization: `Bearer ${state.apiKey}` } : {},
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.models = (data.data || []).sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
    writeJSON(KEYS.models, state.models);
    renderModelMenu();
    syncModelUI();
    if (!silent) toast(`Loaded ${state.models.length} models`, 'ok');
  } catch (err) {
    if (!silent) toast(`Could not load models: ${err.message}`, 'err');
  }
}

function renderModelMenu() {
  const q = state.modelQuery.toLowerCase();
  const active = ensureChat().model;

  let list = state.models.filter((m) => {
    if (!canChat(m)) return false;
    if (q && !(`${m.id} ${m.name || ''}`.toLowerCase().includes(q))) return false;
    if (state.modelFilter === 'free'   && !isFree(m)) return false;
    if (state.modelFilter === 'vision' && !isVision(m)) return false;
    if (state.modelFilter === 'fav'    && !state.favs.includes(m.id)) return false;
    return true;
  });

  // Saved models first, then the rest.
  list.sort((a, b) => (state.favs.includes(b.id) ? 1 : 0) - (state.favs.includes(a.id) ? 1 : 0));

  const chatCapable = state.models.filter(canChat).length;
  el.modelCount.textContent = `${list.length} of ${chatCapable} chat models`;

  if (!state.models.length) {
    el.modelMenuList.innerHTML =
      '<div class="empty-list">No models cached yet.<br>Add your API key in Settings, or hit “Refresh list”.</div>';
    return;
  }
  if (!list.length) {
    el.modelMenuList.innerHTML = '<div class="empty-list">No models match that filter.</div>';
    return;
  }

  el.modelMenuList.innerHTML = list.slice(0, 400).map((m) => {
    const ctx = m.context_length ? `${fmtNum(m.context_length)} ctx` : '';
    const bits = [ctx, isVision(m) ? 'vision' : ''].filter(Boolean).join(' · ');
    return `
      <div class="model-row ${m.id === active ? 'selected' : ''}" data-model="${escapeHtml(m.id)}" role="option">
        <button class="model-row-main" data-action="pick-model" data-model="${escapeHtml(m.id)}" style="text-align:left;min-width:0">
          <div class="model-row-name">${escapeHtml(m.name || m.id)}</div>
          <div class="model-row-sub">${escapeHtml(m.id)}${bits ? ' — ' + bits : ''}</div>
        </button>
        <div class="model-row-price">${priceLabel(m)}</div>
        <button class="fav-btn ${state.favs.includes(m.id) ? 'on' : ''}" data-action="fav-model"
                data-model="${escapeHtml(m.id)}" title="Save this model" type="button"><svg viewBox="0 0 24 24"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z"/></svg></button>
      </div>`;
  }).join('');
}

function syncModelUI() {
  if (typeof updateStatusBar === 'function') updateStatusBar();
  const chat = currentChat();
  const id = chat?.model || state.settings.model;
  const m = modelById(id);
  const auto = state.settings.auto ? 'Auto · ' : '';
  el.modelLabel.textContent = `${auto}${m?.name || id}`;
  el.modelBtn.title = state.settings.auto
    ? `Auto mode picked ${id} — $${autoRemaining().toFixed(2)} of today's budget left`
    : id;
  el.modelBtn.classList.toggle('auto-on', !!state.settings.auto);
  el.modelDot.classList.toggle('live', !!state.apiKey);
}

/* ------------------------------------------------------------
 * Chat list
 * ---------------------------------------------------------- */

function groupLabel(ts) {
  const day = 864e5;
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  if (ts >= startOfToday) return 'Today';
  if (ts >= startOfToday - day) return 'Yesterday';
  if (ts >= startOfToday - day * 7) return 'Previous 7 days';
  if (ts >= startOfToday - day * 30) return 'Previous 30 days';
  return 'Older';
}

function renderChatList() {
  const q = el.searchInput.value.trim().toLowerCase();

  const list = state.chats.filter((c) => {
    if (!q) return true;
    if (c.title.toLowerCase().includes(q)) return true;
    return c.messages.some((m) => textOf(m).toLowerCase().includes(q));
  });

  if (!list.length) {
    el.chatList.innerHTML = `<div class="empty-list">${q ? 'No conversations match.' : 'No conversations yet.'}</div>`;
    return;
  }

  const row = (c) => `
      <div class="chat-item ${c.id === state.currentId ? 'active' : ''}" data-id="${c.id}">
        <button class="chat-item-title" data-action="open-chat" data-id="${c.id}" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</button>
        <div class="chat-item-actions">
          <button class="icon-btn ${c.pinned ? 'on' : ''}" data-action="pin-chat" data-id="${c.id}" title="${c.pinned ? 'Unpin' : 'Pin to the top'}">
            <svg viewBox="0 0 24 24"><path d="M15 3l6 6-3 1-4 4-1 5-6-6 5-1 4-4z"/><path d="M9 15l-5 6"/></svg>
          </button>
          <button class="icon-btn" data-action="rename-chat" data-id="${c.id}" title="Rename">
            <svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>
          </button>
          <button class="icon-btn del" data-action="delete-chat" data-id="${c.id}" title="Delete">
            <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
          </button>
        </div>
      </div>`;

  const pinned = list.filter((c) => c.pinned).sort((a, b) => b.updatedAt - a.updatedAt);
  const rest   = list.filter((c) => !c.pinned).sort((a, b) => b.updatedAt - a.updatedAt);

  let html = '<div class="chat-group-label">Pinned</div>';
  html += pinned.length
    ? pinned.map(row).join('')
    : '<div class="pin-hint">Pin a chat to keep it here</div>';

  let lastGroup = '';
  for (const c of rest) {
    const g = groupLabel(c.updatedAt);
    if (g !== lastGroup) { html += `<div class="chat-group-label">${g}</div>`; lastGroup = g; }
    html += row(c);
  }
  el.chatList.innerHTML = html;

  const count = $('#navChatCount');
  if (count) count.textContent = state.chats.length || '';
}

/* ------------------------------------------------------------
 * Messages
 * ---------------------------------------------------------- */

/** A message's content may be a string or an OpenAI-style content array. */
function textOf(msg) {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
  }
  return '';
}

function imagesOf(msg) {
  if (!Array.isArray(msg.content)) return [];
  return msg.content.filter((p) => p.type === 'image_url').map((p) => p.image_url.url);
}

/** A turn that was nothing but a file request reads as a note, not an empty bubble. */
function replyBodyHTML(msg, text) {
  const body = stripToolTokens(text);
  if (body.trim()) return renderMarkdown(body);

  const asked = extractReadRequests(textOf(msg));
  if (asked.length) {
    return `<span class="req-note">Asked to read ${escapeHtml(asked.join(', '))}</span>`;
  }
  return renderMarkdown(body);
}

function messageHTML(msg, chat) {
  const text = textOf(msg);
  const imgs = imagesOf(msg);

  if (msg.role === 'user' && msg.auto) {
    // An attachment the app made on the model's behalf: a note, not a turn.
    return `
      <div class="msg auto" data-id="${msg.id}">
        <span class="auto-chip">
          <svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/></svg>
          Attached ${escapeHtml((msg.attached || []).join(', ') || 'files')} for the assistant
        </span>
      </div>`;
  }

  if (msg.role === 'user') {
    return `
      <div class="msg user" data-id="${msg.id}">
        ${imgs.length ? `<div class="msg-images">${imgs.map((s) => `<img src="${escapeHtml(s)}" alt="attachment">`).join('')}</div>` : ''}
        <div class="bubble">${escapeHtml(text)}</div>
        <div class="msg-tools">
          <button class="tool-btn" data-action="copy-msg" data-id="${msg.id}">${COPY_SVG}Copy</button>
          <button class="tool-btn" data-action="edit-msg" data-id="${msg.id}">
            <svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>Edit
          </button>
          <button class="tool-btn danger" data-action="delete-msg" data-id="${msg.id}">
            <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>Delete
          </button>
        </div>
      </div>`;
  }

  if (msg.role === 'error') {
    return `
      <div class="msg error" data-id="${msg.id}">
        <div class="msg-head"><span class="avatar">!</span><span>Request failed</span></div>
        <div class="bubble"><b>${escapeHtml(msg.title || 'Error')}</b><br>${escapeHtml(text)}${
          msg.detail ? `<details class="err-detail"><summary>Show raw response from OpenRouter</summary><pre>${escapeHtml(msg.detail)}</pre></details>` : ''
        }</div>
        <div class="msg-tools" style="opacity:1">
          <button class="tool-btn" data-action="retry" data-id="${msg.id}">
            <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 11-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>Retry
          </button>
          <button class="tool-btn danger" data-action="delete-msg" data-id="${msg.id}">Dismiss</button>
        </div>
      </div>`;
  }

  const modelName = modelById(msg.model)?.name || msg.model || chat.model;
  const agent = agentById(chat.agentId);
  const ask = msg.pending ? { text: '', spec: null } : extractAsk(text);
  const showCard = ask.spec && !msg.askAnswered && !msg.askDismissed;
  const stats = [];
  if (msg.tokens)  stats.push(`${fmtNum(msg.tokens)} tok`);
  if (msg.elapsed) stats.push(`${(msg.elapsed / 1000).toFixed(1)}s`);

  return `
    <div class="msg assistant" data-id="${msg.id}">
      <div class="msg-head">
        <span class="avatar brand"><img src="favicon.png" alt="" width="15" height="15"></span>
        <span>${escapeHtml(agent?.name || 'Assistant')}</span>
        <span class="sep">&middot;</span>
        <span class="msg-model">${escapeHtml(modelName)}</span>
      </div>
      <div class="bubble md" data-body>${msg.pending ? THINKING_HTML : replyBodyHTML(msg, ask.text)}</div>
      ${msg.pending ? '' : artifactChipHTML(msg)}
      ${showCard ? askCardHTML(msg, ask.spec) : ''}
      ${msg.askAnswered ? `<div class="ask-answered">${escapeHtml(msg.askAnswered.replace(/\*\*/g, ''))}</div>` : ''}
      <div class="msg-tools">
        <button class="tool-btn" data-action="copy-msg" data-id="${msg.id}">${COPY_SVG}Copy</button>
        <button class="tool-btn" data-action="regen" data-id="${msg.id}">
          <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 11-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>Regenerate
        </button>
        <button class="tool-btn" data-action="export-msg" data-id="${msg.id}">
          <svg viewBox="0 0 24 24"><path d="M12 3v12M8 11l4 4 4-4M4 21h16"/></svg>Export
        </button>
        <button class="tool-btn danger" data-action="delete-msg" data-id="${msg.id}">
          <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>Delete
        </button>
        ${stats.length ? `<span class="msg-meta">${stats.join(' · ')}</span>` : ''}
      </div>
    </div>`;
}

function renderMessages() {
  state.stick = true;
  const chat = currentChat();
  const msgs = chat?.messages || [];

  el.welcome.classList.toggle('hidden', msgs.length > 0);
  el.topbarTitle.textContent = chat?.title || 'New chat';
  el.messages.innerHTML = msgs.map((m) => messageHTML(m, chat)).join('');
  scrollToBottom(true);
  updatePanelButton();
}

/** Re-render only one message in place — used after streaming or an edit. */
function refreshMessage(id) {
  const chat = currentChat();
  const msg = chat?.messages.find((m) => m.id === id);
  const node = el.messages.querySelector(`.msg[data-id="${id}"]`);
  if (!msg || !node) return renderMessages();
  node.outerHTML = messageHTML(msg, chat);
}

function scrollToBottom(force = false) {
  // While streaming we only follow if the reader has not scrolled away, so that
  // scrolling back through a long reply is never fought by the next chunk.
  if (!force && (!state.stick || !state.settings.autoScroll)) return;
  el.scrollRegion.scrollTop = el.scrollRegion.scrollHeight;
}

function nearBottom() {
  const { scrollTop, scrollHeight, clientHeight } = el.scrollRegion;
  return scrollHeight - scrollTop - clientHeight < 120;
}

/* ------------------------------------------------------------
 * Sending
 * ---------------------------------------------------------- */

function systemPromptFor(chat) {
  if (chat.systemPrompt) return chat.systemPrompt;          // explicit per-chat override
  const agent = agentById(chat.agentId);
  if (agent?.systemPrompt) return agent.systemPrompt;
  return state.settings.systemPrompt || '';
}

function buildPayloadMessages(chat) {
  const out = [];
  let sys = (systemPromptFor(chat) || '').trim();
  if (state.settings.allowAsk) sys = `${sys}

${ASK_PROTOCOL}`.trim();
  if (state.wsContext) sys = `${sys}

${state.wsContext}`.trim();
  if (state.deliverable && DELIVERABLES[state.deliverable]) {
    sys = `${sys}\n\n${DELIVERABLES[state.deliverable].instruction}`.trim();
  }
  if (sys) out.push({ role: 'system', content: sys });

  const usable = chat.messages.filter((m) => m.role === 'user' || (m.role === 'assistant' && !m.pending && textOf(m).trim()));
  const trimmed = usable.slice(-state.settings.historyLimit);

  for (const m of trimmed) out.push({ role: m.role, content: m.content });
  return out;
}

let thinkTimer = null;

/** A running clock in the loader, so a slow model still reads as working. */
function startThinkClock() {
  stopThinkClock();
  const t0 = performance.now();
  const tick = () => {
    const secs = (performance.now() - t0) / 1000;
    const label = secs < 60 ? `${secs.toFixed(1)}s` : `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s`;
    $$('.think-time').forEach((n) => { n.textContent = label; });
  };
  tick();
  thinkTimer = setInterval(tick, 100);
}

function stopThinkClock() {
  if (thinkTimer) clearInterval(thinkTimer);
  thinkTimer = null;
}

function setBusy(busy) {
  busy ? startThinkClock() : stopThinkClock();
  state.streaming = busy;
  el.sendBtn.hidden = busy;
  el.stopBtn.hidden = !busy;
  el.modelDot.classList.toggle('busy', busy);
  el.statusLine.textContent = busy ? 'Generating…' : '';
  el.statusLine.classList.remove('warn');
}

async function runCompletion(chat, assistantMsg) {
  if (!state.apiKey) {
    failMessage(chat, assistantMsg, 'No API key', 'Add your OpenRouter API key in Settings (the gear icon) to start chatting.');
    openSettings('api');
    return;
  }

  const picked = modelById(chat.model);
  if (picked && !canChat(picked)) {
    failMessage(chat, assistantMsg, 'Not a chat model',
      `${picked.name || chat.model} is an audio model — it generates sound, not chat replies. Pick a text model from the menu in the top bar.`);
    return;
  }

  const s = state.settings;
  const controller = new AbortController();
  state.controller = controller;
  setBusy(true);

  const started = performance.now();
  let acc = '';
  let usage = null;

  const agent = agentById(chat.agentId);
  // OpenRouter runs a web search when the model id carries the :online suffix.
  const requestModel = state.settings.web && !/:online$/.test(chat.model)
    ? `${chat.model}:online`
    : chat.model;

  const body = {
    model: requestModel,
    messages: buildPayloadMessages(chat),
    temperature: typeof agent?.temperature === 'number' ? agent.temperature : s.temperature,
    top_p: s.topP,
    max_tokens: s.maxTokens,
    stream: s.stream,
  };
  // Some upstream providers reject penalties they do not implement, so only send
  // them when the user has actually moved the slider off zero.
  if (s.freqPenalty) body.frequency_penalty = s.freqPenalty;
  if (s.presPenalty) body.presence_penalty = s.presPenalty;
  if (s.stream) body.usage = { include: true };

  try {
    const res = await fetch(`${API}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${state.apiKey}`,
        'Content-Type': 'application/json',
        // file:// pages report an origin of "null", which OpenRouter rejects as a referer.
        'HTTP-Referer': (location.origin && location.origin !== 'null') ? location.origin : 'https://localhost',
        'X-Title': 'Nexus AI Chat',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      console.error('[Nexus] OpenRouter responded', res.status, detail);
      const e = new Error(describeApiError(detail?.error, `${res.status} ${res.statusText}`));
      e.payload = detail ?? { status: res.status, statusText: res.statusText };
      throw e;
    }

    const node = () => el.messages.querySelector(`.msg[data-id="${assistantMsg.id}"] [data-body]`);

    if (s.stream && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastPaint = 0;

      const paint = (finalPass = false) => {
        const target = node();
        if (target) {
          target.classList.add('md');
          target.innerHTML = renderMarkdown(stripToolTokens(stripPartialAsk(acc)));
          target.classList.toggle('streaming', !finalPass);
          scrollToBottom();
        }
        // The panel follows the same cadence, so code appears as it is written.
        artifactStream(assistantMsg, acc);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;     // SSE keep-alive comment
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') continue;

          let chunk;
          try { chunk = JSON.parse(data); } catch { continue; }

          if (chunk.error) {
            console.error('[Nexus] OpenRouter stream error', chunk);
            const e = new Error(describeApiError(chunk.error, 'Stream error'));
            e.payload = chunk;
            throw e;
          }
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) acc += delta.content;
          if (chunk.usage) usage = chunk.usage;
        }

        // Repaint at most ~20x/sec so long replies stay smooth.
        const now = performance.now();
        if (now - lastPaint > 50) { paint(); lastPaint = now; }
      }
      paint(true);
    } else {
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      acc = data.choices?.[0]?.message?.content || '';
      usage = data.usage || null;
    }

    if (!acc.trim()) acc = '_The model returned an empty response._';

    assistantMsg.content = acc;
    assistantMsg.pending = false;
    assistantMsg.elapsed = Math.round(performance.now() - started);
    assistantMsg.tokens = usage?.completion_tokens || estTokens(acc);
    assistantMsg.promptTokens = usage?.prompt_tokens || 0;
    addAutoSpend(chat.model, usage, assistantMsg.tokens);

    chat.updatedAt = Date.now();
    maybeTitle(chat);
    saveChats();
    refreshMessage(assistantMsg.id);
    renderChatList();
    updateUsage();
    updateWorkspaceUI();
    artifactSettle(assistantMsg);
    await maybeAutoApply();
    await serveReadRequests(chat, assistantMsg);
  } catch (err) {
    if (err.name === 'AbortError') {
      // Keep whatever streamed in before the user hit stop.
      assistantMsg.pending = false;
      assistantMsg.content = acc || '_Stopped before any output._';
      assistantMsg.elapsed = Math.round(performance.now() - started);
      assistantMsg.tokens = estTokens(acc);
      chat.updatedAt = Date.now();
      saveChats();
      refreshMessage(assistantMsg.id);
      artifactSettle(assistantMsg);
      toast('Generation stopped');
    } else {
      failMessage(chat, assistantMsg, 'Request failed', friendlyError(err.message), err.payload);
    }
  } finally {
    state.controller = null;
    setBusy(false);
    updateComposerMeta();
  }
}

/**
 * OpenRouter wraps upstream failures as `{ message: "Provider returned error",
 * code, metadata: { provider_name, raw } }`. The interesting part is in metadata,
 * so unwrap it rather than showing the generic outer message alone.
 */
function describeApiError(error, fallback) {
  if (!error) return fallback;

  const parts = [];
  if (error.message) parts.push(error.message);

  const meta = error.metadata || {};
  if (meta.provider_name) parts.push(`(provider: ${meta.provider_name})`);

  let raw = meta.raw ?? meta.error ?? null;
  if (raw && typeof raw === 'string') {
    // The raw field is often itself a JSON string from the upstream provider.
    try { raw = JSON.parse(raw); } catch { /* leave it as text */ }
  }
  const rawMsg = typeof raw === 'string'
    ? raw
    : raw?.error?.message || raw?.message || (raw ? JSON.stringify(raw) : '');
  if (rawMsg && !parts.join(' ').includes(rawMsg)) parts.push(`— ${rawMsg}`);

  if (error.code && !parts.join(' ').includes(String(error.code))) parts.push(`[${error.code}]`);

  return parts.join(' ').slice(0, 600) || fallback;
}

function friendlyError(msg = '') {
  const m = msg.toLowerCase();
  if (m.includes('401') || m.includes('no auth') || m.includes('invalid api key'))
    return 'Your API key was rejected (401). Check it in Settings → API.';
  if (m.includes('402') || m.includes('credit'))
    return 'Not enough OpenRouter credits (402). Top up at openrouter.ai/credits, or pick a free model.';
  if (m.includes('429') || m.includes('rate limit'))
    return 'Rate limited (429). Wait a few seconds, or switch models.';
  if (m.includes('404') || m.includes('not a valid model'))
    return 'That model id was not found (404). Pick another from the model menu.';
  if (m.includes('provider returned error') || m.includes('502') || m.includes('503'))
    return `${msg}

The model's upstream provider failed rather than OpenRouter itself. Free models share a small, busy pool — retry, or switch to another model. If it keeps happening, check that Prompt Logging is enabled at openrouter.ai/settings/privacy, which most free endpoints require.`;
  if (m.includes('data policy') || m.includes('no endpoints found'))
    return 'No provider matches your privacy settings. Free models generally require Prompt Logging to be enabled at openrouter.ai/settings/privacy.';
  if (m.includes('failed to fetch'))
    return 'Network request failed. Check your connection — and if you opened this file directly, try serving it over http:// instead.';
  return msg || 'Unknown error.';
}

function failMessage(chat, msg, title, text, payload) {
  msg.role = 'error';
  msg.title = title;
  msg.content = text;
  msg.pending = false;
  msg.detail = payload ? JSON.stringify(payload, null, 2) : '';
  saveChats();
  refreshMessage(msg.id);
}

/** Derive a chat title from the first exchange, once. */
function maybeTitle(chat) {
  if (chat.title !== 'New chat') return;
  const first = chat.messages.find((m) => m.role === 'user');
  if (!first) return;
  let t = textOf(first).replace(/\s+/g, ' ').trim();
  if (t.length > 52) t = `${t.slice(0, 52).replace(/\s\S*$/, '')}…`;
  chat.title = t || 'New chat';
  el.topbarTitle.textContent = chat.title;
}

async function send(text) {
  const chat = ensureChat();
  const trimmed = text.trim();
  if (!trimmed && !state.attachments.length) return;
  if (state.streaming) return;

  // Selected workspace files ride along as context for this turn only.
  state.readRounds = 0;   // a new question starts the read budget over
  state.wsContext = await wsContextBlock();

  // Auto mode reads the request and picks the model before the turn is built.
  if (state.settings.auto) {
    const pick = autoPick(trimmed);
    if (pick) {
      chat.model = pick.model.id;
      syncModelUI();
      const picked = $('#autoPicked');
      if (picked) picked.textContent = `Last pick: ${pick.model.name || pick.model.id} (${pick.tier})`;
      if (pick.spentOut) toast("Today's budget is spent — using a free model", 'err', 4000);
      el.statusLine.textContent = `Auto → ${pick.model.name || pick.model.id}`;
    } else if (!state.models.length) {
      toast('Auto mode needs the model list — open the model menu once to load it', 'err', 4000);
    }
  }

  const content = state.attachments.length
    ? [
        ...(trimmed ? [{ type: 'text', text: trimmed }] : []),
        ...state.attachments.map((url) => ({ type: 'image_url', image_url: { url } })),
      ]
    : trimmed;

  chat.messages.push({ id: uid(), role: 'user', content, ts: Date.now() });
  state.attachments = [];
  renderAttachments();

  el.input.value = '';
  autoGrow();
  updateComposerMeta();
  state.stick = true;

  const assistant = { id: uid(), role: 'assistant', content: '', model: chat.model, pending: true,
                      deliverable: state.deliverable || null, ts: Date.now() };
  chat.messages.push(assistant);
  chat.updatedAt = Date.now();
  maybeTitle(chat);
  saveChats();
  renderMessages();
  renderChatList();

  await runCompletion(chat, assistant);
  if (state.deliverable) setDeliverable(null);
}

/** Drop everything after `index` and generate a fresh reply. */
async function regenerateFrom(index) {
  const chat = currentChat();
  if (!chat || state.streaming) return;
  chat.messages.length = index;
  const assistant = { id: uid(), role: 'assistant', content: '', model: chat.model, pending: true, ts: Date.now() };
  chat.messages.push(assistant);
  saveChats();
  renderMessages();
  await runCompletion(chat, assistant);
}

/* ------------------------------------------------------------
 * Composer
 * ---------------------------------------------------------- */

function autoGrow() {
  el.input.style.height = 'auto';
  el.input.style.height = `${Math.min(el.input.scrollHeight, 260)}px`;
}

function updateComposerMeta() {
  const len = el.input.value.length;
  el.charCount.textContent = `${len} char${len === 1 ? '' : 's'}`;
  el.sendBtn.disabled = !len && !state.attachments.length;

  const chat = currentChat();
  const m = modelById(chat?.model || state.settings.model);
  const used = (chat?.messages || []).reduce((n, x) => n + estTokens(textOf(x)), 0) + estTokens(el.input.value);
  const picked = ws.picked.size;
  const base = m?.context_length
    ? `~${fmtNum(used)} / ${fmtNum(m.context_length)} ctx`
    : `~${fmtNum(used)} tokens in chat`;
  const bits = [base];
  if (picked) bits.push(`${picked} file${picked === 1 ? '' : 's'} attached`);
  if (terminalText()) bits.push('terminal output attached');
  el.ctxInfo.textContent = bits.join(' · ');
}

function updateUsage() {
  const total = state.chats.reduce(
    (n, c) => n + c.messages.reduce((k, m) => k + (m.tokens || estTokens(textOf(m))), 0), 0);
  el.usageText.textContent = `${fmtNum(total)} tokens · ${state.chats.length} chats`;
}

function renderAttachments() {
  el.attachments.hidden = !state.attachments.length;
  el.attachments.innerHTML = state.attachments.map((src, i) =>
    `<div class="attachment"><img src="${escapeHtml(src)}" alt=""><button type="button" data-action="drop-attachment" data-i="${i}" aria-label="Remove attachment"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`
  ).join('');
  updateComposerMeta();
}

/** Downscale before storing so localStorage does not fill up with megapixels. */
function addImage(file) {
  if (!file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 1024;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      state.attachments.push(canvas.toDataURL('image/jpeg', 0.82));
      renderAttachments();
    };
    img.onerror = () => toast('That image could not be read', 'err');
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

/* ------------------------------------------------------------
 * Settings UI
 * ---------------------------------------------------------- */

function applySettings() {
  const s = state.settings;
  const theme = s.theme === 'system'
    ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : s.theme;

  document.documentElement.dataset.theme = theme;
  const accents = ['brand', 'blue', 'purple', 'teal', 'green', 'orange'];
  document.documentElement.dataset.accent = accents.includes(s.accent) ? s.accent : 'blue';
  document.documentElement.style.setProperty('--msg-width', `${s.msgWidth}px`);
  document.documentElement.style.setProperty('--font-size', `${s.fontSize}px`);
  el.app.classList.toggle('collapsed', s.sidebarCollapsed);

  if (el.hljsTheme) {
    el.hljsTheme.href = `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/${theme === 'light' ? 'vs' : 'vs2015'}.min.css`;
  }
  el.input.placeholder = s.enterSends
    ? 'Ask anything, or describe what you need…'
    : 'Ask anything, or describe what you need…  (Ctrl+Enter to send)';

  syncPlusMenu();
  updateModeBar();
}

function syncSettingsForm() {
  const s = state.settings;
  el.apiKeyInput.value = state.apiKey;
  $('#systemPromptInput').value = s.systemPrompt;

  const bind = [
    ['#tempInput',   s.temperature,  '#tempVal',   (v) => (+v).toFixed(2)],
    ['#toppInput',   s.topP,         '#toppVal',   (v) => (+v).toFixed(2)],
    ['#maxTokInput', s.maxTokens,    '#maxTokVal', (v) => v],
    ['#freqInput',   s.freqPenalty,  '#freqVal',   (v) => (+v).toFixed(2)],
    ['#presInput',   s.presPenalty,  '#presVal',   (v) => (+v).toFixed(2)],
    ['#histInput',   s.historyLimit, '#histVal',   (v) => v],
    ['#widthInput',  s.msgWidth,     '#widthVal',  (v) => `${v}px`],
    ['#fontInput',   s.fontSize,     '#fontVal',   (v) => `${v}px`],
  ];
  for (const [input, val, out, fmt] of bind) {
    $(input).value = val;
    $(out).textContent = fmt(val);
  }

  $('#streamInput').checked = s.stream;
  $('#askInput').checked = s.allowAsk;
  $('#autoScrollInput').checked = s.autoScroll;
  $('#enterSendsInput').checked = s.enterSends;

  $$('#themeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.themeVal === s.theme));
  $$('#accentRow button').forEach((b) => b.classList.toggle('active', b.dataset.accent === s.accent));
  $('#autoInput').checked = !!s.auto;
  $('#autoBudgetInput').value = s.autoBudget ?? 1;
  renderAutoUsage();

  const msgs = state.chats.reduce((n, c) => n + c.messages.length, 0);
  const toks = state.chats.reduce((n, c) => n + c.messages.reduce((k, m) => k + (m.tokens || estTokens(textOf(m))), 0), 0);
  let bytes = 0;
  try { for (const k of Object.values(KEYS)) bytes += (localStorage.getItem(k) || '').length; } catch {}
  $('#statChats').textContent = state.chats.length;
  $('#statMsgs').textContent = msgs;
  $('#statTok').textContent = fmtNum(toks);
  $('#statSize').textContent = `${(bytes / 1024).toFixed(0)} KB`;
}

function openSettings(tab) {
  syncSettingsForm();
  renderAgentGrid();
  renderLocalUsage();
  if (tab === 'usage' || !state.usage) refreshUsage();
  el.settingsModal.hidden = false;
  if (tab) {
    $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === tab));
  }
}

async function verifyKey() {
  const key = el.apiKeyInput.value.trim();
  const btn = $('#verifyKeyBtn');
  el.keyStatus.hidden = false;
  el.keyStatus.className = 'key-status';
  el.keyStatus.textContent = 'Checking…';
  btn.disabled = true;

  if (!key) {
    el.keyStatus.className = 'key-status bad';
    el.keyStatus.textContent = 'Enter a key first.';
    btn.disabled = false;
    return;
  }

  try {
    const res = await fetch(`${API}/auth/key`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(res.status === 401 ? 'Key rejected (401).' : `HTTP ${res.status}`);
    const { data } = await res.json();

    state.apiKey = key;
    localStorage.setItem(KEYS.apiKey, key);

    const limit = data?.limit;
    const used = Number(data?.usage || 0).toFixed(3);
    const credit = limit == null ? 'unlimited (pay as you go)' : `$${(limit - data.usage).toFixed(3)} left of $${limit}`;
    el.keyStatus.className = 'key-status ok';
    el.keyStatus.innerHTML = `Key works. Usage so far: $${used} — ${credit}.`;

    el.modelDot.classList.add('live');
    await loadModels({ silent: true });
    refreshUsage();
    toast(`Key saved · ${state.models.length} models available`, 'ok');
  } catch (err) {
    el.keyStatus.className = 'key-status bad';
    el.keyStatus.textContent = friendlyError(err.message);
  } finally {
    btn.disabled = false;
  }
}

/* ------------------------------------------------------------
 * Export / import
 * ---------------------------------------------------------- */

function download(name, content, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportMarkdown() {
  const chat = currentChat();
  if (!chat?.messages.length) return toast('Nothing to export yet', 'err');
  const lines = [
    `# ${chat.title}`,
    '',
    `*Model: ${chat.model} · ${new Date(chat.createdAt).toLocaleString()}*`,
    '',
  ];
  for (const m of chat.messages) {
    if (m.role === 'error') continue;
    lines.push(m.role === 'user' ? '## You' : `## Assistant (${m.model || chat.model})`, '', textOf(m), '');
  }
  download(`${chat.title.replace(/[^\w\s-]/g, '').slice(0, 40) || 'chat'}.md`, lines.join('\n'), 'text/markdown');
  toast('Exported as Markdown', 'ok');
}

/* ------------------------------------------------------------
 * Events
 * ---------------------------------------------------------- */

// --- composer -------------------------------------------------
el.composer.addEventListener('submit', (e) => {
  e.preventDefault();
  send(el.input.value);
});

el.input.addEventListener('input', () => { autoGrow(); updateComposerMeta(); });

el.input.addEventListener('keydown', (e) => {
  const s = state.settings;
  if (e.key !== 'Enter') return;
  if (e.isComposing || e.keyCode === 229) return;   // mid-IME composition
  // Enter sends, Shift+Enter opens a line. Ctrl/Cmd+Enter always sends, so the
  // key still works when the preference is turned off.
  const wantsSend = s.enterSends ? !e.shiftKey : (e.ctrlKey || e.metaKey);
  if (wantsSend) { e.preventDefault(); send(el.input.value); }
});

el.input.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (files.length) { e.preventDefault(); files.forEach(addImage); }
});

el.stopBtn.addEventListener('click', () => state.controller?.abort());
$('#attachBtn').addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', () => {
  [...el.fileInput.files].forEach(addImage);
  el.fileInput.value = '';
});

// Drag & drop images anywhere in the app
document.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  e.preventDefault();   // never let a stray drop navigate away from the app
  [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')).forEach(addImage);
});

el.attachments.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="drop-attachment"]');
  if (!btn) return;
  state.attachments.splice(+btn.dataset.i, 1);
  renderAttachments();
});

// --- suggestions ---------------------------------------------
el.welcome.addEventListener('click', (e) => {
  const btn = e.target.closest('.suggestion');
  if (!btn) return;
  el.input.value = btn.dataset.prompt;
  autoGrow();
  updateComposerMeta();
  el.input.focus();
});

// --- message actions -----------------------------------------
el.messages.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const chat = currentChat();
  const id = btn.dataset.id;
  const index = chat ? chat.messages.findIndex((m) => m.id === id) : -1;

  switch (btn.dataset.action) {
    case 'copy-code': {
      const code = btn.closest('.code-block')?.querySelector('code')?.textContent ?? '';
      await copyText(code);
      const label = btn.querySelector('span');
      btn.classList.add('done');
      if (label) label.textContent = 'Copied';
      setTimeout(() => { btn.classList.remove('done'); if (label) label.textContent = 'Copy'; }, 1600);
      break;
    }

    case 'copy-msg': {
      const ok = await copyText(visibleText(chat.messages[index]));
      toast(ok ? 'Copied to clipboard' : 'Could not access the clipboard', ok ? 'ok' : 'err', 1600);
      break;
    }

    case 'delete-msg': {
      if (index < 0) break;
      chat.messages.splice(index, 1);
      saveChats();
      renderMessages();
      break;
    }

    case 'regen': {
      if (index < 0) break;
      regenerateFrom(index);
      break;
    }

    case 'retry': {
      if (index < 0) break;
      regenerateFrom(index);
      break;
    }

    case 'open-artifact': {
      openArtifact(id, Number(btn.dataset.index) || 0);
      break;
    }

    case 'export-msg': {
      if (index < 0) break;
      openExportMenu(btn, visibleText(chat.messages[index]), chat.title);
      break;
    }

    case 'edit-msg': {
      startEdit(id);
      break;
    }

    case 'cancel-edit': {
      renderMessages();
      break;
    }

    case 'save-edit': {
      const area = el.messages.querySelector('.edit-area');
      const value = area?.value.trim();
      if (!value || index < 0) { renderMessages(); break; }
      const msg = chat.messages[index];
      msg.content = Array.isArray(msg.content)
        ? [{ type: 'text', text: value }, ...msg.content.filter((p) => p.type === 'image_url')]
        : value;
      chat.messages.length = index + 1;   // drop the stale reply
      saveChats();
      renderMessages();
      regenerateFrom(index + 1);
      break;
    }
  }
});

function startEdit(id) {
  const node = el.messages.querySelector(`.msg[data-id="${id}"]`);
  const chat = currentChat();
  const msg = chat?.messages.find((m) => m.id === id);
  if (!node || !msg) return;
  const bubble = node.querySelector('.bubble');
  const tools = node.querySelector('.msg-tools');
  bubble.outerHTML = `<textarea class="edit-area">${escapeHtml(textOf(msg))}</textarea>`;
  tools.outerHTML = `<div class="edit-row">
      <button class="ghost-btn" data-action="cancel-edit" type="button">Cancel</button>
      <button class="primary-btn" data-action="save-edit" data-id="${id}" type="button">Save &amp; resend</button>
    </div>`;
  const area = node.querySelector('.edit-area');
  area.style.height = `${area.scrollHeight}px`;
  area.focus();
  area.setSelectionRange(area.value.length, area.value.length);
}

// --- sidebar / chat list -------------------------------------
el.chatList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;

  if (btn.dataset.action === 'open-chat') {
    setCurrent(id);
    if (innerWidth <= 860) el.app.classList.add('collapsed');
  }

  if (btn.dataset.action === 'delete-chat') {
    const chat = state.chats.find((c) => c.id === id);
    if (chat?.messages.length && !confirm(`Delete “${chat.title}”? This cannot be undone.`)) return;
    state.chats = state.chats.filter((c) => c.id !== id);
    saveChats();
    if (state.currentId === id) {
      state.chats.length ? setCurrent(state.chats[0].id) : newChat();
    }
    renderChatList();
    updateUsage();
    toast('Conversation deleted');
  }

  if (btn.dataset.action === 'pin-chat') {
    const chat = state.chats.find((c) => c.id === id);
    if (!chat) return;
    chat.pinned = !chat.pinned;
    saveChats();
    renderChatList();
    toast(chat.pinned ? 'Pinned to the top' : 'Unpinned', '', 1400);
    return;
  }

  if (btn.dataset.action === 'rename-chat') {
    const item = btn.closest('.chat-item');
    const titleBtn = item.querySelector('.chat-item-title');
    const chat = state.chats.find((c) => c.id === id);
    const input = document.createElement('input');
    input.className = 'rename-input';
    input.value = chat.title;
    titleBtn.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
      chat.title = input.value.trim() || chat.title;
      saveChats();
      renderChatList();
      if (chat.id === state.currentId) el.topbarTitle.textContent = chat.title;
    };
    input.addEventListener('blur', commit, { once: true });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') input.blur();
      if (ev.key === 'Escape') { input.value = chat.title; input.blur(); }
    });
  }
});

el.searchInput.addEventListener('input', renderChatList);

$('#newChatBtn').addEventListener('click', () => {
  newChat();
  el.input.focus();
  if (innerWidth <= 860) el.app.classList.add('collapsed');
});

const toggleSidebar = () => {
  state.settings.sidebarCollapsed = !state.settings.sidebarCollapsed;
  saveSettings();
  el.app.classList.toggle('collapsed', state.settings.sidebarCollapsed);
};
$('#collapseBtn').addEventListener('click', toggleSidebar);
$('#expandBtn').addEventListener('click', toggleSidebar);
el.sidebarScrim.addEventListener('click', toggleSidebar);

$('#themeBtn').addEventListener('click', () => {
  const order = ['dark', 'light', 'system'];
  state.settings.theme = order[(order.indexOf(state.settings.theme) + 1) % order.length];
  saveSettings();
  applySettings();
  syncSettingsForm();
  toast(`Theme: ${state.settings.theme}`, '', 1400);
});

$('#settingsBtn').addEventListener('click', () => openSettings());
$('#exportBtn').addEventListener('click', (e) => {
  const chat = currentChat();
  if (!chat?.messages.length) return toast('Nothing to export yet', 'err');
  const transcript = chat.messages
    .filter((m) => m.role !== 'error')
    .map((m) => (m.role === 'user' ? `## You\n\n${textOf(m)}` : `## Assistant\n\n${textOf(m)}`))
    .join('\n\n');
  openExportMenu(e.currentTarget, `# ${chat.title}\n\n${transcript}`, chat.title);
});

$('#clearBtn').addEventListener('click', () => {
  const chat = currentChat();
  if (!chat?.messages.length) return;
  if (!confirm('Clear every message in this conversation?')) return;
  chat.messages = [];
  chat.title = 'New chat';
  saveChats();
  renderMessages();
  renderChatList();
});

// --- model picker --------------------------------------------
el.modelBtn.addEventListener('click', () => {
  const open = el.modelPicker.classList.toggle('open');
  el.modelBtn.setAttribute('aria-expanded', String(open));
  if (open) { renderModelMenu(); el.modelSearch.focus(); el.modelSearch.select(); }
});

document.addEventListener('click', (e) => {
  if (!el.modelPicker.contains(e.target)) {
    el.modelPicker.classList.remove('open');
    el.modelBtn.setAttribute('aria-expanded', 'false');
  }
});

el.modelSearch.addEventListener('input', () => {
  state.modelQuery = el.modelSearch.value.trim();
  renderModelMenu();
});

$$('#modelMenu .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    $$('#modelMenu .chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    state.modelFilter = chip.dataset.filter;
    renderModelMenu();
  });
});

el.modelMenuList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.model;

  if (btn.dataset.action === 'pick-model') {
    const chat = ensureChat();
    chat.model = id;
    state.settings.model = id;
    saveChats();
    saveSettings();
    syncModelUI();
    renderModelMenu();
    updateComposerMeta();
    el.modelPicker.classList.remove('open');
    toast(`Model: ${modelById(id)?.name || id}`, 'ok', 1800);
  }

  if (btn.dataset.action === 'fav-model') {
    state.favs = state.favs.includes(id) ? state.favs.filter((f) => f !== id) : [...state.favs, id];
    saveFavs();
    renderModelMenu();
  }
});

$('#refreshModels').addEventListener('click', () => loadModels());

// --- scroll ---------------------------------------------------
el.scrollRegion.addEventListener('scroll', () => {
  const atBottom = nearBottom();
  state.stick = atBottom;
  el.scrollDown.classList.toggle('show', !atBottom);
}, { passive: true });

el.scrollDown.addEventListener('click', () => {
  state.stick = true;
  el.scrollRegion.scrollTo({ top: el.scrollRegion.scrollHeight, behavior: 'smooth' });
});

// --- modals ---------------------------------------------------
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) {
    e.target.closest('.modal-root').hidden = true;
  }
});

$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === tab.dataset.tab));
    if (tab.dataset.tab === 'usage') refreshUsage();
    if (tab.dataset.tab === 'agents') renderAgentGrid();
  });
});

$('#toggleKeyVis').addEventListener('click', (e) => {
  const show = el.apiKeyInput.type === 'password';
  el.apiKeyInput.type = show ? 'text' : 'password';
  e.target.textContent = show ? 'Hide' : 'Show';
});

$('#verifyKeyBtn').addEventListener('click', verifyKey);

$('#clearKeyBtn').addEventListener('click', () => {
  state.apiKey = '';
  localStorage.removeItem(KEYS.apiKey);
  el.apiKeyInput.value = '';
  el.keyStatus.hidden = true;
  el.modelDot.classList.remove('live');
  toast('API key removed');
});

// Persist the key as it is typed, so a reload never loses it.
el.apiKeyInput.addEventListener('change', () => {
  const key = el.apiKeyInput.value.trim();
  state.apiKey = key;
  key ? localStorage.setItem(KEYS.apiKey, key) : localStorage.removeItem(KEYS.apiKey);
  el.modelDot.classList.toggle('live', !!key);
});

$('#systemPromptInput').addEventListener('input', (e) => {
  state.settings.systemPrompt = e.target.value;
  saveSettings();
});

// Sliders and switches
const sliders = [
  ['#tempInput',   'temperature',  '#tempVal',   (v) => (+v).toFixed(2), Number],
  ['#toppInput',   'topP',         '#toppVal',   (v) => (+v).toFixed(2), Number],
  ['#maxTokInput', 'maxTokens',    '#maxTokVal', (v) => v,               Number],
  ['#freqInput',   'freqPenalty',  '#freqVal',   (v) => (+v).toFixed(2), Number],
  ['#presInput',   'presPenalty',  '#presVal',   (v) => (+v).toFixed(2), Number],
  ['#histInput',   'historyLimit', '#histVal',   (v) => v,               Number],
  ['#widthInput',  'msgWidth',     '#widthVal',  (v) => `${v}px`,        Number],
  ['#fontInput',   'fontSize',     '#fontVal',   (v) => `${v}px`,        Number],
];
for (const [sel, key, out, fmt, cast] of sliders) {
  $(sel).addEventListener('input', (e) => {
    state.settings[key] = cast(e.target.value);
    $(out).textContent = fmt(e.target.value);
    saveSettings();
    applySettings();
  });
}

const switches = [['#streamInput', 'stream'], ['#autoScrollInput', 'autoScroll'],
                  ['#enterSendsInput', 'enterSends'], ['#askInput', 'allowAsk']];
for (const [sel, key] of switches) {
  $(sel).addEventListener('change', (e) => {
    state.settings[key] = e.target.checked;
    saveSettings();
    applySettings();
  });
}

$$('#themeSeg button').forEach((b) => b.addEventListener('click', () => {
  state.settings.theme = b.dataset.themeVal;
  saveSettings();
  applySettings();
  syncSettingsForm();
}));

$$('#accentRow button').forEach((b) => b.addEventListener('click', () => {
  state.settings.accent = b.dataset.accent;
  saveSettings();
  applySettings();
  syncSettingsForm();
}));

const schemeQuery = matchMedia('(prefers-color-scheme: light)');
const onSchemeChange = () => { if (state.settings.theme === 'system') applySettings(); };
if (schemeQuery.addEventListener) schemeQuery.addEventListener('change', onSchemeChange);
else if (schemeQuery.addListener) schemeQuery.addListener(onSchemeChange);

// Data tab
$('#exportAllBtn').addEventListener('click', () => {
  download(`nexus-chats-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify({ version: 1, exportedAt: Date.now(), chats: state.chats }, null, 2),
    'application/json');
  toast('All chats exported', 'ok');
});

$('#importBtn').addEventListener('click', () => $('#importInput').click());

$('#importInput').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const incoming = Array.isArray(data) ? data : data.chats;
    if (!Array.isArray(incoming)) throw new Error('Unrecognised file format');
    const existing = new Set(state.chats.map((c) => c.id));
    let added = 0;
    for (const c of incoming) {
      if (!c?.id || existing.has(c.id)) continue;
      state.chats.push({ ...c, messages: c.messages || [] });
      added++;
    }
    saveChats();
    renderChatList();
    syncSettingsForm();
    updateUsage();
    toast(`Imported ${added} conversation${added === 1 ? '' : 's'}`, 'ok');
  } catch (err) {
    toast(`Import failed: ${err.message}`, 'err');
  } finally {
    e.target.value = '';
  }
});

$('#wipeBtn').addEventListener('click', () => {
  if (!confirm('Delete all conversations, agents, settings and the stored API key from this browser?')) return;
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
  location.reload();
});

// System prompt modal
$('#sysBtn').addEventListener('click', () => {
  const chat = ensureChat();
  el.sysChatInput.value = chat.systemPrompt ?? state.settings.systemPrompt;
  el.sysModal.hidden = false;
  el.sysChatInput.focus();
});

$('#presetRow').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-preset]');
  if (btn) el.sysChatInput.value = btn.dataset.preset;
});

$('#sysSaveBtn').addEventListener('click', () => {
  const chat = ensureChat();
  chat.systemPrompt = el.sysChatInput.value;
  saveChats();
  el.sysModal.hidden = true;
  toast('System prompt saved for this chat', 'ok');
});

// --- keyboard shortcuts ---------------------------------------
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;

  if (e.key === 'Escape') {
    if (state.streaming) { state.controller?.abort(); return; }
    if (!el.artifact.hidden) { closeArtifact(); return; }
    const openModal = $$('.modal-root').find((m) => !m.hidden);
    if (openModal) { openModal.hidden = true; return; }
    closeExportMenu();
    el.modelPicker.classList.remove('open');
    $('#agentPicker').classList.remove('open');
    $('#deliverablePicker').classList.remove('open');
    return;
  }

  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); newChat(); el.input.focus(); }
  if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleSidebar(); }
  if (mod && e.key === ',')               { e.preventDefault(); openSettings(); }
  if (mod && e.key === '/')               { e.preventDefault(); el.searchInput.focus(); }
  if (mod && e.key.toLowerCase() === 'm') { e.preventDefault(); el.modelBtn.click(); }
  if (mod && e.key.toLowerCase() === 'u') { e.preventDefault(); el.fileInput.click(); }
  if (mod && e.key.toLowerCase() === 'j') { e.preventDefault(); $('#agentBtn').click(); }
});

// Warn before losing an in-flight response.
addEventListener('beforeunload', (e) => {
  if (state.streaming) { e.preventDefault(); e.returnValue = ''; }
});

/* ------------------------------------------------------------
 * Boot
 * ---------------------------------------------------------- */

function boot() {
  // Older builds persisted enterSends:false on touch devices, which stuck even
  // on a desktop. Restore the default once, then leave the preference alone.
  if (state.settings.schema !== 2) {
    state.settings.enterSends = DEFAULTS.enterSends;
    state.settings.schema = 2;
    writeJSON(KEYS.settings, state.settings);
  }

  applySettings();
  if (state.settings.ide) setLayout(true, { persist: false });

  if (!state.chats.length) newChat(false);
  if (!currentChat()) state.currentId = state.chats[0].id;
  localStorage.setItem(KEYS.current, state.currentId);

  // Backfill fields for chats saved by older versions.
  for (const c of state.chats) {
    c.model ??= state.settings.model;
    c.messages ??= [];
    c.updatedAt ??= c.createdAt ?? Date.now();
    c.agentId ??= state.settings.defaultAgentId;
  }

  setSidebarWidth(state.settings.sidebarW || DEFAULTS.sidebarW, false);

  // Under 860px the rail becomes an overlay drawer, so it starts closed.
  if (innerWidth <= 860) { state.settings.sidebarCollapsed = true; applySettings(); }

  renderChatList();
  renderMessages();
  renderArtifactList();
  renderModelMenu();
  renderAgentMenu();
  renderAgentGrid();
  syncModelUI();
  syncAgentUI();
  syncSettingsForm();
  updateComposerMeta();
  updateUsage();
  autoGrow();

  if (state.apiKey) {
    loadModels({ silent: true });
  } else {
    loadModels({ silent: true }).then(() => openSettings('api'));
  }

  el.input.focus();
}

/* ============================================================
 * Agents
 * ---------------------------------------------------------- */

function syncAgentUI() {
  const chat = currentChat();
  const agent = agentById(chat?.agentId) || agentById(state.settings.defaultAgentId) || state.agents[0];
  if (!agent) return;
  $('#agentAvatar').textContent = agent.icon || '◉';
  $('#agentLabel').textContent = agent.name;
  $('#agentBtn').title = `Agent: ${agent.name}`;
}

function renderAgentMenu() {
  const chat = currentChat();
  const activeId = chat?.agentId;
  $('#agentMenuList').innerHTML = state.agents.map((a) => {
    const desc = a.systemPrompt || '';
    return `
    <button class="menu-row ${a.id === activeId ? 'selected' : ''}" data-action="pick-agent" data-agent="${escapeHtml(a.id)}">
      <span class="menu-row-head">
        <span class="agent-avatar">${escapeHtml(a.icon || '◉')}</span>
        <b>${escapeHtml(a.name)}</b>
      </span>
      <em>${escapeHtml(desc.slice(0, 90))}${desc.length > 90 ? '…' : ''}</em>
    </button>`;
  }).join('');
}

function applyAgent(id) {
  const chat = ensureChat();
  const agent = agentById(id);
  if (!agent) return;
  chat.agentId = id;
  chat.systemPrompt = null;           // drop any manual override so the agent takes effect
  if (agent.model) chat.model = agent.model;
  state.settings.defaultAgentId = id;
  saveChats();
  saveSettings();
  syncAgentUI();
  syncModelUI();
  renderAgentMenu();
  toast(`Agent: ${agent.name}`, 'ok', 1600);
}

function renderAgentGrid() {
  $('#agentGrid').innerHTML = state.agents.map((a) => {
    const modelLabel = a.model ? (modelById(a.model)?.name || a.model) : 'Keeps current model';
    return `
    <button class="agent-card" data-action="edit-agent" data-agent="${escapeHtml(a.id)}">
      <span class="agent-avatar">${escapeHtml(a.icon || '◉')}</span>
      <span style="min-width:0">
        <b>${escapeHtml(a.name)}</b>
        <em>${escapeHtml(a.systemPrompt || '')}</em>
        <span class="agent-model">${escapeHtml(modelLabel)} &middot; temp ${Number(a.temperature ?? 0.7).toFixed(2)}</span>
      </span>
    </button>`;
  }).join('');
}

function openAgentEditor(id) {
  const agent = id ? agentById(id) : null;
  state.editingAgentId = id || null;

  $('#agentModalTitle').textContent = agent ? `Edit ${agent.name}` : 'New agent';
  $('#agentIconInput').value = agent?.icon || '◉';
  $('#agentNameInput').value = agent?.name || '';
  $('#agentPromptInput').value = agent?.systemPrompt || '';
  $('#agentTempInput').value = agent?.temperature ?? 0.7;
  $('#agentTempVal').textContent = Number(agent?.temperature ?? 0.7).toFixed(2);

  const select = $('#agentModelInput');
  const chatModels = state.models.filter(canChat);
  select.innerHTML = '<option value="">Keep current model</option>' +
    chatModels.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name || m.id)}</option>`).join('');
  select.value = agent?.model || '';

  // Built-in agents can be edited but not removed, so there is always a fallback.
  $('#agentDeleteBtn').hidden = !agent || !!agent.builtin;
  $('#agentModal').hidden = false;
  $('#agentNameInput').focus();
}

function saveAgentFromEditor() {
  const name = $('#agentNameInput').value.trim();
  if (!name) return toast('Give the agent a name', 'err');

  const patch = {
    icon: $('#agentIconInput').value.trim() || '◉',
    name,
    systemPrompt: $('#agentPromptInput').value.trim(),
    model: $('#agentModelInput').value,
    temperature: Number($('#agentTempInput').value),
  };

  if (state.editingAgentId) {
    Object.assign(agentById(state.editingAgentId), patch);
  } else {
    state.agents.push({ id: uid(), ...patch });
  }
  saveAgents();
  renderAgentGrid();
  renderAgentMenu();
  syncAgentUI();
  $('#agentModal').hidden = true;
  toast('Agent saved', 'ok');
}

function deleteAgentFromEditor() {
  const agent = agentById(state.editingAgentId);
  if (!agent || agent.builtin) return;
  if (!confirm(`Delete the agent "${agent.name}"?`)) return;

  state.agents = state.agents.filter((a) => a.id !== agent.id);
  // Any chat pointing at it falls back to the first remaining agent.
  for (const c of state.chats) if (c.agentId === agent.id) c.agentId = state.agents[0]?.id;
  if (state.settings.defaultAgentId === agent.id) state.settings.defaultAgentId = state.agents[0]?.id;

  saveAgents();
  saveChats();
  saveSettings();
  renderAgentGrid();
  renderAgentMenu();
  syncAgentUI();
  $('#agentModal').hidden = true;
  toast('Agent deleted');
}

/* ============================================================
 * Usage
 * ---------------------------------------------------------- */

const money = (n) => `$${Number(n || 0).toFixed(Math.abs(Number(n)) < 1 ? 4 : 2)}`;

async function refreshUsage() {
  const btn = $('#refreshUsage');
  if (!state.apiKey) {
    $('#usagePlan').textContent = 'No API key';
    $('#usageKeyLabel').textContent = 'Add a key on the API tab to see your balance.';
    renderLocalUsage();
    return;
  }

  btn.disabled = true;
  $('#usageKeyLabel').textContent = 'Loading…';

  try {
    const headers = { Authorization: `Bearer ${state.apiKey}` };
    const [keyRes, creditRes] = await Promise.all([
      fetch(`${API}/auth/key`, { headers }),
      fetch(`${API}/credits`, { headers }).catch(() => null),
    ]);
    if (!keyRes.ok) throw new Error(`HTTP ${keyRes.status}`);

    const key = (await keyRes.json()).data || {};
    let credits = null;
    if (creditRes?.ok) credits = (await creditRes.json()).data || null;

    state.usage = { key, credits };
    renderUsage();
  } catch (err) {
    $('#usagePlan').textContent = 'Could not load usage';
    $('#usageKeyLabel').textContent = friendlyError(err.message);
  } finally {
    btn.disabled = false;
    renderLocalUsage();
  }
}

function renderUsage() {
  const { key, credits } = state.usage || {};
  if (!key) return;

  const spent = Number(credits?.total_usage ?? key.usage ?? 0);
  // /credits reports the purchased total; /auth/key reports a per-key cap when set.
  const total = Number(credits?.total_credits ?? key.limit ?? 0) || null;

  $('#usagePlan').textContent = key.is_free_tier ? 'Free tier' : 'Paid account';
  $('#usageKeyLabel').textContent = key.label ? `Key: ${key.label}` : 'Key active';

  $('#usageSpent').textContent = money(spent);
  $('#usageLimit').textContent = total ? money(total) : 'Unlimited';
  $('#usageFreeTier').textContent = key.is_free_tier ? 'Free' : 'Paid';

  const rl = key.rate_limit;
  $('#usageRate').textContent = rl?.requests ? `${rl.requests}/${rl.interval}` : '—';

  const bar = $('#usageBar');
  if (total) {
    const pct = Math.max(0, Math.min(100, (spent / total) * 100));
    bar.style.width = `${pct}%`;
    bar.className = `meter-fill${pct >= 90 ? ' over' : pct >= 70 ? ' warn' : ''}`;
    $('#usageAmount').textContent = `${money(spent)} of ${money(total)}`;
    $('#usageRemaining').textContent = `${money(Math.max(0, total - spent))} remaining`;
    $('#usagePct').textContent = `${pct.toFixed(1)}%`;
  } else {
    bar.style.width = '100%';
    bar.className = 'meter-fill';
    $('#usageAmount').textContent = money(spent);
    $('#usageRemaining').textContent = 'Pay as you go — no preset limit';
    $('#usagePct').textContent = '';
  }

  // On the free tier the real constraint is a daily request cap, not a balance.
  if (key.is_free_tier) {
    $('#usageRemaining').textContent =
      `${money(spent)} spent · free models are capped per day, not per dollar`;
  }
}

function renderLocalUsage() {
  let msgs = 0, prompt = 0, out = 0;
  for (const c of state.chats) {
    msgs += c.messages.length;
    for (const m of c.messages) {
      if (m.role === 'assistant') out += m.tokens || estTokens(textOf(m));
      else if (m.role === 'user') prompt += m.promptTokens || estTokens(textOf(m));
    }
  }
  $('#statChats2').textContent = state.chats.length;
  $('#statMsgs2').textContent = msgs;
  $('#statPromptTok').textContent = fmtNum(prompt);
  $('#statOutTok').textContent = fmtNum(out);
}

/* ============================================================
 * File generation
 * ---------------------------------------------------------- */

const LIBS = {
  xlsx:  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  docx:  'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js',
  pptx:  'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
};

const loadedLibs = new Map();

/** Fetch a generator library the first time it is actually needed. */
function loadScript(url) {
  if (loadedLibs.has(url)) return loadedLibs.get(url);
  const p = new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = url;
    tag.onload = () => resolve();
    tag.onerror = () => {
      loadedLibs.delete(url);
      reject(new Error('Could not load the generator library. Check your connection.'));
    };
    document.head.appendChild(tag);
  });
  loadedLibs.set(url, p);
  return p;
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const safeName = (s, fallback) =>
  (s || '').replace(/[^\w\s.-]/g, '').trim().replace(/\s+/g, '-').slice(0, 48) || fallback;

/* marked hands back HTML-escaped text, so a table cell arrives as
   `&quot;apple&quot;`. Everything downstream — the sheet view, the .xlsx, the
   .docx — wants the characters, and escapes again on its own. */
const decodeEntities = (s) => String(s ?? '').replace(
  /&(amp|lt|gt|quot|apos|#39|nbsp);/g,
  (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' }[name]));

/** Flatten a marked inline-token tree to plain text. */
function plain(token) {
  if (token == null) return '';
  if (typeof token === 'string') return decodeEntities(token);
  if (Array.isArray(token)) return token.map(plain).join('');
  if (token.tokens?.length) return token.tokens.map(plain).join('');
  return decodeEntities(token.text ?? token.raw ?? '');
}

const lex = (md) => (window.marked ? marked.lexer(md || '') : []);

/* ---- Excel ---- */

async function exportXlsx(text, title) {
  await loadScript(LIBS.xlsx);
  const tokens = lex(text);
  const book = XLSX.utils.book_new();
  const used = new Set();

  const addSheet = (rows, name) => {
    let n = safeName(name, 'Sheet').slice(0, 28) || 'Sheet';
    let i = 2;
    while (used.has(n)) n = `${n.slice(0, 25)}-${i++}`;
    used.add(n);
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), n);
  };

  let heading = '';
  let count = 0;
  for (const t of tokens) {
    if (t.type === 'heading') heading = plain(t);
    if (t.type === 'table') {
      const head = t.header.map(plain);
      const body = t.rows.map((r) => r.map(plain));
      addSheet([head, ...body], heading || `Table ${count + 1}`);
      heading = '';
      count++;
    }
  }

  // No tables in the reply — fall back to a readable one-column dump.
  if (!count) {
    addSheet(text.split('\n').map((line) => [line]), title || 'Response');
    toast('No tables found, exported the text instead', '', 4000);
  }

  const buf = XLSX.write(book, { bookType: 'xlsx', type: 'array' });
  saveBlob(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${safeName(title, 'nexus')}.xlsx`);
}

/* ---- Word ---- */

async function exportDocx(text, title) {
  await loadScript(LIBS.docx);
  const D = window.docx;
  const H = [D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3,
             D.HeadingLevel.HEADING_4, D.HeadingLevel.HEADING_5, D.HeadingLevel.HEADING_6];
  const kids = [];

  for (const t of lex(text)) {
    switch (t.type) {
      case 'heading':
        kids.push(new D.Paragraph({ text: plain(t), heading: H[Math.min(t.depth, 6) - 1] }));
        break;

      case 'paragraph':
        kids.push(new D.Paragraph({ children: [new D.TextRun(plain(t))], spacing: { after: 160 } }));
        break;

      case 'list':
        for (const item of t.items) {
          kids.push(new D.Paragraph({
            text: plain(item),
            bullet: t.ordered ? undefined : { level: 0 },
            numbering: t.ordered ? { reference: 'nexus-ordered', level: 0 } : undefined,
            spacing: { after: 60 },
          }));
        }
        break;

      case 'blockquote':
        kids.push(new D.Paragraph({
          children: [new D.TextRun({ text: plain(t), italics: true })],
          indent: { left: 480 },
          spacing: { after: 160 },
        }));
        break;

      case 'code':
        for (const line of (t.text || '').split('\n')) {
          kids.push(new D.Paragraph({
            children: [new D.TextRun({ text: line || ' ', font: 'Consolas', size: 19 })],
            shading: { fill: 'F2F2F2' },
          }));
        }
        kids.push(new D.Paragraph({ text: '' }));
        break;

      case 'table': {
        const row = (cells, header) => new D.TableRow({
          tableHeader: header,
          children: cells.map((c) => new D.TableCell({
            children: [new D.Paragraph({ children: [new D.TextRun({ text: plain(c), bold: !!header })] })],
          })),
        });
        kids.push(new D.Table({
          width: { size: 100, type: D.WidthType.PERCENTAGE },
          rows: [row(t.header, true), ...t.rows.map((r) => row(r, false))],
        }));
        kids.push(new D.Paragraph({ text: '' }));
        break;
      }
    }
  }

  if (!kids.length) kids.push(new D.Paragraph(text));

  const doc = new D.Document({
    numbering: {
      config: [{
        reference: 'nexus-ordered',
        levels: [{ level: 0, format: D.LevelFormat.DECIMAL, text: '%1.', alignment: D.AlignmentType.START }],
      }],
    },
    sections: [{ children: kids }],
  });

  saveBlob(await D.Packer.toBlob(doc), `${safeName(title, 'nexus')}.docx`);
}

/* ---- PowerPoint ---- */

async function exportPptx(text, title) {
  await loadScript(LIBS.pptx);
  const tokens = lex(text);

  // Split the reply into slides at each heading.
  const slides = [];
  let cur = null;
  for (const t of tokens) {
    if (t.type === 'heading') {
      cur = { title: plain(t), bullets: [] };
      slides.push(cur);
      continue;
    }
    if (!cur) { cur = { title: title || 'Slide', bullets: [] }; slides.push(cur); }

    if (t.type === 'list') cur.bullets.push(...t.items.map(plain));
    else if (t.type === 'paragraph') cur.bullets.push(plain(t));
    else if (t.type === 'code') cur.bullets.push((t.text || '').split('\n').slice(0, 8).join('\n'));
  }
  if (!slides.length) slides.push({ title: title || 'Response', bullets: text.split('\n\n') });

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.title = title || 'Nexus export';

  for (const s of slides) {
    const slide = pptx.addSlide();
    slide.addText(s.title, { x: 0.5, y: 0.35, w: 9, h: 0.9, fontSize: 30, bold: true, color: '1F1F1F' });
    const bullets = s.bullets.filter(Boolean).slice(0, 10);
    if (bullets.length) {
      slide.addText(
        bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
        { x: 0.7, y: 1.45, w: 8.6, h: 3.7, fontSize: 16, color: '3B3B3B', lineSpacingMultiple: 1.2 });
    }
  }

  saveBlob(await pptx.write({ outputType: 'blob' }), `${safeName(title, 'nexus')}.pptx`);
}

/* ---- Codebase ---- */

const EXT = {
  javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', jsx: 'jsx', tsx: 'tsx',
  python: 'py', py: 'py', html: 'html', css: 'css', scss: 'scss', json: 'json',
  bash: 'sh', sh: 'sh', shell: 'sh', sql: 'sql', java: 'java', c: 'c', cpp: 'cpp',
  csharp: 'cs', cs: 'cs', go: 'go', rust: 'rs', rs: 'rs', php: 'php', ruby: 'rb',
  yaml: 'yml', yml: 'yml', xml: 'xml', markdown: 'md', md: 'md', toml: 'toml',
};

const FILENAME_RE = /^[\w./-]+\.[A-Za-z0-9]{1,8}$/;

/* marked puts a `space` token between blocks, so the paragraph holding a file
   path is rarely the token immediately before its fence. */
function prevBlock(tokens, i) {
  for (let k = i - 1; k >= 0; k--) {
    if (tokens[k].type !== 'space') return tokens[k];
  }
  return null;
}

/** Pull a filename from the fence info string, or from the line just above it. */
function fileNameFor(token, prev, index) {
  const info = (token.lang || '').trim();

  // ```js:src/app.js   or   ```js title=src/app.js
  const tagged = info.match(/(?:[:=]|title=|file=)\s*["']?([\w./-]+\.[A-Za-z0-9]{1,8})/);
  if (tagged) return tagged[1];

  // ```src/app.js
  const firstWord = info.split(/\s+/)[0];
  if (FILENAME_RE.test(firstWord)) return firstWord;

  // A heading or paragraph directly above that holds only a path
  if (prev) {
    const t = plain(prev).trim().replace(/^[`*_#\s]+|[`*_\s]+$/g, '');
    if (FILENAME_RE.test(t)) return t;
  }

  const lang = info.split(/\s+/)[0].toLowerCase();
  return `file-${index + 1}.${EXT[lang] || 'txt'}`;
}

async function exportZip(text, title) {
  await loadScript(LIBS.jszip);
  const tokens = lex(text);
  const zip = new JSZip();

  let n = 0;
  const seen = new Set();
  tokens.forEach((t, i) => {
    if (t.type !== 'code') return;
    let name = fileNameFor(t, prevBlock(tokens, i), n);
    while (seen.has(name)) name = name.replace(/(\.[^.]+)$/, `-${n}$1`);
    seen.add(name);
    zip.file(name, t.text ?? '');
    n++;
  });

  if (!n) {
    toast('No code blocks in this reply', 'err');
    return;
  }

  zip.file('README.md',
    `# ${title || 'Nexus export'}\n\nGenerated by Nexus on ${new Date().toLocaleString()}.\n\n---\n\n${text}\n`);
  saveBlob(await zip.generateAsync({ type: 'blob' }), `${safeName(title, 'nexus')}.zip`);
  toast(`Bundled ${n} file${n === 1 ? '' : 's'}`, 'ok');
}

/* ---- Export menu ---- */

function closeExportMenu() {
  const open = $('.export-menu');
  if (open) open.remove();
}

function openExportMenu(anchor, text, title) {
  closeExportMenu();
  const tokens = lex(text);
  const hasTable = tokens.some((t) => t.type === 'table');
  const hasCode = tokens.some((t) => t.type === 'code');

  const menu = document.createElement('div');
  menu.className = 'export-menu';
  menu.innerHTML = `
    <button data-fmt="md"><span>Markdown</span><small>.md</small></button>
    <button data-fmt="docx"><span>Word document</span><small>.docx</small></button>
    <button data-fmt="xlsx" ${hasTable ? '' : 'disabled title="No Markdown table in this reply"'}><span>Excel workbook</span><small>.xlsx</small></button>
    <button data-fmt="pptx"><span>PowerPoint deck</span><small>.pptx</small></button>
    <hr>
    <button data-fmt="zip" ${hasCode ? '' : 'disabled title="No code blocks in this reply"'}><span>Codebase</span><small>.zip</small></button>`;
  document.body.appendChild(menu);

  // Keep the menu on screen, flipping above the button when there is no room below.
  const r = anchor.getBoundingClientRect();
  const h = menu.offsetHeight;
  const w = menu.offsetWidth;
  menu.style.top = `${r.bottom + h > innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
  menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;

  menu.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-fmt]');
    if (!btn || btn.disabled) return;
    const fmt = btn.dataset.fmt;
    closeExportMenu();
    try {
      el.statusLine.textContent = 'Building file…';
      if (fmt === 'md') {
        saveBlob(new Blob([text], { type: 'text/markdown' }), `${safeName(title, 'nexus')}.md`);
        toast('Saved as .md', 'ok');
      } else if (fmt === 'docx') { await exportDocx(text, title); toast('Saved as .docx', 'ok'); }
      else if (fmt === 'xlsx') { await exportXlsx(text, title); toast('Saved as .xlsx', 'ok'); }
      else if (fmt === 'pptx') { await exportPptx(text, title); toast('Saved as .pptx', 'ok'); }
      else if (fmt === 'zip') { await exportZip(text, title); }
    } catch (err) {
      console.error('[Nexus] export failed', err);
      toast(`Export failed: ${err.message}`, 'err', 5000);
    } finally {
      el.statusLine.textContent = '';
    }
  });

  setTimeout(() => document.addEventListener('click', function once(ev) {
    if (!menu.contains(ev.target)) {
      closeExportMenu();
      document.removeEventListener('click', once);
    }
  }), 0);
}


/* ============================================================
 * Auto model
 * ------------------------------------------------------------
 * Reads the request, guesses how much thinking it needs, and
 * spends accordingly — with a daily ceiling the user sets. Short
 * questions go to a cheap model; code, analysis and long context
 * go to a strong one. As the day's budget runs down the picks
 * step down with it.
 * ---------------------------------------------------------- */

const AUTO_PREF = [
  'anthropic/claude', 'openai/gpt', 'openai/o', 'google/gemini', 'x-ai/grok',
  'deepseek', 'mistralai', 'meta-llama', 'qwen',
];

/** Dollars per million completion tokens. */
function priceOf(m) {
  const p = Number(m?.pricing?.completion || 0) * 1e6;
  return Number.isFinite(p) ? p : 0;
}

const todayKey = () => new Date().toISOString().slice(0, 10);

function autoSpendToday() {
  const s = state.settings;
  if (!s.autoSpend || s.autoSpend.day !== todayKey()) s.autoSpend = { day: todayKey(), amount: 0 };
  return s.autoSpend;
}

const autoRemaining = () => Math.max(0, (state.settings.autoBudget || 0) - autoSpendToday().amount);

/** How much thinking does this turn look like it needs? */
function classifyRequest(text) {
  const t = (text || '').toLowerCase().trim();
  let score = 0;

  if (t.length > 400) score += 1;
  if (t.length > 1200) score += 1;
  if (t.length < 60) score -= 1;
  if (/^(hi|hey|hello|thanks|thank you|ok|okay|yes|no|sure)\b/.test(t)) score -= 2;

  if (/```|\bcode\b|function |refactor|debug|stack trace|typescript|javascript|python|sql|regex|api\b/.test(t)) score += 2;
  if (/analy|forecast|derive|prove|optimi|architect|trade-?off|strategy|migrat|reconcile|audit/.test(t)) score += 2;
  if (/step by step|reason|explain in detail|compare|pros and cons|why does/.test(t)) score += 1;

  if (state.deliverable) score += 1;
  if (state.wsContext) score += 2;
  if (state.attachments.length) score += 1;

  return score >= 4 ? 'heavy' : score >= 2 ? 'standard' : 'light';
}

/** Pick a model for the tier, inside what is left of today's budget. */
function autoPick(text) {
  if (!state.models.length) return null;

  const tier = classifyRequest(text);
  const needVision = state.attachments.length > 0;
  const left = autoRemaining();
  const budget = state.settings.autoBudget || 0;

  let target = { light: 0.4, standard: 2.5, heavy: 10 }[tier];
  if (left <= 0) target = 0;                                  // spent out: free models only
  else if (left < budget * 0.2) target = Math.min(target, 0.8);

  const pool = state.models.filter((m) =>
    canChat(m) && !isVariablePrice(m) && (!needVision || isVision(m)));
  if (!pool.length) return null;

  let best = null;
  let bestScore = -Infinity;
  for (const m of pool) {
    const price = priceOf(m);
    if (target === 0 && price > 0) continue;
    if (target > 0 && price > target * 2.2 + 0.2) continue;

    // Closest price to the tier's target, nudged by family and context length.
    const closeness = -Math.abs(Math.log((price + 0.05) / (target + 0.05)));
    const pref = AUTO_PREF.findIndex((p) => m.id.startsWith(p));
    const prefScore = pref === -1 ? 0 : (AUTO_PREF.length - pref) * 0.1;
    const ctx = Math.min((m.context_length || 0) / 1e6, 1) * 0.15;
    const score = closeness + prefScore + ctx;
    if (score > bestScore) { bestScore = score; best = m; }
  }

  if (!best) best = [...pool].sort((a, b) => priceOf(a) - priceOf(b))[0];
  return best ? { model: best, tier, spentOut: left <= 0 } : null;
}

/** Add what a reply actually cost to today's total. */
function addAutoSpend(modelId, usage, fallbackOut) {
  const m = modelById(modelId);
  if (!m) return;
  const inPrice  = Number(m.pricing?.prompt || 0);
  const outPrice = Number(m.pricing?.completion || 0);
  const inTok  = usage?.prompt_tokens || 0;
  const outTok = usage?.completion_tokens || fallbackOut || 0;
  const cost = inTok * inPrice + outTok * outPrice;
  if (!cost) return;

  const spend = autoSpendToday();
  spend.amount += cost;
  saveSettings();
  renderAutoUsage();
}

function renderAutoUsage() {
  const budget = state.settings.autoBudget || 0;
  const spent = autoSpendToday().amount;
  const pct = budget ? Math.min(100, (spent / budget) * 100) : 0;

  const amount = $('#autoSpent');
  if (amount) amount.textContent = `$${spent.toFixed(4)}`;
  const fill = $('#autoMeterFill');
  if (fill) {
    fill.style.width = `${pct}%`;
    fill.classList.toggle('warn', pct >= 70 && pct < 90);
    fill.classList.toggle('danger', pct >= 90);
  }
  const val = $('#autoBudgetVal');
  if (val) val.textContent = `$${budget.toFixed(2)}`;
  updateModeBar();
}

/* ---- The bar above the composer: whatever is switched on ---- */

function updateModeBar() {
  const bar = $('#deliverableBar');
  if (!bar) return;

  const chips = [];
  if (state.deliverable) {
    chips.push({ k: 'deliverable', label: `Reply shaped for: ${DELIVERABLES[state.deliverable].label}` });
  }
  if (state.settings.web) chips.push({ k: 'web', label: 'Web search on' });
  if (state.settings.auto) {
    chips.push({ k: 'auto', label: `Auto model · $${autoRemaining().toFixed(2)} left today` });
  }

  bar.hidden = !chips.length;
  bar.innerHTML = chips.map((c) => `
    <button type="button" class="mode-chip" data-mode="${c.k}" title="Turn this off">
      <span>${escapeHtml(c.label)}</span>
      <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>`).join('');
}

/* ---- The + menu ---- */

function syncPlusMenu() {
  $$('#deliverableMenu [data-toggle]').forEach((row) => {
    row.classList.toggle('on', !!state.settings[row.dataset.toggle]);
  });
  $$('#deliverableMenu [data-deliverable]').forEach((row) => {
    row.classList.toggle('on', state.deliverable === row.dataset.deliverable);
  });
}

$('#deliverableMenu').addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-toggle]');
  if (toggle) {
    const key = toggle.dataset.toggle;
    state.settings[key] = !state.settings[key];
    saveSettings();
    syncPlusMenu();
    syncSettingsForm();
    syncModelUI();
    updateModeBar();
    const said = {
      web: state.settings.web ? 'Web search on — replies can cite live pages' : 'Web search off',
      auto: state.settings.auto ? 'Auto model on — the app picks per request' : 'Auto model off',
      autoApply: state.settings.autoApply
        ? 'The assistant will write its files straight to the folder'
        : 'Files wait for your review before being written',
    };
    toast(said[key] || '', '', 2600);
    return;
  }
  if (e.target.closest('#attachBtn, #sysBtn, #folderMenuBtn')) {
    $('#deliverablePicker').classList.remove('open');
  }
});

$('#folderMenuBtn').addEventListener('click', () => {
  setLayout(true);
  openFolder();
});

$('#deliverableBar').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-mode]');
  if (!chip) return;
  const mode = chip.dataset.mode;
  if (mode === 'deliverable') setDeliverable(null);
  else { state.settings[mode] = false; saveSettings(); syncPlusMenu(); syncSettingsForm(); }
  updateModeBar();
});

/* ---- Settings wiring ---- */

$('#autoInput').addEventListener('change', (e) => {
  state.settings.auto = e.target.checked;
  saveSettings();
  syncPlusMenu();
  updateModeBar();
  syncModelUI();
});

$('#autoBudgetInput').addEventListener('input', (e) => {
  state.settings.autoBudget = Number(e.target.value);
  saveSettings();
  renderAutoUsage();
});

$('#autoReset').addEventListener('click', () => {
  state.settings.autoSpend = { day: todayKey(), amount: 0 };
  saveSettings();
  renderAutoUsage();
  toast("Today's auto spend reset", 'ok');
});

/* ============================================================
 * Deliverables
 * ---------------------------------------------------------- */

function setDeliverable(kind) {
  state.deliverable = kind;
  syncPlusMenu();
  updateModeBar();
  if (kind) el.input.focus();
}

/* ============================================================
 * Sidebar resizing
 * ---------------------------------------------------------- */

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 520;

function setSidebarWidth(px, persist = true) {
  const w = Math.round(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, px)));
  document.documentElement.style.setProperty('--sidebar-w', `${w}px`);
  if (persist) {
    state.settings.sidebarW = w;
    saveSettings();
  }
}

function initResizer() {
  const grip = $('#sidebarResizer');
  let active = false;

  const stop = (e) => {
    if (!active) return;
    active = false;
    document.body.classList.remove('resizing');
    setSidebarWidth(e.clientX || state.settings.sidebarW);
  };

  grip.addEventListener('pointerdown', (e) => {
    active = true;
    document.body.classList.add('resizing');
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  grip.addEventListener('pointermove', (e) => { if (active) setSidebarWidth(e.clientX, false); });
  grip.addEventListener('pointerup', stop);
  grip.addEventListener('pointercancel', stop);
  grip.addEventListener('dblclick', () => setSidebarWidth(DEFAULTS.sidebarW));

  // Keyboard accessible: arrows nudge, Home resets.
  grip.addEventListener('keydown', (e) => {
    const w = state.settings.sidebarW;
    if (e.key === 'ArrowLeft') { e.preventDefault(); setSidebarWidth(w - 16); }
    if (e.key === 'ArrowRight') { e.preventDefault(); setSidebarWidth(w + 16); }
    if (e.key === 'Home') { e.preventDefault(); setSidebarWidth(DEFAULTS.sidebarW); }
  });
}

/* ============================================================
 * Wiring
 * ---------------------------------------------------------- */

$('#agentBtn').addEventListener('click', () => {
  const open = $('#agentPicker').classList.toggle('open');
  $('#agentBtn').setAttribute('aria-expanded', String(open));
  if (open) renderAgentMenu();
});

$('#agentMenuList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="pick-agent"]');
  if (!btn) return;
  applyAgent(btn.dataset.agent);
  $('#agentPicker').classList.remove('open');
});

$('#manageAgents').addEventListener('click', () => {
  $('#agentPicker').classList.remove('open');
  openSettings('agents');
});

$('#agentGrid').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="edit-agent"]');
  if (btn) openAgentEditor(btn.dataset.agent);
});

$('#addAgentBtn').addEventListener('click', () => openAgentEditor(null));
$('#agentSaveBtn').addEventListener('click', saveAgentFromEditor);
$('#agentDeleteBtn').addEventListener('click', deleteAgentFromEditor);
$('#agentTempInput').addEventListener('input', (e) => {
  $('#agentTempVal').textContent = Number(e.target.value).toFixed(2);
});

$('#refreshUsage').addEventListener('click', refreshUsage);

$('#deliverableBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#deliverablePicker').classList.toggle('open');
});
$('#deliverableMenu').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-deliverable]');
  if (!btn) return;
  setDeliverable(btn.dataset.deliverable);
  $('#deliverablePicker').classList.remove('open');
});


document.addEventListener('click', (e) => {
  if (!$('#agentPicker').contains(e.target)) $('#agentPicker').classList.remove('open');
  if (!$('#deliverablePicker').contains(e.target)) $('#deliverablePicker').classList.remove('open');
});

initResizer();

/* Registering a worker is what makes the app installable on a phone or tablet.
   It is skipped on file:// where service workers are unavailable. */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

/* ============================================================
 * Workspace — read a real folder, feed it to the model, write back
 *
 * Uses the File System Access API, which exists only in Chromium
 * desktop browsers (Chrome, Edge, Opera, Brave). Firefox and every
 * iOS browser lack it entirely, so the panel explains itself there
 * rather than failing silently.
 * ---------------------------------------------------------- */

const FS_SUPPORTED = typeof window.showDirectoryPicker === 'function';

/* Chrome still exposes the picker on file:// pages but refuses to open it, so
   the protocol has to be part of the test rather than the property alone. */
const FS_USABLE = FS_SUPPORTED && location.protocol !== 'file:';

/**
 * The handle API is fussy about where it runs. When it is missing the reason is
 * almost always the page's context rather than the browser, so say which one it
 * is — "unsupported" sends people looking for the wrong fix.
 */
function fsBlockedReason() {
  if (FS_USABLE) return null;
  if (location.protocol === 'file:') {
    return 'This page is open straight from disk (a <b>file://</b> path). Chrome only offers folder ' +
           'access over http, so start a server in this folder and reload:<br>' +
           '<code>python -m http.server 5500</code> → <code>http://localhost:5500</code>';
  }
  if (window.top !== window.self) {
    return 'The app is running inside an embedded preview. Open <b>http://localhost:5500</b> in a ' +
           'normal browser tab and folder access comes back.';
  }
  if (!window.isSecureContext) {
    return 'Folder access needs a secure page — <b>https</b> or <b>localhost</b>. This page is on ' +
           `<b>${escapeHtml(location.origin)}</b>.`;
  }
  return 'This browser has no File System Access API. Chrome, Edge, Brave and Opera on the desktop ' +
         'have it; Firefox and every iOS browser do not.';
}

/* Directories that are never worth reading into a prompt. */
const WS_SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', '.next', '.nuxt',
  'venv', '.venv', '__pycache__', '.idea', '.vscode', 'coverage', 'target',
  '.cache', 'vendor', 'bin', 'obj', '.gradle', 'Pods', 'DerivedData',
]);

const WS_TEXT_EXT = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'json', 'jsonc', 'html', 'htm', 'css',
  'scss', 'sass', 'less', 'py', 'rb', 'php', 'go', 'rs', 'java', 'kt', 'swift',
  'c', 'h', 'cpp', 'hpp', 'cs', 'sh', 'bash', 'zsh', 'ps1', 'sql', 'yml', 'yaml',
  'toml', 'ini', 'cfg', 'conf', 'env', 'md', 'markdown', 'txt', 'csv', 'tsv',
  'xml', 'svg', 'vue', 'svelte', 'astro', 'graphql', 'gradle', 'properties',
  'dockerfile', 'gitignore', 'editorconfig', 'lock',
]);

const WS_MAX_BYTES = 200 * 1024;   // a single file we are willing to inline
const WS_MAX_FILES = 4000;         // stop walking pathological trees

const ws = {
  root: null,       // FileSystemDirectoryHandle, or { name } for a read-only pick
  readOnly: false,  // a folder <input> can be read but never written back
  openFiles: [],    // { path, name, text, disk, dirty, lang } — the editor's tabs
  files: [],        // { path, name, dir, size, handle }
  dirs: new Set(),  // directory paths, for the tree
  open: new Set(),  // expanded directory paths
  picked: new Set(),// paths included in the prompt
};

/** Entries come from a directory handle or from a folder <input>; read both. */
const wsFileOf = (f) => (f.file ? Promise.resolve(f.file) : f.handle.getFile());

const wsExt = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : name.toLowerCase());
const wsIsText = (name) => WS_TEXT_EXT.has(wsExt(name)) || !name.includes('.');

const wsBytes = (n) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB`
  : n >= 1024 ? `${Math.round(n / 1024)} KB`
  : `${n} B`;

/** Walk the picked directory, collecting readable text files. */
async function wsScan(dirHandle, prefix = '') {
  if (ws.files.length >= WS_MAX_FILES) return;

  for await (const entry of dirHandle.values()) {
    if (ws.files.length >= WS_MAX_FILES) return;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.kind === 'directory') {
      if (WS_SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      ws.dirs.add(path);
      await wsScan(entry, path);
      continue;
    }

    if (!wsIsText(entry.name)) continue;
    let size = 0;
    try {
      size = (await entry.getFile()).size;
    } catch { continue; }
    if (size > WS_MAX_BYTES) continue;

    ws.files.push({ path, name: entry.name, dir: prefix, size, handle: entry });
  }
}

async function openFolder() {
  if (!FS_USABLE) return pickFolderReadOnly();

  let dir;
  try {
    dir = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (err) {
    if (err?.name === 'AbortError') return;          // the user dismissed the picker
    console.error('[Nexus] directory picker failed', err);
    toast(`Folder picker blocked: ${err.message} — falling back to a read-only pick`, 'err', 5000);
    return pickFolderReadOnly();
  }

  ws.root = dir;
  ws.readOnly = false;
  await rescanFolder();
}

/** Every browser can read a folder through an <input>; none can write back. */
function pickFolderReadOnly() {
  const input = $('#folderInput');
  input.value = '';
  input.click();
}

/** Build the same tree from a folder <input>'s FileList. */
function loadFolderFromInput(fileList) {
  const all = [...fileList];
  if (!all.length) return;

  const rootName = (all[0].webkitRelativePath || all[0].name).split('/')[0] || 'Folder';
  ws.root = { name: rootName };
  ws.readOnly = true;
  ws.files = [];
  ws.dirs = new Set();

  for (const file of all) {
    if (ws.files.length >= WS_MAX_FILES) break;

    const rel = file.webkitRelativePath || file.name;
    const path = rel.includes('/') ? rel.split('/').slice(1).join('/') : rel;
    if (!path) continue;

    const segs = path.split('/');
    const name = segs.pop();
    if (segs.some((d) => WS_SKIP_DIRS.has(d) || d.startsWith('.'))) continue;
    if (!wsIsText(name) || file.size > WS_MAX_BYTES) continue;

    let dir = '';
    for (const s of segs) { dir = dir ? `${dir}/${s}` : s; ws.dirs.add(dir); }
    ws.files.push({ path, name, dir: segs.join('/'), size: file.size, file });
  }

  wsFinishLoad();
}

async function rescanFolder() {
  if (!ws.root) return;
  if (ws.readOnly) return pickFolderReadOnly();   // no handle to re-walk
  ws.files = [];
  ws.dirs = new Set();

  $('#fileTree').innerHTML = '<div class="tree-empty">Reading folder…</div>';
  try {
    await wsScan(ws.root);
  } catch (err) {
    $('#fileTree').innerHTML = `<div class="tree-empty">Could not read the folder.<br>${escapeHtml(err.message)}</div>`;
    return;
  }

  wsFinishLoad();
}

function wsFinishLoad() {
  ws.files.sort((a, b) => a.path.localeCompare(b.path));
  // Only the top level starts expanded; deep trees stay manageable.
  ws.open = new Set([...ws.dirs].filter((d) => !d.includes('/')));
  ws.picked = new Set([...ws.picked].filter((p) => ws.files.some((f) => f.path === p)));

  updateStatusBar();
  $('#wsMeta').hidden = false;
  $('#wsRootName').textContent = ws.readOnly ? `${ws.root.name} · read-only` : ws.root.name;
  $('#openFolderBtn').hidden = true;
  $('#wsUnsupported').hidden = true;
  renderTree();
  updateWorkspaceUI();
  toast(`Opened ${ws.root.name} · ${ws.files.length} files`, 'ok');
}

function closeFolder() {
  ws.root = null;
  ws.readOnly = false;
  ws.openFiles = [];
  if (!el.artifact.hidden && !panelItems().length) closeArtifact(); else if (!el.artifact.hidden) renderArtifact();
  ws.files = [];
  ws.dirs = new Set();
  ws.picked = new Set();
  $('#wsMeta').hidden = true;
  $('#openFolderBtn').hidden = false;
  renderTree();
  updateWorkspaceUI();
}

/** Build the visible rows: directories in path order, with their files nested. */
function renderTree() {
  const tree = $('#fileTree');

  const blocked = fsBlockedReason();
  $('#wsUnsupported').hidden = !(blocked && !ws.root);
  if (blocked && !ws.root) {
    $('#wsUnsupported').innerHTML =
      `${blocked}<br><br><b>Open folder</b> still works here — it reads the folder you pick, but ` +
      'cannot write changes back.';
  }

  if (!ws.root) {
    tree.innerHTML = `<div class="tree-empty">Open a folder to let the assistant read your code and ` +
      `answer questions about it${blocked ? '.' : ', then write changes back.'}</div>`;
    return;
  }

  if (ws.readOnly) {
    // Say why it is read-only and offer the way out, rather than just the fact.
    const why = fsBlockedReason();
    $('#wsUnsupported').hidden = false;
    $('#wsUnsupported').innerHTML =
      '<b>Read-only.</b> The assistant can read these files but cannot write to them.<br><br>' +
      (why || 'The folder was picked through the file dialog, which hands over copies rather than ' +
              'a handle to the folder itself.') +
      '<div class="ws-fix">' +
        (FS_USABLE
          ? '<button type="button" class="ghost-btn sm" data-wsfix="reopen">Reopen with write access</button>'
          : '<button type="button" class="ghost-btn sm" data-wsfix="tab">Open this app in a browser tab</button>') +
      '</div>';
  }
  if (!ws.files.length) {
    tree.innerHTML = '<div class="tree-empty">No readable text files found in this folder.</div>';
    return;
  }

  const visible = (path) => {
    // A row shows only when every ancestor directory is expanded.
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      if (!ws.open.has(parts.slice(0, i).join('/'))) return false;
    }
    return true;
  };

  const rows = [];
  const dirs = [...ws.dirs].sort();

  const dirRow = (path) => {
    const depth = path.split('/').length - 1;
    const isOpen = ws.open.has(path);
    return `<button class="tree-row" data-dir="${escapeHtml(path)}" style="padding-left:${8 + depth * 12}px">
      <svg class="tree-twisty ${isOpen ? 'open' : ''}" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
      <svg class="tree-icon" viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
      <span class="tree-name">${escapeHtml(path.split('/').pop())}</span>
    </button>`;
  };

  const fileRow = (f) => {
    const depth = f.dir ? f.dir.split('/').length : 0;
    const on = ws.picked.has(f.path);
    const open = wsOpenFile(f.path);
    return `<button class="tree-row ${on ? 'picked' : ''} ${open ? 'open' : ''} ${open?.dirty ? 'dirty' : ''}"
            data-file="${escapeHtml(f.path)}" style="padding-left:${8 + depth * 12}px"
            title="Open ${escapeHtml(f.path)} — tick the box to send it to the model">
      <span class="tree-spacer"></span>
      <span class="tree-check" title="Include in the next message">✓</span>
      <span class="tree-name">${escapeHtml(f.name)}</span>
      <span class="tree-size">${open?.dirty ? '●' : wsBytes(f.size)}</span>
    </button>`;
  };

  // Interleave directories and the files that sit directly inside them.
  const rootFiles = ws.files.filter((f) => !f.dir);
  for (const d of dirs) {
    if (!visible(d)) continue;
    rows.push(dirRow(d));
    if (!ws.open.has(d)) continue;
    for (const f of ws.files.filter((x) => x.dir === d)) rows.push(fileRow(f));
  }
  rows.unshift(...rootFiles.map(fileRow));

  tree.innerHTML = rows.join('');
}

/** The files the last reply wants to write, if a folder is open to write them into. */
function pendingPatch() {
  if (!ws.root) return [];
  const chat = currentChat();
  const last = chat?.messages.filter((m) => m.role === 'assistant' && !m.pending).slice(-1)[0];
  return last ? parsePatch(textOf(last)) : [];
}

function updateWorkspaceUI() {
  const n = ws.picked.size;
  $('#wsFoot').hidden = !ws.root;
  $('#wsSelected').textContent = `${n} file${n === 1 ? '' : 's'} in context`;

  const files = pendingPatch();
  $('#applyPatchBtn').hidden = !files.length;

  // The same offer, but where the code actually is: above the editor.
  const bar = $('#applyBar');
  if (bar) {
    bar.hidden = !files.length;
    $('#applyBarText').textContent = ws.readOnly
      ? `${files.length} file${files.length === 1 ? '' : 's'} written by the assistant — read-only folder`
      : `The assistant changed ${files.length} file${files.length === 1 ? '' : 's'}`;
    $('#applyAllBtn').disabled = ws.readOnly;
    $('#applyAllBtn').title = ws.readOnly
      ? 'Reopen the folder over http://localhost to write changes back'
      : `Write all ${files.length} to ${ws.root?.name || 'the folder'}`;
  }

  updateComposerMeta();
}

/** Total bytes of the selected files, so the context cost is visible. */
function wsContextBytes() {
  return ws.files.filter((f) => ws.picked.has(f.path)).reduce((n, f) => n + f.size, 0);
}

/** Read the selected files and format them for the prompt. */
/* The model can only edit the project if it is told that it may, and how. This
   goes with every turn a folder is open — not only when files are ticked. */
const WRITE_PROTOCOL = [
  '### Changing files',
  '',
  'You can edit this project. To write a file, put its path alone in backticks on the line',
  'immediately before a fenced block holding the file\'s complete new contents:',
  '',
  '`src/app.js`',
  '',
  '```js',
  '// the whole file, top to bottom',
  '```',
  '',
  'Rules: always give the entire file, never a fragment and never "// ...rest unchanged".',
  'One block per file, and only for files you actually changed. Use the exact path from the',
  'listing above; a new file is written at whatever path you name. The user sees a diff and',
  'accepts or rejects each file before anything touches the disk.',
].join('\n');

/* Small tool-tuned models will happily invent a filesystem and emit tool-call
   tokens at it. Giving them a request format the app actually answers turns
   that into something useful; forbidding the tokens keeps the rest quiet. */
const READ_PROTOCOL = [
  '### Reading more files',
  '',
  'You have no tools, no shell and no filesystem of your own — only what is pasted here.',
  'If you need a file that is not included, ask for it with a fenced block of paths:',
  '',
  '```read',
  'src/app.js',
  'src/util/dates.py',
  '```',
  '',
  'The app reads those paths out of the open folder, attaches them, and lets you continue.',
  'Use paths exactly as they appear in the listing. Never emit tool-call tokens such as',
  '<|tool_call_start|>, and never guess at absolute paths like /home/user/project.',
].join('\n');

async function wsContextBlock() {
  const term = terminalText();
  const blocks = [];

  if (ws.root) {
    const listing = ws.files.map((f) => f.path).slice(0, 400).join('\n');
    blocks.push(`## Project: ${ws.root.name}`, '', 'Every file in it:', '```', listing, '```');

    const shown = new Set();
    const parts = [];

    // What the user is looking at, including edits they have not saved yet.
    for (const f of ws.openFiles.slice(0, 3)) {
      shown.add(f.path);
      parts.push(`\`${f.path}\`  (open in the editor${f.dirty ? ', unsaved changes' : ''})` +
                 `\n\n\`\`\`${wsExt(f.name)}\n${f.text}\n\`\`\``);
    }

    // Everything ticked in the tree.
    for (const f of ws.files) {
      if (!ws.picked.has(f.path) || shown.has(f.path)) continue;
      try {
        const text = await (await wsFileOf(f)).text();
        parts.push(`\`${f.path}\`\n\n\`\`\`${wsExt(f.name)}\n${text}\n\`\`\``);
      } catch {
        parts.push(`\`${f.path}\` — could not be read`);
      }
    }

    blocks.push('', parts.length
      ? 'The files in play right now:'
      : 'No file contents are attached yet. Work from the listing, and ask for any file you need.');
    if (parts.length) blocks.push('', parts.join('\n\n'));

    blocks.push('', WRITE_PROTOCOL, '', READ_PROTOCOL);
    if (ws.readOnly) {
      blocks.push('', 'Note: this folder was opened read-only, so the user has to save your files ' +
                      'by hand. Keep that in mind and mention it if it matters.');
    }
  }

  if (term) {
    blocks.push('', '## Terminal output from the user', '', '```', term, '```', '',
                ws.root ? 'If it shows an error, trace it back to the files above and fix it there.'
                        : 'If it shows an error, say what caused it and give the fix.');
  }

  return blocks.join('\n');
}

/* ---- Writing changes back ---- */

/**
 * Find `path` + fenced block pairs in a reply. This is the same convention the
 * codebase export uses, so one prompt shape drives both.
 */
function parsePatch(text) {
  const tokens = lex(text);
  const out = [];

  tokens.forEach((t, i) => {
    if (t.type !== 'code') return;
    const name = fileNameFor(t, prevBlock(tokens, i), out.length);
    // Ignore the generic fallback: without a real path we must not write anything.
    if (/^file-\d+\./.test(name)) return;
    out.push({ path: name, content: t.text ?? '' });
  });

  return out;
}

/** Resolve (creating as needed) the directory handle for a nested path. */
async function wsDirFor(path, create) {
  const parts = path.split('/').slice(0, -1);
  let dir = ws.root;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

async function applyPatch() {
  const chat = currentChat();
  const last = chat?.messages.filter((m) => m.role === 'assistant' && !m.pending).slice(-1)[0];
  if (!ws.root || !last) return;

  const files = parsePatch(textOf(last));
  if (!files.length) return toast('No file blocks with paths in that reply', 'err');

  for (const f of files) {
    f.exists = ws.files.some((x) => x.path === f.path);
    f.bytes = new Blob([f.content]).size;
  }

  // Diff each one against what is on disk now, so the review shows real changes.
  for (const f of files) {
    const entry = ws.files.find((x) => x.path === f.path);
    f.current = '';
    if (entry) {
      try { f.current = await (await wsFileOf(entry)).text(); } catch { f.current = ''; }
    }
    f.diff = diffLines(f.current, f.content);
    f.accept = f.current !== f.content;
  }

  patchFiles = files;
  renderPatchReview();
  $('#patchModal').hidden = false;
}

/* ---- Wiring ---- */

$$('.side-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    if (!tab.dataset.side) return;   // Agents opens the settings dialog instead

    $$('.side-tab').forEach((t) => t.classList.toggle('active', t === tab));
    $$('.side-panel').forEach((p) => p.classList.toggle('active', p.dataset.sidePanel === tab.dataset.side));

    // Chats and Artifacts read as a centred conversation; the explorer is the
    // workspace, with the conversation moved to the side.
    openSideView(tab.dataset.side);
  });
});

$('#openFolderBtn').addEventListener('click', openFolder);

$('#wsUnsupported').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-wsfix]');
  if (!btn) return;
  if (btn.dataset.wsfix === 'reopen') openFolder();
  else window.open(location.href, '_blank', 'noopener');
});
$('#folderInput').addEventListener('change', (e) => {
  if (e.target.files?.length) loadFolderFromInput(e.target.files);
});
$('#wsRefresh').addEventListener('click', rescanFolder);
$('#wsClose').addEventListener('click', closeFolder);
$('#wsClearSel').addEventListener('click', () => {
  ws.picked.clear();
  renderTree();
  updateWorkspaceUI();
});

$('#fileTree').addEventListener('click', (e) => {
  const row = e.target.closest('.tree-row');
  if (!row) return;

  if (row.dataset.dir) {
    const d = row.dataset.dir;
    ws.open.has(d) ? ws.open.delete(d) : ws.open.add(d);
    renderTree();
    return;
  }

  const path = row.dataset.file;

  // The tick box controls what the model sees; the name opens the file.
  if (e.target.closest('.tree-check')) {
    ws.picked.has(path) ? ws.picked.delete(path) : ws.picked.add(path);
    renderTree();
    updateWorkspaceUI();
    return;
  }

  openWorkspaceFile(path);
  renderTree();
});

$('#applyPatchBtn').addEventListener('click', applyPatch);

renderTree();




/* ============================================================
 * Workspace layout
 * ------------------------------------------------------------
 * Chat layout is the default: conversation in the middle, files
 * in a panel beside it. Workspace layout rearranges the same
 * three regions into an editor — explorer on the left, the file
 * being edited (with the terminal under it) in the middle, and
 * the conversation on the right.
 * ---------------------------------------------------------- */

const IDE_MIN_WIDTH = 1100;

function ideOn() {
  return el.app.classList.contains('ide');
}

function setLayout(on, { persist = true } = {}) {
  if (on && innerWidth <= IDE_MIN_WIDTH) {
    toast('The workspace layout needs a wider window — showing the files panel instead', '', 4000);
    on = false;
  }

  el.app.classList.toggle('ide', on);
  $('#layoutBtn').classList.toggle('active', on);
  $('#layoutBtn').title = on ? 'Back to the chat layout' : 'Workspace layout — explorer, editor, chat';

  // The terminal belongs under the editor in this layout, and under the tree
  // in the other one. Moving the node keeps its listeners intact.
  const term = $('#wsTerminal');
  if (on) {
    el.artifact.insertBefore(term, $('.artifact-foot'));
    el.artifact.hidden = false;
    $('#artifactScrim').hidden = true;
    // The explorer is the point of this layout, so show it.
    showSideView('files');
  } else {
    $('.side-panel[data-side-panel="files"]').insertBefore(term, $('#wsFoot'));
    // Leaving the workspace means a plain conversation: the side panel steps
    // out of the way. Open files stay open, and the top-bar counter brings
    // the panel back.
    el.artifact.hidden = true;
    el.app.classList.remove('panel-open');
  }

  if (persist) { state.settings.ide = on; saveSettings(); }
  renderArtifact();
  updatePanelButton();
  updateStatusBar();
}

$('#layoutBtn').addEventListener('click', () => setLayout(!ideOn()));

/* A window that shrinks below the threshold falls back on its own. */
addEventListener('resize', () => {
  if (ideOn() && innerWidth <= IDE_MIN_WIDTH) setLayout(false, { persist: false });
});

/* Drag the chat column's edge, the way the rail resizes. */
(function initChatResizer() {
  const grip = $('#mainResizer');
  const root = document.documentElement;
  const clamp = (px) => Math.max(320, Math.min(720, px));
  const setW = (px) => root.style.setProperty('--chat-w', `${clamp(px)}px`);

  let dragging = false;
  grip.addEventListener('pointerdown', (e) => {
    if (!ideOn()) return;
    dragging = true;
    grip.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
  });
  grip.addEventListener('pointermove', (e) => { if (dragging) setW(innerWidth - e.clientX); });
  const stop = (e) => {
    if (!dragging) return;
    dragging = false;
    try { grip.releasePointerCapture(e.pointerId); } catch {}
    document.body.classList.remove('resizing');
  };
  grip.addEventListener('pointerup', stop);
  grip.addEventListener('pointercancel', stop);
  grip.addEventListener('keydown', (e) => {
    if (!ideOn()) return;
    const w = parseInt(getComputedStyle(root).getPropertyValue('--chat-w'), 10) || 420;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); setW(w + 24); }
    if (e.key === 'ArrowRight') { e.preventDefault(); setW(w - 24); }
  });
})();



/* ============================================================
 * File requests
 * ------------------------------------------------------------
 * A model that wants a file gets it: the request is read out of
 * the reply, the paths are resolved against the open folder, and
 * the turn continues with the contents attached.
 * ---------------------------------------------------------- */

const READ_FENCE = /```read[ \t]*\r?\n([\s\S]*?)```/gi;
const TOOL_CALL_READ = /read\s*\(\s*(?:path\s*=\s*)?["']([^"']+)["']\s*\)/gi;
const TOOL_TOKENS = /<\|[a-z_]+\|>/gi;

/** Paths the reply asked for, in either the app's format or a stray tool call. */
function extractReadRequests(text) {
  const out = [];
  const src = text || '';

  for (const m of src.matchAll(READ_FENCE)) {
    for (const line of m[1].split('\n')) {
      const p = line.trim().replace(/^[-*`\s]+|[`\s]+$/g, '');
      if (p) out.push(p);
    }
  }
  for (const m of src.matchAll(TOOL_CALL_READ)) out.push(m[1].trim());

  return [...new Set(out)].slice(0, 6);
}

/** Match a requested path against the folder, however loosely it was written. */
function resolveWsPath(request) {
  const want = request.replace(/^[./]+/, '');
  return ws.files.find((f) => f.path === want)
      || ws.files.find((f) => f.path.endsWith(`/${want}`))
      || ws.files.find((f) => f.name === want.split('/').pop())
      || null;
}

/** Attach what the reply asked for and let it carry on. Bounded, so it cannot loop. */
async function serveReadRequests(chat, msg) {
  if (!ws.root) return false;
  if (state.readRounds >= 2) return false;

  const paths = extractReadRequests(textOf(msg));
  if (!paths.length) return false;

  const attached = [];
  for (const p of paths) {
    const entry = resolveWsPath(p);
    if (!entry) { attached.push({ path: p, missing: true }); continue; }
    try {
      attached.push({ path: entry.path, name: entry.name, text: await (await wsFileOf(entry)).text() });
    } catch {
      attached.push({ path: p, missing: true });
    }
  }

  const body = attached.map((a) => a.missing
    ? `\`${a.path}\` — no such file in this folder`
    : `\`${a.path}\`\n\n\`\`\`${wsExt(a.name)}\n${a.text}\n\`\`\``).join('\n\n');

  chat.messages.push({
    id: uid(),
    role: 'user',
    auto: true,
    attached: attached.map((a) => (a.missing ? `${a.path} (missing)` : a.path)),
    content: `Here are the files you asked for.\n\n${body}`,
    ts: Date.now(),
  });

  const next = { id: uid(), role: 'assistant', content: '', model: chat.model, pending: true, ts: Date.now() };
  chat.messages.push(next);
  chat.updatedAt = Date.now();
  saveChats();
  renderMessages();

  state.readRounds += 1;
  await runCompletion(chat, next);
  return true;
}

/* ============================================================
 * Workspace chrome — rail, breadcrumbs, status bar
 * ---------------------------------------------------------- */

/** Switch which panel the rail (and the nav rows) are showing. */
function showSideView(view) {
  $$('.side-tab').forEach((t) => t.classList.toggle('active', t.dataset.side === view));
  $$('.side-panel').forEach((p) => p.classList.toggle('active', p.dataset.sidePanel === view));
  $$('.act-btn[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  el.app.classList.remove('collapsed');
}

$$('.act-btn[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => openSideView(btn.dataset.view));
});

/** A view and its layout: Explorer means the workspace, everything else the chat. */
function openSideView(view) {
  setLayout(view === 'files');
  showSideView(view);
}

$('#actAgents').addEventListener('click', () => openSettings('agents'));
$('#actSettings').addEventListener('click', () => openSettings());

/** demo › src › app.js */
function renderBreadcrumbs(item) {
  const box = $('#breadcrumbs');
  if (!box) return;

  if (!item || !ideOn()) { box.hidden = true; return; }

  const segs = item.kind === 'file'
    ? [ws.root?.name, ...item.path.split('/')].filter(Boolean)
    : [item.name];

  box.hidden = false;
  box.innerHTML = segs.map((s, i) => `
    <span class="crumb${i === segs.length - 1 ? ' last' : ''}">${escapeHtml(s)}</span>
    ${i < segs.length - 1 ? '<svg class="crumb-sep" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>' : ''}
  `).join('');
}

const LANG_LABEL = {
  javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python', ruby: 'Ruby',
  php: 'PHP', go: 'Go', rust: 'Rust', java: 'Java', kotlin: 'Kotlin', swift: 'Swift',
  csharp: 'C#', c: 'C', cpp: 'C++', bash: 'Shell', powershell: 'PowerShell', sql: 'SQL',
  json: 'JSON', yaml: 'YAML', ini: 'INI', markdown: 'Markdown', xml: 'XML', css: 'CSS',
  scss: 'SCSS', less: 'Less',
};

function updateStatusBar() {
  if (!$('#statusBar')) return;

  const item = activeArtifact();
  const file = item?.kind === 'file' ? wsOpenFile(item.path) : null;
  const dirty = ws.openFiles.filter((f) => f.dirty).length;

  $('#stFolder').textContent = ws.root
    ? `${ws.root.name}${ws.readOnly ? ' (read-only)' : ''} · ${ws.files.length} files`
    : 'No folder open';
  $('#stDirty').textContent = dirty ? `● ${dirty} unsaved` : '';
  $('#stDirty').classList.toggle('warn', !!dirty);

  const chat = currentChat();
  const model = modelById(chat?.model || state.settings.model);
  $('#stModel').textContent = model?.name || chat?.model || '';

  $('#stLang').textContent = file
    ? (LANG_LABEL[file.lang] || (wsExt(file.name) || 'text').toUpperCase())
    : (item ? 'Output' : 'Plain text');

  if (!file) $('#stCursor').textContent = '';
}

/** Ln/Col follows the caret in the editor, the way the real status bar does. */
function updateCursorStatus(area) {
  const box = $('#stCursor');
  if (!box || !area) return;
  const upto = area.value.slice(0, area.selectionStart);
  const line = upto.split('\n').length;
  const col = upto.length - upto.lastIndexOf('\n');
  box.textContent = `Ln ${line}, Col ${col}`;
}

['keyup', 'click', 'input', 'select'].forEach((evt) => {
  el.artifactBody.addEventListener(evt, (e) => {
    const area = e.target.closest?.('.edit-area');
    if (area) updateCursorStatus(area);
  }, true);
});

/* ============================================================
 * Reviewing the assistant's changes
 * ------------------------------------------------------------
 * Writing files straight to disk on trust is not reviewable, so
 * the reply's files are diffed against what is there now and
 * each one is accepted or skipped by hand.
 * ---------------------------------------------------------- */

/** Longest-common-subsequence line diff, capped so a huge pair cannot hang the tab. */
function diffLines(before, after) {
  const A = before ? before.split('\n') : [];
  const B = after ? after.split('\n') : [];

  if (A.length * B.length > 4000000) {
    return [{ type: 'note', text: `${A.length} lines replaced by ${B.length} — too large to diff here.` }];
  }

  const m = A.length;
  const n = B.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) { out.push({ type: 'ctx', text: A[i], a: i + 1, b: j + 1 }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: A[i], a: i + 1 }); i++; }
    else { out.push({ type: 'add', text: B[j], b: j + 1 }); j++; }
  }
  while (i < m) { out.push({ type: 'del', text: A[i], a: i + 1 }); i++; }
  while (j < n) { out.push({ type: 'add', text: B[j], b: j + 1 }); j++; }
  return out;
}

/** Keep three lines either side of each change; fold the rest away. */
function foldDiff(rows, pad = 3) {
  const keep = new Set();
  rows.forEach((r, i) => {
    if (r.type === 'ctx') return;
    for (let k = i - pad; k <= i + pad; k++) if (k >= 0 && k < rows.length) keep.add(k);
  });

  const out = [];
  let skipped = 0;
  rows.forEach((r, i) => {
    if (keep.has(i) || r.type === 'note') {
      if (skipped) { out.push({ type: 'fold', text: `${skipped} unchanged line${skipped === 1 ? '' : 's'}` }); skipped = 0; }
      out.push(r);
    } else {
      skipped++;
    }
  });
  if (skipped) out.push({ type: 'fold', text: `${skipped} unchanged line${skipped === 1 ? '' : 's'}` });
  return out;
}

let patchFiles = [];

function renderPatchReview() {
  const box = $('#patchBody');

  box.innerHTML = patchFiles.map((f, i) => {
    const adds = f.diff.filter((r) => r.type === 'add').length;
    const dels = f.diff.filter((r) => r.type === 'del').length;
    const rows = foldDiff(f.diff).map((r) => {
      if (r.type === 'fold') return `<div class="diff-row fold">${escapeHtml(r.text)}</div>`;
      if (r.type === 'note') return `<div class="diff-row fold">${escapeHtml(r.text)}</div>`;
      const sign = r.type === 'add' ? '+' : r.type === 'del' ? '-' : ' ';
      return `<div class="diff-row ${r.type}"><span class="diff-num">${r.a ?? ''}</span><span class="diff-num">${r.b ?? ''}</span><span class="diff-sign">${sign}</span><span class="diff-text">${escapeHtml(r.text)}</span></div>`;
    }).join('');

    return `
      <div class="patch-file ${f.accept ? '' : 'skipped'}" data-i="${i}">
        <label class="patch-head">
          <input type="checkbox" ${f.accept ? 'checked' : ''} data-accept="${i}" />
          <span class="switch"></span>
          <code>${escapeHtml(f.path)}</code>
          <span class="patch-badge ${f.exists ? 'mod' : 'new'}">${f.exists ? 'modified' : 'new file'}</span>
          <span class="patch-stat"><b class="add">+${adds}</b> <b class="del">-${dels}</b></span>
          <span class="patch-size">${wsBytes(f.bytes)}</span>
        </label>
        <div class="diff-view">${rows || '<div class="diff-row fold">No changes — the file already matches.</div>'}</div>
      </div>`;
  }).join('');

  const on = patchFiles.filter((f) => f.accept).length;
  $('#patchSummary').textContent = ws.readOnly
    ? 'This folder was opened read-only — reopen it over http://localhost to write changes back'
    : `${on} of ${patchFiles.length} selected`;
  $('#patchApply').disabled = !on || ws.readOnly;
  $('#patchApply').textContent = `Write ${on} file${on === 1 ? '' : 's'}`;
}

$('#patchBody').addEventListener('change', (e) => {
  const box = e.target.closest('[data-accept]');
  if (!box) return;
  patchFiles[Number(box.dataset.accept)].accept = box.checked;
  renderPatchReview();
});

/** Write a set of {path, content} to disk and fold the result back into the UI. */
async function writePatchFiles(files) {
  if (!files.length) return 0;
  if (ws.readOnly) {
    toast('This folder is read-only — reopen it over http://localhost to let the assistant write', 'err', 6000);
    return 0;
  }

  let ok = 0;
  const failed = [];

  for (const f of files) {
    try {
      const dir = await wsDirFor(f.path, true);
      const handle = await dir.getFileHandle(f.path.split('/').pop(), { create: true });
      const writable = await handle.createWritable();
      await writable.write(f.content);
      await writable.close();
      ok++;

      // An open tab should show what is now on disk, not the stale buffer.
      const open = wsOpenFile(f.path);
      if (open) { open.text = f.content; open.disk = f.content; open.dirty = false; }
    } catch (err) {
      failed.push(`${f.path}: ${err.message}`);
    }
  }

  await rescanFolder();
  if (!el.artifact.hidden) renderArtifact();
  updateWorkspaceUI();

  if (failed.length) {
    console.error('[Nexus] write failures', failed);
    toast(`Wrote ${ok}, failed ${failed.length}. See the console.`, 'err', 6000);
  } else {
    toast(`Wrote ${ok} file${ok === 1 ? '' : 's'} to ${ws.root.name}`, 'ok', 4000);
  }
  return ok;
}

$('#patchApply').addEventListener('click', async () => {
  const chosen = patchFiles.filter((f) => f.accept);
  if (!chosen.length) return;
  $('#patchModal').hidden = true;
  await writePatchFiles(chosen);
});

$('#applyReviewBtn').addEventListener('click', applyPatch);

$('#applyAllBtn').addEventListener('click', async () => {
  const files = pendingPatch();
  if (!files.length) return;
  await writePatchFiles(files);
});

/* ============================================================
 * Terminal output
 * ------------------------------------------------------------
 * A page cannot run commands, so this is the honest version: you
 * paste (or load) what your terminal printed and it rides along
 * with the next message.
 * ---------------------------------------------------------- */

const terminalText = () => ($('#wsTermAttach')?.checked ? ($('#wsTermInput')?.value.trim() || '') : '');

function updateTerminalUI() {
  const text = $('#wsTermInput')?.value.trim() || '';
  const on = $('#wsTermAttach')?.checked;
  const state = $('#wsTermState');
  if (state) {
    state.textContent = text ? `${text.split('\n').length} lines${on ? '' : ' · muted'}` : '';
    state.classList.toggle('on', !!text && on);
  }
  updateComposerMeta();
}

$('#wsTermToggle').addEventListener('click', () => {
  const body = $('#wsTermBody');
  body.hidden = !body.hidden;
  $('#wsTermToggle').setAttribute('aria-expanded', String(!body.hidden));
  $('#wsTermToggle').classList.toggle('open', !body.hidden);
  if (!body.hidden) $('#wsTermInput').focus();
});

$('#wsTermInput').addEventListener('input', updateTerminalUI);
$('#wsTermAttach').addEventListener('change', updateTerminalUI);

$('#wsTermClear').addEventListener('click', () => {
  $('#wsTermInput').value = '';
  updateTerminalUI();
});

$('#wsTermLoad').addEventListener('click', () => $('#wsTermFile').click());

$('#wsTermFile').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    $('#wsTermInput').value = text.length > 40000 ? `…\n${text.slice(-40000)}` : text;
    updateTerminalUI();
    toast(`Loaded ${file.name}`, 'ok');
  } catch (err) {
    toast(`Could not read ${file.name}: ${err.message}`, 'err');
  }
});

/* ============================================================
 * Workspace editor
 * ------------------------------------------------------------
 * A file from the tree opens as a tab in the output panel, next
 * to whatever the assistant has written. Highlighted text sits
 * under a transparent textarea, which is the cheapest honest way
 * to get a coloured, editable buffer without a whole editor.
 * ---------------------------------------------------------- */

const HL_BY_EXT = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', py: 'python', rb: 'ruby', php: 'php',
  go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift', cs: 'csharp',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', sh: 'bash', bash: 'bash', zsh: 'bash',
  ps1: 'powershell', sql: 'sql', json: 'json', yml: 'yaml', yaml: 'yaml',
  toml: 'ini', ini: 'ini', cfg: 'ini', md: 'markdown', markdown: 'markdown',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml', css: 'css',
  scss: 'scss', less: 'less',
};

const wsOpenFile = (path) => ws.openFiles.find((f) => f.path === path);

/** Read a file from the tree and show it in the panel. */
async function openWorkspaceFile(path) {
  const entry = ws.files.find((f) => f.path === path);
  if (!entry) return;

  let file = wsOpenFile(path);
  if (!file) {
    let text;
    try {
      text = await (await wsFileOf(entry)).text();
    } catch (err) {
      toast(`Could not read ${path}: ${err.message}`, 'err', 5000);
      return;
    }
    file = { path, name: entry.name, text, disk: text, dirty: false, lang: HL_BY_EXT[wsExt(entry.name)] || '' };
    ws.openFiles.push(file);
  }

  artifactState.key = `file:${path}`;
  artifactState.dismissed = null;
  el.artifact.hidden = false;
  el.app.classList.add('panel-open');
  $('#artifactScrim').hidden = false;
  renderArtifact();
  updatePanelButton();
}

function closeWorkspaceFile(path) {
  const file = wsOpenFile(path);
  if (file?.dirty && !confirm(`${path} has unsaved changes. Close it anyway?`)) return;
  ws.openFiles = ws.openFiles.filter((f) => f.path !== path);
  renderTree();
  panelItems().length ? renderArtifact() : closeArtifact();
  updatePanelButton();
}

async function saveWorkspaceFile(file) {
  if (!file || !ws.root) return;
  if (ws.readOnly) {
    toast('This folder was opened read-only — reopen it over http://localhost to save', 'err', 5000);
    return;
  }

  try {
    const dir = await wsDirFor(file.path, false);
    const handle = await dir.getFileHandle(file.name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(file.text);
    await writable.close();
  } catch (err) {
    console.error('[Nexus] save failed', err);
    toast(`Could not save ${file.path}: ${err.message}`, 'err', 6000);
    return;
  }

  file.disk = file.text;
  file.dirty = false;
  updateStatusBar();
  const entry = ws.files.find((f) => f.path === file.path);
  if (entry) entry.size = new Blob([file.text]).size;
  renderArtifact();
  renderTree();
  toast(`Saved ${file.path}`, 'ok');
}

function editorBodyHTML(file) {
  const lang = window.hljs?.getLanguage(file.lang) ? file.lang : '';
  let body;
  try {
    body = lang ? hljs.highlight(file.text, { language: lang }).value : escapeHtml(file.text);
  } catch {
    body = escapeHtml(file.text);
  }
  const gutter = file.text.split('\n').map((_, i) => i + 1).join('\n');

  return `
    <div class="art-code art-editor">
      <pre class="art-gutter" aria-hidden="true">${gutter}</pre>
      <div class="edit-wrap">
        <pre class="edit-hl" aria-hidden="true"><code class="hljs language-${escapeHtml(lang)}">${body}</code></pre>
        <textarea class="edit-area" spellcheck="false" data-path="${escapeHtml(file.path)}"
                  ${ws.readOnly ? 'readonly' : ''}>${escapeHtml(file.text)}</textarea>
      </div>
    </div>`;
}

/* Repaint the highlight layer as the user types, but not on every keystroke. */
let hlTimer = null;

el.artifactBody.addEventListener('input', (e) => {
  const area = e.target.closest('.edit-area');
  if (!area) return;

  const file = wsOpenFile(area.dataset.path);
  if (!file) return;
  file.text = area.value;
  file.dirty = file.text !== file.disk;

  const tab = el.artifactTabs.querySelector(`[data-tab-key="file:${CSS.escape(file.path)}"]`);
  if (tab) tab.classList.toggle('dirty', file.dirty);
  $('#artifactMeta').textContent =
    `${file.text.split('\n').length} lines · ${file.dirty ? 'unsaved changes' : 'saved'}`;
  updateStatusBar();

  clearTimeout(hlTimer);
  hlTimer = setTimeout(() => {
    const hl = el.artifactBody.querySelector('.edit-hl code');
    const gut = el.artifactBody.querySelector('.art-gutter');
    if (!hl) return;
    const lang = window.hljs?.getLanguage(file.lang) ? file.lang : '';
    try {
      hl.innerHTML = lang ? hljs.highlight(file.text, { language: lang }).value : escapeHtml(file.text);
    } catch {
      hl.textContent = file.text;
    }
    if (gut) gut.textContent = file.text.split('\n').map((_, i) => i + 1).join('\n');
  }, 140);
});

/* The highlight sits behind the textarea, so the two must scroll as one. */
el.artifactBody.addEventListener('scroll', (e) => {
  const area = e.target.closest('.edit-area');
  if (!area) return;
  const hl = area.previousElementSibling;
  if (hl) { hl.scrollTop = area.scrollTop; hl.scrollLeft = area.scrollLeft; }
}, true);

el.artifactBody.addEventListener('keydown', (e) => {
  const area = e.target.closest('.edit-area');
  if (!area) return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveWorkspaceFile(wsOpenFile(area.dataset.path));
    return;
  }
  // Tab inserts a tab rather than leaving the editor.
  if (e.key === 'Tab') {
    e.preventDefault();
    const { selectionStart: a, selectionEnd: b, value } = area;
    area.value = `${value.slice(0, a)}  ${value.slice(b)}`;
    area.selectionStart = area.selectionEnd = a + 2;
    area.dispatchEvent(new Event('input', { bubbles: true }));
  }
});

$('#artifactSave').addEventListener('click', () => {
  const item = activeArtifact();
  if (item?.kind === 'file') saveWorkspaceFile(wsOpenFile(item.path));
});

/* ============================================================
 * Clarifying questions
 *
 * The model asks by emitting a fenced ```ask block holding JSON.
 * We lift that block out of the rendered Markdown and draw it as a
 * real control, so the reply reads as a question rather than as a
 * wall of JSON.
 * ---------------------------------------------------------- */

const ASK_FENCE = /```(?:ask|ASK)[ \t]*\r?\n([\s\S]*?)```/;
const ASK_PARTIAL = /```(?:ask|ASK)[\s\S]*$/;   // still streaming, no closing fence yet

const ASK_PROTOCOL = [
  'If a request is ambiguous enough that different readings would lead to materially',
  'different work, ask before answering. To ask, reply with ONLY a fenced block tagged',
  '`ask` containing JSON of this shape:',
  '',
  '```ask',
  '{"questions":[{"question":"...","options":[{"label":"Short label","description":"What it means"}],"multiSelect":false}]}',
  '```',
  '',
  'Rules: at most 3 questions, each with 2-4 options. Keep labels under 6 words.',
  'Put no prose outside the block. Use this sparingly — when the answer is obvious,',
  'or the user has already told you, just answer.',
].join('\n');

/** Validate loosely: a malformed card must never break the message. */
function normalizeAsk(raw) {
  if (!raw || !Array.isArray(raw.questions) || !raw.questions.length) return null;

  const questions = raw.questions.slice(0, 3).map((q) => ({
    question: String(q?.question || '').slice(0, 300),
    multiSelect: !!q?.multiSelect,
    options: (Array.isArray(q?.options) ? q.options : []).slice(0, 6).map((o) => ({
      label: String(o?.label ?? o ?? '').slice(0, 120),
      description: String(o?.description || '').slice(0, 200),
    })).filter((o) => o.label),
  })).filter((q) => q.question && q.options.length);

  return questions.length ? { questions } : null;
}

/** Split a reply into the prose to render and the question spec, if any. */
function extractAsk(text) {
  const m = (text || '').match(ASK_FENCE);
  if (!m) return { text: text || '', spec: null };

  let spec = null;
  try { spec = normalizeAsk(JSON.parse(m[1])); } catch { spec = null; }

  // A block we could not parse stays visible, so nothing is silently swallowed.
  if (!spec) return { text: text || '', spec: null };
  return { text: (text || '').replace(ASK_FENCE, '').trim(), spec };
}

/** Hide a half-arrived ask block while the reply is still streaming. */
const stripPartialAsk = (text) => (text || '').replace(ASK_PARTIAL, '').trimEnd();

/* Tool-call tokens are noise from a model talking to tools that are not there. */
const stripToolTokens = (text) => (text || '')
  .replace(/<\|[a-z_]+\|>/gi, '')
  .replace(/^\s*\[\s*read\s*\([^\]]*\)\s*\]\s*$/gim, '')
  .trim();

/** The text a user should get when copying or exporting a reply. */
const visibleText = (msg) => extractAsk(textOf(msg)).text;

/* ---- Card state, keyed by message id ---- */

const askUI = new Map();   // id -> { page, answers: [] }

const askStateFor = (id, spec) => {
  if (!askUI.has(id)) askUI.set(id, { page: 0, answers: spec.questions.map(() => null) });
  return askUI.get(id);
};

function askCardHTML(msg, spec) {
  const st = askStateFor(msg.id, spec);
  const total = spec.questions.length;
  const page = Math.max(0, Math.min(st.page, total - 1));
  const q = spec.questions[page];
  const chosen = st.answers[page];
  const picked = new Set(Array.isArray(chosen) ? chosen : chosen != null ? [chosen] : []);

  const nav = total > 1
    ? `<span class="ask-count">${page + 1} of ${total}</span>
       <button class="ask-nav-btn" data-ask="prev" data-id="${msg.id}" ${page === 0 ? 'disabled' : ''} aria-label="Previous question">
         <svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>
       </button>
       <button class="ask-nav-btn" data-ask="next" data-id="${msg.id}" ${page === total - 1 ? 'disabled' : ''} aria-label="Next question">
         <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
       </button>`
    : '';

  const options = q.options.map((o, i) => `
    <button class="ask-opt ${picked.has(i) ? 'on' : ''}" data-ask="pick" data-id="${msg.id}" data-i="${i}">
      <span class="ask-num">${i + 1}</span>
      <span class="ask-text">
        <b>${escapeHtml(o.label)}</b>${o.description ? `<em> &mdash; ${escapeHtml(o.description)}</em>` : ''}
      </span>
      ${q.multiSelect ? '<span class="ask-tick">&#10003;</span>' : ''}
    </button>`).join('');

  return `
    <div class="ask-card" data-ask-card="${msg.id}">
      <div class="ask-head">
        <span class="ask-q">${escapeHtml(q.question)}</span>
        <div class="ask-nav">
          ${nav}
          <button class="ask-nav-btn" data-ask="dismiss" data-id="${msg.id}" aria-label="Dismiss">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
      </div>

      <div class="ask-options">${options}</div>

      <div class="ask-foot">
        <span class="ask-num pencil">
          <svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>
        </span>
        <input type="text" class="ask-other" data-id="${msg.id}" placeholder="Something else&hellip;" autocomplete="off" />
        ${q.multiSelect || picked.size ? `<button class="ask-send" data-ask="submit" data-id="${msg.id}">Send</button>` : ''}
        <button class="ask-skip" data-ask="skip" data-id="${msg.id}">Skip</button>
      </div>
    </div>`;
}

/** Turn the collected answers into the message we send back. */
function askCompose(spec, answers) {
  const lines = [];
  spec.questions.forEach((q, i) => {
    const a = answers[i];
    if (a == null) return;

    let value;
    if (typeof a === 'string') value = a;                                  // free text
    else if (Array.isArray(a)) value = a.map((i2) => q.options[i2]?.label).filter(Boolean).join(', ');
    else value = q.options[a]?.label;

    if (value) lines.push(`**${q.question}** ${value}`);
  });

  return lines.length ? lines.join('\n') : 'Skip the questions and use your best judgement.';
}

function askRerender(id) {
  const chat = currentChat();
  const msg = chat?.messages.find((m) => m.id === id);
  if (msg) refreshMessage(id);
}

async function askSubmit(id) {
  const chat = currentChat();
  const msg = chat?.messages.find((m) => m.id === id);
  if (!msg) return;

  const { spec } = extractAsk(textOf(msg));
  if (!spec) return;

  const st = askStateFor(id, spec);
  msg.askAnswered = askCompose(spec, st.answers);
  askUI.delete(id);
  saveChats();
  refreshMessage(id);
  await send(msg.askAnswered);
}

/** Record an answer and either advance to the next question or submit. */
function askAnswer(id, value) {
  const chat = currentChat();
  const msg = chat?.messages.find((m) => m.id === id);
  if (!msg) return;

  const { spec } = extractAsk(textOf(msg));
  if (!spec) return;

  const st = askStateFor(id, spec);
  const page = Math.max(0, Math.min(st.page, spec.questions.length - 1));
  const q = spec.questions[page];

  if (q.multiSelect && typeof value === 'number') {
    const cur = Array.isArray(st.answers[page]) ? st.answers[page] : [];
    st.answers[page] = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
    askRerender(id);
    return;                       // multi-select waits for an explicit Send
  }

  st.answers[page] = value;

  if (page < spec.questions.length - 1) {
    st.page = page + 1;
    askRerender(id);
  } else {
    askSubmit(id);
  }
}

/* ---- Wiring ---- */

el.messages.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-ask]');
  if (!btn) return;
  const id = btn.dataset.id;
  const chat = currentChat();
  const msg = chat?.messages.find((m) => m.id === id);
  if (!msg) return;

  switch (btn.dataset.ask) {
    case 'pick': {
      const card = btn.closest('.ask-card');
      const typed = card?.querySelector('.ask-other')?.value.trim();
      // Anything typed wins over the option that was clicked.
      askAnswer(id, typed || Number(btn.dataset.i));
      break;
    }

    case 'prev':
    case 'next': {
      const { spec } = extractAsk(textOf(msg));
      if (!spec) break;
      const st = askStateFor(id, spec);
      st.page = Math.max(0, Math.min(
        st.page + (btn.dataset.ask === 'next' ? 1 : -1), spec.questions.length - 1));
      askRerender(id);
      break;
    }

    case 'skip': {
      askAnswer(id, null);
      break;
    }

    case 'submit': {
      const card = btn.closest('.ask-card');
      const typed = card?.querySelector('.ask-other')?.value.trim();
      if (typed) askAnswer(id, typed);
      else askSubmit(id);
      break;
    }

    case 'dismiss': {
      msg.askDismissed = true;
      askUI.delete(id);
      saveChats();
      refreshMessage(id);
      break;
    }
  }
});

/* Enter in the free-text field answers the current question. */
el.messages.addEventListener('keydown', (e) => {
  const input = e.target.closest('.ask-other');
  if (!input || e.key !== 'Enter') return;
  e.preventDefault();
  const value = input.value.trim();
  if (value) askAnswer(input.dataset.id, value);
});

/* Number keys pick an option while a card is on screen and nothing else has focus. */
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
  if (!/^[1-6]$/.test(e.key)) return;

  const cards = $$('.ask-card');
  const card = cards[cards.length - 1];
  if (!card) return;

  const opt = card.querySelectorAll('.ask-opt')[Number(e.key) - 1];
  if (opt) { e.preventDefault(); opt.click(); }
});


/* ============================================================
 * Output panel
 * ------------------------------------------------------------
 * Long replies are mostly scaffolding around one thing the user
 * actually wants: a file, a table, a script. The panel lifts that
 * out beside the conversation, fills in as the model writes, and
 * hands it over as .xlsx, .zip or a plain file.
 * ---------------------------------------------------------- */

const EXT_BY_LANG = {
  javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', jsx: 'jsx', tsx: 'tsx',
  python: 'py', py: 'py', html: 'html', css: 'css', json: 'json', sql: 'sql',
  bash: 'sh', sh: 'sh', shell: 'sh', yaml: 'yml', yml: 'yml', java: 'java',
  csharp: 'cs', cs: 'cs', cpp: 'cpp', c: 'c', go: 'go', rust: 'rs', php: 'php',
  ruby: 'rb', swift: 'swift', kotlin: 'kt', markdown: 'md', md: 'md', xml: 'xml',
};

const artifactState = { key: null, dismissed: null };
const artifactCache = new Map();   // msg.id -> { len, items }

/** An unterminated fence mid-stream would swallow the rest of the reply. */
function closeFences(text) {
  const fences = (text.match(/^```/gm) || []).length;
  return fences % 2 ? `${text}\n\`\`\`` : text;
}

function collectArtifacts(text) {
  const tokens = lex(closeFences(text || ''));
  const items = [];
  let heading = '';
  let codeN = 0;
  let tableN = 0;

  tokens.forEach((t, i) => {
    if (t.type === 'heading') heading = plain(t).trim();

    if (t.type === 'code') {
      const code = t.text ?? '';
      if (!code.trim()) return;
      const lang = (t.lang || '').trim().split(/\s+/)[0].toLowerCase();
      items.push({ kind: 'code', lang, code, name: fileNameFor(t, prevBlock(tokens, i), codeN++) });
    }

    if (t.type === 'table') {
      items.push({
        kind: 'table',
        name: heading || `Table ${++tableN}`,
        header: t.header.map(plain),
        rows: t.rows.map((r) => r.map(plain)),
      });
      heading = '';
    }
  });

  return items;
}

function artifactsFor(msg) {
  if (!msg || msg.role !== 'assistant') return [];
  const text = textOf(msg);
  const hit = artifactCache.get(msg.id);

  let items;
  if (hit && hit.len === text.length) {
    items = hit.items;
  } else {
    // idx is the position in the reply and never shifts, so a deleted block
    // cannot drag the others' identities along with it.
    items = collectArtifacts(text).map((it, i) => ({ ...it, idx: i }));
    artifactCache.set(msg.id, { len: text.length, items });
  }

  const hidden = msg.hiddenArtifacts;
  return hidden?.length ? items.filter((it) => !hidden.includes(it.idx)) : items;
}

function findMessage(msgId) {
  for (const chat of state.chats) {
    const msg = chat.messages.find((m) => m.id === msgId);
    if (msg) return { chat, msg };
  }
  return null;
}

/** Drop one file or table from the set. The reply itself is left alone. */
function deleteArtifact(msgId, idx) {
  const found = findMessage(msgId);
  if (!found) return;
  const { chat, msg } = found;

  msg.hiddenArtifacts = [...new Set([...(msg.hiddenArtifacts || []), Number(idx)])];
  saveChats();

  if (chat.id === state.currentId) {
    refreshMessage(msg.id);
    if (!el.artifact.hidden) {
      chatArtifacts().length ? renderArtifact() : closeArtifact();
    }
  }
  renderArtifactList();
  updatePanelButton();
  toast('Removed from files — the reply still has it', '', 3000);
}

function hiddenArtifactCount() {
  return state.chats.reduce((n, c) =>
    n + c.messages.reduce((s, m) => s + (m.hiddenArtifacts?.length || 0), 0), 0);
}

function restoreArtifacts() {
  for (const chat of state.chats) {
    for (const msg of chat.messages) delete msg.hiddenArtifacts;
  }
  saveChats();
  renderMessages();
  renderArtifactList();
  updatePanelButton();
  if (!el.artifact.hidden) renderArtifact();
  toast('Restored every removed file', 'ok');
}

const CODE_ICON  = '<svg viewBox="0 0 24 24"><path d="M8 8l-4 4 4 4M16 8l4 4-4 4"/></svg>';
const SHEET_ICON = '<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4z"/><path d="M4 10h16M10 10v9"/></svg>';

/** The card under a reply that opens the panel again. */
function artifactChipHTML(msg) {
  const items = artifactsFor(msg);
  if (!items.length) return '';

  const sheets = items.filter((a) => a.kind === 'table').length;
  const files  = items.length - sheets;
  const lead   = items[0];
  const bits   = [];
  if (files)  bits.push(`${files} file${files === 1 ? '' : 's'}`);
  if (sheets) bits.push(`${sheets} table${sheets === 1 ? '' : 's'}`);

  return `
    <button class="art-chip" data-action="open-artifact" data-id="${msg.id}" data-index="${lead.idx}" type="button">
      <span class="art-chip-ico">${lead.kind === 'table' ? SHEET_ICON : CODE_ICON}</span>
      <span class="art-chip-text">
        <b>${escapeHtml(lead.name)}</b>
        <em>${bits.join(' &middot; ')} &middot; open in the panel</em>
      </span>
      <svg class="art-chip-go" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
    </button>`;
}

const artifactKey = (msgId, i) => `${msgId}:${i}`;

/** Every file and table in the open conversation, in the order they were written. */
function chatArtifacts() {
  const chat = currentChat();
  const out = [];
  for (const m of chat?.messages || []) {
    if (m.role !== 'assistant') continue;
    artifactsFor(m).forEach((item) => out.push({ ...item, msgId: m.id, key: artifactKey(m.id, item.idx) }));
  }
  return out;
}

/** Tabs in the panel: open workspace files first, then what the chat produced. */
function panelItems() {
  const files = ws.openFiles.map((f) => ({
    kind: 'file', key: `file:${f.path}`, name: f.name, path: f.path,
    lang: f.lang, dirty: f.dirty,
  }));
  return [...files, ...chatArtifacts()];
}

function activeArtifact(list = panelItems()) {
  if (!list.length) return null;
  return list.find((a) => a.key === artifactState.key) || list[list.length - 1];
}

function tabsHTML(items, active) {
  return items.map((a) => `
    <button class="art-tab ${a.key === active.key ? 'active' : ''} ${a.dirty ? 'dirty' : ''}"
            data-tab-key="${a.key}" role="tab">
      ${a.kind === 'table' ? SHEET_ICON : CODE_ICON}<span>${escapeHtml(a.name)}</span>
      ${a.kind === 'file' ? `<span class="tab-close" data-close-file="${escapeHtml(a.path)}">&times;</span>` : ''}
    </button>`).join('');
}

function artifactMessage(item) {
  const chat = currentChat();
  return chat?.messages.find((m) => m.id === (item || activeArtifact())?.msgId) || null;
}

function openArtifact(msgId, index = 0) {
  artifactState.key = artifactKey(msgId, index);
  artifactState.dismissed = null;
  el.artifact.hidden = false;
  el.app.classList.add('panel-open');
  $('#artifactScrim').hidden = false;
  renderArtifact();
}

function closeArtifact() {
  if (ideOn()) { renderArtifact(); return; }   // the editor column is permanent here
  if (!el.artifact || el.artifact.hidden) return;
  artifactState.dismissed = activeArtifact()?.msgId || null;
  el.artifact.hidden = true;
  el.app.classList.remove('panel-open');
  $('#artifactScrim').hidden = true;
  updatePanelButton();
}

/** The top-bar button: how many files this conversation has produced. */
function updatePanelButton() {
  const btn = $('#panelBtn');
  if (!btn) return;
  const n = chatArtifacts().length;
  btn.hidden = n === 0 || ideOn();   // in the workspace layout the editor is always on screen
  $('#panelCount').textContent = n;
  btn.classList.toggle('active', !el.artifact.hidden);
  btn.title = `${n} file${n === 1 ? '' : 's'} in this chat`;
  const nav = $('#navArtifactCount');
  if (nav) {
    const total = state.chats.reduce((sum, c) => sum + c.messages.reduce(
      (s, m) => s + (m.role === 'assistant' ? artifactsFor(m).length : 0), 0), 0);
    nav.textContent = total || '';
  }
}

/** Column letters, so a sheet preview reads like a spreadsheet. */
function colName(i) {
  let s = '';
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

function artifactBodyHTML(item) {
  if (!item) return '<div class="art-empty">Nothing to show yet.</div>';

  if (item.kind === 'table') {
    const cols = Math.max(item.header.length, ...item.rows.map((r) => r.length), 1);
    const head = Array.from({ length: cols }, (_, i) => `<th class="art-col">${colName(i)}</th>`).join('');
    const label = Array.from({ length: cols }, (_, i) =>
      `<th>${escapeHtml(item.header[i] ?? '')}</th>`).join('');
    const body = item.rows.map((r, n) => `
      <tr><td class="art-rownum">${n + 2}</td>${
        Array.from({ length: cols }, (_, i) => `<td>${escapeHtml(r[i] ?? '')}</td>`).join('')
      }</tr>`).join('');

    return `
      <div class="art-sheet">
        <table>
          <thead>
            <tr><th class="art-rownum art-col"></th>${head}</tr>
            <tr class="art-headrow"><td class="art-rownum">1</td>${label}</tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  const lang = window.hljs?.getLanguage(item.lang) ? item.lang : '';
  let body;
  try {
    body = lang ? hljs.highlight(item.code, { language: lang }).value : escapeHtml(item.code);
  } catch {
    body = escapeHtml(item.code);
  }
  const lines = item.code.split('\n');
  const gutter = lines.map((_, i) => i + 1).join('\n');

  return `
    <div class="art-code">
      <pre class="art-gutter" aria-hidden="true">${gutter}</pre>
      <pre class="art-lines"><code class="hljs language-${escapeHtml(lang)}">${body}</code></pre>
    </div>`;
}

function renderArtifact() {
  const items = panelItems();
  if (!items.length) {
    el.artifactTabs.hidden = true;
    el.artifactTabs.innerHTML = '';
    $('#artifactTitle').textContent = ideOn() ? 'Editor' : 'Output';
    $('#artifactSub').textContent = '';
    $('#artifactSave').hidden = true;
    $('#artifactDelete').hidden = true;
    $('#artifactSaveAll').hidden = true;
    $('#artifactMeta').textContent = '';
    $('#artifactClose').hidden = ideOn();
    $('#artifactCopy').hidden = true;
    $('#artifactDownload').hidden = true;
    $('#artifactLive').hidden = true;
    renderBreadcrumbs(null);
    updateStatusBar();
    el.artifactBody.innerHTML = ideOn()
      ? `<div class="art-empty">${ws.root
          ? 'Pick a file in the explorer to open it here.'
          : 'Open a folder in the explorer to start editing.'}</div>`
      : '<div class="art-empty">Waiting for the first block&hellip;</div>';
    updatePanelButton();
    return;
  }

  const item = activeArtifact(items);
  artifactState.key = item.key;
  const index = items.indexOf(item);

  if (item.kind === 'file') {
    const file = wsOpenFile(item.path);
    if (!file) { ws.openFiles = ws.openFiles.filter((f) => f.path !== item.path); return renderArtifact(); }

    $('#artifactIcon').innerHTML = CODE_ICON;
    $('#artifactTitle').textContent = file.name;
    $('#artifactSub').textContent = `${file.path}${ws.readOnly ? ' · read-only' : ''}`;
    $('#artifactDownload').title = `Download a copy of ${file.name}`;
    $('#artifactClose').hidden = ideOn();
    $('#artifactCopy').hidden = false;
    $('#artifactDownload').hidden = false;
    $('#artifactSave').hidden = ws.readOnly;
    $('#artifactSave').classList.toggle('dirty', file.dirty);
    $('#artifactDelete').hidden = true;
    $('#artifactLive').hidden = true;
    el.artifact.classList.remove('live');

    el.artifactTabs.hidden = items.length < 2;
    el.artifactTabs.innerHTML = items.length < 2 ? '' : tabsHTML(items, item);
    renderBreadcrumbs(item);
    el.artifactBody.innerHTML = editorBodyHTML(file);
    updateStatusBar();
    updateCursorStatus(el.artifactBody.querySelector('.edit-area'));
    $('#artifactMeta').textContent =
      `${file.text.split('\n').length} lines · ${file.dirty ? 'unsaved changes' : 'saved'}`;
    $('#artifactSaveAll').hidden = true;
    updatePanelButton();
    return;
  }

  $('#artifactSave').hidden = true;
  $('#artifactDelete').hidden = false;
  const msg = artifactMessage(item);

  $('#artifactIcon').innerHTML = item.kind === 'table' ? SHEET_ICON : CODE_ICON;
  $('#artifactTitle').textContent = item.name;
  $('#artifactDownload').title = item.kind === 'table'
    ? `Download this sheet as .xlsx`
    : `Download ${item.name}`;
  $('#artifactSub').textContent = item.kind === 'table'
    ? `${item.rows.length} row${item.rows.length === 1 ? '' : 's'} · ${item.header.length} columns`
    : (item.lang || 'text');

  el.artifactTabs.hidden = items.length < 2;
  el.artifactTabs.innerHTML = items.length < 2 ? '' : tabsHTML(items, item);

  renderBreadcrumbs(item);
  el.artifactBody.innerHTML = artifactBodyHTML(item);
  updateStatusBar();

  $('#artifactClose').hidden = ideOn();
  $('#artifactCopy').hidden = false;
  $('#artifactDownload').hidden = false;
  const streaming = state.streaming && msg.pending;
  $('#artifactLive').hidden = !streaming;
  el.artifact.classList.toggle('live', streaming);
  if (streaming && item.kind === 'code') el.artifactBody.scrollTop = el.artifactBody.scrollHeight;

  $('#artifactMeta').textContent = item.kind === 'table'
    ? `${item.rows.length} rows · ${index + 1} of ${items.length} in this chat`
    : `${item.code.split('\n').length} lines · ${index + 1} of ${items.length} in this chat`;

  const own = msg ? artifactsFor(msg) : [item];
  const anyTable = own.some((a) => a.kind === 'table');
  const codeCount = own.filter((a) => a.kind === 'code').length;
  const save = $('#artifactSaveAll');
  save.hidden = own.length < 2 && !msg?.deliverable;
  updatePanelButton();
  // The header button saves what is on screen; this one saves the whole reply.
  save.textContent = anyTable
    ? 'Save all tables (.xlsx)'
    : `Save ${codeCount} file${codeCount === 1 ? '' : 's'} (.zip)`;
}

/** Called on every streaming repaint: open on the first block, then follow it. */
let lastArtifactPaint = 0;

function artifactStream(msg, acc) {
  if (!acc) return;
  const text = String(acc);
  const hasBlock = /^```/m.test(text) || /^\s*\|.*\|\s*$/m.test(text);
  if (!hasBlock) return;

  msg.content = text;   // so artifactsFor() sees the partial reply

  if (el.artifact.hidden) {
    if (artifactState.dismissed === msg.id) return;   // the user closed it for this reply
    artifactCache.delete(msg.id);
    const first = artifactsFor(msg)[0];
    if (!first) return;
    openArtifact(msg.id, first.idx);
    lastArtifactPaint = performance.now();
    return;
  }
  if (activeArtifact()?.msgId !== msg.id) return;

  // Lexing and highlighting the whole reply is too costly to do on every frame.
  const now = performance.now();
  if (now - lastArtifactPaint < 200) return;
  lastArtifactPaint = now;
  artifactCache.delete(msg.id);
  renderArtifact();
}

/** With "write files without asking" on, the reply lands on disk by itself. */
async function maybeAutoApply() {
  if (!state.settings.autoApply || !ws.root || ws.readOnly) return;
  const files = pendingPatch();
  if (!files.length) return;
  await writePatchFiles(files);
}

/** Called once a reply is complete. */
function artifactSettle(msg) {
  artifactCache.delete(msg.id);
  const items = artifactsFor(msg);

  renderArtifactList();

  if (!items.length) {
    if (msg.deliverable === 'xlsx') {
      toast('The reply had no table to put in a spreadsheet — try asking for the data as a table', 'err', 5000);
    }
    if (activeArtifact()?.msgId === msg.id) closeArtifact();
    updatePanelButton();
    return;
  }

  // A requested file wins: jump to the block that answers the request.
  if (msg.deliverable === 'xlsx' || msg.deliverable === 'docx' || msg.deliverable === 'pptx') {
    const sheet = items.find((a) => a.kind === 'table');
    if (sheet) {
      if (artifactState.dismissed !== msg.id) openArtifact(msg.id, sheet.idx);
      toast('Spreadsheet ready — save it from the panel', 'ok', 4000);
    }
  } else if (msg.deliverable === 'zip' && artifactState.dismissed !== msg.id) {
    openArtifact(msg.id, items[0].idx);
  }

  if (!el.artifact.hidden) renderArtifact();
  updatePanelButton();
}

/* ---- Saving what is in the panel ---- */

async function saveArtifact(item, title) {
  if (item.kind === 'file') {
    const file = wsOpenFile(item.path);
    saveBlob(new Blob([file?.text ?? ''], { type: 'text/plain' }), file?.name || 'file.txt');
    toast(`Saved a copy of ${file?.name}`, 'ok');
    return;
  }

  if (item.kind === 'table') {
    await loadScript(LIBS.xlsx);
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([item.header, ...item.rows]);
    XLSX.utils.book_append_sheet(book, sheet, safeName(item.name, 'Sheet').slice(0, 28) || 'Sheet');
    const buf = XLSX.write(book, { bookType: 'xlsx', type: 'array' });
    saveBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
             `${safeName(item.name || title, 'nexus')}.xlsx`);
    toast('Saved as .xlsx', 'ok');
    return;
  }

  const name = /\.[A-Za-z0-9]{1,8}$/.test(item.name)
    ? item.name
    : `${safeName(item.name, 'snippet')}.${EXT_BY_LANG[item.lang] || 'txt'}`;
  saveBlob(new Blob([item.code], { type: 'text/plain' }), name);
  toast(`Saved ${name}`, 'ok');
}

/* ---- Panel events ---- */

el.artifactTabs.addEventListener('click', (e) => {
  const close = e.target.closest('[data-close-file]');
  if (close) { closeWorkspaceFile(close.dataset.closeFile); return; }

  const tab = e.target.closest('[data-tab-key]');
  if (!tab) return;
  artifactState.key = tab.dataset.tabKey;
  renderArtifact();
});

$('#panelBtn').addEventListener('click', () => {
  if (!el.artifact.hidden) { closeArtifact(); return; }
  const items = chatArtifacts();
  if (!items.length) return;
  const last = items[items.length - 1];
  artifactState.dismissed = null;
  openArtifact(last.msgId, Number(last.key.split(':')[1]));
});

$('#artifactDelete').addEventListener('click', () => {
  const item = activeArtifact();
  if (!item) return;
  deleteArtifact(item.msgId, item.idx);
});

$('#artifactClose').addEventListener('click', closeArtifact);
$('#artifactScrim').addEventListener('click', closeArtifact);

$('#artifactCopy').addEventListener('click', async (e) => {
  const item = activeArtifact();
  if (!item) return;
  const text = item.kind === 'table'
    ? [item.header, ...item.rows].map((r) => r.join('\t')).join('\n')
    : item.kind === 'file' ? (wsOpenFile(item.path)?.text ?? '')
    : item.code;
  const ok = await copyText(text);
  toast(ok ? 'Copied' : 'Could not access the clipboard', ok ? 'ok' : 'err', 1600);
  e.currentTarget.classList.add('done');
  setTimeout(() => e.currentTarget.classList.remove('done'), 1200);
});

$('#artifactDownload').addEventListener('click', async () => {
  const item = activeArtifact();
  if (!item) return;
  try {
    el.statusLine.textContent = 'Building file…';
    await saveArtifact(item, currentChat()?.title);
  } catch (err) {
    console.error('[Nexus] save failed', err);
    toast(`Could not save: ${err.message}`, 'err', 5000);
  } finally {
    el.statusLine.textContent = '';
  }
});

$('#artifactSaveAll').addEventListener('click', async () => {
  const msg = artifactMessage();
  if (!msg) return;
  const items = artifactsFor(msg);   // the reply the panel is showing
  const title = currentChat()?.title;
  try {
    el.statusLine.textContent = 'Building file…';
    if (items.some((a) => a.kind === 'table')) {
      await exportXlsx(visibleText(msg), title);
      toast('Saved as .xlsx', 'ok');
    } else {
      await exportZip(visibleText(msg), title);
    }
  } catch (err) {
    console.error('[Nexus] save failed', err);
    toast(`Could not save: ${err.message}`, 'err', 5000);
  } finally {
    el.statusLine.textContent = '';
  }
});


/** The Artifacts tab: everything produced across every conversation. */
function renderArtifactList() {
  const box = $('#artifactList');
  if (!box) return;

  const rows = [];
  for (const chat of [...state.chats].sort((a, b) => b.updatedAt - a.updatedAt)) {
    for (const m of chat.messages) {
      if (m.role !== 'assistant') continue;
      artifactsFor(m).forEach((item) => rows.push({ item, chat, msgId: m.id }));
    }
  }

  const hidden = hiddenArtifactCount();
  const restore = hidden
    ? `<button class="art-restore" id="artifactRestore" type="button">Restore ${hidden} removed file${hidden === 1 ? '' : 's'}</button>`
    : '';

  if (!rows.length) {
    box.innerHTML = '<div class="empty-list">Code blocks and tables from the assistant collect here.</div>' + restore;
    return;
  }

  box.innerHTML = rows.slice(0, 200).map(({ item, chat, msgId }) => `
    <div class="art-row" data-chat="${chat.id}" data-msg="${msgId}" data-index="${item.idx}">
      <button class="art-row-open" type="button">
        <span class="art-row-ico">${item.kind === 'table' ? SHEET_ICON : CODE_ICON}</span>
        <span class="art-row-text">
          <b>${escapeHtml(item.name)}</b>
          <em>${escapeHtml(chat.title)}</em>
        </span>
      </button>
      <button class="icon-btn del art-row-del" type="button" title="Delete ${escapeHtml(item.name)}" aria-label="Delete">
        <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
      </button>
    </div>`).join('') + restore;
}

$('#artifactList').addEventListener('click', (e) => {
  if (e.target.closest('#artifactRestore')) { restoreArtifacts(); return; }

  const row = e.target.closest('.art-row');
  if (!row) return;

  if (e.target.closest('.art-row-del')) {
    deleteArtifact(row.dataset.msg, Number(row.dataset.index));
    return;
  }

  if (row.dataset.chat !== state.currentId) setCurrent(row.dataset.chat);
  artifactState.dismissed = null;
  openArtifact(row.dataset.msg, Number(row.dataset.index));
  if (innerWidth <= 860) el.app.classList.add('collapsed');
});

$('#agentsNavBtn').addEventListener('click', () => openSettings('agents'));

/* Drag the panel edge, same feel as the sidebar. */
(function initArtifactResizer() {
  const grip = $('#artifactResizer');
  const root = document.documentElement;
  const clamp = (px) => Math.max(320, Math.min(720, px));
  const setW = (px) => root.style.setProperty('--artifact-w', `${clamp(px)}px`);

  let dragging = false;
  grip.addEventListener('pointerdown', (e) => {
    dragging = true;
    grip.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
  });
  grip.addEventListener('pointermove', (e) => {
    if (dragging) setW(innerWidth - e.clientX);
  });
  const stop = (e) => {
    if (!dragging) return;
    dragging = false;
    try { grip.releasePointerCapture(e.pointerId); } catch {}
    document.body.classList.remove('resizing');
  };
  grip.addEventListener('pointerup', stop);
  grip.addEventListener('pointercancel', stop);

  grip.addEventListener('keydown', (e) => {
    const w = parseInt(getComputedStyle(root).getPropertyValue('--artifact-w'), 10) || 420;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); setW(w + 24); }
    if (e.key === 'ArrowRight') { e.preventDefault(); setW(w - 24); }
  });
})();

try {
  boot();
} catch (err) {
  console.error('Startup failed', err);
  showFatal('Startup failed', err);
}

})();
