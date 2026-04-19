# audit/roadmap.md — Plan VoiceClone

**Horizon** : Sprint 1 complet + Sprint 2 partiel + Sprint 4 + items ciblés 3/8. Le reste en backlog.
**Budget** : 60h/sem confirmé (12h/jour).
**Sprint 0 shipped** : fondation (migration `025_sprint0_foundation.sql`, scenarios dual-write), tracking Plausible + 6 events, ménage UI. Détails dans [sprint-0-recon.md](sprint-0-recon.md) et [sessions-log.md](sessions-log.md).

---

## Principes directeurs

1. Chaque feature passe le filtre [philosophy.md §4](philosophy.md).
2. Un sprint = un bundle cohérent livrable indépendamment.
3. Quick wins avant refontes.
4. **Mesurer avant juger** : les métriques prédites sont remplacées par "à mesurer".

---

## Sprint 1 — Opérateur déverrouillé (5j à 12h/jour, ~32h)

**Objectif** : le quotidien de l'opérateur cesse de saigner.
**Dépendance** : aucune.

1. Switch clones inline dans cockpit — dropdown + raccourci Cmd+Shift+C (12h)
2. "Corriger" promu en action primaire inline — bouton solid vermillon sous chaque bot msg (6h) — **✅ shipped** (commit `1d3b44a`)
3. Copier LinkedIn-ready + menu copy — plain / markdown / linkedin-ready par défaut (6h)
4. Compteur cible char contextuel — `🎯 1200-1500` post / `🎯 150-280` DM (2h)
5. AuditStrip repliée par défaut (2h)
6. 3 jauges cockpit → un badge `style health` unique (4h)

**Métriques** (à mesurer, baseline Plausible) : temps switch clone, taux corrections par conv bot.

---

## Sprint 2 — Multi-client scalable (partiel, ~30h)

**Scope réduit** : items qui ne dépendent pas de volume clone élevé.
**Dépendance** : Sprint 0.c (organization_id — shipped).

1. Champ `client` / `tag` dans `/create` step info (6h : 3 BE + 3 FE)
2. Hub Version A : search + Cmd+K + récents + filtres + grille responsive (20h)
3. Filtres conversations dans `/chat` sidebar — pills posts/DMs/flag (4h)

**En backlog** : dupliquer clone existant (hypothèse templating non-validée), upload fichier posts/DMs (attendre `clone_created ×10` pour voir patterns).

**Métrique** (à mesurer) : capacité scalable à 20+ clones.

---

## Sprint 3 — Calibration (partiel, ~32h)

**Scope réduit** : hors "aperçu style" (hypothèse produit non-validée).
**Dépendance** : Sprint 0.b (scenarios typés — shipped).

- 3.2 Contextes calibration dérivés du type + domaine — remplacer les 5 contextes hardcoded (8h BE)
- 3.3 Split view corpus source dans `/calibrate` — RAG Voyage-3 existant (12h)
- 3.4 Régénération par essai — bouton `↺`, hard-cap 3 (4h)
- 3.5 Rollback de règles — dans IntelligencePanel, liste règles actives + bouton révoquer (8h)

**En backlog** : 3.1 Aperçu style avant "Générer" (12h). Trancher après 3 interviews opérateurs : prévisualiser vs générer puis trier ?

**Métrique** (à mesurer) : taux clones regénérés <24h après création.

---

## Sprint 4 — Thermomètre conditionnel + aide contextuelle (3j, ~22h)

**Dépendance** : Sprint 0.b (shipped).

1. Thermomètre conditionnel au scenario — `{#if scenario.startsWith('DM')}` (1h, trivial avec scenarios typés)
2. Bouton `?` contextual help dans cockpit chat — overlay slide-in sur `/guide#ancre` (4h)
3. Renommer tab `prospect` → `brief` (30min)
4. Guide : filtre audience + TOC flottante + FAQ + exemples réels (16h)

**Métrique** (à mesurer) : tickets support opérateur.

---

## Sprint 8 — items ciblés (4h)

- 8.1 Masquer TTR/kurtosis par défaut + toggle "mode tech" (4h) — align Principe "refuser complexité technique visible"

**En backlog** : hero commercial, landing rebuild, bandeau logos clients (attendre logos + métriques publiables + conversion mesurée).

---

## Backlog

### Attendre data / trigger

- **Sprint 2 suite** : dupliquer clone (10h, hypothèse non-validée), upload fichier posts/DMs (10h, attendre patterns).
- **Sprint 3.1** : aperçu style avant générer (12h, attendre interviews).
- **Sprint 5 — Cohérence** : tagger corrections par contexte, détecteur contradictions, dashboard Cohérence, abstraction active, audit trail règles. Déclencheur : >200 corrections par persona (sinon détecteur tourne dans le vide).
- **Sprint 6 — Admin manager** : bandeau alertes, stat-cards delta, table clients sortable, export CSV, bouton inviter client. Déclencheur : Sprint 5 livré + seuils alertes mesurés.
- **Sprint 7 — Handoff client** : flow signup via token, preview enrichie, expiration/révocation. Déclencheur : client final = user tertiaire validé + business model clarifié.
- **Sprint 8 landing rebuild** : hero, CTA, navbar, cas clients, pricing, FAQ. Déclencheur : zero conversion mesurée + logos dispo.

### Axes Phase 2 (déclenchables)

- **Architecture intents posts** : sources différenciées par intent, critics per intent, scoring. Déclencheur : Sprint 5 stable + volume corrections suffisant.
- **Agence-first activation complète** : organizations + rôles (owner/operator/client_viewer), RLS Postgres, UI multi-org, facturation par org. Déclencheur : 3e client signé ou 2e setter recruté.
- **Intégration Breakcold / sales engagement** : import conv DM, push draft, scoring via callbacks. Déclencheur : négociation API + volume DM suffisant.

---

## Métriques en continu (Plausible Sprint 0.d)

Events branchés : `clone_created`, `message_sent`, `correction_submitted`, `share_created`, `share_claimed`, `scenario_switched`.

Derived (à mesurer, sans baseline prédite) : temps switch clone, taux corrections/bot msg, clones actifs/opérateur, clones regénérés <24h, taux claim→first message <10min.

---

**Roadmap vivante. Re-évaluer après chaque sprint : est-ce qu'on apprend quelque chose qui change le suivant ?**
