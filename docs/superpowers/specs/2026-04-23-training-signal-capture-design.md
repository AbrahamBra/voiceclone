# Training Signal Capture — Refonte Design

**Date:** 2026-04-23
**Status:** Spec archived — original implementation in PR #50 was closed on 2026-04-24 (migration-number collision with master 036/037 + protocol-v2 plan 038/039, CI failures, 5-day drift). Work can be reprised from this spec as a fresh narrower PR when priorities align.
**Author:** AhmetA + Claude

---

## 1. Context & Problem

VoiceClone Intelligence currently captures only explicit feedback: the five chat buttons (`✓ c'est ça`, `★ excellent`, `✎ corriger`, `↻ regen`, `📏 save rule`). The most frequent user action — **copying the draft out to LinkedIn** — emits no signal. Rejections via regeneration emit no signal. Offline reflection on past conversations is absent.

AhmetA's product axiom (persisted memory, `feedback_every_action_trains.md`): **every user action must be training data**. A button that doesn't emit a signal is a bug.

Current failure modes observed:

- `handleValidate` was wired as prop `onValidate` in `ChatMessage.svelte` but never exposed in the JSX — pure dead code.
- `onCopyBlock` was wired as `() => {}` in `+page.svelte` — highest-frequency action, zero persistence.
- `handleRegen` updated `turn_kind` only, no correction signal — so regen clicks disappeared.
- `feedback-events.js` accepted a `validated_edited` event type that no UI code ever fires.
- Consolidation treated all corrections as equal (`MIN_CLUSTER_SIZE=3`), no way to distinguish a deliberate ✎ correction from a passive copy-paste.
- Legacy writingRules were evicted FIFO when the cap was hit, regardless of how much graduated evidence supported them.

## 2. Goals / Non-Goals

**Goals:**

- Capture all four learning levels end-to-end (N1 knowledge, N2 explicit, N3 offline reflection, N4 proactive validation).
- Promote strong explicit signals fast, require more evidence for implicit ones — without blocking implicit capture.
- Evict writingRules by aggregate weight instead of age, so legacy placeholder rules fall off first.
- Preserve backward compatibility: 3 fresh explicit corrections still consolidate as before.
- Emit observability metrics for implicit-spam detection and weight drift.

**Non-Goals (this spec):**

- Breakcold auto-import of DMs (future, tracked in `project_voiceclone_integrations.md`).
- Client-supervision SKU and rule propagation (tracked in `project_voiceclone_supervision.md`).
- UI consolidation (14 panels → 5). Separate spec, same sprint.
- Changing the existing `confidence` evolution mechanism (time decay + neg feedback from migration 009). This spec adds `confidence_weight` as an **orthogonal** dimension.

## 3. Design Overview

### 3.1 Four Learning Levels

| Level | Source | When | Output |
|-------|--------|------|--------|
| **N1** | `knowledge_entities` extraction | Chat streaming (existing) | Entities + confidence |
| **N2** | User explicit action (5 buttons) + implicit capture (copy, regen) | Chat runtime | `corrections` row with `source_channel` |
| **N3** | Offline cron rescanning past conversations via Haiku | `*/30 * * * *` cron | `rule_proposals` row (status = `pending`) |
| **N4** | Proactive chip surfaces N3 proposals to user | On next chat session in conversation | User accept/reject/edit → correction or dismissal |

### 3.2 Enriched Corrections Funnel (Approach C)

All 11 signal types funnel into the existing `corrections` table. Instead of creating parallel tables per signal type, we enrich `corrections` with three columns:

- `source_channel` — which of 11 origins produced this row
- `confidence_weight` — immutable, set at insertion, reflects signal strength (e.g., explicit button = 1.0, copy-paste = 0.6)
- `is_implicit` — boolean shortcut for "user did not explicitly articulate a correction"

**Effective weight** used by consolidation: `confidence × confidence_weight`. The two dimensions are orthogonal:

- `confidence` (migration 009, pre-existing) — evolves over time: decays with age, decreases on contradicting feedback.
- `confidence_weight` (migration 036, new) — fixed at creation, reflects the signal's structural reliability.

Why this matters: a copy-paste signal that sits in the database for 30 days can still see its `confidence` decay, but it always carries the "soft signal" flag via `confidence_weight=0.6`. We never retroactively pretend it was an explicit correction.

### 3.3 Scope: What Ships Where

| Phase | Deliverable | State |
|-------|-------------|-------|
| **Phase 1** | Signal capture: `copy_paste_out`, `regen_rejection`, dead code cleanup | ✅ Implemented (commit `d634195`) |
| **Phase 2** | Consolidation weighting + aggregate-weight eviction | ✅ Implemented (commit `61d30d0`) |
| **Phase 3a** | `edit_diff` — requires new UX affordance ("j'ai envoyé ceci" textarea pre-filled with draft) | ⏳ Pending |
| **Phase 3b** | N3 offline rescan cron (`/api/cron-rescan-conversations`) | ⏳ Pending |
| **Phase 3c** | N4 proactive chip (`RuleProposalChip.svelte` + `/api/rule-proposals`) | ⏳ Pending |

## 4. Data Model

Four migrations, all idempotent, all executed against production Supabase by user on 2026-04-23:

### 4.1 Migration 036 — `corrections` enrichment

```sql
ALTER TABLE corrections
  ADD COLUMN IF NOT EXISTS source_channel    TEXT         NOT NULL DEFAULT 'explicit_button',
  ADD COLUMN IF NOT EXISTS confidence_weight NUMERIC(3,2) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS is_implicit       BOOLEAN      NOT NULL DEFAULT false;

-- CHECK constraint on source_channel: 11 allowed values (listed in §5.1)
-- Indexes on source_channel and confidence_weight DESC
```

The `DEFAULT 'explicit_button'` means all pre-existing corrections auto-tag as explicit — backward compatible with code paths that don't yet set the column.

### 4.2 Migration 037 — `rule_proposals` table + conversations cursor

```sql
CREATE TABLE rule_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  rule_text TEXT NOT NULL,
  evidence_message_ids UUID[] NOT NULL,
  pattern_type TEXT NOT NULL CHECK IN ('style_drift','repeated_rejection','silent_constraint','contradiction'),
  confidence NUMERIC(3,2) NOT NULL CHECK (0 <= confidence <= 1),
  status TEXT NOT NULL DEFAULT 'pending' CHECK IN ('pending','accepted','rejected','superseded'),
  proposed_at TIMESTAMPTZ DEFAULT now(),
  decided_at TIMESTAMPTZ,
  decided_by_event_id UUID
);

ALTER TABLE conversations ADD COLUMN last_rescan_at TIMESTAMPTZ;
-- Partial index for rescan candidates: last_rescan_at < last_message_at
```

The `last_rescan_at` cursor lets N3 cron skip conversations unchanged since last scan.

### 4.3 Migration 038 — N4 per-conversation pause

```sql
ALTER TABLE conversations ADD COLUMN n4_paused_until TIMESTAMPTZ;
```

Anti-fatigue: after 3 consecutive chip rejections in a conversation, set `n4_paused_until = now() + 7 days`. N4 UI checks this column before rendering the chip.

### 4.4 Migration 039 — writingRules provenance (declared, not yet read)

```sql
ALTER TABLE corrections ADD COLUMN promoted_to_rule_index INTEGER;
```

Reserved for tracking which rule index each graduated correction fed. Phase 2 eviction currently uses the existing `graduated_rule` column (which stores the rule text) rather than the index column. Migration 039 is in place for future use but `promoted_to_rule_index` remains unread today.

## 5. Signal Capture Map

### 5.1 The 11 source channels

| `source_channel` | UI trigger | Weight | Implicit? | Phase |
|---|---|---:|:-:|:-:|
| `explicit_button` | ✓/★/✎/📏 buttons | 1.0 | no | Pre-existing (tagged by default) |
| `client_validated` | 🟢 agency validation | 1.0 | no | Pre-existing |
| `edit_diff` | User edited before sending (diff sent vs proposed) | 0.8 | no | 3a |
| `copy_paste_out` | User copies draft out | 0.6 | yes | **1** ✅ |
| `regen_rejection` | User clicks ↻ | 0.5 | yes | **1** ✅ |
| `chat_correction` | Inline correction detected in user's next turn | 0.7 | yes | Future |
| `negative_feedback` | "non", "pas comme ça" detected | 0.6 | yes | Future |
| `direct_instruction` | "tu dois toujours…", "ne fais jamais…" | 0.9 | no | Future |
| `coaching_correction` | Didactic reformulation detected | 0.7 | no | Future |
| `metacognitive_n3` | IA rescan found pattern | 0.5 | yes | 3b |
| `proactive_n4` | User accepted an IA-proposed rule | 0.9 | no | 3c |

### 5.2 Phase 1: how signals hit `/api/feedback`

**`copy_paste_out`** (`api/feedback.js`):

- Required: `botMessage`. Optional: `userMessage`.
- Inserts `corrections` row with `[COPY_PASTE_OUT]` prefix, `source_channel='copy_paste_out'`, `confidence_weight=0.6`, `is_implicit=true`.
- Entities matched in the draft get `confidence += 0.03` (capped at 1.0).
- Triggered from `ChatMessage.svelte` via `onCopyBlock={(block) => handleCopyBlock(message, block)}` in `+page.svelte`.

**`regen_rejection`** (`api/feedback.js`):

- Same shape, prefix `[REGEN_REJECTED]`, `confidence_weight=0.5`.
- Entities matched get `confidence -= 0.03` (floor at 0.0).
- Triggered from `handleRegen` in `+page.svelte` before the existing `PATCH turn_kind` call. Best-effort (non-blocking).

**Intelligence panel filter** (`api/feedback.js`):

```javascript
const META_MARKERS = ["[VALIDATED]", "[CLIENT_VALIDATED]", "[EXCELLENT]", "[COPY_PASTE_OUT]", "[REGEN_REJECTED]"];
```

These rows exist as signal records but never render as visible "rules" in the Intelligence panel.

### 5.3 Event log (`/api/feedback-events`)

`VALID_TYPES` updated:

```javascript
const VALID_TYPES = new Set([
  "validated", "corrected", "saved_rule", "excellent", "client_validated",
  "rule_proposal_accepted", "rule_proposal_rejected", "rule_proposal_edited",
]);
```

- Removed: `validated_edited` (was declared but never fired).
- Added: 3 `rule_proposal_*` types for N4 chip accept/reject/edit flow (Phase 3c).

## 6. Consolidation Weighting (Phase 2)

### 6.1 Promotion gate

Old: cluster size ≥ 3.
New: cluster size ≥ 2 **AND** aggregate weight ≥ 2.0.

```javascript
const MIN_CLUSTER_MEMBERS = 2;
const MIN_CLUSTER_WEIGHT_SUM = 2.0;

const clusterWeight = (cluster) => cluster.members.reduce((sum, i) => {
  const c = corrections[i];
  return sum + (c.confidence ?? 0.8) * (c.confidence_weight ?? 1.0);
}, 0);
```

Behavior by example:

| Cluster composition | Effective weight | Promotes? |
|---|---:|:-:|
| 3× explicit fresh (confidence 1.0, weight 1.0) | 3.00 | ✅ (backward compat) |
| 2× explicit fresh + 1× copy_paste fresh | 2.60 | ✅ |
| 5× copy_paste fresh (0.6 × 0.8 × 5) | 2.40 | ✅ (needs more evidence) |
| 2× copy_paste fresh | 0.96 | ❌ |
| 3× explicit aged (confidence decayed to 0.5) | 1.50 | ❌ (consistent with old decay behavior) |

### 6.2 Aggregate-weight eviction

When `writingRules.length > MAX_WRITING_RULES (25)` after promotion:

1. Query `corrections` where `status='graduated'` and `graduated_rule IN (currentRules)`.
2. Sum `confidence × confidence_weight` per `graduated_rule`.
3. Rank `currentRules` by `(weight ASC, original_index ASC)` — legacy rules without graduated matches get weight 0 and evict first; ties broken FIFO as fallback.
4. Evict the `overflow` weakest.
5. Emit `writing_rules_evicted` log with evicted/kept counts + top-5 weakest weights sample.

### 6.3 Extended observability

`consolidation_complete` log now carries:

```javascript
{
  clustersFound, rulesPromoted, correctionsGraduated, threshold,
  weight_sum_by_promotable: [...],  // array of numbers
  explicit_count,                    // count where is_implicit=false
  implicit_count,                    // count where is_implicit=true
}
```

Purpose: detect implicit-signal spam (e.g., copy_paste_out floods from a bot), and weight drift.

## 7. N3 Offline Rescan (Phase 3b, pending)

**Trigger:** Vercel cron `*/30 * * * *` → `/api/cron-rescan-conversations`.

**Flow:**

1. Select up to N conversations where `last_rescan_at IS NULL OR last_rescan_at < last_message_at`.
2. For each, load last ~50 messages.
3. Send to Haiku with a prompt asking it to identify patterns in four categories:
   - `style_drift` — draft tone diverged from client's actual style over the conversation
   - `repeated_rejection` — same kind of draft rejected multiple times (regen, edit)
   - `silent_constraint` — client never said it explicitly but every accepted draft has a property
   - `contradiction` — draft-then-correction pairs contradict an existing writingRule
4. For each pattern, insert a `rule_proposals` row with `status='pending'`, `evidence_message_ids`, and `confidence`.
5. Set `conversations.last_rescan_at = now()`.

**Guardrails:**

- Rate-limit: max N conversations per tick (start with 10).
- Cost: Haiku-only, ~200 tokens in, ~100 tokens out per conversation.
- Skip conversations with `n4_paused_until > now()`.

## 8. N4 Proactive Chip (Phase 3c, pending)

**Component:** `src/lib/components/RuleProposalChip.svelte` (new).

**Render condition:** On chat page mount, fetch `rule_proposals WHERE status='pending' AND persona_id=current` (via `/api/rule-proposals GET`). If any exist and `conversations.n4_paused_until < now()`, surface one chip above the input: "J'ai remarqué que tu tends à [rule_text]. On en fait une règle ?"

**Actions:**

| Action | Event | Side effect |
|---|---|---|
| Accept | `rule_proposal_accepted` | Insert `corrections` row with `source_channel='proactive_n4'`, `confidence_weight=0.9`. Mark proposal `accepted`. |
| Reject | `rule_proposal_rejected` | Mark proposal `rejected`. If 3 consecutive rejects in conversation: set `n4_paused_until = now() + 7d`. |
| Edit | `rule_proposal_edited` | Textarea to edit `rule_text`, then insert correction with edited text + `confidence_weight=0.9`. Mark `accepted`. |

**Backend:** `/api/rule-proposals` (GET list, PATCH status).

## 9. Observability & Telemetry

All logs go through existing `lib/log.js` → learning_events table. Key events:

| Event | Emitted by | When |
|---|---|---|
| `consolidation_complete` (extended) | `correction-consolidation.js` | End of every cron-consolidate tick |
| `writing_rules_evicted` (new) | `correction-consolidation.js` | When cap overflow triggers eviction |
| `copy_paste_out` (feedback_event) | `/api/feedback` | User copies draft |
| `regen_rejection` (feedback_event) | `/api/feedback` | User clicks ↻ |
| `rule_proposal_accepted/rejected/edited` | `/api/feedback-events` | N4 chip decision |

Signals to watch manually in the first week post-deploy:

- `implicit_count / (implicit_count + explicit_count)` — should stabilize; if it spikes past 0.8 we have implicit spam or bot traffic.
- `weight_sum_by_promotable` distribution — should cluster near 2.0–4.0. Values > 10 suggest stale clusters never evicted.
- `writing_rules_evicted.weights_sample` — weakest evicted should be ~0 for first few cycles (legacy rules purged), then rise.

## 10. Backward Compatibility & Rollback

**Schema:** All migrations are `ADD COLUMN IF NOT EXISTS` with defaults → no data loss, no read breakage for code that doesn't set the new columns.

**Code:** Every signal path adds rows — no existing row is mutated by the new channels. Pre-existing explicit corrections continue to promote at the same rate (3 × 1.0 × 0.8 confidence decay = 2.40 ≥ 2.0 gate).

**Rollback plan:**

- Phase 1 revert → remove the two new `if (type === …)` blocks in `api/feedback.js` and the two handler wirings in `+page.svelte`. Data already captured stays, just no new rows.
- Phase 2 revert → restore `MIN_CLUSTER_SIZE=3` and FIFO eviction. No schema change needed; new columns sit unused.
- Migrations themselves are left in place (cheap to keep).

## 11. Open Questions / Future Work

- **`edit_diff` UX affordance** — open question: where does the "j'ai envoyé ceci" textarea live? Below the draft? As a follow-up chip after copy? Product decision pending.
- **Chat-extraction channels** (`chat_correction`, `negative_feedback`, `direct_instruction`, `coaching_correction`) — require NLP classification of user's next-turn text. Deferred; not on this sprint.
- **Client-supervision rule propagation** — N4 chips from client role should affect agency persona's writingRules. Out of scope; tracked separately.
- **Observability dashboard** — currently logs only. An agency-facing "training pulse" view is a likely follow-up once data accumulates.

## 12. Implementation Artifacts

- **PR:** https://github.com/AbrahamBra/voiceclone/pull/50
- **Commits:** `b29560d` (migrations), `d634195` (Phase 1), `61d30d0` (Phase 2)
- **Tests:** `test/correction-consolidation.test.js` — 13/13 pass with new weighted clustering.
- **Files touched:** `api/feedback.js`, `api/feedback-events.js`, `lib/correction-consolidation.js`, `src/lib/components/ChatMessage.svelte`, `src/routes/chat/[persona]/+page.svelte`, 4 SQL migrations.

---

**Memory gate before merge:** Per `feedback_prod_without_ui_test.md` (written 2026-04-23 after incident), PR #50 must be exercised end-to-end on a Vercel Preview URL before merging to master. The runtime code is substantial and a silent regression in chat would be hard to diagnose from logs alone.
