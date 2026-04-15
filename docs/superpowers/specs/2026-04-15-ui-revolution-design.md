# UI Revolution — Svelte 5 Rewrite

**Date:** 2026-04-15
**Status:** Draft
**Goal:** Rewrite the VoiceClone frontend in Svelte 5 for a fast, fluid, premium UX. Desktop-first, mobile-ready. Target users: solopreneurs, cofounders, setters who use this daily.

---

## 1. Security: Client Isolation (Critical)

### Problem
`/api/config?persona=UUID` authenticates but doesn't verify the persona belongs to the requesting client. A client could load another client's clone config by guessing the UUID.

### Fix — Affected Endpoints (exhaustive list)

All endpoints below accept a `persona` param but do NOT verify ownership. Each needs:
```js
const { client, isAdmin } = await authenticateRequest(req);
// after loading persona:
if (!isAdmin && persona.client_id !== client.id) {
  return res.status(403).json({ error: "Forbidden" });
}
```

| Endpoint | Param source | Currently checks ownership? |
|----------|-------------|---------------------------|
| `api/config.js` | `query.persona` | NO |
| `api/calibrate.js` | `body.persona` | NO |
| `api/calibrate-feedback.js` | `body.persona` | NO |
| `api/feedback.js` | `body.persona` | NO |
| `api/chat.js` | `body.persona` | YES (via conversation) |
| `api/conversations.js` | `query.persona` | YES (`client_id` filter) |
| `api/clone.js` | N/A (creates new) | YES (`client_id` on insert) |

Fix the 4 NO endpoints before the Svelte migration.

---

## 1b. Auth Guards & Route Protection

**Problem:** SvelteKit routes are directly navigable. A user hitting `/chat/some-uuid` without auth must be redirected.

**Solution:** SvelteKit layout load function in `+layout.js`:
- On every navigation, check if `auth` store has a valid session token
- If not, redirect to `/` (login screen)
- The `auth` store hydrates from `localStorage` on app init (session token + access code)
- If a stored session token returns 401, clear it and redirect to `/`

**localStorage invalidation:**
- "Reprendre avec [Name]" shortcut fetches `/api/config?persona=ID` on click
- If 403/404 → clear stored persona, show toast "Clone indisponible", stay on login
- Never auto-navigate based on stale localStorage without a validation fetch

---

## 2. Tech Stack

- **Svelte 5** with SvelteKit (Vercel adapter)
- **Routing:** SvelteKit file-based (`/`, `/chat/[persona]`, `/create`)
- **Styling:** Keep current CSS design tokens (dark Linear aesthetic), migrate to Svelte scoped styles
- **API:** Keep existing `/api/*.js` Vercel serverless functions unchanged
- **Build:** Vite (via SvelteKit), deployed as Vercel project
- **No new dependencies** beyond SvelteKit ecosystem

### Migration Strategy
Incremental: build the Svelte app alongside existing `public/`, swap when ready. API layer stays untouched.

---

## 3. UX Overhaul: 3 Axes

### 3.1 Instant Entry (4 clicks → 1)

**Current flow:** Access screen → type code → click Enter → see personas → click persona → see scenarios → click scenario → chat

**New flow:** Single-screen progressive reveal

1. User lands on `/` — sees code input, nothing else
2. Types code, hits Enter → personas slide in below (no page change)
3. Clicks persona → if single scenario, go straight to `/chat/[persona]`; if multiple, scenarios expand inline as pills/tabs
4. Total: type + 1 click (or type + 2 clicks with multiple scenarios)

**Implementation:**
- Single Svelte component `Login.svelte` with reactive state: `idle` → `personas` → `scenarios`
- CSS transitions between states (`slide`, `fade`)
- Auto-focus on code input on mount
- Remember last persona in `localStorage` — show "Reprendre avec [Name]" shortcut

### 3.2 Premium Chat Experience

**Layout:** Two-column on desktop (sidebar + chat), full-screen chat on mobile with slide-out sidebar.

**Streaming improvements:**
- Token-by-token rendering with cursor blink animation
- Smooth scroll-to-bottom using `scrollIntoView({ behavior: 'smooth' })` instead of jumpy `scrollTop`
- Skeleton placeholder (3 pulsing lines) while waiting for first token

**SSE reconnection spec:**
- On network drop: retry with exponential backoff (1s, 2s, 4s, 8s, max 15s)
- Max 5 retries per message, then show error: "Connexion perdue. Réessayer?"
- Retry restarts the full message (no mid-stream resume — server doesn't support it)
- User sees a subtle "Reconnexion..." label on the typing indicator during retries
- On success after retry: clear error state, continue normally

**Interactions:**
- `Cmd/Ctrl+N` — new conversation
- `Cmd/Ctrl+K` — search conversations (command palette style, searches by title client-side from already-loaded list; if >50 convos, falls back to `/api/conversations?search=` API call)
- `Cmd/Ctrl+Enter` — send message
- `Escape` — close modals/sidebar
- Textarea auto-resize with shift+enter for newlines (keep current behavior)

**Message rendering:**
- Keep copyable blocks with hover-reveal copy buttons
- Add subtle fade-in animation per message
- Typing indicator with smoother animation (current is good, keep)
- "Corrected automatically" badge stays

**Sidebar:**
- Slide-in/out on mobile (swipe gesture or hamburger)
- Conversations grouped by date (Aujourd'hui, Hier, Cette semaine, Plus ancien)
- Active conversation highlighted
- Double-click to rename (keep current behavior)
- Right-click or long-press for delete option

### 3.3 Clone Creation Wizard

**Current:** One long form with all fields visible. Overwhelming.

**New:** Step-by-step wizard with transitions.

**Step 1 — Source** (one screen)
- Big CTA: "Coller une URL LinkedIn" with auto-scrape
- Or: "Remplir manuellement" as secondary option
- When URL pasted and scraped: show preview card of the person (name, headline, post count) with success animation
- Auto-advance to step 2

**Step 2 — Review & enrich** (one screen)  
- Pre-filled profile textarea (editable)
- Pre-filled posts (editable, collapsible)
- Optional: "Ajouter des documents" expandable section
- Progress indicator: "Etape 2/3"

**Step 3 — Generate** (one screen)
- Single "Generer" button
- Live progress: "Analyse du style..." → "Extraction des patterns..." → "Création du clone..."
- On success: animated transition to calibration or directly to chat

---

## 3b. Error States

Every user-facing action has an error state. No silent failures.

| Action | Error | User sees |
|--------|-------|-----------|
| Login (wrong code) | 403 | Input shakes + "Code invalide" (current behavior, keep) |
| Login (server down) | Network error | "Serveur indisponible, réessayez" below input |
| Load persona config | 403/404 | Toast "Clone indisponible" + stay on persona list |
| Load conversations | Any error | Sidebar shows "Erreur de chargement" with retry link |
| Send message | 429 | Toast "Trop de messages, patientez" (current, keep) |
| Send message | 402 | Inline message "Budget dépassé" with settings link (current, keep) |
| Send message | 500/network | "Connexion perdue" with "Réessayer" button (current, keep) |
| Clone creation scrape | 501 | "Scraping non disponible" (current, keep) |
| Clone creation scrape | Other error | Show error message from API |
| Clone generation | 402/403 | Show specific error, re-enable button |
| Clone generation | 500 | "Erreur de génération, réessayez" |
| Calibration | Any error | "Calibration indisponible. Vous pouvez passer." (current, keep) |
| Rename conversation | Fail | Revert to original title + toast |

---

## 4. Component Architecture

```
src/
├── routes/
│   ├── +page.svelte              # Login + persona selection
│   ├── +layout.svelte            # Global layout, theme provider
│   ├── chat/
│   │   └── [persona]/
│   │       └── +page.svelte      # Chat view
│   └── create/
│       └── +page.svelte          # Clone creation wizard
├── lib/
│   ├── stores/
│   │   ├── auth.js               # accessCode, sessionToken, client
│   │   ├── persona.js            # currentPersona, config
│   │   └── chat.js               # messages, conversations, sending state
│   ├── api.js                    # Fetch wrapper with auth headers
│   ├── sse.js                    # SSE streaming with reconnection
│   └── utils.js                  # renderMarkdown, escapeHtml, relativeTime
├── components/
│   ├── ChatMessage.svelte        # Single message (user or bot)
│   ├── ChatInput.svelte          # Textarea + send button
│   ├── ConversationSidebar.svelte
│   ├── PersonaCard.svelte
│   ├── ScenarioPill.svelte
│   ├── WizardStep.svelte
│   ├── FeedbackModal.svelte
│   ├── LeadModal.svelte
│   ├── SettingsModal.svelte
│   ├── CommandPalette.svelte     # Cmd+K search
│   └── Toast.svelte
└── app.css                       # Global tokens (--accent, --bg, etc.)
```

---

## 5. Transitions & Animations

All using Svelte's built-in transition system:

| Element | Transition | Duration |
|---------|-----------|----------|
| Screen changes | `fly` (y: 8px) + `fade` | 200ms |
| Persona cards appearing | `fly` (y: 12px) staggered | 150ms each |
| Messages appearing | `fly` (y: 4px) + `fade` | 120ms |
| Sidebar slide (mobile) | `fly` (x: -280px) | 250ms |
| Modals | `fade` backdrop + `scale` content | 150ms |
| Toast | `fly` (y: 20px) + `fade` | 200ms |
| Wizard steps | `fly` (x: ±100%) crossfade | 300ms |
| Typing cursor | CSS `blink` | 500ms |

---

## 6. Mobile Adaptations

- **Breakpoint:** 768px
- **Sidebar:** Hidden by default, slide-in via hamburger button in chat header (no swipe gesture in v1)
- **Chat input:** Sticky to bottom, respects virtual keyboard
- **Clone wizard:** Full-width steps, larger touch targets
- **Persona selection:** Cards stack vertically (already the case)
- **No horizontal scrolling anywhere**

---

## 7. Performance Targets

- **First paint:** < 500ms (Svelte compiles to minimal JS)
- **Bundle size:** < 50KB gzipped (current vanilla is ~15KB uncompressed)
- **SSE latency:** Same as current (no framework overhead on streaming)
- **Lighthouse performance:** 90+ on `/` (login page, desktop, no throttling). Chat page is SSE-heavy so Lighthouse is less meaningful there.

---

## 8. What Stays the Same

- All `/api/*.js` endpoints — zero changes
- Dark Linear aesthetic (CSS tokens)
- Supabase backend
- SSE streaming protocol
- Feedback/correction flow
- Calibration flow
- Lead scraping modal

---

## 9. What Changes

| Before | After |
|--------|-------|
| Single `app.js` (1000 lines) | ~15 focused Svelte components |
| `public/index.html` with all screens | SvelteKit routes |
| CSS in single `style.css` | Scoped styles per component + global tokens |
| No transitions | Native Svelte transitions everywhere |
| 4 clicks to chat | 1-2 clicks to chat |
| Sidebar hidden on mobile | Slide-in sidebar on mobile |
| No keyboard shortcuts | Cmd+N, Cmd+K, Cmd+Enter |
| Hard page refreshes lose state | SvelteKit SPA navigation preserves state |
| No command palette | Cmd+K for conversation search |

---

## 10. Out of Scope

- Backend changes (except config.js security fix)
- New features (voice, images, etc.)
- Authentication overhaul (keep access codes)
- Database schema changes
- i18n (stays French-only for now)
