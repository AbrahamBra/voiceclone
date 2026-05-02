-- 068_protocol_import_batch.sql
--
-- Track each `/api/v2/protocol/import-doc` invocation as a batch row so the
-- UI can show "what each uploaded doc produced". Without this, propositions
-- carry only a synthetic source_ref UUID — we can group by it but have no
-- filename / kind / identity-prose impact to display.
--
-- Used by the calibration view (PR 4) to surface :
--   - Which docs landed where (filename × doc_kind × counts)
--   - Identity-prose enrichment per doc
--   - Cross-batch overlap (props with count > 1 + multiple source_refs)
--
-- The batch.id is the same UUID used as proposition.source_ref / source_refs[0]
-- for upload_batch source — no FK needed (UUID match by convention) so this
-- table can be added without touching existing data.

CREATE TABLE IF NOT EXISTS protocol_import_batch (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES protocol_document(id) ON DELETE CASCADE,

  doc_filename text,
  doc_kind text NOT NULL DEFAULT 'generic'
    CHECK (doc_kind IN ('persona_context', 'operational_playbook',
                        'icp_audience', 'positioning', 'generic')),

  identity_appended boolean NOT NULL DEFAULT false,
  identity_chars_added int NOT NULL DEFAULT 0,

  chunks_processed int NOT NULL DEFAULT 0,
  candidates_total int NOT NULL DEFAULT 0,
  propositions_created int NOT NULL DEFAULT 0,
  propositions_merged int NOT NULL DEFAULT 0,
  silenced int NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_protocol_import_batch_doc_recent
  ON protocol_import_batch (document_id, created_at DESC);

ALTER TABLE protocol_import_batch ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all ON protocol_import_batch;
CREATE POLICY service_role_all ON protocol_import_batch
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE protocol_import_batch IS
  'One row per /api/v2/protocol/import-doc call. id = the same UUID used as '
  'proposition.source_ref for upload_batch propositions in that call. '
  'Powers the calibration view in the protocol panel.';
