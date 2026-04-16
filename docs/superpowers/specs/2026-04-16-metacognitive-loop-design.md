# Metacognitive Loop — Design Spec

**Date:** 2026-04-16
**Status:** Approved
**Files:** `lib/prompt.js`, `lib/feedback-detect.js`, `api/chat.js`

## Problem

The bot is purely reactive — it only learns when the user explicitly corrects it via short messages matching regex patterns. It misses:

1. **Long messages** rich in methodology, values, and industry insights (e.g., Paolo explaining Ellipse's process in 900+ chars)
2. **Emotional/philosophical statements** the client makes about their vision (e.g., "c'est ca qui fait un vrai ami")
3. **The bot never verbalizes learning** — corrections are saved silently, the client doesn't know the bot is getting smarter
4. **No proactive "teacher" behavior** — the bot never connects past insights to current topics

## Solution: Approach 1 — Prompt-first + Post-response Extraction

Two complementary mechanisms:

### A. System Prompt — Metacognitive Instructions

Replace the current `PEDAGOGIE & FEEDBACK` block in `lib/prompt.js` (lines 71-74) with a richer metacognitive block (~200 tokens).

The bot is instructed to detect 5 types of insights during conversation:

| Type | Signal | Bot Reaction | Save |
|------|--------|-------------|------|
| **Correction factuelle** | Client corrects an error | "Merci pour cette precision, je n'avais pas integre que [X]. Je le retiens." | Auto + verbalize |
| **Valeur/philosophie** | Client expresses a deep conviction | "Ce que tu dis la est cle — [reformulation]. Tu veux que je l'integre ?" | Ask confirmation |
| **Methodologie** | Client describes a process | "Interessant — [reformulation]. Je le note." | Auto + verbalize |
| **Insight sectoriel** | Market observation/trend | Acknowledge and connect to existing knowledge | Auto, verbalize if strong |
| **Anecdote/histoire** | Client shares a personal story | "Cette histoire est top, je la garde pour enrichir du contenu." | Auto + verbalize |

**Verbalization rule:** The bot does NOT say "je retiens" on every message. Only for significant insights. Minor insights are captured silently by the post-response extraction.

**Teacher behavior:** The prompt instructs the bot to proactively use accumulated knowledge (entities + corrections) to propose connections, recall past insights, and positively surprise the client.

### B. Post-response Extraction — `detectMetacognitiveInsights`

New function in `lib/feedback-detect.js` that covers the current gap: long messages (> 200 chars) that don't match any existing regex pattern.

**Trigger conditions:**
- User message > 200 chars (above ALL existing pattern thresholds: CORRECTION < 150, VALIDATION < 200, NEGATIVE < 200)
- Does NOT match any of the 4 existing patterns: INSTRUCTION_PATTERN, CORRECTION_PATTERN, VALIDATION_PATTERN, NEGATIVE_PATTERN
- At least 2 messages in conversation (need context)
- Note: messages 150-500 chars matching INSTRUCTION_PATTERN are handled by `detectDirectInstruction` which short-circuits before the pipeline. If the short-circuit fails and falls through to the normal pipeline, the 200-char minimum + pattern exclusion prevents double-processing.

**Process:**
1. Send recent exchange to Haiku with structured input: CONTEXT (last 8 messages) separated from TARGET MESSAGE (current user message)
2. Haiku categorizes: correction, valeur, methodologie, insight_sectoriel, anecdote
3. Each insight saved to `corrections` table:
   - `correction` column: type-prefixed rule, e.g. `[METHODOLOGIE] Chez Ellipse, la veille se fait AVANT l'appel client`
   - `user_message` column: the context excerpt from Haiku extraction (max 200 chars)
   - `bot_message` column: `[metacognitive-extraction]` marker
4. Graph extraction via `extractGraphKnowledge` on each insight (entities + relations)
5. Intelligence cache invalidated via `clearIntelligenceCache`

**Type prefix examples:**
- `[METHODOLOGIE] Chez Ellipse, la veille se fait AVANT l'appel client`
- `[VALEUR] Le contenu authentique cree un lien d'amitie avec l'audience`
- `[INSIGHT] Les millionnaires britanniques migrent vers Dubai/USA pour raisons fiscales`
- `[ANECDOTE] Histoire de clients qui ont quitte le UK — utilisable pour contenu investissement`

**Why `corrections` table:** Corrections are injected at PRIORITY 1 in the system prompt (before scenario, ontology, knowledge). Everything saved there directly influences the bot from the next message onward.

**Type prefixes and consolidation:** The existing `consolidateCorrections` function groups by word overlap (>60% similarity), not by type prefix. Corrections with the same prefix will tend to cluster together naturally because they share the prefix word. No code change needed in consolidation, but this is a natural clustering, not an explicit type-based grouping.

**Deduplication:** The function receives the bot's response text as a parameter. The Haiku prompt includes the bot's response so it can skip insights the bot already explicitly acknowledged/verbalized. This prevents saving duplicates when the bot already said "Je retiens que la veille se fait avant l'appel."

**Cost:** One Haiku call per long message (~$0.001). Does not trigger on short messages (already covered by existing functions).

### C. Wiring in `chat.js`

Add `detectMetacognitiveInsights` to the existing post-response Promise.all (lines 267-271).

**Important:** The post-response block runs AFTER `res.end()` (line 263). The existing code already `await`s the Promise.all to prevent Vercel from killing the function. The new Haiku call adds ~1-2s to the post-response block, which is acceptable since it runs in parallel with the existing detectors and the total post-response time is bounded by the slowest call (typically ~2-3s).

```javascript
await Promise.all([
  detectCoachingCorrection(intellId, message, messages, client),
  detectChatFeedback(intellId, message, messages, client),
  detectMetacognitiveInsights(intellId, message, messages, result.text, client),
  (client && result.usage) ? logUsage(...) : null,
]);
```

Note: `result.text` (the bot's response) is passed to `detectMetacognitiveInsights` for deduplication.

**Import update:** Add `detectMetacognitiveInsights` to the named imports from `../lib/feedback-detect.js` at line 8 of `api/chat.js`.

**No overlap between detection functions:**
- `detectCoachingCorrection`: messages < 150 chars matching CORRECTION_PATTERN
- `detectChatFeedback`: messages < 200 chars matching VALIDATION_PATTERN
- `detectDirectInstruction`: messages < 500 chars matching INSTRUCTION_PATTERN (short-circuits before pipeline)
- `detectNegativeFeedback`: messages < 200 chars matching NEGATIVE_PATTERN (short-circuits before pipeline)
- `detectMetacognitiveInsights`: messages > 200 chars NOT matching any of the 4 patterns above

**Short-circuit fall-through:** If `detectDirectInstruction` or `detectNegativeFeedback` fail and fall through to the normal pipeline, the new function's 200-char minimum + pattern exclusion guards prevent double-processing.

### D. Haiku Extraction Prompt

```
Tu analyses un message d'un client qui utilise son clone vocal IA.
Extrais TOUS les enseignements implicites que le clone devrait retenir.

Types d'enseignements :
- correction : le client corrige une erreur factuelle ou methodologique
- valeur : le client exprime une conviction/philosophie profonde
- methodologie : le client decrit un processus ou une facon de faire
- insight_sectoriel : observation sur le marche/secteur
- anecdote : histoire personnelle ou de clients, utilisable dans du contenu

Reponds en JSON :
{
  "has_insights": true/false,
  "insights": [
    { "type": "methodologie", "rule": "description concise et actionnable", "context": "extrait du message" },
    { "type": "valeur", "rule": "...", "context": "..." }
  ]
}

IMPORTANT :
- Extrais UNIQUEMENT ce qui enrichit la connaissance du clone sur le client
- Les insights doivent etre actionnables (utilisables dans de futures generations)
- Si le message est juste une instruction de travail banale, reponds {"has_insights": false}
- Prefere la qualite : 1-2 insights forts > 5 insights vagues
- Si le bot a DEJA mentionne un insight dans sa reponse, ne le re-extrais pas
```

**Structured input format (user message to Haiku):**
```
CONTEXTE (messages precedents) :
[last 8 messages formatted as USER:/BOT:]

---

MESSAGE A ANALYSER :
"[current user message]"

---

REPONSE DU BOT (pour eviter les doublons) :
"[bot response text, max 300 chars]"
```

### E. Function Pattern

`detectMetacognitiveInsights` follows the same pattern as existing detectors in `feedback-detect.js`:
1. Guard clauses (length, pattern exclusion)
2. Anthropic client init from `getApiKey(client)`
3. `Promise.race` with 10s timeout
4. JSON extraction from response
5. For each insight: `supabase.from("corrections").insert(...)` + `extractGraphKnowledge(...)`
6. `clearIntelligenceCache(intellId)`
7. Structured logging with `console.log(JSON.stringify({...}))`

## Changes Summary

| Component | File | Change |
|-----------|------|--------|
| Metacognitive prompt | `lib/prompt.js` | Replace PEDAGOGIE & FEEDBACK block (~200 tokens) |
| Insight extraction | `lib/feedback-detect.js` | New exported `detectMetacognitiveInsights` function + Haiku prompt |
| Wiring + import | `api/chat.js` | Add import + call in post-response Promise.all with `result.text` |

**3 files modified, 0 files created.** No DB migration, no new endpoint.

## Success Criteria

1. When Paolo says "la veille se fait avant l'appel" → the bot acknowledges the correction in its response AND a `[METHODOLOGIE]` correction appears in DB
2. When Paolo says "c'est ca qui fait un vrai ami" → the bot highlights this as a core value AND a `[VALEUR]` correction appears in DB
3. In a future conversation, the bot references a past insight to make a connection the client didn't expect
4. No double-saving: short messages handled by existing functions, long messages (> 200 chars) by the new function, with pattern exclusion as guard
5. No added latency: extraction runs post-response in parallel
6. Bot response passed to Haiku for deduplication — insights already verbalized by the bot are not re-extracted
