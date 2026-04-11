# VoiceClone — White-Label Text Clone Framework

**Date:** 2026-04-11
**Status:** Approved
**Goal:** Purge all Ahmet-specific branding and rebuild the app from scratch as a generic, configurable text clone framework. Ship a demo-ready product with a fictitious persona ("Alex Renaud") for a video demonstration.

---

## 1. Overview

VoiceClone is a white-label framework that lets anyone create an AI-powered text clone of a person's writing voice. The clone reproduces tone, vocabulary, forbidden words, signature phrases, and domain expertise via a configurable persona system backed by a knowledge base of markdown files.

The app ships with a demo persona ("Alex Renaud", content strategy expert) to demonstrate capabilities in a product demo video.

### What the demo video must show

1. Access screen with code entry
2. Scenario selection (free chat / content audit)
3. Streaming chat with coherent, persona-consistent responses
4. The 3-pass pipeline in action (generation, critique, rewrite)
5. Knowledge base driving domain expertise in responses

---

## 2. Architecture

### File structure

```
voiceclone/
├── api/
│   ├── chat.js              # POST — chat endpoint, SSE streaming
│   ├── config.js             # GET — returns public persona config
│   └── health.js             # GET — health check
├── lib/
│   ├── pipeline.js           # 3-pass: generate → critique → rewrite
│   ├── prompt.js             # Dynamic system prompt builder
│   ├── knowledge.js          # Knowledge base loader (topic detection)
│   ├── sse.js                # SSE stream helpers (keep from existing)
│   └── validate.js           # Input validation (keep from existing)
├── persona/
│   ├── persona.json          # Source of truth: identity, voice, theme, scenarios
│   ├── knowledge/
│   │   ├── concepts/         # Foundational concepts (markdown)
│   │   ├── topics/           # Domain expertise (markdown)
│   │   └── sources/          # Source material (markdown)
│   └── scenarios/
│       ├── default.md        # Free chat instructions
│       └── audit.md          # Content audit instructions
├── public/
│   ├── index.html            # Single-page app (3 screens)
│   ├── app.js                # Client logic (SSE, routing, formatting)
│   └── style.css             # Design system from persona theme
├── eval/
│   ├── run.js                # Test runner
│   ├── checks.js             # Validation functions
│   └── cases/                # Test case JSON files
├── vercel.json
├── package.json
└── README.md
```

### Tech stack

- **Frontend:** HTML5 / CSS3 / Vanilla JavaScript (no framework, no build step)
- **Backend:** Node.js ES modules, Vercel serverless functions
- **AI:** Anthropic Claude API via `@anthropic-ai/sdk`
- **Deployment:** Vercel
- **Streaming:** Server-Sent Events (SSE)

---

## 3. persona.json — Persona definition

Single file that defines a clone. Everything reads from this.

```json
{
  "name": "Alex Renaud",
  "title": "Expert en strategie de contenu & storytelling",
  "avatar": "AR",
  "description": "Aide les entrepreneurs a transformer leur expertise en contenu qui attire des clients.",

  "voice": {
    "tone": ["Direct", "Pedagogique", "Pragmatique"],
    "personality": ["Stratege patient", "Anti-bullshit", "Genereux en frameworks"],
    "signaturePhrases": [
      "Le contenu n'est pas une fin. C'est un filtre.",
      "Si ton audience ne peut pas te resumer en une phrase, t'as un probleme de positionnement."
    ],
    "forbiddenWords": ["game changer", "disruptif", "hacks", "tips", "booster", "mindset"],
    "neverDoes": ["Points d'exclamation excessifs", "Tutoiement non sollicite", "Jargon startup"],
    "writingRules": [
      "Phrases courtes. Paragraphes de 2-3 lignes max.",
      "Toujours illustrer avec un exemple concret.",
      "Poser une question avant de donner un conseil."
    ]
  },

  "scenarios": {
    "default": {
      "label": "Discussion libre",
      "description": "Echangez librement avec {name}",
      "file": "scenarios/default.md"
    },
    "audit": {
      "label": "Audit de contenu",
      "description": "{name} analyse votre strategie de contenu",
      "file": "scenarios/audit.md"
    }
  },

  "theme": {
    "accent": "#2563eb",
    "background": "#0a0a0a",
    "surface": "#141414",
    "text": "#e5e5e5"
  }
}
```

### How persona.json is consumed

- **`/api/config`** returns a sanitized version (no internal paths) for the frontend
- **`lib/prompt.js`** reads `voice.*` fields to construct the system prompt
- **`lib/pipeline.js`** reads `voice.forbiddenWords`, `voice.writingRules`, `voice.neverDoes` for the critic pass
- **`lib/knowledge.js`** reads `scenarios` to resolve scenario file paths
- **`public/app.js`** reads the config response to set name, avatar, theme colors, scenario cards

---

## 4. Backend — 3-pass pipeline

### Endpoint: `POST /api/chat`

**Request:**
```
Headers: x-access-code: <code>
Body: { "message": "string", "history": [...], "scenario": "default" }
```

**Response:** SSE stream with events:
- `text` — response text chunks (pass 1 streaming)
- `critic_start` — critic check has begun
- `critic_done` — critic result (pass/fail + violations)
- `rewrite_start` — rewrite has begun (only if violations)
- `rewrite_text` — rewritten text chunks (pass 3 streaming)
- `done` — generation complete
- `ping` — keep-alive during critic phase

### Pass 1 — Generate

1. `lib/prompt.js` builds the system prompt:
   - Loads persona identity from `persona.json` (name, title, description)
   - Loads voice rules (tone, personality, writing rules, signature phrases, forbidden words)
   - `lib/knowledge.js` detects relevant topics from user message keywords → loads matching markdown files
   - Loads scenario-specific instructions from the scenario markdown file
   - Assembles into a single system prompt
2. Calls Claude API with streaming enabled
3. Streams text chunks to client via SSE as they arrive

### Pass 2 — Critique

1. Takes the complete pass 1 response
2. Builds a critic prompt from `persona.json` rules: forbidden words, writing rules, neverDoes
3. Calls Claude API (non-streaming, fast)
4. Returns structured result: `{ pass: boolean, violations: string[] }`

### Pass 3 — Rewrite (conditional)

1. Only runs if pass 2 found violations
2. Sends the original response + violations to Claude with instructions to fix
3. Streams corrected response to client, replacing the original

### Rate limiting

Keep existing `api/_rateLimit.js` — in-memory, IP-based.

### Access control

`POST /api/chat` and `GET /api/config` require `x-access-code` header matching `ACCESS_CODE` env var.

---

## 5. Frontend — 3-screen SPA

### Screen 1: Access

- Centered card with persona avatar (initials), name, title
- Code input field + enter button
- On valid code → fetch `/api/config` → transition to screen 2
- All persona info fetched dynamically, nothing hardcoded in HTML

### Screen 2: Scenario selection

- Cards for each scenario from config (label + description)
- Click → transition to screen 3 with selected scenario
- If only one scenario exists, auto-skip to chat

### Screen 3: Chat

- Header: avatar + persona name
- Message area: user bubbles right, clone bubbles left
- Input bar at bottom with send button (+ Enter key)
- Streaming: text appears progressively in the clone bubble
- Critic phase: subtle indicator ("Verification...")
- Rewrite: clone bubble content transitions smoothly to corrected version
- Conversation history maintained in memory (sent with each request)

### Design system

- Dark mode by default, colors from `persona.json` theme
- CSS custom properties set dynamically from config:
  - `--accent`, `--bg`, `--surface`, `--text`
- Clean sans-serif typography (system font stack)
- Subtle animations: fade-in messages, typing indicator pulse
- Mobile-first responsive layout
- No VoiceClone branding in the UI — only the persona's identity shows

---

## 6. Demo persona: Alex Renaud

Fictitious but credible persona for the demo video.

### Identity

- **Name:** Alex Renaud
- **Title:** Expert en strategie de contenu & storytelling
- **Background:** 12 ans d'experience, 150+ entrepreneurs accompagnes
- **Style:** Direct, pedagogique, anti-jargon, framework-oriented

### Knowledge base files

1. **`persona/knowledge/topics/strategie-contenu.md`**
   - Content strategy frameworks (PESO model, content flywheel, pillar content)
   - How to build a content system, not just posts
   - Distribution strategy (owned vs earned vs paid)

2. **`persona/knowledge/topics/storytelling.md`**
   - Narrative structure for business content
   - LinkedIn hooks and formats
   - How to transform expertise into stories that convert

3. **`persona/scenarios/default.md`**
   - Free chat rules: ask questions before advising, use concrete examples
   - Stay in character, reference frameworks naturally

4. **`persona/scenarios/audit.md`**
   - Content audit grille: scoring on positioning, regularity, format diversity, engagement, conversion
   - Structured output with scores and recommendations

---

## 7. What gets deleted

Everything Ahmet-specific is removed:

- `knowledge/` entire directory (replaced by `persona/knowledge/`)
- `context/voice-dna.json` (replaced by `persona/persona.json`)
- All transcript source files
- Ahmet references in `package.json`, `README.md`, `public/index.html`
- Existing design specs in `docs/superpowers/specs/` (except this one)
- Hardcoded access code `ahmet99` in eval

## 8. What gets rewritten from scratch

- `public/index.html` — generic markup, reads config dynamically
- `public/app.js` — new client, same SSE logic but clean
- `public/style.css` — design system driven by theme config
- `lib/prompt.js` — loads from `persona/` paths
- `lib/critic.js` → merged into `lib/pipeline.js`
- `api/chat.js` — simplified, uses new pipeline
- `README.md` — framework documentation
- `eval/` — tests adapted to new persona format

## 9. What gets kept (as-is or near as-is)

- `lib/sse.js` — SSE helpers work fine
- `lib/validate.js` — input validation works fine
- `api/_rateLimit.js` — rate limiting works fine
- `vercel.json` — deployment config works fine

---

## 10. Environment variables

- `ACCESS_CODE` — password for API access
- `ANTHROPIC_API_KEY` — Claude API key

No other configuration needed. Everything else lives in `persona/persona.json`.

---

## 11. Success criteria

1. Zero references to "Ahmet", "Akyurek", or any previous branding in the codebase
2. App fully functional with the Alex Renaud demo persona
3. Streaming chat works with visible latency under 1 second to first token
4. Critic pipeline catches forbidden words and rewrites correctly
5. All UI elements (name, avatar, colors, scenarios) driven by persona.json
6. Demo video can show: access → scenario selection → chat → audit → pipeline in action
7. Mobile responsive
8. Deployable to Vercel with zero config beyond env vars
