# Brain Drawer Lateral — Session Resume Doc

**Last update:** 2026-04-25
**Worktree:** `C:/Users/abrah/AhmetA/.claude/worktrees/chat-dossier-2-zones`
**Branch:** `feat/brain-drawer`

---

## Where we are in the overall flow

1. ✅ Spec written & approved (4 review iterations)
2. ✅ User approved spec (User Review Gate passed)
3. ✅ Plan written & committed
4. 🔄 **Plan review loop — iteration 1 dispatch was interrupted** (this is the resume point)
5. ⏳ Plan approval by user (not yet asked)
6. ⏳ Execution via subagent-driven-development

---

## Files committed on branch `feat/brain-drawer`

Recent commit history (latest first):
- `9ad5cfc` — `plan(chat): brain drawer lateral implementation plan + rename migration 041→046`
- `8bc87e7` — `design(chat): fix review iteration 3 — track() import path ($lib/tracking, not analytics)`
- `fcd8fb4` — `design(chat): fix review iteration 2 — drop meta payload, split telemetry DB↔analytics`
- `7c52631` — `design(chat): fix spec review blockers — migration 041, message_id policy, emitBrainEvent helper`
- `f75ca5c` — `design(chat): drawer cerveau latéral (chantier #2)`

Committed files on this branch:
- `docs/superpowers/specs/2026-04-24-brain-drawer-lateral-design.md` (spec, ~600 lines, approved)
- `docs/superpowers/plans/2026-04-24-brain-drawer-lateral.md` (plan, ~1700 lines)
- `docs/superpowers/plans/2026-04-24-brain-drawer-lateral-PROGRESS.md` (this file — NOT yet committed)

**No code/migration/test files committed yet.** All implementation is still pending — the plan exists on paper only.

---

## Critical parallel-session coordination (2026-04-25)

AhmetA is running a **parallel session on `protocole-vivant Chunk 2 Wave 2a/2b`**. Key facts:
- **Migration 041-043** are reserved paper-space for protocole-vivant follow-ups (`rule_proposals`, `n4_paused_until`, `promoted_to_rule_index`).
- **Migrations 044 + 045** already applied on prod (last = 045 `match_propositions vector(1024)`).
- **Our chantier uses migration 046**, not 041. Rename is done in spec + plan.
- **`api/feedback-events.js`** will be re-touched by the parallel session's Task 2.7 (Wave 2b, later). That session will diff our final VALID_TYPES before coding. Non-blocking, just awareness.

---

## Resume here (next action)

**Immediate next step:** dispatch the plan-document-reviewer subagent for iteration 1 of the plan review loop. The dispatch was interrupted. Below is the exact prompt to re-send (copy verbatim to `Agent` tool, `subagent_type: general-purpose`):

<details>
<summary>Reviewer prompt (click to expand)</summary>

```
You are a plan-document-reviewer. Review an implementation plan for issues and either **Approve** or **Flag issues**.

**Plan under review:** `C:/Users/abrah/AhmetA/.claude/worktrees/chat-dossier-2-zones/docs/superpowers/plans/2026-04-24-brain-drawer-lateral.md`

**Spec source (the plan must faithfully implement this):** `C:/Users/abrah/AhmetA/.claude/worktrees/chat-dossier-2-zones/docs/superpowers/specs/2026-04-24-brain-drawer-lateral-design.md`

**Project:** VoiceClone — SvelteKit 2.57.1 + Svelte 5 (runes) + Supabase + node:test. Chantier #2 of a 4-chantier chat cockpit UX refactor. Replaces `/brain/[persona]` navigation with a side-by-side drawer opened from `/chat/[persona]`, reusing 4 existing Panels.

**Known plan-to-spec deviations (intentional, documented at top of plan):**
1. Split `brainDrawer.js` and `brainEvents.js` into pure core + thin wrapper for Node-testability (SvelteKit `$app/*` imports crash `node:test`).
2. Migration test at `test/migration-046-brain-events.test.js` (flat) because `npm test` glob is `test/*.test.js` not recursive.
3. Component-level automated tests dropped (no Svelte test framework in repo) — covered by preview smoke acceptance criteria.
4. Migration number is **046**, not the spec's original 041 — parallel session (protocole-vivant Chunk 2.5) reserved 041-043 paper-space, 044-045 already applied (last is 045 match_propositions vector(1024)). Rename done consistently across spec + plan.

**Environment facts you can trust:**
- `src/lib/tracking.js` exists and exports `track()`. Path `$lib/tracking` resolves.
- `api/feedback-events.js` line 3 currently has 7 event_types in VALID_TYPES (missing `copy_paste_out`, `regen_rejection` from migration 040 drift).
- Existing test pattern: `test/composer-state.test.js` (pure JS, node:test), `test/api-feedback-events.test.js` (API handler mock pattern), `test/protocol-v2-migration.test.js` (DB-gated migration test pattern).
- `package.json` test script: `node --test test/*.test.js`.
- `src/lib/stores/` contains existing stores incl. `chat.js` (exports `messages`, `currentConversationId`).
- `src/lib/auth.js` may or may not exist — plan's Task 8 Step 1 instructs grep to verify paths.

**Review checklist:**
1. **Task granularity**: Each step is 2-5 min, single action.
2. **TDD discipline**: Every Task with testable logic has Write test → Verify fail → Implement → Verify pass → Commit.
3. **Exact file paths**: Every file reference is concrete.
4. **Complete code**: Tests and implementations fully in plan.
5. **Exact commands**: `npm test`, `git commit -m`, `grep` — all present with expected output.
6. **Spec fidelity**: Plan produces all spec behaviors. Acceptance criteria map to tasks.
7. **Dependency ordering**: Valid TDD order within chunks; chunks ordered correctly.
8. **Deploy safety**: Chunk 5's migration-046-before-merge coupling is explicit.
9. **Parallel session awareness**: Coordination note about api/feedback-events.js is present.
10. **Scope discipline**: No tasks wandering outside spec.

**Output format:**
- Start with verdict line: **✅ Approved** or **❌ Issues Found**
- If issues: numbered list, each with (a) chunk + task ref, (b) what's wrong, (c) suggested fix.
- If approved: one-paragraph summary.

Focus on blocking issues. Minor wording = optional polish.
```

</details>

---

## Plan structure (5 chunks)

| Chunk | Tasks | Scope |
|---|---|---|
| 1 | Task 1-3 | Migration 046 + test + dev apply + VALID_TYPES drift fix |
| 2 | Task 4-8 | Pure core libs (`brainDrawerUrl`, `brainDrawerCore`, `brainEventsCore`) + thin wrappers |
| 3 | Task 9-10 | `BrainDrawer.svelte` + `ProtocolPanel.svelte` onRuleAdded prop |
| 4 | Task 11-13 | `/chat/[persona]/+page.svelte` wiring + legacy `/brain/[persona]` redirect |
| 5 | Step A-D | Deploy: push PR → smoke preview → migration prod → merge master |

---

## Key plan-time design decisions (baked into plan)

1. **File split for testability** — `brainDrawerCore.js` (pure) + `brainDrawer.js` (SvelteKit wrapper). Same pattern for `brainEventsCore.js` + `brainEvents.js`. Pure cores are unit-tested with `node:test`; wrappers covered by preview smoke.
2. **Migration test path flat** — `test/migration-046-brain-events.test.js`, not `test/migrations/...`, because `node --test test/*.test.js` is non-recursive.
3. **No Svelte component framework** — Task 9 (BrainDrawer.svelte) and Task 10 (ProtocolPanel prop) rely on `npm run build` + manual smoke; no rendering test. Rationale in plan's "Plan-to-spec deviations" section.
4. **`track()` import path** — `$lib/tracking` (verified exists: `C:/Users/abrah/AhmetA/src/lib/tracking.js` — Plausible wrapper, SSR/adblock-safe). **Not** `$lib/analytics`.

---

## What AhmetA needs to do manually (non-tech)

Once execution finishes:
1. **Smoke test Preview Vercel** — 12 acceptance criteria checklist (spec §"Acceptance criteria" lines 565-576, reproduced in plan Chunk 5 Step B).
2. **Apply migration 046 on Supabase PROD** via SQL editor (paste body of `supabase/046_feedback_brain_drawer.sql`, run, verify CHECK). **BEFORE** merging master.
3. **Merge master** once smoke + prod migration both green.

---

## Known risks / watch-outs

- **Pipeline deploy-skew window**: if master merges before migration 046 hits prod, every `brain_drawer_opened` emission throws CHECK 500. Garde critique documentée 3 fois (spec §"Ordre de déploiement", plan Chunk 5 Step C, plan Task 3 commit message).
- **Parallel session double-edit on `api/feedback-events.js`**: non-blocking per AhmetA coordination note, but if the other session merges first and modifies VALID_TYPES differently, we'll need a rebase.
- **`composerText` + `showToast` + `personaName` + chat stores** must already exist in `/chat/[persona]/+page.svelte` from chantier #1. Plan Task 11 Step 1 says "halt and report" if missing.

---

## Resume instructions for a fresh session

1. `cd C:/Users/abrah/AhmetA/.claude/worktrees/chat-dossier-2-zones`
2. `git status` → should show this PROGRESS file as untracked (or committed, depending on when you resume).
3. Read this file + the plan + the spec.
4. Dispatch the plan reviewer (prompt above) and process its output.
5. After reviewer approval, ask AhmetA to review the plan.
6. After AhmetA approval, invoke `superpowers:subagent-driven-development` to execute.
