-- ============================================================
-- Migration 050 — protocol_publish_event (Reco B narrative changelog)
--
-- Inspiré du changelog public Sudowrite — chaque publish d'une nouvelle
-- version du protocole produit un événement immutable qui capture :
--   - quel doc a été activé, quel doc a été archivé
--   - les propositions résolues à ce moment (accepted/rejected/revised)
--   - un récit narratif lisible non-tech ("voici ce qu'on a appris cette
--     semaine, ce qu'on a ajouté/retiré et pourquoi")
--
-- Pourquoi une table séparée plutôt qu'une colonne sur protocol_document :
--   - les données sont "frozen" (reflètent l'état AU publish, pas l'évolution
--     future du doc qui pourrait re-changer)
--   - permet d'afficher un changelog UI sans reconstituer l'historique depuis
--     les transitions de status
--   - capture explicitement le lien "ces propositions ont été résolues par
--     ce publish" — info perdue aujourd'hui (les propositions transitionnent
--     status='accepted'/'rejected' mais sans pointer vers le publish event)
--
-- Additif uniquement — aucun DROP, aucun ALTER destructif.
-- À appliquer manuellement après 048 + 049.
-- ============================================================

CREATE TABLE IF NOT EXISTS protocol_publish_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  document_id uuid NOT NULL
    REFERENCES protocol_document(id) ON DELETE CASCADE,
  archived_document_id uuid
    REFERENCES protocol_document(id) ON DELETE SET NULL,

  -- Snapshot du numéro de version au moment du publish (denormalisé pour
  -- robustesse cross-archive : si le doc est purgé, on garde le numéro).
  version int NOT NULL,

  -- Récit narratif Sudowrite-style, lisible non-tech.
  -- Généré par lib/protocol-v2-changelog-narrator.js via Anthropic au
  -- moment du publish. NULL autorisé pour les publishes legacy ou si la
  -- génération a échoué.
  summary_narrative text,

  -- Version compacte (≤ 30 mots) pour les UIs liste / tooltips.
  summary_brief text,

  -- IDs des propositions résolues par ce publish event.
  -- Triple split : ce qu'on a intégré (accepted), ce qu'on a refusé (rejected),
  -- ce qu'on a intégré mais reformulé (revised).
  accepted_proposition_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  rejected_proposition_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  revised_proposition_ids  uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],

  -- Stats migration outcome (déjà calculé par publishDraft).
  stats_migrated int NOT NULL DEFAULT 0,

  -- Auteur du publish (client_id du humain qui a cliqué Publier).
  -- Nullable pour publishes auto-cron ou legacy.
  published_by uuid REFERENCES clients(id) ON DELETE SET NULL,

  published_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE protocol_publish_event IS
  'Événement immutable de publication d''une version de protocole. Source du changelog UI lisible non-tech.';

COMMENT ON COLUMN protocol_publish_event.summary_narrative IS
  'Récit Sudowrite-style généré par lib/protocol-v2-changelog-narrator.js. ~150-250 mots, registre opérationnel agence.';

COMMENT ON COLUMN protocol_publish_event.summary_brief IS
  'Tagline ≤ 30 mots pour UI compacte (liste, breadcrumb, notification).';

-- Lookup par document_id (récupérer tout l'historique d'un protocole).
CREATE INDEX IF NOT EXISTS idx_publish_event_document
  ON protocol_publish_event (document_id, published_at DESC);

-- Lookup global trié temporellement (timeline cross-doc, ex: feed agence).
CREATE INDEX IF NOT EXISTS idx_publish_event_published_at
  ON protocol_publish_event (published_at DESC);

-- Lookup par persona (qui a publié récemment).
-- Pas d'index dédié : la query passe via document_id puis joins.

-- ── RLS ────────────────────────────────────────────────────────
ALTER TABLE protocol_publish_event ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all ON protocol_publish_event;
CREATE POLICY service_role_all ON protocol_publish_event
  FOR ALL TO service_role USING (true) WITH CHECK (true);
