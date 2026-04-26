# DB Hardening Plan — VoiceClone

**Date:** 2026-04-26
**Worktree:** `claude/elegant-liskov-bca5d6`
**Status:** validated by user, execution in progress

## Context

External critique reviewed the schema and produced a checklist of suggestions. After auditing the actual repo (50 migrations + schema.sql), most items are already implemented. This plan captures the real residual gaps and the decisions taken.

## Already implemented (no action needed)

- **FK + ON DELETE CASCADE** — systematic in `schema.sql` and every new migration. The schema dump format hid them.
- **RLS baseline** — migration 019 enables RLS on core tables with `service_role_all` policy (deny anon/authenticated, service_role bypasses). Each new migration extends RLS to its tables (036, 029, 022, 020, 021, 014, 015, 023, 024, 025, 038, 049, 050).
- **HNSW indexes** — `chunks` (1024-dim, m=16, ef=64), `knowledge_entities` (1024), `proposition` (1024 after 045 voyage migration).
- **CHECK constraints** — already on `messages.role`, `clients.tier`, `business_outcomes.outcome`, `protocol_rule_firing.outcome`, `feedback_events.event_type`, `knowledge_entities.type`, `knowledge_relations.relation_type`, `operating_protocols.{status,check_kind,severity}`, `protocol_document.{owner_kind,status}`, `protocol_section.{kind,author_kind}`, `protocol_artifact.{kind,severity}`, `proposition.{source,intent,target_kind,status}`, `users.role`, `extractor_training_example.{scope,outcome}`.
- **GIN trigram** on `messages.content` (basic full-text search).
- **`updated_at` triggers** on protocol-v2 tables.
- **Cohabitation `operating_protocols` ↔ `protocol_document`** — intentional V1→V2 in-flight migration, documented in 038, backfill via `scripts/backfill-protocol-v2.js`.

## Real residual gaps + decisions

### 🔴 PR-A (sub-sprint) — API keys → Supabase Vault

**Problem:** `clients.anthropic_api_key` and `clients.scraping_api_key` stored in plaintext.

**Risk:** DB dump leak / `service_role` key compromise / RLS misconfig → all clients' Anthropic accounts exposed.

**Approach (multi-step, must verify chat flow at each step):**
1. Migration: add `clients.anthropic_vault_id uuid`, `clients.scraping_vault_id uuid`. Don't drop old columns yet.
2. Backfill script: write existing keys to `vault.secrets`, store ref in `vault_id` columns.
3. Code change: every reader of `clients.*_api_key` switches to `vault.decrypted_secrets` lookup. Test chat flow on Preview deploy.
4. Drop `anthropic_api_key`, `scraping_api_key` columns once verified in prod for ≥1 week.

**Why split:** code change touches the chat pipeline. Per memory `feedback_prod_without_ui_test`, must verify chat works on Preview before each merge.

### 🟡 PR-B+C (bundled, additive DDL, zero code impact)

**Single migration** `051_db_hardening_additive.sql`:
- Add `CHECK` on `learning_events.event_type` (currently only commented). Values: `'rule_added','rule_weakened','correction_saved','consolidation_run','consolidation_reverted'`.
- Add `embedding_model text` column to `chunks`, `knowledge_entities`, `proposition`. Default backfill to current model name.
- `ALTER COLUMN created_at SET NOT NULL` sweep on tables from migrations 002-018 era (`chunks`, `corrections`, `knowledge_files`, `knowledge_entities`, `knowledge_relations`, `usage_log`, `personas`, `clients`, `conversations`, `scenario_files`, `share_tokens`). Backfill `created_at = now()` where currently NULL.

**Risk:** very low. Pure additive DDL. Only NULL backfill could surprise if data has corrupted rows, but `WHERE created_at IS NULL` count is presumably 0.

### 🟡 PR-D — Targeted GIN on jsonb

**Problem:** unclear which jsonb columns are actually filtered in queries.

**Approach:**
1. Audit code: grep app code for `metadata->`, `rules_fired @>`, `payload @>`, `content->`, `signals @>`, `voice->`, `theme->`, `stats->`, `parsed_json->`.
2. Build GIN index only where filtering happens. Likely candidates:
   - `chunks.metadata` (RAG filter by source_type / source_path?)
   - `feedback_events.rules_fired` (which rules contributed analytics?)
   - `protocol_artifact.content` (kind-specific filtering?)
   - `proposition.source_refs` (uuid array containment).
3. Skip jsonb that is write-only / read-as-blob.

**Risk:** low. Index creation, no data modification.

### 🟢 PR-E (sub-sprint) — Soft delete + RGPD purge

**Decision:** soft delete for lifecycle (`deleted_at timestamptz` column) + explicit hard-delete pipeline for RGPD "right to erasure".

**Why:** RGPD requires actual deletion when a data subject requests it. Soft-delete-only is non-compliant. But for normal lifecycle (deactivation, archive, undelete), soft is preferable.

**Approach:**
1. Migration: add `deleted_at timestamptz` to `clients`, `personas`, `conversations`, `messages`, `knowledge_files`, `corrections`, `chunks`. Partial indexes: existing indexes on these tables become `WHERE deleted_at IS NULL`.
2. Code change: every read query gates on `deleted_at IS NULL` (or use views). Audit all 60+ files that touch these tables.
3. Soft-delete API: replace existing hard `DELETE` calls with `UPDATE ... SET deleted_at = now()`.
4. RGPD purge: `scripts/rgpd-purge-client.js {client_id}` — explicit cascading hard delete (still respects FK CASCADE), audit-logged. Must include: clients, all personas, all chunks/messages/corrections/knowledge_files, all learning_events, all vault secrets (if PR-A done).
5. UI: "Delete account" button → triggers RGPD purge with confirmation.

**Risk:** medium. Code change is broad (every read query). Stage carefully:
- Stage 1: migration only (column + partial indexes). No effect.
- Stage 2: convert deletes to soft-delete in lib/db.js. Verify reads still work.
- Stage 3: add `deleted_at IS NULL` filter to reads. Test extensively.
- Stage 4: build RGPD purge script + UI.

**Per memory `feedback_test_setup_docs`:** the RGPD purge script must be tested end-to-end before shipping.

## Execution order

1. **PR-B+C** (bundled, additive) — fastest visible win, builds confidence in pipeline.
2. **PR-D** (targeted GIN) — after code audit.
3. **PR-A sub-sprint** (Vault) — security-critical, multi-step.
4. **PR-E sub-sprint** (soft delete + RGPD purge) — biggest scope, most code impact.

## Out of scope (external critique flagged but not pursuing)

- Partitioning by persona+date — premature at current volume.
- EAV / generic metrics table — would degrade query ergonomics.
- `parent_message_id` for thread arborescence — `draft_of_message_id` already covers the workflow.
- Separate `knowledge_triples` table — `knowledge_relations` is sufficient.
- Renaming `personas.client_id` to enforce non-null on non-seed personas — useful but minor.

## What I cannot verify without DB access

This plan is based on migrations in git. The actual production DB state may differ if:
- Some migrations weren't applied (the `ace_pattern` migration 049 says "À appliquer manuellement via Supabase SQL Editor").
- Migrations were applied but later modified by hand.
- `deleted_at` columns or indexes were added out-of-band.

**Required first step before any migration:** run an audit query against the live DB to confirm current state matches the assumed git state. Suggested:
```sql
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
```
