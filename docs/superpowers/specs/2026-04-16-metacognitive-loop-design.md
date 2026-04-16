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

New function in `lib/feedback-detect.js` that covers the current gap: long messages (> 150 chars) that don't match any existing regex pattern.

**Trigger conditions:**
- User message > 150 chars
- Does NOT match existing patterns (INSTRUCTION, CORRECTION, VALIDATION, NEGATIVE)
- At least 2 messages in conversation (need context)

**Process:**
1. Send recent exchange (last 10 messages) to Haiku with metacognitive extraction prompt
2. Haiku categorizes: correction, valeur, methodologie, insight_sectoriel, anecdote
3. Each insight saved to `corrections` table with type prefix:
   - `[METHODOLOGIE] Chez Ellipse, la veille se fait AVANT l'appel client`
   - `[VALEUR] Le contenu authentique cree un lien d'amitie avec l'audience`
   - `[INSIGHT] Les millionnaires britanniques migrent vers Dubai/USA pour raisons fiscales`
   - `[ANECDOTE] Histoire de clients qui ont quitte le UK — utilisable pour contenu investissement`
4. Graph extraction via `extractGraphKnowledge` on each insight (entities + relations)
5. Intelligence cache invalidated

**Why `corrections` table:** Corrections are injected at PRIORITY 1 in the system prompt (before scenario, ontology, knowledge). Everything saved there directly influences the bot from the next message onward.

**Type prefixes:** Allow the existing `consolidateCorrections` function to group insights by type. No code change needed in consolidation.

**Cost:** One Haiku call per long message (~$0.001). Does not trigger on short messages (already covered).

### C. Wiring in `chat.js`

Add `detectMetacognitiveInsights` to the existing post-response Promise.all (line 267):

```javascript
await Promise.all([
  detectCoachingCorrection(intellId, message, messages, client),
  detectChatFeedback(intellId, message, messages, client),
  detectMetacognitiveInsights(intellId, message, messages, client),
  (client && result.usage) ? logUsage(...) : null,
]);
```

**No overlap between detection functions:**
- `detectCoachingCorrection`: short messages < 150 chars matching CORRECTION_PATTERN
- `detectChatFeedback`: short messages < 200 chars matching VALIDATION_PATTERN
- `detectMetacognitiveInsights`: messages > 150 chars NOT matching any existing pattern

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
```

## Changes Summary

| Component | File | Change |
|-----------|------|--------|
| Metacognitive prompt | `lib/prompt.js` | Replace PEDAGOGIE & FEEDBACK block (~200 tokens) |
| Insight extraction | `lib/feedback-detect.js` | New `detectMetacognitiveInsights` function + Haiku prompt |
| Wiring | `api/chat.js` | Add call in post-response Promise.all |
| Export | `lib/feedback-detect.js` | Export new function |

**3 files modified, 0 files created.** No DB migration, no new endpoint.

## Success Criteria

1. When Paolo says "la veille se fait avant l'appel" → the bot acknowledges the correction in its response AND a `[METHODOLOGIE]` correction appears in DB
2. When Paolo says "c'est ca qui fait un vrai ami" → the bot highlights this as a core value AND a `[VALEUR]` correction appears in DB
3. In a future conversation, the bot references a past insight to make a connection the client didn't expect
4. No double-saving: short messages handled by existing functions, long messages by the new function
5. No added latency: extraction runs post-response in parallel
