# UI Revolution — Svelte 5 Rewrite Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite VoiceClone frontend in Svelte 5 + SvelteKit for a fast, fluid, premium UX while keeping all existing API endpoints unchanged.

**Architecture:** SvelteKit SPA with Vercel adapter, coexisting with existing `api/*.js` serverless functions. Svelte stores manage auth/persona/chat state. SSE streaming client with reconnection. Progressive-reveal login flow.

**Tech Stack:** Svelte 5, SvelteKit, @sveltejs/adapter-vercel, Vite

**Svelte 5 syntax note:** All components use Svelte 5 runes syntax: `let { prop } = $props()` instead of `export let prop`, `onclick={handler}` instead of `on:click={handler}`, `$state()` for reactive state, `$derived()` for computed values, `$effect()` for side effects. No `export let`, no `on:` directives, no `$:` reactive statements.

**Spec:** `docs/superpowers/specs/2026-04-15-ui-revolution-design.md`

---

## Chunk 1: Security Fixes + SvelteKit Scaffold

### Task 1: Fix Persona Ownership in 4 API Endpoints

**Files:**
- Modify: `api/config.js`
- Modify: `api/calibrate.js`
- Modify: `api/calibrate-feedback.js`
- Modify: `api/feedback.js`

- [ ] **Step 1: Fix `api/config.js` — add ownership check**

The endpoint loads persona but doesn't check `client_id`. Add after `authenticateRequest`:

```js
// api/config.js — after line 11
const { client, isAdmin } = await authenticateRequest(req);

// ... after getPersonaFromDb:
if (!isAdmin && persona.client_id !== client?.id) {
  res.status(403).json({ error: "Forbidden" });
  return;
}
```

Currently line 11 is `await authenticateRequest(req)` which discards the return value. Destructure it instead.

- [ ] **Step 2: Fix `api/calibrate.js` — add ownership check**

Read the file first. It accepts `body.persona` and loads the persona. Add:
```js
const { client, isAdmin } = await authenticateRequest(req);
// after loading persona from DB:
if (!isAdmin && persona.client_id !== client?.id) {
  res.status(403).json({ error: "Forbidden" });
  return;
}
```

- [ ] **Step 3: Fix `api/calibrate-feedback.js` — same pattern**

Same as step 2. Read file, find where persona is loaded, add ownership check.

- [ ] **Step 4: Fix `api/feedback.js` — same pattern**

Same pattern. Read file, add ownership check after persona load.

- [ ] **Step 5: Verify all 4 endpoints**

Run a quick scan to confirm no other endpoints accept a `persona` param without ownership check:
```bash
grep -rn "persona" api/*.js | grep -v "client_id\|client\.id\|isAdmin"
```

- [ ] **Step 6: Commit security fixes**

```bash
git add api/config.js api/calibrate.js api/calibrate-feedback.js api/feedback.js
git commit -m "fix: add persona ownership checks to 4 unprotected endpoints"
```

---

### Task 2: Initialize SvelteKit Project

**Files:**
- Create: `svelte.config.js`
- Create: `vite.config.js`
- Modify: `package.json`
- Create: `src/app.html`
- Create: `src/app.css`
- Modify: `vercel.json`

- [ ] **Step 1: Install SvelteKit dependencies**

```bash
npm install --save-dev @sveltejs/kit @sveltejs/adapter-vercel svelte @sveltejs/vite-plugin-svelte vite
```

- [ ] **Step 2: Create `svelte.config.js`**

```js
import adapter from "@sveltejs/adapter-vercel";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      runtime: "nodejs22.x",
    }),
    // Keep /api as serverless functions (not SvelteKit routes)
    // SvelteKit only handles the frontend routes
  },
};

export default config;
```

- [ ] **Step 3: Create `vite.config.js`**

```js
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
});
```

- [ ] **Step 4: Create `src/app.html`**

```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VoiceClone</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>◎</text></svg>">
  %sveltekit.head%
</head>
<body>
  <div id="svelte">%sveltekit.body%</div>
</body>
</html>
```

- [ ] **Step 5: Create `src/app.css` — global design tokens**

Extract CSS custom properties and base reset from current `public/style.css` (lines 1-35). Keep ALL existing tokens (`--accent`, `--bg`, `--surface`, `--border`, `--text`, `--text-secondary`, `--text-tertiary`, `--radius`, etc.). Include body styling, `*` reset, `.hidden` utility, font import. Nothing component-specific.

- [ ] **Step 6: Update `vercel.json` for SvelteKit + API coexistence**

```json
{
  "functions": {
    "api/chat.js": { "maxDuration": 60 },
    "api/clone.js": { "maxDuration": 60 }
  }
}
```

Remove the `rewrites` — SvelteKit adapter handles routing. The `api/` directory stays as Vercel serverless functions (Vercel auto-detects them alongside SvelteKit).

- [ ] **Step 7: Update `package.json` — add scripts**

Add to `package.json`:
```json
{
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

- [ ] **Step 8: Verify SvelteKit boots**

```bash
npm run dev
```

Should start on `localhost:5173`. May show a 404 (no routes yet) — that's fine.

- [ ] **Step 9: Commit scaffold**

```bash
git add svelte.config.js vite.config.js src/app.html src/app.css package.json package-lock.json vercel.json
git commit -m "feat: initialize SvelteKit project alongside existing API"
```

---

## Chunk 2: Core Lib Layer (stores, api, utils)

### Task 3: Auth Store + API Wrapper

**Files:**
- Create: `src/lib/stores/auth.js`
- Create: `src/lib/api.js`

- [ ] **Step 1: Create `src/lib/stores/auth.js`**

Svelte writable stores for `accessCode`, `sessionToken`, `client`, `isAdmin`. Hydrate from localStorage on init. Provide `login(code)` and `logout()` functions. Also store `client` object (returned from `/api/personas`) for ownership context.

```js
import { writable, get } from "svelte/store";

export const accessCode = writable("");
export const sessionToken = writable(null);
export const client = writable(null); // client object from login response
export const isAdmin = writable(false);
export const isHydrated = writable(false); // true after localStorage check completes

// Hydrate from localStorage on module load (runs once)
if (typeof localStorage !== "undefined") {
  const saved = localStorage.getItem("vc_session");
  if (saved) {
    try {
      const { code, token } = JSON.parse(saved);
      if (code) accessCode.set(code);
      if (token) sessionToken.set(token);
    } catch {}
  }
  isHydrated.set(true);
}

// Persist on change
if (typeof localStorage !== "undefined") {
  accessCode.subscribe((c) => {
    const token = get(sessionToken);
    localStorage.setItem("vc_session", JSON.stringify({ code: c, token }));
  });
  sessionToken.subscribe((t) => {
    const code = get(accessCode);
    localStorage.setItem("vc_session", JSON.stringify({ code, token: t }));
  });
}

export function logout() {
  accessCode.set("");
  sessionToken.set(null);
  client.set(null);
  isAdmin.set(false);
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem("vc_session");
    localStorage.removeItem("vc_last_persona");
  }
}
```

- [ ] **Step 2: Create `src/lib/api.js`**

Fetch wrapper that auto-attaches auth headers. Returns parsed JSON or throws.

```js
import { get } from "svelte/store";
import { accessCode, sessionToken, logout } from "./stores/auth.js";

export function authHeaders(extra = {}) {
  const h = { ...extra };
  const token = get(sessionToken);
  const code = get(accessCode);
  if (token) h["x-session-token"] = token;
  else if (code) h["x-access-code"] = code;
  return h;
}

export async function api(path, opts = {}) {
  const resp = await fetch(path, {
    ...opts,
    headers: authHeaders(opts.headers || {}),
  });
  if (resp.status === 401) {
    logout();
    throw { status: 401, error: "Session expired" };
  }
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ error: "Server error" }));
    throw { status: resp.status, ...body };
  }
  return resp.json();
}

// For SSE endpoints, return the raw Response (caller reads the stream)
export async function apiStream(path, opts = {}) {
  const resp = await fetch(path, {
    ...opts,
    headers: authHeaders(opts.headers || {}),
  });
  if (resp.status === 401) {
    logout();
    throw { status: 401, error: "Session expired" };
  }
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ error: "Server error" }));
    throw { status: resp.status, ...body };
  }
  return resp;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/stores/auth.js src/lib/api.js
git commit -m "feat: auth store with localStorage persistence + API wrapper"
```

---

### Task 4: Persona Store + Chat Store + Utils

**Files:**
- Create: `src/lib/stores/persona.js`
- Create: `src/lib/stores/chat.js`
- Create: `src/lib/utils.js`
- Create: `src/lib/sse.js`

- [ ] **Step 1: Create `src/lib/stores/persona.js`**

```js
import { writable } from "svelte/store";

export const currentPersonaId = writable("");
export const personaConfig = writable(null); // { id, name, avatar, title, scenarios, theme }
export const personas = writable([]); // list from /api/personas
export const canCreateClone = writable(false);
```

- [ ] **Step 2: Create `src/lib/stores/chat.js`**

```js
import { writable } from "svelte/store";

export const messages = writable([]); // [{ role: 'user'|'bot', content: '', id }]
export const currentConversationId = writable(null);
export const conversations = writable([]); // sidebar list
export const currentScenario = writable("");
export const sending = writable(false);
```

- [ ] **Step 3: Create `src/lib/utils.js`**

Port `renderMarkdown`, `escapeHtml`, and `getRelativeTime` from current `public/app.js`. These are pure functions, copy directly:

```js
export function renderMarkdown(text) {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^---$/gm, "<hr>")
    .replace(/^[-•] (.+)$/gm, "<li>$1</li>")
    .replace(/^(\d+)[.)]\s+(.+)$/gm, "<li>$2</li>")
    .replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>")
    .replace(/▶/g, "&#9654;").replace(/→/g, "&#8594;")
    .replace(/\n/g, "<br>");
}

export function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function getRelativeTime(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return "il y a " + mins + "m";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return "il y a " + hours + "h";
  const days = Math.floor(hours / 24);
  return "il y a " + days + "j";
}

export function groupByDate(items, dateField = "last_message_at") {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today - 86400000);
  const weekAgo = new Date(today - 7 * 86400000);

  const groups = { "Aujourd'hui": [], "Hier": [], "Cette semaine": [], "Plus ancien": [] };
  for (const item of items) {
    const d = new Date(item[dateField]);
    if (d >= today) groups["Aujourd'hui"].push(item);
    else if (d >= yesterday) groups["Hier"].push(item);
    else if (d >= weekAgo) groups["Cette semaine"].push(item);
    else groups["Plus ancien"].push(item);
  }
  return Object.entries(groups).filter(([, v]) => v.length > 0);
}
```

- [ ] **Step 4: Create `src/lib/sse.js` — SSE client with reconnection**

Port from current streaming logic in `public/app.js` (sendMessage function), add reconnection:

```js
import { authHeaders } from "./api.js";

/**
 * Send a chat message via SSE streaming.
 * @param {object} params - { message, scenario, personaId, conversationId }
 * @param {object} callbacks - { onDelta, onThinking, onRewriting, onClear, onDone, onConversation, onError }
 * @returns {Promise<void>}
 */
export async function streamChat(params, callbacks, retryCount = 0) {
  const MAX_RETRIES = 5;
  const BACKOFF = [1000, 2000, 4000, 8000, 15000];

  try {
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        message: params.message,
        scenario: params.scenario,
        persona: params.personaId,
        conversation_id: params.conversationId || undefined,
      }),
    });

    if (resp.status === 429) { callbacks.onError?.("rate_limit"); return; }
    if (resp.status === 402) { callbacks.onError?.("budget"); return; }
    if (!resp.ok) throw new Error("Server error " + resp.status);

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const evt = JSON.parse(line.slice(6));
          switch (evt.type) {
            case "delta": callbacks.onDelta?.(evt.text); break;
            case "thinking": callbacks.onThinking?.(); break;
            case "rewriting": callbacks.onRewriting?.(evt.attempt || 1); break;
            case "clear": callbacks.onClear?.(); break;
            case "done": callbacks.onDone?.(evt); break;
            case "conversation": callbacks.onConversation?.(evt.id); break;
            case "error": throw new Error("SSE error event");
          }
        } catch (parseErr) {
          if (parseErr.message === "SSE error event") throw parseErr;
        }
      }
    }
  } catch (err) {
    if (retryCount < MAX_RETRIES) {
      const delay = BACKOFF[Math.min(retryCount, BACKOFF.length - 1)];
      callbacks.onError?.("reconnecting", retryCount + 1);
      await new Promise((r) => setTimeout(r, delay));
      return streamChat(params, callbacks, retryCount + 1);
    }
    callbacks.onError?.("failed");
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/persona.js src/lib/stores/chat.js src/lib/utils.js src/lib/sse.js
git commit -m "feat: persona/chat stores, utils, SSE client with reconnection"
```

---

## Chunk 3: Login + Layout + Theme

### Task 5: Global Layout + Auth Guard

**Files:**
- Create: `src/routes/+layout.svelte`
- Create: `src/routes/+layout.js`

- [ ] **Step 1: Create `src/routes/+layout.js` — SPA mode only**

```js
export const ssr = false;
export const prerender = false;
```

No auth guard here — store hydration from localStorage hasn't run yet at `load()` time on hard refresh. Auth guard lives in `+layout.svelte` instead.

- [ ] **Step 2: Create `src/routes/+layout.svelte` — with client-side auth guard**

```svelte
<script>
  import "../app.css";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { accessCode, sessionToken, isHydrated } from "$lib/stores/auth.js";
  import Toast from "$lib/components/Toast.svelte";

  let { children } = $props();

  // Auth guard: redirect to / if not authenticated (except on / itself)
  $effect(() => {
    if (!$isHydrated) return; // wait for localStorage hydration
    if ($page.url.pathname !== "/" && !$accessCode && !$sessionToken) {
      goto("/");
    }
  });
</script>

{#if $isHydrated}
  {@render children()}
{/if}
<Toast />
```

This runs client-side after localStorage hydration, avoiding the race condition.

- [ ] **Step 3: Commit**

```bash
git add src/routes/+layout.svelte src/routes/+layout.js
git commit -m "feat: global layout with SPA mode + auth guard"
```

---

### Task 6: Login Page — Progressive Reveal

**Files:**
- Create: `src/routes/+page.svelte`
- Create: `src/lib/components/PersonaCard.svelte`
- Create: `src/lib/components/ScenarioPill.svelte`
- Create: `src/lib/components/Toast.svelte`

- [ ] **Step 1: Create `src/lib/components/Toast.svelte`**

Simple toast component driven by a writable store. Uses Svelte 5 syntax:

```svelte
<script>
  import { fly } from "svelte/transition";
  import { toastMessage } from "$lib/stores/ui.js";
</script>

{#if $toastMessage}
  <div class="toast" transition:fly={{ y: 20, duration: 200 }}>
    {$toastMessage}
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    bottom: 4.5rem;
    left: 50%;
    transform: translateX(-50%);
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    padding: 0.5rem 1rem;
    border-radius: var(--radius);
    font-size: 0.75rem;
    z-index: 100;
  }
</style>
```

Also create `src/lib/stores/ui.js`:
```js
import { writable } from "svelte/store";

export const toastMessage = writable(null);
let toastTimer;

export function showToast(msg, duration = 3000) {
  clearTimeout(toastTimer);
  toastMessage.set(msg);
  toastTimer = setTimeout(() => toastMessage.set(null), duration);
}
```

- [ ] **Step 2: Create `src/lib/components/PersonaCard.svelte`**

```svelte
<script>
  import { fly } from "svelte/transition";
  let { persona, index = 0, onclick } = $props();
</script>

<button
  class="persona-card"
  transition:fly={{ y: 12, delay: index * 80, duration: 150 }}
  {onclick}
>
  <div class="persona-card-avatar">{persona.avatar}</div>
  <div>
    <strong>{persona.name}</strong>
    <span class="persona-card-title">{persona.title || ""}</span>
  </div>
</button>

<style>
  /* Port .persona-card styles from public/style.css lines 131-184 */
  .persona-card {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.75rem 1rem;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    text-align: left;
    font-family: var(--font);
    color: var(--text);
  }
  .persona-card:hover { border-color: var(--text-tertiary); background: #1f1f23; }
  .persona-card-avatar {
    width: 32px; height: 32px; border-radius: 50%;
    background: var(--border); color: var(--text-secondary);
    display: flex; align-items: center; justify-content: center;
    font-size: 0.6875rem; font-weight: 600; flex-shrink: 0;
  }
  .persona-card strong { font-size: 0.8125rem; font-weight: 500; display: block; }
  .persona-card-title { font-size: 0.6875rem; color: var(--text-tertiary); }
</style>
```

- [ ] **Step 3: Create `src/lib/components/ScenarioPill.svelte`**

```svelte
<script>
  import { fly } from "svelte/transition";
  let { scenario, index = 0, onclick } = $props();
</script>

<button
  class="scenario-pill"
  transition:fly={{ y: 8, delay: index * 60, duration: 150 }}
  {onclick}
>
  <strong>{scenario.label}</strong>
  <span>{scenario.description}</span>
</button>

<style>
  .scenario-pill {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.75rem 1rem;
    text-align: left;
    cursor: pointer;
    width: 100%;
    font-family: var(--font);
    color: var(--text);
    transition: border-color 0.15s, background 0.15s;
  }
  .scenario-pill:hover { border-color: var(--text-tertiary); background: #1f1f23; }
  .scenario-pill strong { font-size: 0.8125rem; font-weight: 500; display: block; margin-bottom: 0.125rem; }
  .scenario-pill span { font-size: 0.6875rem; color: var(--text-tertiary); }
</style>
```

- [ ] **Step 4: Create `src/routes/+page.svelte` — Login with progressive reveal**

This is the main login page. States: `idle` → `personas` → `scenarios`.

Port the logic from `doAccess()`, `showPersonaList()`, and scenario selection in current `app.js`. Key behaviors:
- On mount: auto-focus code input. Check localStorage for last persona → show "Reprendre" shortcut.
- On submit: call `/api/personas` → set personas → transition to persona list.
- On persona click: call `/api/config?persona=ID` → if 1 scenario, navigate to `/chat/[persona]`; if multiple, show scenario pills inline.
- On scenario click: navigate to `/chat/[persona]?scenario=key`.
- "Reprendre" shortcut: on click, fetch `/api/config?persona=ID`. If 200 → navigate to `/chat/[persona]`. If 403/404 → `localStorage.removeItem("vc_last_persona")`, call `showToast("Clone indisponible")`, stay on login. Never navigate without this validation fetch.
- Apply theme from persona config.

The component should use `{#if state === 'idle'}`, `{#if state === 'personas'}`, `{#if state === 'scenarios'}` blocks with Svelte transitions.

Scoped styles: port `.access-card`, `.access-form`, `.subtitle`, `.error`, `.shake` animation from `public/style.css`.

- [ ] **Step 5: Test login flow in browser**

```bash
npm run dev
```

Open `localhost:5173`. Verify:
1. Code input is auto-focused
2. Wrong code → shake + error message
3. Correct code → personas slide in
4. Click persona → scenarios appear (or navigates to chat if single scenario)
5. Theme applies on persona selection

- [ ] **Step 6: Commit**

```bash
git add src/routes/+page.svelte src/lib/components/PersonaCard.svelte src/lib/components/ScenarioPill.svelte src/lib/components/Toast.svelte src/lib/stores/ui.js
git commit -m "feat: login page with progressive reveal + persona/scenario selection"
```

---

## Chunk 4: Chat Page

### Task 7: Chat Layout + Message Rendering

**Files:**
- Create: `src/routes/chat/[persona]/+page.svelte`
- Create: `src/routes/chat/[persona]/+page.js`
- Create: `src/lib/components/ChatMessage.svelte`
- Create: `src/lib/components/ChatInput.svelte`

- [ ] **Step 1: Create `src/routes/chat/[persona]/+page.js` — load persona config**

```js
// ssr = false inherited from +layout.js. Auth guard in +layout.svelte.
export function load({ params, url }) {
  return {
    personaId: params.persona,
    scenario: url.searchParams.get("scenario") || "default",
  };
}
```

- [ ] **Step 2: Create `src/lib/components/ChatMessage.svelte`**

Port `addMessage()` logic from `app.js:408-473`. Handle:
- User messages: plain text, right-aligned
- Bot messages: rendered markdown, left-aligned, copyable blocks
- Transitions: `fly` y:4 + `fade` on mount
- Actions bar (copy, correct) — appears on hover
- Copy per-block for multi-paragraph bot messages

Scoped styles: port `.msg`, `.msg-user`, `.msg-bot`, `.msg-actions`, `.action-btn`, `.copyable-block`, `.block-copy-btn` from `public/style.css`.

- [ ] **Step 3: Create `src/lib/components/ChatInput.svelte`**

Port chat input logic:
- Textarea with auto-resize on input
- Send on Enter (Shift+Enter for newline)
- Send on Cmd/Ctrl+Enter
- Disabled while sending
- Auto-focus on mount

Scoped styles: port `.chat-input-bar`, `#chat-input`, `#chat-send` from `public/style.css`.

- [ ] **Step 4: Create `src/routes/chat/[persona]/+page.svelte`**

Main chat view. On mount:
1. Fetch `/api/config?persona=ID` → populate persona store, apply theme
2. Fetch `/api/conversations?persona=ID` → populate sidebar
3. Show welcome message from scenario config
4. If conversation_id in localStorage → load it

Layout: flex row with sidebar (280px) + chat main area.

Wire up `streamChat()` from `src/lib/sse.js` for sending messages. Handle all SSE events (delta, thinking, rewriting, clear, done, conversation, error) by updating `messages` store reactively.

Smooth scroll: use `element.scrollIntoView({ behavior: 'smooth', block: 'end' })` on new messages instead of `scrollTop`.

Skeleton typing indicator: 3 pulsing lines (port `.typing-indicator` from CSS).

Scoped styles: port `.chat-header`, `.chat-messages`, `.chat-avatar`, `.chat-name`, `.back-btn`, `.lead-btn`, `.settings-btn`, `.typing-indicator`, `.rewrite-badge`, `.score-block` from `public/style.css`.

- [ ] **Step 5: Test basic chat flow**

```bash
npm run dev
```

1. Login → select persona → arrive at `/chat/[persona]`
2. See welcome message
3. Type + send → see typing indicator → see streamed response
4. Copy button works
5. Back button returns to login

- [ ] **Step 6: Commit**

```bash
git add src/routes/chat/ src/lib/components/ChatMessage.svelte src/lib/components/ChatInput.svelte
git commit -m "feat: chat page with SSE streaming + message rendering"
```

---

### Task 8: Conversation Sidebar

**Files:**
- Create: `src/lib/components/ConversationSidebar.svelte`

- [ ] **Step 1: Create `src/lib/components/ConversationSidebar.svelte`**

Port from `renderConversationList()`, `loadConversations()`, sidebar search, new conversation button, rename on double-click, and "Changer de clone" button.

Key behaviors:
- Conversations grouped by date using `groupByDate()` from utils
- Active conversation highlighted
- Double-click title → inline edit input (port `startTitleEdit()`)
- "Nouvelle conversation" button clears messages + resets conversation ID
- "Changer de clone" navigates to `/`
- Search input with 300ms debounce (port current search logic)
- On mobile (< 768px): absolute positioned, slides in from left with `fly` x:-280

Add a context menu (right-click or long-press on mobile) with a "Supprimer" option. On confirm, call `DELETE /api/conversations?id=X` (or implement inline if endpoint exists). Show a confirm toast before deletion.

Props: `{personaId, currentConvId, onSelectConversation, onNewConversation}`

Scoped styles: port `.conv-sidebar`, `.conv-sidebar-header`, `.conv-new-btn`, `.conv-search`, `.conv-list`, `.conv-item`, `.conv-item-title`, `.conv-item-meta`, `.conv-switch-btn`, `.conv-title-edit` from `public/style.css`.

Add mobile toggle: a hamburger button in chat header that sets `sidebarOpen = true`, and clicking outside or selecting a conversation closes it.

- [ ] **Step 2: Integrate sidebar into chat page**

Import and add `<ConversationSidebar>` to `src/routes/chat/[persona]/+page.svelte`. Wire up conversation selection, new conversation, and clone switching.

- [ ] **Step 3: Test sidebar**

1. Conversations load in sidebar
2. Click conversation → loads messages
3. Double-click title → rename
4. "Nouvelle conversation" → clears chat
5. Search works
6. On narrow window → hamburger shows sidebar

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/ConversationSidebar.svelte src/routes/chat/
git commit -m "feat: conversation sidebar with grouping, rename, search"
```

---

## Chunk 5: Modals + Keyboard Shortcuts

### Task 9: Feedback, Settings, Lead Modals

**Files:**
- Create: `src/lib/components/FeedbackModal.svelte`
- Create: `src/lib/components/SettingsModal.svelte`
- Create: `src/lib/components/LeadModal.svelte`

- [ ] **Step 1: Create `src/lib/components/FeedbackModal.svelte`**

Port `openFeedback()` and `openImplicitFeedback()` from `app.js:475-661`.
Two modes: explicit correction + implicit diff.
Svelte modal with `fade` backdrop + `scale` content transitions.
Dispatch to `/api/feedback`.

Scoped styles: port `.feedback-overlay`, `.feedback-modal`, `.feedback-hint`, `.feedback-actions` from CSS.

- [ ] **Step 2: Create `src/lib/components/SettingsModal.svelte`**

Port `openSettings()` from `app.js:502-533`.
Show budget, API key input, save to `/api/settings`.
Same modal pattern.

- [ ] **Step 3: Create `src/lib/components/LeadModal.svelte`**

Port lead scraping from `app.js:972-1054`.
URL input → validate LinkedIn format → call `/api/scrape` → inject lead context into chat input → close modal → auto-send.

- [ ] **Step 4: Wire modals into chat page**

Import all 3 modals into `src/routes/chat/[persona]/+page.svelte`.
- "Corriger" button on messages → opens FeedbackModal
- Settings gear → opens SettingsModal
- Lead button → opens LeadModal

- [ ] **Step 5: Test modals**

1. Click "Corriger" on a bot message → feedback modal opens, submit works
2. Click gear → settings modal opens, API key save works
3. Click lead button → lead modal opens, LinkedIn URL analyzed

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/FeedbackModal.svelte src/lib/components/SettingsModal.svelte src/lib/components/LeadModal.svelte src/routes/chat/
git commit -m "feat: feedback, settings, and lead modals"
```

---

### Task 10: Keyboard Shortcuts + Command Palette

**Files:**
- Create: `src/lib/components/CommandPalette.svelte`
- Modify: `src/routes/chat/[persona]/+page.svelte`

- [ ] **Step 1: Create `src/lib/components/CommandPalette.svelte`**

Cmd+K command palette. Overlay with search input. Searches conversation titles client-side from the conversations store. If >50 items, falls back to API search.

Shows results as a list. Enter or click → load conversation. Escape → close.

Styled as a centered modal with subtle backdrop blur, similar to Linear/Raycast.

- [ ] **Step 2: Add keyboard shortcuts to chat page**

In `src/routes/chat/[persona]/+page.svelte`, add a `svelte:window on:keydown` handler:

```svelte
<svelte:window on:keydown={handleKeyboard} />
```

```js
function handleKeyboard(e) {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key === "n") { e.preventDefault(); newConversation(); }
  if (mod && e.key === "k") { e.preventDefault(); commandPaletteOpen = true; }
  if (mod && e.key === "Enter") { e.preventDefault(); sendMessage(); }
  if (e.key === "Escape") { closeAllModals(); }
}
```

Note: `Cmd+Enter` is also handled in `ChatInput.svelte` for when the textarea has focus. The layout-level handler catches it when focus is elsewhere.

- [ ] **Step 3: Test shortcuts**

1. Cmd+K → palette opens, type to search, Enter selects
2. Cmd+N → new conversation
3. Escape → closes palette/modals

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/CommandPalette.svelte src/routes/chat/
git commit -m "feat: command palette (Cmd+K) + keyboard shortcuts"
```

---

## Chunk 6: Clone Creation Wizard + Calibration

### Task 11: Clone Creation Wizard

**Files:**
- Create: `src/routes/create/+page.svelte`
- Create: `src/lib/components/WizardStep.svelte`

- [ ] **Step 1: Create `src/lib/components/WizardStep.svelte`**

Generic step wrapper with `fly` x-transition for horizontal step movement:

```svelte
<script>
  import { fly } from "svelte/transition";
  let { direction = 1, children } = $props();
</script>

<div
  class="wizard-step"
  in:fly={{ x: direction * 100, duration: 300 }}
  out:fly={{ x: direction * -100, duration: 300 }}
>
  {@render children()}
</div>

<style>
  .wizard-step { width: 100%; }
</style>
```

- [ ] **Step 2: Create `src/routes/create/+page.svelte`**

3-step wizard. Port from current clone creation flow in `app.js:191-366`.

**Step 1 (Source):** LinkedIn URL input with scrape button, or "manual" toggle. On successful scrape, show preview card (name, headline, post count) and auto-advance.

**Step 2 (Review):** Pre-filled textarea for profile, posts (collapsible), optional docs section. "Etape 2/3" progress label.

**Step 3 (Generate):** Single button. On click, call `/api/clone`. Show live status updates. On success, navigate to calibration or chat.

Port file upload logic (`handleFiles`, `extractPdfText`, `extractDocxText`) from `app.js:249-317`.

Use `{#if step === 1}`, `{#if step === 2}`, `{#if step === 3}` with `<WizardStep>` transitions.

Scoped styles: port `.create-container`, `.create-step`, `.scrape-row`, `.btn-secondary`, `.create-divider`, `.file-upload-zone`, `.file-upload-btn`, `.file-tag` from CSS.

- [ ] **Step 3: Test wizard**

1. Navigate to `/create`
2. Step 1: paste LinkedIn URL → scrape → preview card appears → auto-advance
3. Step 2: review pre-filled data, edit, advance
4. Step 3: generate → see progress → success

- [ ] **Step 4: Commit**

```bash
git add src/routes/create/ src/lib/components/WizardStep.svelte
git commit -m "feat: clone creation wizard (3-step with transitions)"
```

---

### Task 12: Calibration Screen

**Files:**
- Create: `src/routes/calibrate/[persona]/+page.svelte`

- [ ] **Step 1: Create calibration page**

Port `startCalibration()`, `renderCalibrateCards()`, and submit logic from `app.js:536-624`.

Shows test messages from `/api/calibrate`, star rating per message, optional correction textarea, submit to `/api/calibrate-feedback`.

On "Skip" or after submit → navigate to `/chat/[persona]`.

Scoped styles: port `.calibrate-container`, `.calibrate-cards`, `.calibrate-card`, `.calibrate-rating`, `.star-btn`, `.calibrate-correction` from CSS.

- [ ] **Step 2: Wire wizard → calibration → chat**

After clone creation success in wizard, navigate to `/calibrate/[persona]`.
After calibration submit, navigate to `/chat/[persona]`.

- [ ] **Step 3: Test full flow**

1. Create clone → auto-navigate to calibration
2. Rate messages → submit → navigate to chat
3. "Skip" → navigate to chat

- [ ] **Step 4: Commit**

```bash
git add src/routes/calibrate/
git commit -m "feat: calibration page with star rating"
```

---

## Chunk 7: Polish + Cleanup + Deploy

### Task 13: Mobile Responsive

**Files:**
- Modify: `src/lib/components/ConversationSidebar.svelte`
- Modify: `src/routes/chat/[persona]/+page.svelte`
- Modify: `src/app.css`

- [ ] **Step 1: Add mobile sidebar toggle**

In chat page, add hamburger button visible at `< 768px`. Sidebar becomes absolute positioned overlay. Clicking a conversation or outside closes it.

- [ ] **Step 2: Mobile chat input**

Ensure chat input stays sticky at bottom on mobile. Test with virtual keyboard in dev tools.

- [ ] **Step 3: Responsive tweaks**

Port media queries from current `public/style.css:1000-1011`. Add any missing breakpoint adjustments.

- [ ] **Step 4: Test at 375px and 768px widths**

Use browser dev tools to verify:
- Login page: centered, readable
- Chat: full-width, sidebar hamburger works
- Wizard: full-width steps
- No horizontal scroll

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/ConversationSidebar.svelte src/routes/chat/ src/app.css
git commit -m "feat: mobile responsive layout"
```

---

### Task 14: Remove Old Frontend + Deploy

**Files:**
- Delete: `public/app.js`
- Delete: `public/index.html`
- Delete: `public/style.css`
- Modify: `vercel.json` (if needed)

- [ ] **Step 1: Verify SvelteKit build works**

```bash
npm run build
```

Should produce `.svelte-kit/output/` without errors.

- [ ] **Step 2: Move old frontend to backup (optional safety net)**

```bash
mkdir -p _old_frontend
mv public/app.js public/index.html public/style.css _old_frontend/
```

- [ ] **Step 3: Test production build locally**

```bash
npm run preview
```

Verify all flows work.

- [ ] **Step 4: Commit + push**

```bash
git add -A
git commit -m "feat: Svelte 5 frontend — remove old vanilla JS"
git push origin master
```

- [ ] **Step 5: Verify Vercel deployment**

After push, check Vercel dashboard. Verify:
- `/` loads login page
- `/api/health` still works (serverless functions intact)
- Chat flow works end-to-end
- Mobile works

---

## Summary

| Chunk | Tasks | What it delivers |
|-------|-------|-----------------|
| 1 | Tasks 1-2 | Security fixes + SvelteKit scaffold |
| 2 | Tasks 3-4 | Core lib (stores, API, SSE, utils) |
| 3 | Tasks 5-6 | Login page with progressive reveal |
| 4 | Tasks 7-8 | Chat page + sidebar |
| 5 | Tasks 9-10 | Modals + keyboard shortcuts |
| 6 | Tasks 11-12 | Clone wizard + calibration |
| 7 | Tasks 13-14 | Mobile + cleanup + deploy |
