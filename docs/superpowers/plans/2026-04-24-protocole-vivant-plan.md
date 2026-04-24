# Protocole vivant — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformer l'onglet Protocole de `5 règles atomiques` en doctrine vivante (prose narrative + artifacts exécutables + propositions arbitrées + versioning + hooks agence/client), sans régression sur l'existant.

**Architecture:** Nouveau modèle de données en parallèle des tables `operating_protocols`/`protocol_hard_rules` existantes. Migration progressive par feature flag persona. API v2 + shim read-only sur l'ancienne API. Pipeline signaux→extracteurs LLM→propositions avec dédup sémantique (pgvector). Auto-amélioration extracteurs via corpus rejets/accepts (cron hebdo).

**Tech Stack:** SvelteKit (Svelte 5 runes) · Vercel serverless · Supabase Postgres + pgvector · Anthropic SDK · OpenAI embeddings-3-small · node:test.

**Spec source:** [`docs/superpowers/specs/2026-04-24-protocole-vivant-design.md`](../specs/2026-04-24-protocole-vivant-design.md) (iteration 2 approved).

---

## File Structure Overview

Created files (by chunk) :

### Chunk 1 — Infra data (détaillé ci-dessous)
- `supabase/038_protocol_v2_core.sql` — 5 nouvelles tables (doc/section/artifact/proposition/training_example) + pgvector extension + index
- `supabase/039_protocol_v2_hooks.sql` — hooks persona (client_share_token, client_user_id) + user (role)
- `lib/protocol-v2-db.js` — data access layer (list/get documents, sections, artifacts, propositions)
- `scripts/backfill-protocol-v2.js` — migration idempotente des `operating_protocols` existants vers `protocol_document` + artifacts
- `api/v2/protocol.js` — endpoint GET read-only retournant doc complet
- `test/protocol-v2-db.test.js` — tests data layer
- `test/protocol-v2-backfill.test.js` — tests backfill idempotence
- `test/api-v2-protocol.test.js` — test API shape

### Chunk 2 — Extractors + queue (outlined)
- `lib/protocol-v2-extractors/index.js` + 1 fichier par `target_kind` (hard_rules.js, errors.js, patterns.js, scoring.js, process.js, templates.js)
- `lib/protocol-v2-embeddings.js` — wrapper pgvector + dédup sémantique
- `api/v2/propositions.js` — CRUD propositions (create via signal, list, accept, reject, revise)
- `api/v2/protocol/extract.js` — endpoint save-prose-and-extract (le flow section édition)
- `scripts/feedback-event-to-proposition.js` — subscriber cron qui transforme `feedback_events` en `propositions`

### Chunk 3 — UI Doctrine + Registre + édition prose + SSE
- `src/lib/components/ProtocolDoctrine.svelte` — vue lecture prose
- `src/lib/components/ProtocolRegistry.svelte` — vue tableau virtualisé
- `src/lib/components/ProtocolSectionEditor.svelte` — éditeur inline avec extraction à la save
- `src/lib/components/ProtocolActivityFeed.svelte` — feed SSE
- `src/lib/components/ProtocolArtifactAccordion.svelte` — accordéon sous paragraphe
- `src/routes/brain/[persona]/+page.svelte` — modifié pour rooter vers Doctrine/Registre/Propositions selon feature flag
- `api/v2/protocol/stream.js` — endpoint SSE pour tirs live

### Chunk 4 — UI propositions + versioning
- `src/lib/components/ProtocolPropositionsQueue.svelte` — queue + batch actions
- `src/lib/components/ProtocolPropositionCard.svelte` — carte individuelle
- `src/lib/components/ProtocolVersionBar.svelte` — draft/active/publish
- `lib/protocol-v2-versioning.js` — publish atomique + stats preservation via content_hash
- `api/v2/protocol/publish.js` — endpoint publication

### Chunk 2.5 — Training signal capture (reprise spec archivé 2026-04-23)
- `supabase/040_corrections_enrichment.sql` — source_channel, confidence_weight, is_implicit sur `corrections`
- `supabase/041_rule_proposals.sql` — table `rule_proposals` (data only, phase 3b/3c future) + `conversations.last_rescan_at`
- `supabase/042_n4_pause.sql` — `conversations.n4_paused_until` (anti-fatigue)
- `supabase/043_promoted_rule_index.sql` — `corrections.promoted_to_rule_index` (réservé)
- `api/feedback.js` — branches `copy_paste_out` + `regen_rejection` + filtre META_MARKERS étendu
- `api/feedback-events.js` — VALID_TYPES : retirer `validated_edited`, ajouter `rule_proposal_*`
- `src/lib/components/ChatMessage.svelte` — wire onCopyBlock handler
- `src/routes/chat/[persona]/+page.svelte` — handler `handleCopyBlock` + modifier `handleRegen`
- `lib/correction-consolidation.js` — weighted promotion gate + aggregate-weight eviction + extended log

### Chunk 5 — Scope agence + hooks client
- `supabase/044_protocol_v2_templates.sql` — templates agence + inheritance
- `src/lib/components/AgencyDashboard.svelte` — portfolio agence
- `api/v2/templates.js` — CRUD templates
- `api/v2/templates/inherit.js` — propagation opt-in
- `api/v2/personas/share-token.js` — génération/révocation token client

### Chunk 6 — Extracteur self-improvement
- `scripts/regenerate-extractor-prompt.js` — cron hebdo
- `lib/protocol-v2-extractor-trainer.js` — sélection few-shots équilibrés
- Migration des prompts dans `lib/protocol-v2-extractors/*.js` pour supporter few-shot dynamique

Modified files :
- `src/lib/components/ProtocolPanel.svelte` — devient un shim conditionnel (ancienne UI si flag OFF)
- `src/routes/chat/[persona]/+page.svelte` — retrait FeedbackPanel latéral + ajout badge propositions
- `api/protocol.js` — devient shim read-only lisant tables v2 (chunk 3 final task)

---

## Memories à consulter avant d'exécuter

- [project_voiceclone_stack.md] — `vite dev` ne sert pas `api/` ; toujours tester via `vercel dev` ou tests node directs
- [feedback_autonomous_commits.md] — commits autonomes OK, demander uniquement pour destructif
- [feedback_autonomous_pr_push.md] — PR + push preview autonomes
- [feedback_autonomous_prod_merge.md] — merge master + push prod autonomes
- [feedback_prod_without_ui_test.md] — JAMAIS merge master sans flow UI testé sur Vercel preview
- [feedback_autonomous_testing.md] — run tests sans demander pendant l'implémentation
- [feedback_synthetic_scenarios_when_sparse_data.md] — fixtures synthétiques si données réelles sparse
- [feedback_unbounded_scale_by_design.md] — pas de plafond arbitraire sur nb artifacts/propositions/sections

---

## Chunk 1: Sprint 1 — Infra data

**Scope :** nouvelles tables SQL + backfill idempotent + API v2 read-only. Aucune UI touchée. Aucune régression possible sur l'existant (additif seulement).

**Vérif finale du chunk :** un persona existant (qui a des `operating_protocols` + `protocol_hard_rules`) affiche ses règles via `GET /api/v2/protocol?persona=<id>` en format nouveau (document → section `hard_rules` → artifacts `hard_check`), sans que l'ancienne API `/api/protocol` ait bougé.

---

### Task 1.1 — Migration 038 : 5 tables core + pgvector

**Files:**
- Create: `supabase/038_protocol_v2_core.sql`
- Test: `test/protocol-v2-migration.test.js`

**Approach:** la migration est un script SQL idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). Test d'intégration = exécuter le SQL contre une DB de test et vérifier que les 5 tables + leurs colonnes existent. Aucune donnée backfillée dans cette task.

- [ ] **Step 1.1.1 — Écrire le test d'intégration qui fail**

Ce test suppose une variable env `SUPABASE_TEST_URL` pointant vers une base jetable. Il applique le SQL et vérifie le schéma.

```javascript
// test/protocol-v2-migration.test.js
import { strict as assert } from "node:assert";
import { describe, it, before } from "node:test";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Utilise SUPABASE_TEST_URL + SUPABASE_TEST_SERVICE_KEY pour une DB jetable.
// Ce test se skip si les vars ne sont pas set (permet CI sans DB).
const TEST_URL = process.env.SUPABASE_TEST_URL;
const TEST_KEY = process.env.SUPABASE_TEST_SERVICE_KEY;

const skipIfNoTestDb = () => {
  if (!TEST_URL || !TEST_KEY) return { skip: "no test DB configured" };
  return {};
};

describe("migration 038 — protocol_v2_core", () => {
  let sb;
  before(() => {
    if (!TEST_URL || !TEST_KEY) return;
    sb = createClient(TEST_URL, TEST_KEY);
  });

  it("creates 5 new tables", skipIfNoTestDb(), async () => {
    const sql = readFileSync("supabase/038_protocol_v2_core.sql", "utf8");
    const { error } = await sb.rpc("exec_sql", { sql });
    assert.equal(error, null, `SQL exec failed: ${error?.message}`);

    const { data } = await sb
      .from("information_schema.tables")
      .select("table_name")
      .in("table_name", [
        "protocol_document",
        "protocol_section",
        "protocol_artifact",
        "proposition",
        "extractor_training_example",
      ]);
    assert.equal(data?.length, 5, `expected 5 tables, got ${data?.length}`);
  });

  it("enables pgvector extension", skipIfNoTestDb(), async () => {
    const { data } = await sb
      .from("pg_extension")
      .select("extname")
      .eq("extname", "vector");
    assert.equal(data?.length, 1, "pgvector extension not enabled");
  });
});
```

- [ ] **Step 1.1.2 — Run test pour vérifier qu'il fail**

```bash
node --test test/protocol-v2-migration.test.js
```

Expected: FAIL ("cannot read file 038_protocol_v2_core.sql" ou équivalent).

- [ ] **Step 1.1.3 — Écrire la migration SQL**

```sql
-- ============================================================
-- Migration 038 — Protocole vivant (Phase 1: core tables)
--
-- Crée le modèle de données pour le protocole en tant que DOCTRINE VIVANTE :
--   - protocol_document : doc typé par sections (narratif + structured)
--   - protocol_section  : sections composables (kind enum)
--   - protocol_artifact : artifacts exécutables compilés depuis sections
--   - proposition       : queue d'arbitrage des apprentissages
--   - extractor_training_example : corpus auto-amélioration extracteurs
--
-- Cohabite avec operating_protocols + protocol_hard_rules (migration 036).
-- Backfill dans scripts/backfill-protocol-v2.js (task 1.4).
--
-- Additif uniquement — aucun DROP, aucun ALTER destructif.
-- ============================================================

-- pgvector pour dédup sémantique des propositions
CREATE EXTENSION IF NOT EXISTS vector;

-- ── 1. protocol_document ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS protocol_document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  owner_kind text NOT NULL
    CHECK (owner_kind IN ('persona', 'template')),
  owner_id uuid NOT NULL,

  version int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),

  parent_template_id uuid REFERENCES protocol_document(id) ON DELETE SET NULL,
  diverged_from_template_at timestamptz,
  pending_template_version int,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE protocol_document IS
  'Doc vivant — une doctrine versionnée par persona ou template agence.';

CREATE INDEX IF NOT EXISTS idx_protocol_document_owner
  ON protocol_document (owner_kind, owner_id);
CREATE INDEX IF NOT EXISTS idx_protocol_document_active
  ON protocol_document (owner_kind, owner_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_protocol_document_template_parent
  ON protocol_document (parent_template_id)
  WHERE parent_template_id IS NOT NULL;

-- ── 2. protocol_section ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS protocol_section (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES protocol_document(id) ON DELETE CASCADE,

  "order" int NOT NULL DEFAULT 0,

  kind text NOT NULL
    CHECK (kind IN ('identity', 'icp_patterns', 'scoring', 'process',
                    'templates', 'hard_rules', 'errors', 'custom')),

  heading text,
  prose text NOT NULL DEFAULT '',
  structured jsonb,

  inherited_from_section_id uuid REFERENCES protocol_section(id) ON DELETE SET NULL,
  client_visible boolean NOT NULL DEFAULT true,
  client_editable boolean NOT NULL DEFAULT false,

  author_kind text NOT NULL DEFAULT 'user'
    CHECK (author_kind IN ('user', 'auto_extraction', 'proposition_accepted')),

  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN protocol_section.kind IS
  'identity=contexte prompt only · icp_patterns=taxonomie · scoring=moteur score · process=state machine · templates=skeletons · hard_rules=check atomic · errors=do/dont · custom=libre';

CREATE INDEX IF NOT EXISTS idx_protocol_section_document
  ON protocol_section (document_id, "order");
CREATE INDEX IF NOT EXISTS idx_protocol_section_inherited
  ON protocol_section (inherited_from_section_id)
  WHERE inherited_from_section_id IS NOT NULL;

-- ── 3. protocol_artifact ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS protocol_artifact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_section_id uuid NOT NULL REFERENCES protocol_section(id) ON DELETE CASCADE,

  source_quote text,
  kind text NOT NULL
    CHECK (kind IN ('hard_check', 'soft_check', 'pattern', 'score_axis',
                    'decision_row', 'state_transition', 'template_skeleton')),

  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  severity text
    CHECK (severity IN ('hard', 'strong', 'light')),
  scenarios text[],

  is_active boolean NOT NULL DEFAULT true,
  is_manual_override boolean NOT NULL DEFAULT false,

  content_hash text NOT NULL,
  stats jsonb NOT NULL DEFAULT '{"fires":0,"last_fired_at":null,"accuracy":null}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN protocol_artifact.content_hash IS
  'Hash normalisé (sens, pas ponctuation) — préserve stats.fires cross-version quand un paragraphe est reformulé sans changer le sens.';

CREATE INDEX IF NOT EXISTS idx_protocol_artifact_section
  ON protocol_artifact (source_section_id);
CREATE INDEX IF NOT EXISTS idx_protocol_artifact_active_kind
  ON protocol_artifact (kind)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_protocol_artifact_content_hash
  ON protocol_artifact (content_hash);

-- ── 4. proposition ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proposition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES protocol_document(id) ON DELETE CASCADE,

  source text NOT NULL
    CHECK (source IN ('feedback_event', 'learning_event', 'chat_rewrite',
                      'manual', 'client_validation', 'agency_supervision',
                      'upload_batch', 'analytics_cron')),
  source_ref uuid,
  source_refs uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  count int NOT NULL DEFAULT 1,

  intent text NOT NULL
    CHECK (intent IN ('add_paragraph', 'amend_paragraph',
                      'add_rule', 'refine_pattern', 'remove_rule')),
  target_kind text NOT NULL
    CHECK (target_kind IN ('identity', 'icp_patterns', 'scoring', 'process',
                           'templates', 'hard_rules', 'errors', 'custom')),
  target_section_id uuid REFERENCES protocol_section(id) ON DELETE SET NULL,

  proposed_text text NOT NULL,
  rationale text,
  confidence numeric(3,2) NOT NULL,

  -- Embedding pour dédup sémantique (text-embedding-3-small = 1536 dims).
  embedding vector(1536),

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'revised', 'merged')),
  user_note text,

  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_proposition_document_pending
  ON proposition (document_id, created_at DESC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_proposition_target_section
  ON proposition (target_section_id)
  WHERE target_section_id IS NOT NULL;
-- Index vectoriel pour dédup (IVF_FLAT, 100 lists — fine pour <100k props).
CREATE INDEX IF NOT EXISTS idx_proposition_embedding
  ON proposition USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ── 5. extractor_training_example ───────────────────────────
CREATE TABLE IF NOT EXISTS extractor_training_example (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  scope text NOT NULL CHECK (scope IN ('persona', 'template')),
  scope_id uuid NOT NULL,

  extractor_kind text NOT NULL,
  input_signal jsonb NOT NULL,
  proposed jsonb NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('accepted', 'revised', 'rejected')),
  revised_text text,
  user_note text,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_extractor_training_scope_kind
  ON extractor_training_example (scope, scope_id, extractor_kind, created_at DESC);

-- ── 6. RLS — service_role_all sur toutes les nouvelles tables ──
ALTER TABLE protocol_document           ENABLE ROW LEVEL SECURITY;
ALTER TABLE protocol_section            ENABLE ROW LEVEL SECURITY;
ALTER TABLE protocol_artifact           ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposition                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE extractor_training_example  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all ON protocol_document;
CREATE POLICY service_role_all ON protocol_document
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_all ON protocol_section;
CREATE POLICY service_role_all ON protocol_section
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_all ON protocol_artifact;
CREATE POLICY service_role_all ON protocol_artifact
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_all ON proposition;
CREATE POLICY service_role_all ON proposition
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_all ON extractor_training_example;
CREATE POLICY service_role_all ON extractor_training_example
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 7. Triggers updated_at ───────────────────────────────────
CREATE OR REPLACE FUNCTION set_protocol_v2_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protocol_document_updated_at ON protocol_document;
CREATE TRIGGER trg_protocol_document_updated_at
  BEFORE UPDATE ON protocol_document
  FOR EACH ROW EXECUTE FUNCTION set_protocol_v2_updated_at();

DROP TRIGGER IF EXISTS trg_protocol_section_updated_at ON protocol_section;
CREATE TRIGGER trg_protocol_section_updated_at
  BEFORE UPDATE ON protocol_section
  FOR EACH ROW EXECUTE FUNCTION set_protocol_v2_updated_at();
```

- [ ] **Step 1.1.4 — Run test, vérifier PASS**

```bash
SUPABASE_TEST_URL=... SUPABASE_TEST_SERVICE_KEY=... node --test test/protocol-v2-migration.test.js
```

Expected: PASS (2 tests).

Si pas de DB test configurée : tests skippés (normal en dev laptop). Lancer manuellement contre la dev branch Supabase avant commit.

- [ ] **Step 1.1.5 — Commit**

```bash
git add supabase/038_protocol_v2_core.sql test/protocol-v2-migration.test.js
git commit -m "feat(protocol-v2): migration 038 — core tables (doc/section/artifact/proposition/training)"
```

---

### Task 1.2 — Migration 039 : hooks persona + user

**Files:**
- Create: `supabase/039_protocol_v2_hooks.sql`

**Approach:** additif sur tables existantes. Ajoute les colonnes nullables décrites en Section 4 du spec (lifecycle client + rôle user). Pas de test unitaire dédié — la validation passe par l'intégration de task 1.4 et le backfill.

- [ ] **Step 1.2.1 — Écrire la migration**

```sql
-- ============================================================
-- Migration 039 — Protocole vivant (hooks persona + user)
--
-- Ajoute les colonnes data-only pour supporter le flux 3-acteurs
-- (agence / setter / client) défini dans la spec Section 4.
-- Aucune UI ne les utilise dans ce chunk — hooks seulement.
-- ============================================================

-- 1. persona.client_share_token / client_user_id
--    Lifecycle documenté dans spec Section 4 : token set par agence,
--    client_user_id set quand le client clique le lien et s'authentifie.
ALTER TABLE personas
  ADD COLUMN IF NOT EXISTS client_share_token uuid,
  ADD COLUMN IF NOT EXISTS client_user_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_personas_client_share_token
  ON personas (client_share_token)
  WHERE client_share_token IS NOT NULL;

COMMENT ON COLUMN personas.client_share_token IS
  'UUID token de partage /train/{token}. Généré par agence, révocable (NULL). Invariant: client_user_id != NULL ⇒ token a été set à un moment.';

-- 2. Table users — ajout rôle (si table users existe dans le schéma public)
--    Certains setups Supabase gardent auth.users + profiles publiques.
--    On check l'existence avant d'ALTER.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) THEN
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'setter'
      CHECK (role IN ('agency_admin', 'setter', 'client'));
  END IF;
END $$;
```

- [ ] **Step 1.2.2 — Appliquer la migration sur dev branch Supabase**

```bash
# Via Supabase CLI ou dashboard SQL editor — appliquer 039 après 038.
# Vérifier que personas.client_share_token existe :
psql $SUPABASE_DEV_URL -c "\d personas" | grep client_share_token
```

Expected: ligne `client_share_token | uuid |` visible.

- [ ] **Step 1.2.3 — Commit**

```bash
git add supabase/039_protocol_v2_hooks.sql
git commit -m "feat(protocol-v2): migration 039 — hooks persona (client token) + user.role"
```

---

### Task 1.3 — Data access layer `lib/protocol-v2-db.js`

**Files:**
- Create: `lib/protocol-v2-db.js`
- Test: `test/protocol-v2-db.test.js`

**Approach:** wrapper fonctionnel autour de `supabase` pour toutes les lectures protocole v2. Fonctions pures testables avec un client Supabase mocké (stub minimal). Pas d'écriture dans cette task — read-only pour Chunk 1.

- [ ] **Step 1.3.1 — Écrire le test qui fail**

```javascript
// test/protocol-v2-db.test.js
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  getActiveDocument,
  listSections,
  listArtifacts,
} from "../lib/protocol-v2-db.js";

// Stub supabase : retourne des data configurables.
function makeStub(rows) {
  return {
    from(table) {
      return {
        _rows: rows[table] || [],
        _filter: {},
        select() { return this; },
        eq(col, val) { this._filter[col] = val; return this; },
        order() { return this; },
        single() {
          const match = this._rows.find(r =>
            Object.entries(this._filter).every(([k, v]) => r[k] === v));
          return Promise.resolve({ data: match || null, error: null });
        },
        then(resolve) {
          const matches = this._rows.filter(r =>
            Object.entries(this._filter).every(([k, v]) => r[k] === v));
          resolve({ data: matches, error: null });
        },
      };
    },
  };
}

describe("protocol-v2-db", () => {
  it("getActiveDocument returns the active doc for a persona", async () => {
    const sb = makeStub({
      protocol_document: [
        { id: "d1", owner_kind: "persona", owner_id: "p1", status: "archived", version: 1 },
        { id: "d2", owner_kind: "persona", owner_id: "p1", status: "active", version: 2 },
      ],
    });
    const doc = await getActiveDocument(sb, "p1");
    assert.equal(doc?.id, "d2");
    assert.equal(doc?.version, 2);
  });

  it("getActiveDocument returns null when persona has no document", async () => {
    const sb = makeStub({ protocol_document: [] });
    const doc = await getActiveDocument(sb, "pX");
    assert.equal(doc, null);
  });

  it("listSections returns sections ordered by 'order'", async () => {
    const sb = makeStub({
      protocol_section: [
        { id: "s1", document_id: "d1", order: 1, kind: "identity", prose: "..." },
        { id: "s2", document_id: "d1", order: 0, kind: "hard_rules", prose: "..." },
      ],
    });
    const sections = await listSections(sb, "d1");
    assert.equal(sections.length, 2);
    // Stub ne trie pas — dans l'impl réelle supabase trie via .order().
    // Ici on teste juste la présence + filtrage document_id.
    assert.ok(sections.every(s => s.document_id === "d1"));
  });

  it("listArtifacts returns only active by default", async () => {
    const sb = makeStub({
      protocol_artifact: [
        { id: "a1", source_section_id: "s1", is_active: true, kind: "hard_check" },
        { id: "a2", source_section_id: "s1", is_active: false, kind: "hard_check" },
      ],
    });
    const arts = await listArtifacts(sb, "s1", { activeOnly: true });
    assert.equal(arts.length, 1);
    assert.equal(arts[0].id, "a1");
  });
});
```

- [ ] **Step 1.3.2 — Run test pour vérifier FAIL**

```bash
node --test test/protocol-v2-db.test.js
```

Expected: FAIL ("cannot find module ../lib/protocol-v2-db.js").

- [ ] **Step 1.3.3 — Écrire l'impl minimale**

```javascript
// lib/protocol-v2-db.js
// Data access layer pour le protocole vivant. Read-only dans ce chunk.
// Écritures (create/update/publish) arriveront dans les chunks 2-4.
//
// Pattern : toutes les fonctions prennent un client Supabase en premier
// argument pour permettre les tests avec un stub et l'appel via le
// singleton `supabase` de lib/supabase.js côté endpoints.

/**
 * Retourne le document ACTIVE d'une persona (max 1), ou null.
 */
export async function getActiveDocument(sb, personaId) {
  const { data, error } = await sb
    .from("protocol_document")
    .select("id, version, status, parent_template_id, created_at, updated_at")
    .eq("owner_kind", "persona")
    .eq("owner_id", personaId)
    .eq("status", "active")
    .single();
  if (error) return null;
  return data;
}

/**
 * Liste les sections d'un document dans l'ordre d'affichage.
 */
export async function listSections(sb, documentId) {
  const { data, error } = await sb
    .from("protocol_section")
    .select(
      'id, document_id, "order", kind, heading, prose, structured, inherited_from_section_id, client_visible, client_editable, author_kind, updated_at'
    )
    .eq("document_id", documentId)
    .order('"order"', { ascending: true });
  if (error) return [];
  return data || [];
}

/**
 * Liste les artifacts d'une section.
 * @param options.activeOnly  ne retourne que is_active=true (défaut true)
 */
export async function listArtifacts(sb, sectionId, { activeOnly = true } = {}) {
  let q = sb
    .from("protocol_artifact")
    .select("id, source_section_id, source_quote, kind, content, severity, scenarios, is_active, is_manual_override, content_hash, stats, created_at")
    .eq("source_section_id", sectionId);
  if (activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) return [];
  return data || [];
}

/**
 * Compte les propositions pending pour un document (badge UI).
 */
export async function countPendingPropositions(sb, documentId) {
  const { count, error } = await sb
    .from("proposition")
    .select("id", { count: "exact", head: true })
    .eq("document_id", documentId)
    .eq("status", "pending");
  if (error) return 0;
  return count || 0;
}
```

- [ ] **Step 1.3.4 — Run test, vérifier PASS**

```bash
node --test test/protocol-v2-db.test.js
```

Expected: PASS (4 tests).

- [ ] **Step 1.3.5 — Commit**

```bash
git add lib/protocol-v2-db.js test/protocol-v2-db.test.js
git commit -m "feat(protocol-v2): data access layer read-only"
```

---

### Task 1.4 — Backfill script idempotent

**Files:**
- Create: `scripts/backfill-protocol-v2.js`
- Test: `test/protocol-v2-backfill.test.js`

**Approach:** script Node exécutable en CLI. Pour chaque `operating_protocols` existant, crée un `protocol_document` + 1 section `hard_rules` + N `protocol_artifact` de kind `hard_check`. Idempotence assurée via `content_hash` (calculé depuis check_kind + check_params + severity + scenarios) : si l'artifact existe déjà en v2 pour la persona, on skippe.

Fallback prose quand `operating_protocols.raw_document` est null : on génère un résumé via LLM appelé avec `ANTHROPIC_API_KEY` (message court, "résume en prose ces règles"). Si `ANTHROPIC_API_KEY` absent, on met un placeholder déterministe ("Règles héritées du protocole v1 — upload un playbook complet pour activer les autres sections.") — le test utilise ce path.

- [ ] **Step 1.4.1 — Écrire le test qui fail**

```javascript
// test/protocol-v2-backfill.test.js
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { computeContentHash, buildBackfillPlan } from "../scripts/backfill-protocol-v2.js";

describe("backfill — content_hash", () => {
  it("produit le même hash pour deux rules sémantiquement identiques", () => {
    const r1 = {
      check_kind: "counter",
      check_params: { what: "questions", max: 1 },
      severity: "hard",
      applies_to_scenarios: ["DM_1st"],
    };
    const r2 = { ...r1, description: "libellé différent", rule_id: "slug_diff" };
    assert.equal(computeContentHash(r1), computeContentHash(r2));
  });

  it("produit des hashes différents quand check_params change", () => {
    const r1 = { check_kind: "counter", check_params: { what: "questions", max: 1 }, severity: "hard", applies_to_scenarios: [] };
    const r2 = { check_kind: "counter", check_params: { what: "questions", max: 2 }, severity: "hard", applies_to_scenarios: [] };
    assert.notEqual(computeContentHash(r1), computeContentHash(r2));
  });
});

describe("backfill — buildBackfillPlan", () => {
  it("génère un plan complet pour un protocol existant", () => {
    const protocol = {
      id: "op1", persona_id: "p1", version: 3, is_active: true,
      raw_document: null,
      rules: [
        { rule_id: "no_two_q", check_kind: "counter", check_params: { what: "questions", max: 1 }, severity: "hard", applies_to_scenarios: ["DM_1st"], source_quote: "Une seule question." },
      ],
    };
    const existingHashes = new Set();
    const plan = buildBackfillPlan(protocol, existingHashes);

    assert.equal(plan.document.owner_kind, "persona");
    assert.equal(plan.document.owner_id, "p1");
    assert.equal(plan.document.version, 3);
    assert.equal(plan.document.status, "active");
    assert.equal(plan.sections.length, 1);
    assert.equal(plan.sections[0].kind, "hard_rules");
    assert.equal(plan.artifacts.length, 1);
    assert.equal(plan.artifacts[0].kind, "hard_check");
    assert.equal(plan.artifacts[0].severity, "hard");
    assert.equal(plan.artifacts[0].content.check_kind, "counter");
    assert.ok(plan.artifacts[0].content_hash);
  });

  it("skip les artifacts déjà présents (content_hash match)", () => {
    const rule = { check_kind: "counter", check_params: { what: "questions", max: 1 }, severity: "hard", applies_to_scenarios: [] };
    const existingHash = computeContentHash(rule);
    const protocol = { id: "op1", persona_id: "p1", version: 1, is_active: false, raw_document: null, rules: [{ ...rule, rule_id: "r1" }] };
    const plan = buildBackfillPlan(protocol, new Set([existingHash]));
    assert.equal(plan.artifacts.length, 0, "l'artifact existant doit être skippé");
  });

  it("fallback prose déterministe quand raw_document est null et pas de LLM", () => {
    const protocol = {
      id: "op1", persona_id: "p1", version: 1, is_active: false,
      raw_document: null,
      rules: [{ rule_id: "r1", check_kind: "counter", check_params: {}, severity: "hard", applies_to_scenarios: [] }],
    };
    const plan = buildBackfillPlan(protocol, new Set());
    assert.ok(plan.sections[0].prose.includes("Règles héritées"),
      "fallback prose doit mentionner 'Règles héritées'");
  });
});
```

- [ ] **Step 1.4.2 — Run test, vérifier FAIL**

```bash
node --test test/protocol-v2-backfill.test.js
```

Expected: FAIL ("cannot find module ../scripts/backfill-protocol-v2.js").

- [ ] **Step 1.4.3 — Écrire le script**

```javascript
// scripts/backfill-protocol-v2.js
// Migre les `operating_protocols` + `protocol_hard_rules` existants vers
// le nouveau modèle (protocol_document + section hard_rules + artifacts).
//
// Idempotent : re-jouer ne duplique rien (content_hash).
// CLI : node scripts/backfill-protocol-v2.js [--dry-run] [--persona=<id>]

import crypto from "node:crypto";

const FALLBACK_PROSE =
  "Règles héritées du protocole v1. " +
  "Upload un playbook complet pour activer les sections patterns/scoring/process.";

/**
 * Hash stable sur la SÉMANTIQUE d'une règle (pas son libellé).
 * Inclut : check_kind, check_params (JSON canonique), severity, scenarios triés.
 */
export function computeContentHash(rule) {
  const canonical = {
    check_kind: rule.check_kind,
    check_params: canonicalJson(rule.check_params || {}),
    severity: rule.severity || "hard",
    scenarios: [...(rule.applies_to_scenarios || [])].sort(),
  };
  const str = JSON.stringify(canonical);
  return crypto.createHash("sha256").update(str).digest("hex");
}

function canonicalJson(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(canonicalJson);
  const keys = Object.keys(obj).sort();
  const out = {};
  for (const k of keys) out[k] = canonicalJson(obj[k]);
  return out;
}

/**
 * Construit le plan d'insertion pour UN `operating_protocols` row.
 * Pure fonction — pas d'I/O, testable.
 *
 * @param protocol          row operating_protocols incluant .rules (hard_rules jointe)
 * @param existingHashes    Set<string> des content_hash déjà présents en v2 pour cette persona
 * @returns { document, sections, artifacts }
 */
export function buildBackfillPlan(protocol, existingHashes) {
  const documentId = crypto.randomUUID();
  const sectionId = crypto.randomUUID();

  const document = {
    id: documentId,
    owner_kind: "persona",
    owner_id: protocol.persona_id,
    version: protocol.version || 1,
    status: protocol.is_active ? "active" : "archived",
    created_at: new Date().toISOString(),
  };

  const section = {
    id: sectionId,
    document_id: documentId,
    order: 0,
    kind: "hard_rules",
    heading: "Règles absolues",
    prose: protocol.raw_document || FALLBACK_PROSE,
    structured: null,
    author_kind: "auto_extraction",
  };

  const artifacts = [];
  for (const rule of (protocol.rules || [])) {
    const hash = computeContentHash(rule);
    if (existingHashes.has(hash)) continue;
    artifacts.push({
      id: crypto.randomUUID(),
      source_section_id: sectionId,
      source_quote: rule.source_quote || null,
      kind: "hard_check",
      content: {
        check_kind: rule.check_kind,
        check_params: rule.check_params || {},
      },
      severity: rule.severity || "hard",
      scenarios: rule.applies_to_scenarios || null,
      is_active: true,
      is_manual_override: false,
      content_hash: hash,
      stats: { fires: 0, last_fired_at: null, accuracy: null },
    });
  }

  return { document, sections: [section], artifacts };
}

// ── CLI runner ───────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const personaFilter = args.find(a => a.startsWith("--persona="))?.split("=")[1];

  const { supabase } = await import("../lib/supabase.js");

  let q = supabase
    .from("operating_protocols")
    .select("id, persona_id, version, is_active, raw_document, protocol_hard_rules(*)");
  if (personaFilter) q = q.eq("persona_id", personaFilter);
  const { data: protocols, error } = await q;
  if (error) { console.error(error); process.exit(1); }

  let stats = { personas: 0, documents: 0, sections: 0, artifacts: 0, skipped: 0 };
  for (const p of protocols) {
    const protocol = { ...p, rules: p.protocol_hard_rules || [] };

    // Charge hashes déjà présents pour cette persona (idempotence cross-protocol).
    const { data: existing } = await supabase
      .from("protocol_artifact")
      .select("content_hash, protocol_section!inner(document_id, protocol_document!inner(owner_id))")
      .eq("protocol_section.protocol_document.owner_id", p.persona_id);
    const existingHashes = new Set((existing || []).map(r => r.content_hash));

    const plan = buildBackfillPlan(protocol, existingHashes);
    if (plan.artifacts.length === 0 && existingHashes.size > 0) {
      stats.skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`[dry] persona=${p.persona_id} doc_v${plan.document.version} +${plan.artifacts.length} artifacts`);
      continue;
    }

    await supabase.from("protocol_document").insert(plan.document);
    await supabase.from("protocol_section").insert(plan.sections);
    if (plan.artifacts.length > 0) {
      await supabase.from("protocol_artifact").insert(plan.artifacts);
    }
    stats.personas++;
    stats.documents++;
    stats.sections += plan.sections.length;
    stats.artifacts += plan.artifacts.length;
  }

  console.log("Backfill done:", stats);
}

// Exécuter uniquement si appelé directement (pas en import test).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 1.4.4 — Run test, vérifier PASS**

```bash
node --test test/protocol-v2-backfill.test.js
```

Expected: PASS (5 tests).

- [ ] **Step 1.4.5 — Test dry-run sur dev branch**

```bash
node scripts/backfill-protocol-v2.js --dry-run
```

Expected: lignes `[dry] persona=... doc_v1 +N artifacts` listant chaque persona ayant un `operating_protocols` existant. Vérifier le count correspond à ce qu'on attend (combien de personas ont un protocole aujourd'hui, via `SELECT count(*) FROM operating_protocols;`).

- [ ] **Step 1.4.6 — Run backfill réel sur dev branch**

```bash
node scripts/backfill-protocol-v2.js
```

Expected: `Backfill done: { personas: N, documents: N, sections: N, artifacts: M, skipped: 0 }`.

- [ ] **Step 1.4.7 — Vérifier idempotence : re-run**

```bash
node scripts/backfill-protocol-v2.js
```

Expected: `Backfill done: { personas: 0, ..., skipped: N }` (rien de nouveau ajouté).

- [ ] **Step 1.4.8 — Commit**

```bash
git add scripts/backfill-protocol-v2.js test/protocol-v2-backfill.test.js
git commit -m "feat(protocol-v2): backfill idempotent depuis operating_protocols"
```

---

### Task 1.5 — API v2 read-only endpoint

**Files:**
- Create: `api/v2/protocol.js`
- Test: `test/api-v2-protocol.test.js`

**Approach:** endpoint `GET /api/v2/protocol?persona=<id>` qui retourne `{ document, sections: [{ ...section, artifacts: [...] }], pendingPropositionsCount }`. Auth reprend exactement `authenticateRequest` + `hasPersonaAccess` comme `api/protocol.js` existant.

Le test unitaire mock `authenticateRequest` et le data access layer pour valider le shape de la réponse. Le test d'intégration end-to-end se fait manuellement via `curl` sur Vercel preview (step 1.5.6).

- [ ] **Step 1.5.1 — Écrire le test qui fail**

```javascript
// test/api-v2-protocol.test.js
import { strict as assert } from "node:assert";
import { describe, it, mock } from "node:test";

describe("GET /api/v2/protocol", () => {
  it("retourne 400 si persona manquant", async () => {
    // Mock authenticateRequest pour qu'il passe.
    mock.module("../lib/supabase.js", {
      namedExports: {
        authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: true }),
        hasPersonaAccess: async () => true,
        supabase: {},
        setCors: () => {},
      },
    });
    const { default: handler } = await import("../api/v2/protocol.js");
    const req = { method: "GET", query: {} };
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res._body.error, /persona is required/i);
  });

  it("retourne 403 si persona access denied", async () => {
    mock.module("../lib/supabase.js", {
      namedExports: {
        authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: false }),
        hasPersonaAccess: async () => false,
        supabase: {},
        setCors: () => {},
      },
    });
    const { default: handler } = await import("../api/v2/protocol.js");
    const req = { method: "GET", query: { persona: "p1" } };
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 403);
  });

  it("retourne doc + sections + artifacts pour persona autorisée", async () => {
    mock.module("../lib/supabase.js", {
      namedExports: {
        authenticateRequest: async () => ({ client: { id: "c1" }, isAdmin: true }),
        hasPersonaAccess: async () => true,
        supabase: {},
        setCors: () => {},
      },
    });
    mock.module("../lib/protocol-v2-db.js", {
      namedExports: {
        getActiveDocument: async () => ({ id: "d1", version: 2, status: "active" }),
        listSections: async () => [{ id: "s1", document_id: "d1", kind: "hard_rules", prose: "...", order: 0 }],
        listArtifacts: async () => [{ id: "a1", source_section_id: "s1", kind: "hard_check", is_active: true }],
        countPendingPropositions: async () => 3,
      },
    });
    const { default: handler } = await import("../api/v2/protocol.js");
    const req = { method: "GET", query: { persona: "p1" } };
    const res = makeRes();
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res._body.document.id, "d1");
    assert.equal(res._body.sections.length, 1);
    assert.equal(res._body.sections[0].artifacts.length, 1);
    assert.equal(res._body.pendingPropositionsCount, 3);
  });
});

function makeRes() {
  return {
    statusCode: 200,
    _body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this._body = b; return this; },
    end() { return this; },
  };
}
```

- [ ] **Step 1.5.2 — Run test, vérifier FAIL**

```bash
node --test test/api-v2-protocol.test.js
```

Expected: FAIL ("cannot find module ../api/v2/protocol.js").

- [ ] **Step 1.5.3 — Écrire l'endpoint**

```javascript
// api/v2/protocol.js
// Protocole v2 — endpoint read-only.
//
// GET /api/v2/protocol?persona=<id>
//   → { document, sections: [{ ...s, artifacts: [...] }], pendingPropositionsCount }
//
// Auth: identique à api/protocol.js (authenticateRequest + hasPersonaAccess).
// Écritures (save prose, accept proposition, publish) dans chunks 2-4.

export const maxDuration = 15;

import {
  authenticateRequest,
  supabase,
  hasPersonaAccess,
  setCors,
} from "../../lib/supabase.js";
import {
  getActiveDocument,
  listSections,
  listArtifacts,
  countPendingPropositions,
} from "../../lib/protocol-v2-db.js";

export default async function handler(req, res) {
  setCors(res, "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  const personaId = req.query?.persona;
  if (!personaId) {
    res.status(400).json({ error: "persona is required" });
    return;
  }
  if (!isAdmin && !(await hasPersonaAccess(client?.id, personaId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const document = await getActiveDocument(supabase, personaId);
  if (!document) {
    // Persona sans document v2 encore (backfill pas passé, ou nouvelle persona).
    res.status(200).json({ document: null, sections: [], pendingPropositionsCount: 0 });
    return;
  }

  const sections = await listSections(supabase, document.id);
  const sectionsWithArtifacts = await Promise.all(
    sections.map(async (s) => ({
      ...s,
      artifacts: await listArtifacts(supabase, s.id, { activeOnly: true }),
    })),
  );
  const pendingPropositionsCount = await countPendingPropositions(supabase, document.id);

  res.status(200).json({
    document,
    sections: sectionsWithArtifacts,
    pendingPropositionsCount,
  });
}
```

- [ ] **Step 1.5.4 — Run test, vérifier PASS**

```bash
node --test test/api-v2-protocol.test.js
```

Expected: PASS (3 tests).

- [ ] **Step 1.5.5 — Commit**

```bash
git add api/v2/protocol.js test/api-v2-protocol.test.js
git commit -m "feat(protocol-v2): GET /api/v2/protocol read-only endpoint"
```

- [ ] **Step 1.5.6 — Push preview + verif end-to-end UI-less**

```bash
git push origin HEAD
```

Attendre que Vercel build le preview URL. Tester avec `curl` :

```bash
# Remplacer X par un persona_id qu'on sait avoir un operating_protocols.
# ACCESS_CODE = code client valide.
curl -s -H "x-access-code: $ACCESS_CODE" \
  "https://<preview-url>/api/v2/protocol?persona=X" | jq .
```

Expected : JSON avec `document.version > 0`, `sections[0].kind == "hard_rules"`, `sections[0].artifacts.length > 0`. Chaque artifact a `kind: "hard_check"` et `content.check_kind` (counter / regex / max_length / structural).

Comparer avec l'ancien `/api/protocol?persona=X` : le nombre de règles doit matcher le nombre d'artifacts.

---

### Task 1.6 — Verif Chunk 1 (audit global)

- [ ] **Step 1.6.1 — Run tous les tests du chunk**

```bash
node --test test/protocol-v2-migration.test.js test/protocol-v2-db.test.js test/protocol-v2-backfill.test.js test/api-v2-protocol.test.js
```

Expected: tous PASS (ou skip si pas de DB test pour migration.test).

- [ ] **Step 1.6.2 — Verif absence de régression sur existant**

```bash
# Test que l'ancienne API et l'UI existante tournent toujours.
curl -s -H "x-access-code: $ACCESS_CODE" \
  "https://<preview-url>/api/protocol?persona=X" | jq '.protocols | length'
```

Expected: même nombre qu'avant (non-zéro si persona a un protocol).

- [ ] **Step 1.6.3 — Ouvrir PR**

```bash
gh pr create --title "feat(protocol-v2): Sprint 1 — core infra data" --body "$(cat <<'EOF'
## Summary
- Migration 038 : 5 tables core (document/section/artifact/proposition/training_example) + pgvector
- Migration 039 : hooks persona (client_share_token, client_user_id) + user.role
- `lib/protocol-v2-db.js` : read-only data layer
- `scripts/backfill-protocol-v2.js` : migration idempotente depuis operating_protocols
- `GET /api/v2/protocol?persona=X` : endpoint read-only

## Test plan
- [x] `node --test test/protocol-v2-*.test.js` (tous PASS)
- [x] `node scripts/backfill-protocol-v2.js --dry-run` sur dev branch
- [x] `node scripts/backfill-protocol-v2.js` deux fois → deuxième run skip tout
- [x] `GET /api/v2/protocol?persona=X` sur preview retourne le shape attendu
- [x] `GET /api/protocol?persona=X` (legacy) continue à retourner ses rules intactes

Spec : `docs/superpowers/specs/2026-04-24-protocole-vivant-design.md`
Plan : `docs/superpowers/plans/2026-04-24-protocole-vivant-plan.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 1.6.4 — Merge master (après review humaine ou flow preview testé)**

```bash
# Uniquement si la section 1.5.6 a confirmé que le flow tourne sur preview.
# Respecter feedback_prod_without_ui_test.md — jamais merge sans cette verif.
gh pr merge --merge --delete-branch
```

---

## Chunk 2: Sprint 2 — Extractors + propositions queue (OUTLINE)

**Scope :** un extracteur LLM par `target_kind`, pipeline signal → extracteur → dédup sémantique → queue. Backend seulement.

**À détailler dans une session future** — voici les tâches à cadrer :

- **Task 2.1** `lib/protocol-v2-embeddings.js` + `text-embedding-3-small` wrapper + dédup sémantique via pgvector (`<=>` cosine distance)
- **Task 2.2** `lib/protocol-v2-extractors/hard_rules.js` — prompt + parsing + tests sur fixtures de corrections
- **Task 2.3** `lib/protocol-v2-extractors/errors.js` — do/don't extraction
- **Task 2.4** `lib/protocol-v2-extractors/{patterns,scoring,process,templates}.js` (un fichier par kind)
- **Task 2.5** `lib/protocol-v2-extractor-router.js` — classifier léger qui route signal → bon extracteur (LLM call short ou règles statiques selon source)
- **Task 2.6** `api/v2/propositions.js` — CRUD (list by document, accept, reject, revise)
- **Task 2.7** `scripts/feedback-event-to-proposition.js` — cron qui drain `feedback_events` → `proposition`
- **Task 2.8** `api/v2/protocol/extract.js` — endpoint `POST save-prose` avec extraction inline + timeout 15s + kill-switch `PROTOCOL_V2_EXTRACTION`
- **Task 2.9** Tests end-to-end : correction chat → event → proposition pending → accept → artifact visible via API v2

**Verif chunk :** une correction chat produit une proposition pending visible via `GET /api/v2/propositions?document=<id>&status=pending`.

---

## Chunk 2.5: Training signal capture (OUTLINE)

Reprend le spec archivé [`docs/superpowers/specs/2026-04-23-training-signal-capture-design.md`](../specs/2026-04-23-training-signal-capture-design.md) — la PR #50 a été fermée pour collision de numéros de migration (036-039 étaient repris par la PR protocol-v2). On rejoue sur les numéros 040-043, libres depuis les migrations 038/039 du Chunk 1.

**Pourquoi ce Chunk s'insère entre 2 et 3 :**
- Chunk 2 construit `scripts/feedback-event-to-proposition.js` qui drain `feedback_events → proposition`. Les deux nouveaux signaux implicites (`copy_paste_out` ~60% des actions user quotidiennes, `regen_rejection` ~15%) doivent exister **avant** que ce cron tourne — sinon il ne voit que les corrections explicites, 80% du signal d'apprentissage reste muet.
- Chunk 3 refond la page chat (retrait FeedbackPanel, ajout badge propositions). On veut les hooks signaux en place **avant** cette refonte, pas bolt-on après — éviter de retoucher `+page.svelte` deux fois.

**Scope :** phases 1 + 2 du spec archivé seulement. Phase 3 (edit_diff UX, N3 cron, N4 chip) reste explicitement future work hors de ce chunk.

### Tâches cadre

- **Task 2.5.1** `supabase/040_corrections_enrichment.sql` — ALTER `corrections` : `source_channel TEXT NOT NULL DEFAULT 'explicit_button'` avec CHECK enum (11 valeurs : `explicit_button`, `client_validated`, `edit_diff`, `copy_paste_out`, `regen_rejection`, `chat_correction`, `negative_feedback`, `direct_instruction`, `coaching_correction`, `metacognitive_n3`, `proactive_n4`), `confidence_weight NUMERIC(3,2) NOT NULL DEFAULT 1.0`, `is_implicit BOOLEAN NOT NULL DEFAULT false`. Index sur `source_channel` et `confidence_weight DESC`. Idempotent `ADD COLUMN IF NOT EXISTS`.

- **Task 2.5.2** `supabase/041_rule_proposals.sql` — créer table `rule_proposals` (id, persona_id FK cascade, conversation_id FK nullable, rule_text, evidence_message_ids uuid[], pattern_type enum [style_drift, repeated_rejection, silent_constraint, contradiction], confidence numeric(3,2) CHECK [0,1], status enum [pending, accepted, rejected, superseded] default pending, proposed_at, decided_at, decided_by_event_id). Ajouter `conversations.last_rescan_at TIMESTAMPTZ` + index partiel `WHERE last_rescan_at IS NULL OR last_rescan_at < last_message_at`. Data only — aucun cron dans ce chunk.

- **Task 2.5.3** `supabase/042_n4_pause.sql` — `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS n4_paused_until TIMESTAMPTZ`. Data only — le chip N4 qui lira cette colonne vient phase 3c future.

- **Task 2.5.4** `supabase/043_promoted_rule_index.sql` — `ALTER TABLE corrections ADD COLUMN IF NOT EXISTS promoted_to_rule_index INTEGER`. Réservé pour tracer quel rule index chaque graduated correction a alimenté. Non lu aujourd'hui.

- **Task 2.5.5** `api/feedback.js` — ajouter deux branches dans le handler :
  - `if (type === 'copy_paste_out')` → insère `corrections` row avec prefix `[COPY_PASTE_OUT]` sur `correction_text`, `source_channel='copy_paste_out'`, `confidence_weight=0.6`, `is_implicit=true`. Entities matched dans le draft : `confidence += 0.03` (cap 1.0).
  - `if (type === 'regen_rejection')` → même shape, prefix `[REGEN_REJECTED]`, `confidence_weight=0.5`. Entities matched : `confidence -= 0.03` (floor 0.0).
  - Étendre `META_MARKERS` côté `/api/feedback` filtre du panel intelligence : ajouter `[COPY_PASTE_OUT]`, `[REGEN_REJECTED]` aux 3 existants.

- **Task 2.5.6** UI wiring :
  - `src/lib/components/ChatMessage.svelte` — exposer le prop `onCopyBlock` dans le JSX (actuellement déclaré mais jamais câblé — dead code).
  - `src/routes/chat/[persona]/+page.svelte` — `handleCopyBlock(message, block)` qui POST `/api/feedback` avec `type:'copy_paste_out'`, best-effort (fire-and-forget, pas de spinner).
  - `handleRegen` — avant le PATCH existant `turn_kind`, fire `POST /api/feedback` `type:'regen_rejection'`. Non-bloquant si erreur.

- **Task 2.5.7** `api/feedback-events.js` — `VALID_TYPES` : retirer `validated_edited` (dead code, aucun UI qui le fire), ajouter `rule_proposal_accepted`, `rule_proposal_rejected`, `rule_proposal_edited` (réservés phase 3c).

- **Task 2.5.8** `lib/correction-consolidation.js` — **promotion gate pondéré** :
  - Remplacer `const MIN_CLUSTER_SIZE = 3;` par `const MIN_CLUSTER_MEMBERS = 2;` + `const MIN_CLUSTER_WEIGHT_SUM = 2.0;`.
  - Ajouter `clusterWeight(cluster) = cluster.members.reduce((sum, i) => sum + (corrections[i].confidence ?? 0.8) * (corrections[i].confidence_weight ?? 1.0), 0)`.
  - Gate : `cluster.members.length >= MIN_CLUSTER_MEMBERS && clusterWeight(cluster) >= MIN_CLUSTER_WEIGHT_SUM`.
  - Tests étendus dans `test/correction-consolidation.test.js` avec fixtures mix implicit/explicit (cf. table §6.1 du spec archivé).

- **Task 2.5.9** `lib/correction-consolidation.js` — **eviction par poids agrégé** :
  - Remplacer FIFO eviction par : query `corrections where status='graduated' and graduated_rule IN (currentRules)` → `sum(confidence × confidence_weight)` par rule → rank ASC (ties FIFO) → evict overflow weakest.
  - Emit log `writing_rules_evicted` avec `{ evicted_count, kept_count, top5_weakest_weights }`.

- **Task 2.5.10** `consolidation_complete` log étendu : ajouter à la payload `weight_sum_by_promotable` (array), `explicit_count` (is_implicit=false), `implicit_count` (is_implicit=true). Purpose : détecter implicit-signal spam (bot copy_paste floods) et weight drift.

- **Task 2.5.11** **Bridge vers Chunk 2** — `scripts/feedback-event-to-proposition.js` (Chunk 2 Task 2.7) doit **aussi** consommer les `corrections` avec `source_channel IN ('copy_paste_out', 'regen_rejection', 'edit_diff', 'chat_correction', …)` et les router vers l'extracteur approprié :
  - `copy_paste_out` avec entities matched + `confidence_weight >= 0.6` → proposition `intent=refine_pattern` (the draft's patterns were accepted as-is).
  - `regen_rejection` avec entities → proposition `intent=add_rule` ou `amend_paragraph` (something in the draft was wrong).
  - Seuil pour créer une proposition single-shot vs. attendre cluster : `confidence_weight >= 0.8` → direct, sinon attend N≥2 signaux similaires (dédup embedding Chunk 2).

### Verif chunk

- `node --test test/correction-consolidation.test.js` avec 8+ scénarios mix implicit/explicit → promote corrects, eviction respecte les poids.
- Test intégration sur Vercel preview : copier un draft dans la page chat → `SELECT correction_text, source_channel, confidence_weight, is_implicit FROM corrections ORDER BY created_at DESC LIMIT 1;` → row `[COPY_PASTE_OUT]`, `source_channel='copy_paste_out'`, `confidence_weight=0.60`, `is_implicit=true`. Idem `↻ regen` → `[REGEN_REJECTED]`.
- Test bridge (exécuté une fois Chunk 2 en place) : 3 × `copy_paste_out` sur même règle implicite (même entities matched dans 3 drafts différents) → vérifier une `proposition` pending créée par le cron avec `source='chat_rewrite'` ou équivalent.

### Backward compat

- Toutes migrations `ADD COLUMN IF NOT EXISTS` avec defaults → zero data loss, zero read breakage.
- `DEFAULT 'explicit_button'` sur `source_channel` = toutes les corrections pré-existantes restent taggées explicit → gate backward compat `3 × 1.0 × 0.8 = 2.40 ≥ 2.0` passe toujours (cf. table §6.1).
- Rollback : retirer les 2 branches `if (type === …)` dans `api/feedback.js` + les handler wirings UI. Colonnes SQL restent (cheap to keep).

### Notes & risques

- **Regarder PR #50 closed** avant de coder : commits `b29560d` (migrations), `d634195` (Phase 1 UI+api), `61d30d0` (Phase 2 consolidation). Le code était fonctionnel mais les numéros de migration ont collisionné avec master. On peut cherry-pick en réécrivant les numéros.
- **Risque principal** : `handleCopyBlock` était implémenté dans PR #50 mais la mémoire `feedback_keep_moving` a saved "`onCopyBlock` était wired as `() => {}` — highest-frequency action, zero persistence". Bien vérifier avec un test E2E qu'aucun clic de copy n'est perdu.
- **Phase 3 (edit_diff UX, N3 rescan cron, N4 chip)** = sous-spec dédié si ces signaux deviennent nécessaires après observation de la courbe implicit/explicit en prod.

---

## Chunk 3: Sprint 3 — UI Doctrine + Registre + édition prose + SSE (OUTLINE)

**Scope :** toute la surface UI côté persona (page Protocole). Pas la page Propositions (chunk 4).

**Tâches cadre :**

- **Task 3.1** `ProtocolDoctrine.svelte` — vue lecture (TOC gauche + prose center + pulse sur paragraph)
- **Task 3.2** `ProtocolArtifactAccordion.svelte` — accordéon inline sous paragraphe
- **Task 3.3** `ProtocolRegistry.svelte` — tableau virtualisé avec TanStack Virtual
- **Task 3.4** `ProtocolSectionEditor.svelte` — éditeur prose + call à `/api/v2/protocol/extract` + diff d'extraction
- **Task 3.5** `api/v2/protocol/stream.js` — endpoint SSE pour tirs live + activity feed
- **Task 3.6** `ProtocolActivityFeed.svelte` — consomme SSE
- **Task 3.7** `ProtocolPanel.svelte` — devient un shim qui render ancienne UI OU nouvelle selon feature flag `flags.new_protocol_ui`
- **Task 3.8** Feature flag système (lecture env `NEW_PROTOCOL_UI_PERSONAS=uuid1,uuid2` ou équivalent)
- **Task 3.9** Exercice flow complet sur 1 persona flaggée via Vercel preview

**Verif chunk :** sur une persona flaggée, l'onglet Protocole affiche la nouvelle UI, la prose peut être éditée, un tir d'artifact en prod pulse le §source, l'activity feed bouge.

---

## Chunk 4: Sprint 4 — UI propositions + versioning (OUTLINE)

**Tâches cadre :**

- **Task 4.1** `ProtocolPropositionsQueue.svelte` — queue groupée par §target, filtres, batch actions
- **Task 4.2** `ProtocolPropositionCard.svelte` — carte individuelle avec accept/revise/reject
- **Task 4.3** `api/v2/propositions/accept.js` — mutation : crée/amende artifact + patch prose + log `extractor_training_example` positif
- **Task 4.4** `api/v2/propositions/reject.js` — mutation : log `extractor_training_example` négatif
- **Task 4.5** `lib/protocol-v2-versioning.js` — publish atomique + préservation stats via content_hash
- **Task 4.6** `api/v2/protocol/publish.js` — POST publish draft → active
- **Task 4.7** `ProtocolVersionBar.svelte` — UI draft/active/publier/rollback
- **Task 4.8** Tests versioning : éditer prose → publish → vérifier stats préservées pour artifacts inchangés

**Verif chunk :** version bump n'efface pas les `stats.fires` des artifacts dont `content_hash` n'a pas bougé.

---

## Chunk 5: Sprint 5 — Scope agence + hooks client (OUTLINE)

**Tâches cadre :**

- **Task 5.1** `supabase/044_protocol_v2_templates.sql` — index sur `protocol_document` pour owner_kind=template
- **Task 5.2** `api/v2/templates.js` — CRUD template côté agence
- **Task 5.3** `api/v2/templates/{id}/inherit.js` — mécanique persona hérite d'un template
- **Task 5.4** Notification opt-in quand template évolue (cron ou realtime Supabase)
- **Task 5.5** `AgencyDashboard.svelte` — portfolio personas, health, top artifacts, propositions agency-wide
- **Task 5.6** Cron sémantique agency-wide (propositions ≥3 personas → escalade template)
- **Task 5.7** `api/v2/personas/share-token.js` — génération/révocation token client
- **Task 5.8** Data hooks `client_visible` / `client_editable` respectés par API (filtre en sortie selon `user.role`)

**Verif chunk :** template v+1 déclenche une notification sur chaque persona héritée ; un client avec token peut voir les sections `client_visible` seulement.

---

## Chunk 6: Sprint 6 — Extracteur self-improvement (OUTLINE)

**Tâches cadre :**

- **Task 6.1** `scripts/regenerate-extractor-prompt.js` — script hebdo qui pour chaque `extractor_kind` sélectionne 10 few-shots positifs + 10 négatifs balanced, régénère le prompt, sauvegarde version
- **Task 6.2** `lib/protocol-v2-extractors/{kind}.js` refacto pour charger prompt depuis table `extractor_prompt` (version courante)
- **Task 6.3** Table `extractor_prompt` (version, prompt_text, activated_at) — migration 041
- **Task 6.4** Test e2e : injecter 20 signaux jumeaux rejetés → 21e signal produit prop `confidence < 0.5`
- **Task 6.5** Metric dashboard : accept rate par extracteur over time

**Verif chunk :** cf spec Section 5, Sprint 6 — verif e2e mesurable.

---

## Notes d'exécution

- **Une PR par chunk.** Chaque PR doit (a) passer tous les tests node ; (b) être exercée end-to-end sur Vercel preview avant merge master (per `feedback_prod_without_ui_test`).
- **Feature flag par persona dès Chunk 3** — pas de big-bang UI.
- **Kill-switch `PROTOCOL_V2_EXTRACTION=false`** disponible dès Chunk 2 pour désactiver l'extraction auto en urgence.
- **Ne pas toucher `api/protocol.js` ni `ProtocolPanel.svelte` avant Chunk 3** — zéro risque de régression dans les 2 premiers chunks.
- **Synthèse + commit fréquent** — chaque task = 1 commit atomique.
