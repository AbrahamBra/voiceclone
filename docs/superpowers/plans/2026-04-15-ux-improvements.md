# UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 4 UX features: rename conversations, back navigation, copy-per-block, and lead scraping modal.

**Architecture:** All changes are vanilla JS/CSS/HTML edits to existing files. One new PATCH handler added to `api/conversations.js`. Lead scraping reuses existing `/api/scrape` endpoint. No new dependencies.

**Tech Stack:** Vanilla JS, CSS, HTML, Supabase (Postgres), Vercel serverless functions

**Spec:** `docs/superpowers/specs/2026-04-15-ux-improvements-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `api/conversations.js` | Modify | Add PATCH handler for renaming |
| `public/index.html` | Modify | Add back button, clone-switch button, lead modal HTML |
| `public/app.js` | Modify | All 4 features frontend logic |
| `public/style.css` | Modify | Copyable blocks, back button, lead modal styles |

---

## Task 0: XSS Fix in renderConversationList

**Files:**
- Modify: `public/app.js:753-764` (renderConversationList)
- Modify: `public/app.js:836-844` (search results rendering)

This is a prerequisite for Task 2 (rename) since user-editable titles become an XSS vector.

- [ ] **Step 1: Add escapeHtml helper**

Add after `renderMarkdown` function (line 28):

```javascript
function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
```

- [ ] **Step 2: Fix renderConversationList to use textContent**

Replace the `item.innerHTML` line in `renderConversationList` (line 760-761). Switch from innerHTML string concat to DOM creation:

```javascript
function renderConversationList(conversations) {
  const list = $("conv-list");
  list.innerHTML = "";
  for (const conv of conversations) {
    const item = document.createElement("div");
    item.className = "conv-item" + (conv.id === currentConversationId ? " active" : "");
    const titleDiv = document.createElement("div");
    titleDiv.className = "conv-item-title";
    titleDiv.textContent = conv.title || "Sans titre";
    titleDiv.dataset.convId = conv.id;
    const metaDiv = document.createElement("div");
    metaDiv.className = "conv-item-meta";
    metaDiv.textContent = getRelativeTime(conv.last_message_at) + " \u00b7 " + (conv.message_count || 0) + " msg";
    item.appendChild(titleDiv);
    item.appendChild(metaDiv);
    item.addEventListener("click", () => loadConversation(conv.id));
    list.appendChild(item);
  }
}
```

- [ ] **Step 3: Fix search results rendering**

Same pattern for the search results loop at line 836-844. Replace `item.innerHTML` with DOM creation using `textContent`:

```javascript
const item = document.createElement("div");
item.className = "conv-item";
const titleDiv = document.createElement("div");
titleDiv.className = "conv-item-title";
titleDiv.textContent = r.conversation_title || "Sans titre";
const metaDiv = document.createElement("div");
metaDiv.className = "conv-item-meta";
metaDiv.textContent = r.message_content_snippet.slice(0, 80) + "...";
item.appendChild(titleDiv);
item.appendChild(metaDiv);
item.addEventListener("click", () => loadConversation(r.conversation_id));
list.appendChild(item);
```

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "fix: XSS in conversation list rendering — use textContent instead of innerHTML"
```

---

## Task 1: Navigation Back Buttons

**Files:**
- Modify: `public/index.html:86-88` (sidebar header) and `94-97` (chat header)
- Modify: `public/app.js` (add click handlers)
- Modify: `public/style.css` (back button styles)

- [ ] **Step 1: Add back button to chat header in HTML**

In `public/index.html`, replace the `<header class="chat-header">` block (lines 94-97):

```html
<header class="chat-header">
  <button class="back-btn" id="back-btn" aria-label="Retour aux scenarios">&#8592;</button>
  <div class="chat-avatar" id="chat-avatar"></div>
  <span class="chat-name" id="chat-name"></span>
  <button class="lead-btn" id="lead-btn" title="Analyser un lead">&#128269;</button>
  <button class="settings-btn" id="settings-btn" title="Parametres">&#9881;</button>
</header>
```

Note: the lead button is added here but wired in Task 4.

- [ ] **Step 2: Add "Changer de clone" to sidebar header**

In `public/index.html`, replace the sidebar header (lines 86-91):

```html
<aside class="conv-sidebar" id="conv-sidebar">
  <div class="conv-sidebar-header">
    <button class="conv-switch-btn" id="conv-switch-btn" aria-label="Changer de clone">&#8592; Changer de clone</button>
    <button class="conv-new-btn" id="conv-new-btn">+ Nouvelle conversation</button>
    <input type="text" class="conv-search" id="conv-search" placeholder="Rechercher...">
  </div>
  <div class="conv-list" id="conv-list"></div>
</aside>
```

- [ ] **Step 3: Add CSS for back button and switch button**

Append to `public/style.css` before the `@media (max-width: 768px)` rule (before line 907):

```css
.back-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 1.1rem;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius);
  transition: color 0.15s;
  flex-shrink: 0;
}

.back-btn:hover { color: var(--text); }

.conv-switch-btn {
  width: 100%;
  padding: 0.4rem 0.5rem;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-tertiary);
  font-size: 0.75rem;
  cursor: pointer;
  margin-bottom: 0.5rem;
  transition: color 0.15s, border-color 0.15s;
  text-align: left;
}

.conv-switch-btn:hover { color: var(--text-secondary); border-color: var(--text-tertiary); }

.lead-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 0.9rem;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  margin-left: auto;
  transition: color 0.15s;
}

.lead-btn:hover { color: var(--text); }
```

- [ ] **Step 4: Wire back button click handler**

Add in `public/app.js` after the `conv-search` event listener block (after line 847):

```javascript
// Back to scenarios
$("back-btn").addEventListener("click", () => {
  currentConversationId = null;
  currentScenario = "";
  $("chat-messages").innerHTML = "";
  setupScenarios();
  const keys = Object.keys(config.scenarios);
  if (keys.length === 1) {
    // Only one scenario — go to conversation picker instead
    selectPersona(currentPersonaId);
  } else {
    showScreen("screen-scenarios");
  }
});

// Switch clone
$("conv-switch-btn").addEventListener("click", () => {
  currentConversationId = null;
  currentScenario = "";
  currentPersonaId = "";
  $("chat-messages").innerHTML = "";
  showScreen("screen-access");
  // Ensure persona list is visible (not access form)
  const personaList = $("persona-list");
  if (personaList && !personaList.classList.contains("hidden")) {
    // Already visible, good
  } else {
    // Re-trigger persona loading
    doAccess();
  }
});
```

- [ ] **Step 5: Test navigation**

Manual test:
1. Log in → select persona → select scenario → chat screen
2. Click `←` → should return to scenario selection
3. Select scenario again → chat screen
4. Click "Changer de clone" in sidebar → should return to persona list
5. Verify no re-authentication prompt

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/app.js public/style.css
git commit -m "feat: back button and clone-switch navigation in chat"
```

---

## Task 2: Rename Conversations

**Files:**
- Modify: `api/conversations.js:1-6` (CORS + method guard) and add PATCH handler
- Modify: `public/app.js` (inline edit on double-click in renderConversationList)

- [ ] **Step 1: Add PATCH handler to api/conversations.js**

Replace lines 1-6 of `api/conversations.js`:

```javascript
import { authenticateRequest, supabase, setCors } from "../lib/supabase.js";

export default async function handler(req, res) {
  setCors(res, "GET, PATCH, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  // --- PATCH: rename conversation ---
  if (req.method === "PATCH") {
    const { id } = req.query || {};
    const { title } = req.body || {};

    if (!id) { res.status(400).json({ error: "id query param required" }); return; }
    if (!title || !title.trim()) { res.status(400).json({ error: "title required" }); return; }
    const cleanTitle = title.trim().slice(0, 100);

    // Ownership check
    const { data: conv, error: convErr } = await supabase
      .from("conversations").select("id, client_id").eq("id", id).single();
    if (convErr || !conv) { res.status(404).json({ error: "Not found" }); return; }
    if (!isAdmin && conv.client_id !== client.id) { res.status(403).json({ error: "Forbidden" }); return; }

    const { error: updateErr } = await supabase
      .from("conversations").update({ title: cleanTitle }).eq("id", id);
    if (updateErr) { res.status(500).json({ error: updateErr.message }); return; }

    res.json({ ok: true, title: cleanTitle });
    return;
  }

  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
```

The rest of the file (from `const { id, search, persona, before } = req.query || {};` onward) stays unchanged.

- [ ] **Step 2: Add inline edit on double-click in app.js**

Add this function in `public/app.js` after `renderConversationList`:

```javascript
function startTitleEdit(titleDiv, convId) {
  const original = titleDiv.textContent;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "conv-title-edit";
  input.value = original;
  input.maxLength = 100;
  titleDiv.replaceWith(input);
  input.focus();
  input.select();

  async function save() {
    const val = input.value.trim();
    if (!val || val === original) {
      // Revert
      const restored = document.createElement("div");
      restored.className = "conv-item-title";
      restored.textContent = original;
      restored.dataset.convId = convId;
      restored.addEventListener("dblclick", () => startTitleEdit(restored, convId));
      input.replaceWith(restored);
      return;
    }
    // Optimistic update
    const newTitle = document.createElement("div");
    newTitle.className = "conv-item-title";
    newTitle.textContent = val;
    newTitle.dataset.convId = convId;
    newTitle.addEventListener("dblclick", () => startTitleEdit(newTitle, convId));
    input.replaceWith(newTitle);

    try {
      const resp = await fetch("/api/conversations?id=" + convId, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ title: val }),
      });
      if (!resp.ok) {
        // Revert on error
        newTitle.textContent = original;
        showToast("Erreur de renommage");
      }
    } catch {
      newTitle.textContent = original;
      showToast("Erreur de renommage");
    }
  }

  input.addEventListener("blur", save);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    if (e.key === "Escape") { input.value = original; input.blur(); }
  });
}
```

- [ ] **Step 3: Wire double-click in renderConversationList**

In the `renderConversationList` function (from Task 0), add after `titleDiv.dataset.convId = conv.id;`:

```javascript
titleDiv.addEventListener("dblclick", (e) => {
  e.stopPropagation();
  startTitleEdit(titleDiv, conv.id);
});
```

- [ ] **Step 4: Add CSS for inline edit input**

Append to `public/style.css`:

```css
.conv-title-edit {
  width: 100%;
  padding: 0.125rem 0.25rem;
  background: var(--bg);
  border: 1px solid var(--accent);
  border-radius: 4px;
  color: var(--text);
  font-size: 0.85rem;
  font-family: inherit;
  outline: none;
}
```

- [ ] **Step 5: Test rename**

Manual test:
1. Open chat with conversations in sidebar
2. Double-click a conversation title → should show editable input
3. Type new name → Enter → title updates
4. Double-click → type → Escape → reverts to original
5. Double-click → clear → blur → reverts to original
6. Verify network tab shows PATCH request with 200 response

- [ ] **Step 6: Commit**

```bash
git add api/conversations.js public/app.js public/style.css
git commit -m "feat: rename conversations via double-click inline edit"
```

---

## Task 3: Copy Per Block

**Files:**
- Modify: `public/app.js:404-448` (addMessage function)
- Modify: `public/style.css` (copyable block styles)

- [ ] **Step 1: Refactor addMessage to render blocks**

Replace the bot-message rendering in `addMessage` (the `if (role === "bot")` branch). The key change: split `text` on `\n\n`, render each block individually, wrap in `.copyable-block`:

```javascript
function addMessage(role, text) {
  const container = $("chat-messages");
  const div = document.createElement("div");
  div.className = `msg msg-${role}`;
  if (role === "bot") {
    // Split into blocks and render each independently
    const blocks = text.split(/\n\n+/);
    if (blocks.length > 1) {
      for (const block of blocks) {
        if (!block.trim()) continue;
        const wrapper = document.createElement("div");
        wrapper.className = "copyable-block";
        wrapper.innerHTML = renderMarkdown(block);
        const cpBtn = document.createElement("button");
        cpBtn.className = "block-copy-btn";
        cpBtn.textContent = "\u29C9";
        cpBtn.title = "Copier ce bloc";
        cpBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(block);
          cpBtn.textContent = "\u2713";
          setTimeout(() => { cpBtn.textContent = "\u29C9"; }, 1500);
        });
        wrapper.appendChild(cpBtn);
        div.appendChild(wrapper);
      }
    } else {
      div.innerHTML = renderMarkdown(text);
    }

    if (container.children.length > 0) {
      const actions = document.createElement("div");
      actions.className = "msg-actions";

      const copyBtn = document.createElement("button");
      copyBtn.className = "action-btn";
      copyBtn.textContent = "Copier";
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(text);
        copyBtn.textContent = "Copie !";
        lastCopiedMessage = { text, personaId: currentPersonaId };
        const diffLink = div.querySelector(".diff-link");
        if (diffLink) diffLink.classList.remove("hidden");
        setTimeout(() => { copyBtn.textContent = "Copier"; }, 1500);
      });
      actions.appendChild(copyBtn);

      const fb = document.createElement("button");
      fb.className = "action-btn";
      fb.textContent = "Corriger";
      fb.addEventListener("click", () => openFeedback(div, text));
      actions.appendChild(fb);

      div.appendChild(actions);

      const diffLink = document.createElement("a");
      diffLink.className = "diff-link hidden";
      diffLink.href = "#";
      diffLink.textContent = "Tu l'as modifie ? Colle ta version ici";
      diffLink.addEventListener("click", (e) => { e.preventDefault(); openImplicitFeedback(text); });
      div.appendChild(diffLink);
    }
  } else div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}
```

- [ ] **Step 2: Add CSS for copyable blocks**

Append to `public/style.css`:

```css
.copyable-block {
  position: relative;
  padding-right: 28px;
}

.copyable-block + .copyable-block {
  margin-top: 0.5rem;
}

.block-copy-btn {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 22px;
  height: 22px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--text-tertiary);
  font-size: 0.75rem;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, border-color 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.copyable-block:hover .block-copy-btn {
  opacity: 0.7;
  border-color: var(--border);
}

.block-copy-btn:hover {
  opacity: 1 !important;
  color: var(--text-secondary);
}
```

- [ ] **Step 3: Test copy per block**

Manual test:
1. Send a message that produces a multi-paragraph response
2. Hover over a paragraph → small ⧉ button appears top-right
3. Click it → copies just that paragraph, shows ✓
4. "Copier" button still copies full message
5. Single-paragraph responses → no per-block buttons (only one block, no wrapper)

- [ ] **Step 4: Commit**

```bash
git add public/app.js public/style.css
git commit -m "feat: copy individual blocks in bot messages"
```

---

## Task 4: Lead Scraping Modal

**Files:**
- Modify: `public/index.html` (add lead modal HTML)
- Modify: `public/app.js` (lead button handler + scrape + inject)
- Modify: `public/style.css` (already added `.lead-btn` in Task 1)

- [ ] **Step 1: Add lead modal HTML**

In `public/index.html`, add before `<script src="/app.js">` (before line 109):

```html
<!-- Lead analysis modal (hidden, shown via JS) -->
<div id="lead-overlay" class="feedback-overlay" style="display:none">
  <div class="feedback-modal">
    <h3>Analyser un lead</h3>
    <p class="feedback-hint">Collez un profil LinkedIn pour enrichir la conversation.</p>
    <input type="text" id="lead-url" placeholder="linkedin.com/in/username" style="width:100%;padding:0.5rem;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:0.85rem;font-family:inherit;">
    <p id="lead-status" class="scrape-status hidden"></p>
    <div class="feedback-actions">
      <button class="feedback-cancel" id="lead-cancel">Annuler</button>
      <button class="feedback-submit" id="lead-submit">Analyser</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Wire lead button and modal logic**

Add in `public/app.js` after the `conv-switch-btn` handler:

```javascript
// Lead scraping
$("lead-btn").addEventListener("click", () => {
  $("lead-overlay").style.display = "flex";
  $("lead-url").value = "";
  $("lead-status").classList.add("hidden");
  $("lead-status").style.color = "";
  $("lead-submit").disabled = false;
  $("lead-submit").textContent = "Analyser";
  setTimeout(() => $("lead-url").focus(), 100);
});

$("lead-cancel").addEventListener("click", () => { $("lead-overlay").style.display = "none"; });
$("lead-overlay").addEventListener("click", (e) => { if (e.target === $("lead-overlay")) $("lead-overlay").style.display = "none"; });

$("lead-submit").addEventListener("click", async () => {
  const url = $("lead-url").value.trim();
  if (!url) return;

  // Frontend validation
  if (!url.match(/linkedin\.com\/in\/[^/?#]+/)) {
    $("lead-status").textContent = "URL invalide. Format : linkedin.com/in/username";
    $("lead-status").classList.remove("hidden");
    $("lead-status").style.color = "";
    return;
  }

  const btn = $("lead-submit");
  const status = $("lead-status");
  btn.disabled = true;
  btn.textContent = "Analyse en cours...";
  status.textContent = "Recuperation du profil et des posts...";
  status.classList.remove("hidden");
  status.style.color = "";

  try {
    const resp = await fetch("/api/scrape", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ linkedin_url: url }),
    });

    if (resp.status === 501) {
      status.textContent = "Analyse non disponible (scraping non configure)";
      btn.disabled = false; btn.textContent = "Analyser";
      return;
    }
    if (!resp.ok) {
      const err = await resp.json();
      status.textContent = err.error || "Erreur d'analyse";
      btn.disabled = false; btn.textContent = "Analyser";
      return;
    }

    const data = await resp.json();
    const profile = data.profile;

    // Build lead context — posts first (opener material), then profile/company
    const posts = data.posts.slice(0, 3);
    let postSection = "";
    if (posts.length > 0) {
      // Estimate publishing frequency from post count
      const freq = data.postCount >= 10 ? "actif (10+ posts)" :
                   data.postCount >= 5 ? "regulier (5-10 posts)" :
                   data.postCount >= 2 ? "occasionnel (2-4 posts)" : "rare (1 post)";
      postSection = "SUJETS DU MOMENT (priorite pour l'opening) :\n" +
        "Frequence de publication : " + freq + "\n" +
        "3 derniers posts :\n" +
        posts.map((p, i) => (i + 1) + ". " + p.slice(0, 250)).join("\n\n");
    }

    const leadMsg = [
      "[Contexte lead — " + profile.name + "]",
      postSection,
      "PROFIL :\nTitre: " + profile.headline + "\n" + profile.text.slice(0, 500),
      "Aide-moi a preparer une approche personnalisee pour ce prospect. Utilise ses sujets recents comme angle d'ouverture.",
    ].filter(Boolean).join("\n\n");

    // Close modal
    $("lead-overlay").style.display = "none";

    // Inject as user message and send
    $("chat-input").value = leadMsg;
    sendMessage();

  } catch {
    status.textContent = "Erreur de connexion";
    btn.disabled = false;
    btn.textContent = "Analyser";
  }
});
```

- [ ] **Step 3: Test lead scraping**

Manual test:
1. Click 🔍 in chat header → modal opens
2. Enter invalid URL → "URL invalide" error
3. Enter valid LinkedIn URL → "Analyse en cours..." → modal closes → message injected → bot responds with personalized advice
4. Click overlay backdrop → modal closes
5. Click "Annuler" → modal closes

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat: lead scraping modal — analyze LinkedIn prospects in chat"
```

---

## Task 5: Final Integration Test

- [ ] **Step 1: Full flow test**

Start dev server and test all 4 features together:
1. Log in → select persona → enter chat
2. Send a few messages → verify sidebar populates
3. Double-click conversation title → rename → verify persists on reload
4. Click ← back → verify scenario screen → re-enter chat → conversation still there
5. Click "Changer de clone" → verify persona list → select same persona → conversations visible
6. Send message → hover bot response → verify per-block copy buttons work
7. Click 🔍 → enter LinkedIn URL → verify lead context injected and bot responds

- [ ] **Step 2: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration fixes from full flow test"
```
