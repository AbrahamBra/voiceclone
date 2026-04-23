-- ============================================================
-- Migration 036 — Operating protocols (Phase 1: hard rules)
--
-- Transforme VoiceClone d'un outil RAG passif en système piloté par
-- protocole opérationnel structuré. Un client upload un playbook
-- ("Process Setter" d'un coach, etc.) en cochant "Operating Protocol" →
-- parser structuré extrait les règles absolues → après validation
-- manuelle opérateur, le pipeline chat les applique en PASS 2d
-- (blocage + rewrite automatique).
--
-- Scope Phase 1 :
--   - Table operating_protocols (1 row par fichier source)
--   - Table protocol_hard_rules (règles bloquantes extraites)
--   - Colonne knowledge_files.document_type (routing upload)
--
-- Phases 2+ (non incluses) :
--   - protocol_scoring_rubric / protocol_decision_table / protocol_icp
--   - protocol_message_templates / protocol_handoff_format
--   - protocol_nurture_cadence / handoff_briefs
--   - conversations.protocol_scores
--
-- Additif uniquement — aucun DROP.
-- ============================================================

-- 1. Document type sur knowledge_files (route upload)
ALTER TABLE knowledge_files
  ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'generic'
    CHECK (document_type IN ('voice_reference', 'operating_protocol', 'generic'));

COMMENT ON COLUMN knowledge_files.document_type IS
  'voice_reference = exemples de style/messages envoyés. operating_protocol = playbook structuré (règles, rubric, templates). generic = autre doc utile en RAG.';

CREATE INDEX IF NOT EXISTS idx_knowledge_files_doc_type
  ON knowledge_files (persona_id, document_type)
  WHERE document_type <> 'generic';

-- 2. operating_protocols — 1 par fichier source
CREATE TABLE IF NOT EXISTS operating_protocols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id uuid REFERENCES personas(id) ON DELETE CASCADE NOT NULL,
  source_file_id uuid REFERENCES knowledge_files(id) ON DELETE CASCADE,

  -- Lifecycle: pending (en attente parsing) → parsed (prêt à activer) → failed
  --            is_active gère séparément l'activation (toggle opérateur)
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'parsed', 'failed')),
  is_active boolean NOT NULL DEFAULT false,
  version int NOT NULL DEFAULT 1,
  activated_at timestamptz,

  -- Audit trail du parse (opérateur peut relire / debug)
  raw_document text,
  parsed_json jsonb,
  parser_model text,
  parser_confidence numeric(3,2),
  parse_error text,
  parse_attempts int NOT NULL DEFAULT 0,
  parse_attempted_at timestamptz,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE operating_protocols IS
  'Protocole opérationnel parsé depuis un knowledge_file de type operating_protocol. Active un lot de hard_rules côté pipeline chat.';
COMMENT ON COLUMN operating_protocols.is_active IS
  'Activation manuelle obligatoire par l''opérateur (garde-fou anti parsing faux).';

CREATE INDEX IF NOT EXISTS idx_operating_protocols_persona
  ON operating_protocols (persona_id);
CREATE INDEX IF NOT EXISTS idx_operating_protocols_active
  ON operating_protocols (persona_id)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_operating_protocols_pending
  ON operating_protocols (created_at)
  WHERE status = 'pending';

-- 3. protocol_hard_rules — règles absolues bloquantes extraites
CREATE TABLE IF NOT EXISTS protocol_hard_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id uuid REFERENCES operating_protocols(id) ON DELETE CASCADE NOT NULL,

  -- slug stable (ex: "never_two_questions") — identifiant pour compteurs UI
  rule_id text NOT NULL,
  description text NOT NULL,

  -- Check impl: chaque check_kind a son handler dans lib/protocolChecks.js
  --   regex        : {pattern, flags, max_matches}
  --   counter      : {what: 'lines'|'questions'|'bullets', max}
  --   max_length   : {chars}
  --   structural   : {deny: 'markdown_list'|'offer_mention'|'signature_complete'}
  check_kind text NOT NULL
    CHECK (check_kind IN ('regex', 'counter', 'max_length', 'structural')),
  check_params jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Scope : null = tous scénarios. Ex: ['DM_1st'] limite au premier message.
  applies_to_scenarios text[],

  -- Même taxonomie que lib/checks.js — hard déclenche rewrite, strong/light journalisent
  severity text NOT NULL DEFAULT 'hard'
    CHECK (severity IN ('hard', 'strong', 'light')),

  -- Citation exacte du document source (audit + UI hover)
  source_quote text,

  created_at timestamptz DEFAULT now(),

  UNIQUE(protocol_id, rule_id)
);

COMMENT ON TABLE protocol_hard_rules IS
  'Règles absolues bloquantes extraites du protocole. Appliquées par lib/protocolChecks.js en PASS 2d du pipeline chat.';

CREATE INDEX IF NOT EXISTS idx_protocol_hard_rules_protocol
  ON protocol_hard_rules (protocol_id);

-- 4. RLS : service_role_all (même pattern que 019_rls_baseline)
ALTER TABLE operating_protocols  ENABLE ROW LEVEL SECURITY;
ALTER TABLE protocol_hard_rules  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all ON operating_protocols;
CREATE POLICY service_role_all ON operating_protocols
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_all ON protocol_hard_rules;
CREATE POLICY service_role_all ON protocol_hard_rules
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5. Trigger updated_at sur operating_protocols
CREATE OR REPLACE FUNCTION set_operating_protocols_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_operating_protocols_updated_at ON operating_protocols;
CREATE TRIGGER trg_operating_protocols_updated_at
  BEFORE UPDATE ON operating_protocols
  FOR EACH ROW EXECUTE FUNCTION set_operating_protocols_updated_at();
