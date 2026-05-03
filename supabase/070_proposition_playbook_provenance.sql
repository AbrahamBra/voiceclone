-- Migration 070 — Provenance pour les propositions extractées depuis les
-- playbooks source-specific vers le doc protocole global.
--
-- Pourquoi : aujourd'hui les playbooks source-specific (visite_profil,
-- dr_recue, interaction_contenu, …) sont importés via
-- /api/v2/protocol/source-playbooks et restent **cloisonnés** dans leur doc.
-- Pour Nicolas : 3 playbooks de 14k chars chacun → 0 proposition sur le doc
-- global. Pourtant 80%+ du contenu est doctrine commune (qualif/SWOT,
-- règles d'or, persona buyer, métaprompt) qui devrait nourrir le protocole.
--
-- Ce que cette migration ajoute :
--   1. Nouvelle valeur 'playbook_extraction' dans le CHECK source de
--      proposition (pour distinguer des propositions issues de
--      'upload_batch' = import doc général).
--   2. Colonne `provenance jsonb DEFAULT '{}'` qui stocke la trace
--      multi-source au format :
--        {
--          "playbook_sources": [
--            {"source_core": "visite_profil", "toggle_idx": 2, "toggle_title": "QUALIFIER LA RÉPONSE + SWOT / TOWS", "playbook_id": "<uuid>"},
--            {"source_core": "dr_recue",      "toggle_idx": 2, "toggle_title": "QUALIFIER LA RÉPONSE + SWOT / TOWS", "playbook_id": "<uuid>"}
--          ]
--        }
--      Quand la même proposition (matched via embedding) sort de plusieurs
--      playbooks, on append au tableau au lieu d'insérer un duplicat. Ça
--      rend la convergence visible côté UI d'arbitrage : 3 sources qui
--      convergent sur "max 6 lignes par message" = signal fort que c'est
--      doctrine commune.
--
-- Idempotence :
--   - DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT pour le CHECK source
--   - ADD COLUMN IF NOT EXISTS pour provenance
--
-- Pas de backfill SQL ici : le script
-- scripts/extract-source-playbooks-to-global.js le fait via le pipeline
-- d'extraction LLM (un coût qui ne convient pas dans une migration).

-- 1) Étendre le CHECK source pour autoriser 'playbook_extraction'
ALTER TABLE proposition
  DROP CONSTRAINT IF EXISTS proposition_source_check;

ALTER TABLE proposition
  ADD CONSTRAINT proposition_source_check
  CHECK (source IN (
    'feedback_event',
    'learning_event',
    'chat_rewrite',
    'manual',
    'client_validation',
    'agency_supervision',
    'upload_batch',
    'analytics_cron',
    'playbook_extraction'
  ));

-- 2) Colonne provenance jsonb (default {} = pas de trace, propositions legacy
--    upload_batch n'auront pas de playbook_sources peuplés — c'est attendu)
ALTER TABLE proposition
  ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Index GIN pour query "toutes les propositions issues de la source visite_profil"
-- ou "toutes celles vues dans ≥2 playbooks" (signal de convergence à l'arbitrage).
CREATE INDEX IF NOT EXISTS idx_proposition_provenance_gin
  ON proposition USING gin (provenance jsonb_path_ops);

COMMENT ON COLUMN proposition.provenance IS
  'Trace multi-source des propositions extractées de playbooks source-specific. Schema: {"playbook_sources": [{"source_core","toggle_idx","toggle_title","playbook_id"}]}. Append-on-merge via dédup sémantique (embedding). Vide pour propositions issues d''upload_batch ou autres sources.';
