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
