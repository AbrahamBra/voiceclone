# Intelligence Auto-Adaptive — Design Spec

## Problem

The correction consolidation pipeline (greedy clustering → Haiku synthesis → writingRules promotion) has 5 structural weaknesses that prevent true auto-adaptive learning:

1. **No backtest**: promoted rules that degrade fidelity stay forever
2. **Fixed clustering threshold** (0.75): wrong for both "dry" and "verbose" personas
3. **Blind synthesis**: Haiku abstracts operational rules ("5-15 words") into vague directives
4. **Naive graph walk**: BFS ignores relation types, no hub penalty, no cycle awareness
5. **No inline fidelity guard**: generated messages aren't checked against persona signature

## Solution: 5 Independent Modules

All changes are surgical edits to existing files. No new services, no new DB tables.

---

### Module 1: Composite Fidelity Score + Auto-Backtest

**File**: `lib/fidelity.js` (extend), `lib/correction-consolidation.js` (modify)

**Style metrics** (extracted from both source posts and generated drafts):
- `avgSentenceLength`: average word count per sentence
- `questionRatio`: fraction of sentences ending with `?`
- `signaturePresence`: fraction of persona signaturePhrases found
- `forbiddenHits`: count of forbidden words (should always be 0)

**Composite score formula**:
```
composite = 0.70 * rescaleScore(cosine_sim) + 0.30 * styleScore
styleScore = weighted average of:
  - sentenceLengthSim: 1 - |avgLen_source - avgLen_draft| / avgLen_source  (30%)
  - questionRatioSim: 1 - |qRatio_source - qRatio_draft|                  (25%)
  - signatureScore: signaturePresence in draft                              (25%)
  - forbiddenClean: forbiddenHits === 0 ? 1.0 : 0.0                       (20%)
```

**Backtest flow in consolidation**:
1. Before promoting rules: `scoreBefore = calculateFidelityScore(personaId)`
2. Promote rules + persist writingRules
3. After promoting: `scoreAfter = calculateFidelityScore(personaId)`
4. If `scoreAfter.score_global - scoreBefore.score_global < -5`: call `revertConsolidation()` for each promoted rule, log `auto-reverted`
5. If fidelity unavailable (no Voyage key, < 3 chunks): skip backtest, promote anyway

**Cost**: ~$0.05 extra per consolidation (max 1/day). Acceptable.

---

### Module 2: Adaptive Clustering Threshold

**File**: `lib/correction-consolidation.js` (modify `clusterCorrections`)

**Logic**:
1. Compute pairwise cosine similarities for all correction embeddings
2. Calculate median and standard deviation of the distribution
3. Adaptive threshold = `clamp(median - 0.8 * stddev, 0.65, 0.85)`
4. Use this threshold instead of the fixed 0.75
5. Cache result in-memory (same 5-min TTL as persona cache)

**Fallback**: if < 5 corrections (insufficient for statistics), use 0.75 default.

---

### Module 3: Typed Synthesis (Operational vs Abstract)

**File**: `lib/correction-consolidation.js` (modify `synthesizeCluster`)

**Updated Haiku prompt**:
```
Tu consolides des corrections de style d'un clone vocal IA.

REGLE CRITIQUE : Si une correction contient un chiffre, une longueur, un format,
une contrainte exacte, un pattern precis, ou un mot-cle technique
→ c'est OPERATIONNEL. Conserve les chiffres et contraintes TELS QUELS.
Exemples : "5-15 mots max", "style WhatsApp", "tutoyer par defaut"

Sinon → c'est ABSTRAIT. Reformule en une regle de ton/attitude concise.

Synthetise les corrections en UNE regle. Max 30 mots. Regle seule, pas d'explication.
```

No code structure change. Same function signature, same flow.

---

### Module 4: Weighted Graph Walk

**File**: `lib/knowledge-db.js` (modify `findRelevantEntities`)

**Relation type weights**:
```javascript
const RELATION_WEIGHTS = {
  enforces: 1.0,   uses: 1.0,    prerequisite: 1.0,
  includes: 0.7,   equals: 0.7,  causes: 0.5,
  contradicts: 0.0  // exclude contradictory neighbors
};
```

**Hub penalty**: max 3 1-hop neighbors per direct entity (prevents hub entities from flooding context).

**Cycle awareness**: track visited IDs across both hops — an entity reached via hop-1 is never re-added via hop-2.

---

### Module 5: Inline Fidelity Guard

**File**: `lib/fidelity.js` (new export), `lib/pipeline.js` (modify `runPipeline`)

**Persona centroid**: pre-computed mean of all linkedin_post chunk embeddings. Cached 1 hour (separate from 5-min persona cache since posts change rarely).

**Guard flow** (inserted between PASS 1 and PASS 2 in pipeline):
1. If centroid available and embedding service up:
   - Embed the generated text (1 Voyage call, ~100ms)
   - Compute cosine similarity vs persona centroid
   - If sim < adaptive threshold (same as clustering): add `fidelity_drift` as a **strong** violation (flag, no auto-rewrite — the existing checks handle hard violations)
2. If centroid unavailable: skip silently (graceful degradation)

**Why strong, not hard**: the inline guard flags drift as information. The rewrite mechanism already handles forbidden words/self-reveal. Adding another auto-rewrite layer would compound latency and risk style collapse. The flag is surfaced in the SSE `done` event so the admin dashboard can track drift over time.

---

## File Change Summary

| File | Change Type | Lines Added/Modified |
|------|------------|---------------------|
| `lib/fidelity.js` | Extend: `computeStyleMetrics()`, `compositeScore()`, `getPersonaCentroid()`, `inlineFidelityCheck()` | ~90 new |
| `lib/correction-consolidation.js` | Modify: clustering + synthesis + backtest | ~60 modified |
| `lib/knowledge-db.js` | Modify: graph walk weighting | ~25 modified |
| `lib/pipeline.js` | Modify: add inline guard call | ~10 added |
| `lib/checks.js` | No change | — |

## Success Criteria

1. Consolidation auto-reverts rules that degrade composite fidelity by > 5 points
2. Clustering threshold adapts per persona (measurable: fewer orphan corrections)
3. Operational rules preserve exact constraints through synthesis
4. Graph walk excludes contradictory neighbors, caps hub entities
5. Pipeline flags fidelity drift in SSE done events
