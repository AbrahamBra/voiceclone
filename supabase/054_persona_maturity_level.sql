-- 054_persona_maturity_level.sql
--
-- Maturity tier comme attribut first-class du persona.
-- Spec : docs/superpowers/specs/2026-04-27-clone-meta-rules-and-maturity.md (§1)
--
-- L1 — positionnement + ICP + voix + matière (pas de scripts DM)
-- L2 — opérationnel mono-scenario (ex: icebreaker outbound chez Nicolas)
-- L3 — opérationnel multi-scenario (icebreaker × multi-source + creusement + call_proposal + graceful_exit)
--
-- Nullable : NULL = "non renseigné" (personas créés avant cette migration ou
-- onboarding qui a skip la question).
--
-- Usages :
--   - Onboarding /create : 1ère question "tu as un L1/L2/L3 ?"
--   - Extracteur allowlist (post-V1) : L1 ne lance pas templates/scoring
--   - UI brain drawer (post-V1) : tabs/sections actifs varient par tier
--
-- Additif uniquement — pas de contrainte NOT NULL pour préserver la
-- création back-compat sans maturity_level.

ALTER TABLE personas ADD COLUMN IF NOT EXISTS maturity_level text
  CHECK (maturity_level IS NULL OR maturity_level IN ('L1', 'L2', 'L3'));

COMMENT ON COLUMN personas.maturity_level IS
  'Tier de maturité du document source du clone : L1 = positionnement seul, L2 = playbook DM mono-scenario, L3 = playbook DM multi-scenario. NULL = non renseigné. Cf docs/superpowers/specs/2026-04-27-clone-meta-rules-and-maturity.md.';

CREATE INDEX IF NOT EXISTS idx_personas_maturity_level
  ON personas(maturity_level)
  WHERE maturity_level IS NOT NULL;
