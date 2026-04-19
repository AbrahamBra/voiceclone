-- 030_prospect_dossier.sql
-- Per-conversation prospect dossier metadata — feeds ProspectDossierHeader.
-- Tous NULL au départ ; éditables inline depuis l'UI.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS prospect_name text,
  ADD COLUMN IF NOT EXISTS stage text,
  ADD COLUMN IF NOT EXISTS note text;

COMMENT ON COLUMN conversations.prospect_name IS 'Displayed in ProspectDossierHeader, editable inline.';
COMMENT ON COLUMN conversations.stage IS 'Freeform tag (e.g. "J+3 relance"). YAGNI: no enum.';
COMMENT ON COLUMN conversations.note IS 'One-line memo visible in header.';
