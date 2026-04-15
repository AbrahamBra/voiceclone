# UX Improvements: Rename Convs, Navigation, Copy Blocks, Lead Scraping

**Date:** 2026-04-15
**Status:** Approved

## Overview

Four targeted UX improvements to the existing VoiceClone chat interface. All changes are in the existing vanilla JS/CSS/HTML stack with no new dependencies.

## 1. Rename Conversations

**Goal:** Let users rename conversation titles in the sidebar.

**Interaction:**
- Double-click on `.conv-item-title` → replaces text node with an `<input>` field, pre-filled with current title
- Enter or blur → saves via `PATCH /api/conversations?id={convId}` with body `{ title }`
- Escape → cancels, restores original text
- Empty/whitespace-only input → reverts to original (no blank titles)
- Optimistic: update sidebar text immediately, revert on error

**Backend (`api/conversations.js`):**
- Update `setCors` to `"GET, PATCH, OPTIONS"`
- Update method guard to allow both GET and PATCH
- PATCH handler: reads `id` from `req.query`, `title` from `req.body`
- Validates: non-empty title, max 100 chars, ownership (`client_id` check)
- Updates `conversations.title` in Supabase

**XSS fix (existing bug, must fix now):**
- `renderConversationList` uses `innerHTML` with raw `conv.title` — XSS vector
- Fix: escape title text before inserting, or use `textContent` instead of `innerHTML` for the title div
- Same escaping applies to search results rendering

**Files:** `api/conversations.js`, `public/app.js`

## 2. Navigation: Back Buttons

**Goal:** Navigate away from chat without reloading the page.

**UI changes:**
- Add back arrow button `←` in `chat-header`, before the avatar
- Click → returns to `screen-scenarios` (scenario selection for current persona), reset `currentScenario`
- Add "Changer de clone" text button in sidebar header, above "Nouvelle conversation"
- Click → shows `screen-access` with persona list visible (call `showScreen("screen-access")` + ensure persona list is shown, NOT the access form — avoid re-authentication)

**State cleanup on back to scenarios:**
- `currentConversationId = null`
- `currentScenario = ""`
- Clear `chat-messages` innerHTML
- Keep localStorage `conv_{personaId}` intact (resume on return)

**State cleanup on "Changer de clone":**
- Same as above plus `currentPersonaId = ""`

**Accessibility:** `aria-label="Retour aux scenarios"` on back button, `aria-label="Changer de clone"` on clone switch button.

**Files:** `public/index.html`, `public/app.js`, `public/style.css`

## 3. Copy Per Block

**Goal:** Copy individual paragraphs and code blocks from bot messages.

**Problem:** Current `renderMarkdown()` produces flat HTML with `<br>` separators — no `<p>` tags, no `<pre><code>` blocks. Block detection needs a different strategy.

**Approach — split on double-breaks:**
- After `renderMarkdown(text)` produces HTML, work on the **raw text** instead for segmentation
- Split `text` on `\n\n` (double newline) to get logical blocks
- For each block, render it individually via `renderMarkdown(block)` and wrap in a `.copyable-block` div
- Each `.copyable-block` gets a small copy button (clipboard icon ⧉) positioned top-right, visible on hover
- Click → `navigator.clipboard.writeText(blockRawText)` (copies the original markdown text of that block, not the HTML)
- Brief "Copie !" tooltip feedback, same 1.5s pattern as existing copy

**Why split on raw text, not HTML:** Avoids parsing regex-generated HTML. The raw text split gives clean blocks that match what the user sees. Each block is independently rendered.

**Existing "Copier" button:** Stays as-is for full-message copy.

**CSS:**
- `.copyable-block` → `position: relative; padding-right: 28px`
- `.block-copy-btn` → `position: absolute; top: 2px; right: 2px; opacity: 0; transition: opacity 0.15s`
- `.copyable-block:hover .block-copy-btn` → `opacity: 0.7`
- Button style: small (20x20), muted color, matches existing `.action-btn` aesthetic

**Files:** `public/app.js` (modify `addMessage`), `public/style.css`

## 4. Lead Scraping (Analyze Prospect)

**Goal:** Scrape a LinkedIn prospect profile and inject context into the conversation so the clone can help craft personalized outreach.

**UI:**
- New button in `chat-header`: icon 🔍 with tooltip "Analyser un lead"
- Click → opens a modal (reuse existing overlay pattern from feedback modal)
- Modal: URL input + "Analyser" button + status text area

**Loading/error states (mirror `scrapeLinkedIn()` pattern):**
- Button disabled + text "Analyse en cours..." during fetch
- On 501 (no API key): "Analyse non disponible"
- On error: show error message in modal status area
- On success: modal closes, context injected

**Frontend URL validation:** Check for `linkedin.com/in/` before calling API. Show inline error if invalid.

**Flow on success:**
1. Receives `{ profile: { name, headline, text }, posts, postCount }` from `POST /api/scrape`
2. Builds a lead context message — **posts first** (opener material), then profile/company:
   ```
   [Contexte lead — {name}]
   
   SUJETS DU MOMENT (priorité pour l'opening) :
   Fréquence de publication : {déduit du postCount: actif/régulier/occasionnel/rare}
   3 derniers posts :
   1. {post1, 250 chars max}
   2. {post2, 250 chars max}
   3. {post3, 250 chars max}
   
   PROFIL :
   Titre: {headline}
   {text (first 500 chars)}
   
   Aide-moi à préparer une approche personnalisée pour ce prospect. Utilise ses sujets récents comme angle d'ouverture.
   ```
3. Sends as a normal user message via the existing `sendMessage()` flow
4. The message gets stored in conversation history (feature, not bug — provides context for follow-up)

**Tradeoffs acknowledged:**
- Lead context counts as a regular message (rate limits, storage) — acceptable for MVP
- The `[Contexte lead]` prefix is a string convention, not enforced by backend — the LLM will still process it naturally given the conversational context
- No `currentLeadContext` variable needed — context lives in conversation history

**No backend changes needed.** Reuses existing `/api/scrape`.

**Files:** `public/index.html` (modal HTML), `public/app.js`, `public/style.css`

## Implementation Order

1. **XSS fix** in `renderConversationList` (prerequisite for feature 1)
2. **Feature 2 — Navigation** (simplest, unblocks testing other features)
3. **Feature 1 — Rename conversations** (PATCH endpoint + inline edit)
4. **Feature 3 — Copy per block** (text splitting + wrapper divs)
5. **Feature 4 — Lead scraping** (modal + existing API reuse)

All 4 features are independent — no shared state between them.
