-- 067_protocol_identity_section.sql
--
-- Backfill an `identity` section into every protocol_document that doesn't
-- already have one. Identity is the prose-only foundation of the doctrine —
-- voice, bio, convictions, ton — the "who am I" context that should land in
-- the system prompt before any rule, scoring axis, or template fires.
--
-- Until now the scaffold shipped 6 sections starting at hard_rules (order=0),
-- so persona context was either lost in knowledge_files (RAG only) or had to
-- be manually shoved into hard_rules where it didn't belong (and got
-- rejected by the hard_rules extractor as "not testable"). PR upcoming
-- introduces doc-categorization-aware routing where `persona_context` docs
-- (background, bio, convictions) target this identity section.
--
-- Strategy : per document missing identity, shift existing orders by +1
-- to free up order=0, then INSERT identity at order=0. Idempotent — runs
-- only on documents that don't yet have an identity section.
--
-- Note : the `kind` CHECK constraint on protocol_section already accepts
-- 'identity' (see migration 038), so no schema change is needed — only
-- data backfill.

DO $$
DECLARE
  doc_row record;
BEGIN
  FOR doc_row IN
    SELECT id FROM protocol_document
    WHERE NOT EXISTS (
      SELECT 1 FROM protocol_section ps
      WHERE ps.document_id = protocol_document.id AND ps.kind = 'identity'
    )
  LOOP
    UPDATE protocol_section
    SET "order" = "order" + 1
    WHERE document_id = doc_row.id;

    INSERT INTO protocol_section (
      document_id,
      kind,
      "order",
      heading,
      prose,
      structured,
      author_kind,
      client_visible,
      client_editable
    )
    VALUES (
      doc_row.id,
      'identity',
      0,
      'Identité — voix, parcours, convictions',
      '',
      NULL,
      'auto_extraction',
      true,
      false
    );
  END LOOP;
END $$;
