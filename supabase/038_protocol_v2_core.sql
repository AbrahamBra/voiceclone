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
  -- Pas d'updated_at : mutations live via stats.last_fired_at; les autres champs sont write-once (set à la création, ou replaced via override manuel).

  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN protocol_artifact.content_hash IS
  'Hash normalisé (sens, pas ponctuation) — préserve stats.fires cross-version quand un paragraphe est reformulé sans changer le sens.';

CREATE INDEX IF NOT EXISTS idx_protocol_artifact_section
  ON protocol_artifact (source_section_id);
CREATE INDEX IF NOT EXISTS idx_protocol_artifact_active_kind
  ON protocol_artifact (kind)
  WHERE is_active = true;
-- Pas de UNIQUE sur content_hash : deux artifacts peuvent légitimement porter le même hash
-- s'ils ciblent des sections différentes. La préservation des stats cross-version est
-- gérée côté application (scripts/backfill-protocol-v2.js) via lookup explicite.
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
  -- source_ref: event déclencheur canonique (premier signal qui a créé la proposition).
  -- source_refs: tous les events contribuants (append on merge). Invariant à la création:
  -- source_ref = source_refs[0], count = len(source_refs).
  source_ref uuid,
  source_refs uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  count int NOT NULL DEFAULT 1,

  intent text NOT NULL
    CHECK (intent IN ('add_paragraph', 'amend_paragraph',
                      'add_rule', 'refine_pattern', 'remove_rule')),
  -- Keep this CHECK list in sync with protocol_section.kind above.
  target_kind text NOT NULL
    CHECK (target_kind IN ('identity', 'icp_patterns', 'scoring', 'process',
                           'templates', 'hard_rules', 'errors', 'custom')),
  target_section_id uuid REFERENCES protocol_section(id) ON DELETE SET NULL,

  proposed_text text NOT NULL,
  rationale text,
  confidence numeric(3,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),

  -- Embedding pour dédup sémantique (text-embedding-3-small = 1536 dims).
  embedding vector(1536),

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'revised', 'merged')),
  user_note text,

  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
  -- Pas d'updated_at général : resolved_at capture la seule transition d'intérêt (pending → autre). Édits pending mineurs (user_note) non tracés intentionnellement.
);

CREATE INDEX IF NOT EXISTS idx_proposition_document_pending
  ON proposition (document_id, created_at DESC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_proposition_target_section
  ON proposition (target_section_id)
  WHERE target_section_id IS NOT NULL;
-- HNSW préféré à ivfflat car construit incrémental : ne dépend pas du contenu au CREATE. Default params (m=16, ef_construction=64) conviennent jusqu'à ~1M rows.
CREATE INDEX IF NOT EXISTS idx_proposition_embedding
  ON proposition USING hnsw (embedding vector_cosine_ops);

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
  -- Table immuable par design : corpus d'entraînement append-only. Aucun trigger updated_at.
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
