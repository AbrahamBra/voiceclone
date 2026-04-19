# audit/decisions.md — Journal des décisions produit

**Format** : 1 ligne par décision. Date (prise) · Quoi · Pourquoi · À revoir quand.
**Usage** : source de vérité pour "on avait décidé quoi et pourquoi, déjà ?". Append-only — une décision révoquée reste loggée avec sa révocation.

---

## Décisions actives

| Date | Quoi | Pourquoi | À revoir quand |
|---|---|---|---|
| 2026-04-18 | Solo-first dans le code, agence-first dans l'usage — dette structurelle assumée à court terme. Migration 025 ajoute `organization_id` nullable (schéma prêt, pas d'UI) | Permet de ship Sprint 1-4 sans refonte RLS. Le schéma attend. | 3e client signé OU 2e setter recruté → activer rôles + RLS par org |
| 2026-04-18 | Retypage scenarios canoniques : enum `{post_autonome, post_lead_magnet, post_actu, post_prise_position, post_framework, post_cas_client, post_coulisse, DM_1st, DM_relance, DM_reply, DM_closing}` — dual-write (scenario text legacy + scenario_type enum) | Prérequis pour thermomètre conditionnel (Sprint 4) + future architecture intents posts. Dual-write protège le rollback. | Après 2-3 mois d'usage réel : renommer au contact terrain si nécessaire, puis dropper la colonne legacy |
| 2026-04-18 | Tracking Plausible + 6 events branchés (`clone_created`, `message_sent`, `correction_submitted`, `share_created`, `share_claimed`, `scenario_switched`) | "Mesurer avant juger" — sans baseline on ship à l'aveugle | Permanent — événements additifs si besoin |
| 2026-04-19 | Sprint 1 exécuté dans l'ordre audit (items 1→6), à 12h/jour ≈ 3j | Scope défendable par l'audit sans data. Dépendances : aucune. | Après Sprint 1 livré : re-évaluer l'ordre Sprint 2/3/4 selon métriques Plausible |
| 2026-04-19 | Sprint 2 partiel : items 1 (champ client/tag), 2 (hub search), 3 (filtres conv). Dupliquer clone + upload posts/DMs en backlog | Scope agnostique au volume. Les deux items backlog dépendent de patterns observables à partir de `clone_created ×10+` | Après Sprint 2 livré + 10+ clones créés |
| 2026-04-19 | Sprint 3 partiel : items 3.2, 3.3, 3.4, 3.5. Item 3.1 "Aperçu style avant Générer" (12h) en backlog | Hypothèse produit non-validée : prévisualiser vs générer puis trier ? Coût 12h trop élevé sans retex opérateur | Après 3 interviews opérateurs externes |
| 2026-04-19 | Sprint 8 : uniquement 8.1 (masquer TTR/kurtosis par défaut + toggle "mode tech"). Landing rebuild en backlog | 8.1 aligne Principe "refuser complexité technique visible". Le rebuild landing attend logos clients publiables + conversion mesurée | Après zero conversion mesurée OU logos dispos |
| 2026-04-19 | Docs compressés : `philosophy.md` → 1 page (3 règles), `roadmap.md` → Sprint 1-4 ciblés + backlog, `what-i-understand.md` → A/B/D.1, tableaux notes /10 supprimés des screens, `manifesto.md` supprimé | "Focus produit" — viser 100% de la valeur opérationnelle, couper le vernis | Si un des docs redevient utile : le restaurer depuis l'historique git |

---

## Déclencheurs ouverts (à surveiller)

| Déclencheur | Impact | Décision qu'il ouvre |
|---|---|---|
| 3e client signé OU 2e setter recruté | Bascule agence-first complète | Activer orgs + rôles + RLS + facturation par org |
| >200 corrections par persona (cumul) | Assez de data pour détecteur contradictions | Déclencher Sprint 5 Cohérence |
| `clone_created ×10` | Patterns d'usage suffisants pour juger templating | Trancher : dupliquer clone (Sprint 2.3) vs pas utile |
| 3 interviews opérateurs externes menées | Hypothèse "aperçu style" tranchée | Déclencher ou tuer Sprint 3.1 |
| 5-10 clients payants | Validation business model | Trancher self-serve vs B2B2C |
| Volume DM suffisant + négociation API | Intégration Breakcold faisable | Déclencher import conversations DM + push draft |

---

## Décisions révoquées (append-only)

_(vide pour l'instant)_
