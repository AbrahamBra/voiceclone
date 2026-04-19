# what-i-understand.md — VoiceClone

Compréhension inférée à froid après lecture du code.

---

## A. One-liner (validé avec AhmetA le 2026-04-18)

> **VoiceClone est l'outil opérationnel d'une agence de ghostwriting + setting LinkedIn. L'agence y monte un clone par client (service posts, service DM, ou les deux), l'entraîne par feedback continu, et s'en sert au quotidien pour produire le contenu facturé. Usage secondaire : l'agence s'en sert pour son propre compte.**

Conséquences pour l'audit :
- **User réel** = opérateur d'agence (un collaborateur) qui jongle entre N clones clients + 1 clone agence chaque jour. Pas un curieux du pipeline, pas un client final.
- Le **client final** de l'agence peut arriver dans l'app via `/share/[token]` (handoff). UX secondaire mais existante.
- La **vitesse de switch inter-clones** et la **lisibilité multi-persona** deviennent prioritaires — bien plus que la beauté d'un écran isolé.
- Le pipeline "observable" (landing lab, cockpit, marginalia) est un **différenciateur commercial** (ce que l'agence montre à un prospect pour vendre), pas l'interface quotidienne.

Red flag confirmé : **l'app ne fait pas de différence UX entre "je bosse pour mon client A" et "je bosse pour mon client B" et "je bosse pour mon agence"**. Tout est au même niveau dans le hub. Un opérateur d'agence qui gère 20 clients va devoir scroller. Pas de filtres, pas de groupes, pas de tri par activité.

---

## B. Cartographie fonctionnelle

### B.1 Sections principales (8 routes, 3 niveaux)

```
Public
├── /                  Landing "laboratoire" (démo scriptée + porte d'auth)
└── /guide             Onboarding produit (marketing + pédagogie)

Authentifié
├── /hub               Dispatcher : liste clones + entrées create/admin/guide
├── /create            Funnel 6 étapes (calibration → type → info → posts → dm → docs)
├── /calibrate/[id]    n essais notés 1-5 + correction textuelle
├── /chat/[id]         Cockpit de chat (10 composants, 3 onglets sidebar, 4 panels right)
├── /admin             Dashboard multi-client read-only (admin seulement)
└── /share/[token]     Accepter un clone partagé
```

### B.2 Happy path identifié (nouveau user)

1. Arrive sur `/` → observe 30s de démo → saisit le code d'accès au footer
2. Redirect `/hub` → vide ou peuplé de clones existants → click "+ Créer un clone"
3. `/create` → scrape LinkedIn → choisit type → paste posts → upload docs → "Générer"
4. Redirect `/calibrate/[id]` → note 5 essais + corrige → "Valider"
5. Redirect `/chat/[id]` → découvre le cockpit, 3 jauges, 4 panels, sidebar 3 onglets
6. Envoie un message → observe le streaming + marginalia + AuditStrip qui se remplit
7. Corrige via bouton "Corriger" → pick alternative → le clone apprend
8. Revient plus tard : last_persona en localStorage → idéalement reprend où il était

**Étapes 5-6 sont le moment de friction maximum** : l'écran chat est d'une densité visuelle spectaculaire pour quelqu'un qui ne connaît pas encore l'app.

### B.3 Parcours secondaires détectés

- **Partage** : depuis hub → "Partager" → copie URL → destinataire `/share/[token]` → claim
- **Prospect scraping** : dans le chat, panel "prospect" → URL LinkedIn → injecte un message contexte dans le chat (pas une génération directe, juste une préparation d'input)
- **Ingest doc post-création** : sidebar onglet "Connaissance" → upload fichier → fake-progress 5 steps → ingestion backend
- **Calibration après coup** : rien ne force à repasser par `/calibrate/[id]` après la création initiale. Mais l'IntelligencePanel permet de "Recalculer" la fidélité (limité à 1x/heure).
- **Cmd+K** : palette de conversations (pas de navigation globale, c'est restreint aux conv de la persona courante).

### B.4 Culs-de-sac / écrans orphelins

- **Depuis `/chat/[id]`, aucun lien direct vers `/hub`, `/create`, `/guide`, `/admin`**. Il faut cliquer la flèche back (qui va à `/`, puis le layout redirect à `/hub`) ou passer par la ConversationSidebar "← Changer de clone". C'est un cul-de-sac de navigation pour l'utilisateur qui travaille avec plusieurs clones.
- **`/admin` n'a pas de cross-link direct vers un persona ou un client** — on voit les stats, mais on ne peut pas cliquer sur une ligne client pour aller regarder ses conversations.
- **`/calibrate/[id]` n'est jamais ré-accessible** après la création initiale (aucun bouton ou lien ne pointe vers lui depuis ailleurs).
- **`/guide` est isolé** : on y arrive depuis la landing footer et depuis le hub, jamais depuis le chat. Pourtant c'est au moment du premier chat qu'on a le plus besoin d'aide.

---

## D.1 Persona cible (validée)

**User principal** : **opérateur d'agence de ghostwriting + setting LinkedIn**.
- Profil : collaborateur agence, pas forcément technique. Son boulot : produire 10-20 posts/semaine + mener N conversations DM de prospection par jour, multiplié par M clients.
- Jobs-to-be-done (ordre d'usage probable) :
  1. Switcher rapidement entre les clones actifs de la journée
  2. Générer un post ou un DM dans la voix du client
  3. Corriger quand ça sonne faux (le client est exigeant)
  4. Préparer un DM ciblé avec le contexte prospect (LeadPanel)
  5. Ingérer un nouveau doc client (nouvelle offre, étude de cas) pour enrichir le clone
  6. Monter un nouveau clone quand un nouveau client signe
- Ce que cet user **ne fait pas** tous les jours : lire les métriques TTR/kurtosis, explorer le graphe d'entités, comprendre la courbe fidelity. Il veut que ça marche, pas comprendre pourquoi.

**User secondaire 1** : **lead/directeur de l'agence** → consomme `/admin` pour surveiller conso, budget, qualité par client.

**User secondaire 2** : **client final de l'agence** → arrive via `/share/[token]`, probablement juste pour valider ou piocher du contenu. Peu d'autonomie attendue.

**Audience marketing (non-user)** : **prospect de l'agence** → consomme la landing `/` (démo observable du pipeline) pour être convaincu que "cette agence est rigoureuse, ils ont un vrai système anti-dérive, pas juste un ChatGPT déguisé". La landing est un **asset commercial**, pas un onboarding.
