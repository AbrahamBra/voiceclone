# Décision : ne pas backfiller `personas.maturity_level`

**Date** : 2026-05-02
**Contexte** : audit `protocol-underutilization-2026-05-01.md` §2 a noté que `maturity_level` n'est tagué que sur 2 personas sur 5 ciblés (Nicolas L3, Boni-yai L3). Vérification prod ce jour : 1 L2 + 2 L3 + 11 NULL. Question ouverte : back-fill ou retirer la colonne ?

## Verdict

**Ni l'un ni l'autre. NULL reste la valeur documentée pour "non renseigné".**

## Rationale

1. **La migration 054 est explicite** : "Nullable : NULL = 'non renseigné' (personas créés avant cette migration ou onboarding qui a skip la question)". La schema accepte NULL by design.
2. **Les usages "post-V1" cités dans la migration ne sont pas implémentés** : "Extracteur allowlist (post-V1) : L1 ne lance pas templates/scoring" et "UI brain drawer (post-V1) : tabs/sections actifs varient par tier". Tant que ces consommateurs n'existent pas, la colonne ne pilote rien runtime.
3. **Les 11 NULL sont majoritairement inactifs ou test** : `sim_clone_alpha`, `mohamed-camara-legacy-42ed7abb`, `thomas`, `thierry`, `alex-revops`, `ahmet-akyurek`, etc. Backfiller arbitrairement L1 ajouterait du bruit sans valeur produit.
4. **Les 2 actifs ont leur tier** : Nicolas L3 et Boni-yai L3 — c'est ce qui compte pour l'usage en cours.
5. **Si le tier devient runtime-significant** (extracteur allowlist, drawer UI) : à ce moment-là, soit l'onboarding force la saisie pour les nouveaux personas, soit on backfill ciblé sur les seuls personas actifs (4-5 max), pas en masse.

## Action

- **Aucune modification DB**.
- Le wizard `/create` continue à demander L1/L2/L3 à la création — cf `src/routes/create/+page.svelte` + `api/clone.js:66-78`.
- Si un futur consommateur exige NOT NULL : ajouter une migration ciblée à ce moment, pas par anticipation.

## Pas de TODO orphelin

Cette décision n'ouvre pas de "follow-up" implicite — c'est une closure. Si la doctrine évolue (V3 design active la colonne), on rouvre la question explicitement.
