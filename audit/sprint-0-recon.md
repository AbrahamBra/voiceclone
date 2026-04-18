# sprint-0-recon.md — Reconnaissance état actuel avant exécution Sprint 0

**Session** : 2026-04-18 · 10 min reconnaissance (zéro code modifié)
**Usage** : à consommer en ouverture de la session Sprint 0 Split A (migrations).

---

## État des migrations Supabase

**Structure actuelle** : migrations à plat dans `supabase/`, **PAS** dans `supabase/migrations/`. `schema.sql` = snapshot initial (baseline). 27 migrations incrémentales par-dessus.

**Collisions de numérotation détectées** :
- `017_learning_events.sql` + `017_rate_limit.sql`
- `018_consolidation_cron.sql` + `018_legacy_cleanup.sql`
- `023_fidelity_extended_columns.sql` + `023_rhythm_loop.sql`

**Implication** : l'ordering n'est pas piloté par Supabase CLI standard (sinon les dups auraient cassé). Les migrations sont probablement appliquées manuellement via SQL Editor. À valider avec AhmetA avant toute nouvelle migration : est-ce qu'il y a un outil d'application ou tout est manuel ?

**Prochain numéro sûr** : `025_...` (24 est le dernier utilisé, `024_rhythm_baselines.sql`).

---

## Schéma actuel — tables concernées par Sprint 0

### `clients` (schema.sql:5-17)
- PK `id uuid`, `access_code text UNIQUE`, `tier`, budgets, API keys, `is_active`
- **Pas de `organization_id`** → à ajouter en 0.c
- **Sémantique** : `clients` = user/auth de l'app (opérateur d'agence OU solo OU client final reçu par share). Le nom est piégeux : ce ne sont PAS les clients d'agence ghostwriting.

### `personas` (schema.sql:20-34)
- PK `id`, `client_id` FK, `slug`, `voice jsonb`, **`scenarios jsonb NOT NULL`**, `theme jsonb`
- Note : `type` column ajoutée plus tard (migration `008_clone_type.sql`) — valeurs `'post'`, `'dm'` (cf. 010_persona_shares.sql:29)
- **`scenarios` = jsonb dict** (format `{ "post": "...", "dm": "..." }` inféré par 010:33 `scenarios - 'post'`). Pas un enum sur persona.

### `conversations` (004_conversations.sql:4-12)
- PK `id`, `client_id`, `persona_id`, **`scenario text NOT NULL DEFAULT 'default'`** ← free text, C'EST la cible du retypage 0.b
- `title`, `last_message_at`, `created_at`
- **Pas de `organization_id`** → à ajouter en 0.c

### Shares — deux tables (010_persona_shares.sql)
- **`share_tokens`** : `token PK`, `persona_id`, `created_by` (client_id), `expires_at`, `used_at`
- **`persona_shares`** : `persona_id` + `client_id` junction (qui a accès à quoi)
- **Roadmap ambiguë** : "colonne `role` sur `shares`" → **sur laquelle des deux ?** À trancher. Probablement `persona_shares` (junction = qui-a-quel-rôle sur le persona). À confirmer avec AhmetA.

### RLS (019_rls_baseline.sql)
- Activée sur `clients`, `personas`, `conversations`, `messages`, `persona_shares`, `share_tokens`, etc.
- Stratégie : service_role bypass, anon/authenticated = zéro accès.
- **Impact Sprint 0** : ajouter des colonnes ne casse rien (pas de policies anon/auth à réviser). Refonte RLS par org = Phase 2 (trigger agence-first complet).

---

## Plan de migration détaillé — Étape 1 Split A

### Migration `025_sprint0_foundation.sql` (fichier unique, batch 0.c + 0.b)

```sql
-- Sprint 0 Foundation: org-readiness (0.c) + canonical scenarios (0.b)
BEGIN;

-- ============================================================
-- 0.c — organization_id + shares.role (low-cost, no UI logic yet)
-- ============================================================

-- 1. Synthetic solo org per existing client
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

-- 2. Add organization_id to clients, personas, conversations (nullable initially)
ALTER TABLE clients       ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
ALTER TABLE personas      ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);

-- 3. Backfill: one solo org per existing client
INSERT INTO organizations (id, name, owner_client_id)
SELECT gen_random_uuid(), 'Solo — ' || name, id FROM clients
WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE owner_client_id = clients.id);

UPDATE clients c
SET organization_id = o.id
FROM organizations o
WHERE o.owner_client_id = c.id AND c.organization_id IS NULL;

UPDATE personas p SET organization_id = c.organization_id
FROM clients c WHERE p.client_id = c.id AND p.organization_id IS NULL;

UPDATE conversations cv SET organization_id = c.organization_id
FROM clients c WHERE cv.client_id = c.id AND cv.organization_id IS NULL;

-- 4. role on persona_shares (default 'claim' per roadmap)
ALTER TABLE persona_shares
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'claim'
  CHECK (role IN ('claim', 'operator', 'client_viewer', 'owner'));

-- ============================================================
-- 0.b — canonical scenarios enum
-- ============================================================

DO $$ BEGIN
  CREATE TYPE scenario_canonical AS ENUM (
    'post_autonome', 'post_lead_magnet', 'post_actu',
    'post_prise_position', 'post_framework', 'post_cas_client',
    'post_coulisse',
    'DM_1st', 'DM_relance', 'DM_reply', 'DM_closing'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS scenario_type scenario_canonical;

-- Soft mapping: legacy text → enum, best-effort. Unmapped stays NULL.
UPDATE conversations SET scenario_type = CASE
  WHEN scenario ILIKE 'post%autonom%'   THEN 'post_autonome'::scenario_canonical
  WHEN scenario ILIKE '%lead%magnet%'   THEN 'post_lead_magnet'::scenario_canonical
  WHEN scenario ILIKE '%actu%'          THEN 'post_actu'::scenario_canonical
  WHEN scenario ILIKE '%prise%position%' THEN 'post_prise_position'::scenario_canonical
  WHEN scenario ILIKE '%framework%'     THEN 'post_framework'::scenario_canonical
  WHEN scenario ILIKE '%cas%client%'    THEN 'post_cas_client'::scenario_canonical
  WHEN scenario ILIKE '%coulisse%'      THEN 'post_coulisse'::scenario_canonical
  WHEN scenario ILIKE 'dm%1%' OR scenario ILIKE '%first%' THEN 'DM_1st'::scenario_canonical
  WHEN scenario ILIKE '%relance%'       THEN 'DM_relance'::scenario_canonical
  WHEN scenario ILIKE '%reply%' OR scenario ILIKE '%repons%' THEN 'DM_reply'::scenario_canonical
  WHEN scenario ILIKE '%clos%'          THEN 'DM_closing'::scenario_canonical
  WHEN scenario = 'post' THEN 'post_autonome'::scenario_canonical
  WHEN scenario = 'dm'   THEN 'DM_1st'::scenario_canonical
  ELSE NULL
END
WHERE scenario_type IS NULL;

COMMIT;
```

### Décisions requises avant l'exécution

1. **Shares.role — persona_shares ou share_tokens ?** → hypothèse retenue ici : `persona_shares`. À confirmer.
2. **Liste des enum scenarios** — j'ai ajouté `post_coulisse` (présent dans philosophy.md §6 "Post coulisse / transparence") qui manquait dans roadmap.md (10 valeurs listées, philo en nomme 7 côté post). À trancher : **10 ou 11 valeurs** ?
3. **Mode d'application des migrations** — Supabase CLI ou SQL Editor manuel ? Impacte le contrat "migration appliquée = session réussie".
4. **`personas.scenarios` jsonb** — laissé intact (source of truth pour "quels scenarios ce persona supporte"). Le retypage concerne `conversations.scenario` (quel scenario est *utilisé* dans cette conv). À valider : c'est bien ça la sémantique voulue ?

### Plan de test de la migration

1. Backup Supabase (snapshot prod) avant.
2. Appliquer sur staging.
3. Verify :
   - `SELECT COUNT(*) FROM clients WHERE organization_id IS NULL` → 0
   - `SELECT COUNT(*) FROM personas WHERE organization_id IS NULL` → 0
   - `SELECT COUNT(*) FROM conversations WHERE organization_id IS NULL` → 0
   - `SELECT scenario, scenario_type, COUNT(*) FROM conversations GROUP BY 1,2` → inspecter unmapped (scenario_type NULL)
   - `SELECT role, COUNT(*) FROM persona_shares GROUP BY 1` → tous 'claim'
4. Smoke test app : create persona / open chat / send message — rien ne doit casser (colonnes nullable, enum additif).

---

## Ménage worktrees (flag hors scope)

`.claude/worktrees/` contient **29 entrées**. Plusieurs commencent à accumuler depuis plusieurs sessions. À traiter dans une session dédiée "ops" (pas Sprint 0). Risque : confusion sur quel worktree est la source canonique si on continue à en créer.

---

## Checklist ouverture session Split A

- [ ] Lire ce fichier + `philosophy.md` + `roadmap.md` §Sprint 0
- [ ] Valider avec AhmetA les 4 décisions ci-dessus
- [ ] Créer `supabase/025_sprint0_foundation.sql` sur base du draft ci-dessus
- [ ] Appliquer en staging, vérifier les 4 assertions
- [ ] Appliquer en prod si staging vert
- [ ] Passer à Étape 2 (scenarios frontend) uniquement une fois la migration confirmée en prod

---

**Ce fichier est consommable en 2 minutes à l'ouverture. Objectif rempli : la prochaine session n'a pas besoin de re-explorer le schéma.**
