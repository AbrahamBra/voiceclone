# sessions-log.md — Journal de sessions VoiceClone

**Usage** : chaque nouvelle session commence par la lecture de ce fichier + `philosophy.md` + `roadmap.md`. On sait où on en est, on ne re-débat pas.

---

## Template pour reprendre une session

Au début de chaque nouvelle session, message d'ouverture type :

```
Nouvelle session. On attaque le Sprint X (voir roadmap.md).
Avant d'agir :
1. Lis audit/philosophy.md (la boussole)
2. Lis audit/roadmap.md §Sprint X (le scope)
3. Lis audit/sessions-log.md (l'état actuel)
4. Propose-moi un plan d'exécution de 3-5 étapes
5. Ne touche pas au code avant que j'aie validé le plan
```

---

## Décomposition multi-session — Phase 1

| ID | Sprint | Durée estimée | Mix | Prérequis session |
|---|---|---|---|---|
| **S-00** | Sprint 0 Fondations | 1-2 sessions | BE+FE+ops | — |
| **S-01** | Sprint 1 Opérateur déverrouillé | 1 session | FE lourd | S-00 |
| **S-02** | Sprint 2 Multi-client scalable | 1-2 sessions | Full-stack | S-00 |
| **S-03** | Sprint 3 Calibration + aperçu | 1 session | Full-stack | S-00 + S-02 |
| **S-04** | Sprint 4 Thermo + aide | 1 session courte | FE | S-00 |
| **S-05a** | Sprint 5 Cohérence — BE | 1 session | BE heavy | S-00 + S-03 |
| **S-05b** | Sprint 5 Cohérence — FE | 1 session | FE | S-05a |
| **S-06a** | Sprint 6 Admin — core | 1 session | Full-stack | S-00 + S-05b |
| **S-06b** | Sprint 6 Admin — polish | 1 session | FE+BE | S-06a |
| **S-07** | Sprint 7 Handoff client | 1 session | Full-stack | S-06b |
| **S-08** | Sprint 8 Landing commerciale | 1-2 sessions | Design+FE+copy | S-04 |

**Total estimé : 11-13 sessions pour Phase 1 complète.**

À ton rythme de 60h/sem et 3-4h utiles par session efficace avec moi : **~3-4 semaines calendaires** de Phase 1 si on enchaîne.

---

## Règles de session

1. **Scope figé en entrée** — on attaque 1 sprint à la fois. Si dérive thématique, on note dans `follow-ups.md` mais on ne fait pas.
2. **Livrable à la fin** — code committé + tests passés + update de ce journal avec ce qui a été fait.
3. **Pas de re-débat philosophique** — `philosophy.md` est la boussole. Si tension, on la note, on ne la rouvre pas pendant la session exécution.
4. **Review courte entre sprints** — à la fin de chaque sprint livré, 15-30 min pour ajuster la roadmap si on a appris quelque chose de structurel.
5. **Si blocage technique imprévu** — on arrête, on note le blocage, on reprend la session suivante avec une stratégie dédiée (pas d'heroïsme en fin de session fatigué).

---

## Historique des sessions

### Session 1 — 2026-04-18 · Audit complet + Philosophie + Roadmap

**Durée** : session longue (conversation étendue)
**Participants** : AhmetA + Claude (Principal Product Designer mode)

**Livrables produits** :
- `audit/app-map.md` — cartographie des 8 routes
- `audit/what-i-understand.md` — compréhension validée avec AhmetA
- `audit/screens/chat.md` — audit `/chat` + addenda Breakcold + thermomètre rail
- `audit/screens/create.md` — audit `/create`
- `audit/screens/hub.md` — audit `/hub`
- `audit/screens/calibrate.md` — audit `/calibrate`
- `audit/screens/landing.md` — audit `/`
- `audit/screens/guide.md` — audit `/guide`
- `audit/screens/admin.md` — audit `/admin`
- `audit/screens/share.md` — audit `/share/[token]`
- `audit/philosophy.md` — 3 principes fondateurs validés + annexe théorique (Lacan/Žižek, mode C)
- `audit/roadmap.md` — 9 sprints sur 6-7 semaines à 60h/sem
- `audit/manifesto.md` — manifeste court pour amis tech

**Décisions majeures prises ensemble** :
1. Cible user = opérateur d'agence ghostwriting+setting (pas créateur solo curieux)
2. "Laboratoire" = vernis commercial + route `/labo` dédiée, PAS cœur UX quotidien
3. VoiceClone ≠ projet AHA (esprit humain artificiel). Discipline transférable, pas le code
4. Direction Linear : simplicité par défaut, profondeur sur demande
5. SEO hors scope (app privée par code d'accès)
6. Solo-first court terme, agence-first au 3e client ou 2e setter
7. Mode C visé comme différenciateur long-terme (modèle de l'individu, pas modèle du monde)
8. 3 principes fondateurs validés : Opérateur domine / IA gardien de cohérence / Clone rappelle ce que l'humain a décidé

**Points validés pour action** :
- Retypage scenarios en enum canonique `{post_autonome, post_lead_magnet, post_actu, post_prise_position, post_framework, post_cas_client, DM_1st, DM_relance, DM_reply, DM_closing}` — Sprint 0
- Sprint 5 "Cohérence" nouveau, signature philosophique du projet
- Préparation agence-first low-cost (colonnes DB) en Sprint 0 pour ne pas se peindre dans un coin

**Tensions identifiées, non-tranchées à ce stade** :
- Fiabilité des corrections humaines reconnue fragile (Mode A + B + C pour y répondre progressivement)
- Bascule agence-first à activer ponctuellement selon signaux business (pas avant 3e client)
- Intégration Breakcold : intérêt confirmé, à activer quand API négociée

**À faire avant session suivante (par AhmetA, optionnel)** :
- Relire `philosophy.md` à tête reposée, contester si besoin
- Relire `manifesto.md`, ajuster le ton pour son audience d'amis tech
- Considérer si le sprint 0.d tracking produit (Plausible/Posthog) demande une décision de vendor
- Réfléchir aux 2-3 faiblesses internes non-encore-nommées qui pourraient émerger à froid

**Prochaine session suggérée** : **S-00 Sprint 0 Fondations**
- Scope : ménage (10 items) + retypage scenarios + colonnes agence-first + tracking
- Durée estimée : 1 longue session (4h) ou 2 moyennes
- Prérequis : aucun, tout est planifié

---

## Entrées suivantes

_(à compléter session par session)_

### Session 2 — [date] · Sprint 0 Fondations

**Scope** : _(à renseigner)_
**Livrables** : _(à renseigner)_
**Décisions** : _(à renseigner)_
**Blocages** : _(à renseigner)_
**Prochaine session** : _(à renseigner)_
