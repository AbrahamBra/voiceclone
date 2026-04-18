# philosophy.md — Ce qu'est VoiceClone (et ce qu'il n'est pas)

**Statut** : document de boussole, co-écrit avec AhmetA le 2026-04-18.
**Usage** : à relire avant toute décision produit structurante. Si une feature proposée ne passe pas le filtre, elle est reportée ou rejetée.

---

## 1. Ce qu'est VoiceClone

> **Un outil opérationnel pour une agence de ghostwriting + setting LinkedIn. Il permet à l'opérateur de produire du contenu (posts + DMs) dans la voix fidèle d'un client, en s'améliorant au fil des corrections, avec un pipeline de préservation de style visible mais discret.**

Trois mots-clés :
- **Opérationnel** — il sert à travailler, pas à contempler
- **Fidèle** — la préservation du style prime sur la productivité brute
- **Évolutif** — il apprend, et il apprend intelligemment (pas juste en accumulant)

---

## 2. Ce que VoiceClone n'est pas

Liste **aussi importante** que la liste positive. Chaque item ici est une tentation à refuser.

- **Pas un chatbot généraliste**. Le clone ne discute pas de la pluie, ne répond pas aux questions hors-style. Il produit. C'est tout.
- **Pas un outil de productivité brute**. "Générer 20 posts à la chaîne" est un anti-usage. On privilégie 5 posts fidèles à 20 posts moyens.
- **Pas un laboratoire de recherche**. Les artefacts laboratoire (métriques techniques, pipeline observable, démos animées) sont du **vernis commercial** et un asset de positionnement — pas le cœur de l'expérience utilisateur quotidienne.
- **Pas l'ébauche d'un esprit humain artificiel**. L'ambition long-terme d'AhmetA sur ce sujet est réelle, mais **vit ailleurs**. VoiceClone est un produit commercial qui capitalise une discipline (contraintes + observabilité + feedback), pas le véhicule de cette ambition. La séparation est nette et assumée.
- **Pas un outil pour créateurs solo curieux du pipeline**. La cible est l'opérateur d'agence — quelqu'un qui veut produire vite et bien pour un client tiers, pas quelqu'un qui veut comprendre pourquoi le LLM a choisi ce mot-là.

---

## 3. Qui on sert (hiérarchie stricte)

1. **Opérateur d'agence** (user principal quotidien) — collaborateur AhmetA qui produit pour N clients. Ses besoins dominent toute décision UX.
2. **Lead / directeur d'agence** (admin, monitoring, facturation) — user secondaire, besoins orientés portefeuille.
3. **Client final** (reçoit un share-link, valide son clone) — user tertiaire, expérience simplifiée.
4. **Prospect agence** (visite la landing) — cible marketing, pas user produit.
5. **Curieux tech / dev** — secondaire, on lui parle via `/labo` dédié et la démo landing, pas via l'app.

Une décision qui améliore les users 4-5 au détriment des users 1-2 est **presque toujours mauvaise**.

---

## 4. Les trois principes fondateurs

### Principe #1 — L'opérateur domine, la tech vit en vernis

- L'opérateur vient produire, pas observer son clone
- Toutes les métriques techniques (TTR, kurtosis, collapse_idx, fidelity cosinus, catalogue de règles, audit trail sources) sont **opt-in ou masquées par défaut**
- Le vernis laboratoire a deux lieux légitimes :
  - La **démo landing** (asset commercial pour prospect agence)
  - La **route `/labo`** (asset pour curieux tech + showcase pour prospect qualifié)
- Dans l'app quotidienne : une ligne résumée, un badge couleur, un toggle "voir le détail" pour qui veut creuser. Jamais de mur de chiffres imposé.

**Règle de décision** : si une feature expose de la métrique technique à l'opérateur par défaut, elle est soit reportée, soit reformulée en "badge + tooltip opt-in".

### Principe #2 — L'IA maintient la cohérence que l'humain ne maintient pas seul

- L'humain se contredit dans le temps. Il juge selon l'humeur, l'audience imaginée, le contexte oublié. C'est une donnée, pas un défaut à corriger.
- Le clone n'obéit pas aveuglément aux corrections — il les **ingère avec méfiance**
- Quand deux corrections se contredisent, le système **rappelle à l'humain ce qu'il a décidé** et lui demande de trancher. Il ne choisit pas silencieusement la dernière.
- La correction isolée ne fait pas règle. Une règle émerge de la répétition confirmée.
- Le ground-truth ultime n'est pas le jugement humain, c'est **la performance réelle** (quand elle est mesurable). Le jugement humain est un signal parmi d'autres, pas l'oracle absolu.

**Règle de décision** : toute nouvelle feature de feedback / correction doit répondre à la question "comment ça se comporte quand l'humain est incohérent ou contradictoire ?" avant d'être livrée.

### Principe #3 — Le clone te rappelle ce que tu as décidé quand tu t'en souviens plus

- La mémoire de l'opérateur est courte. Celle du clone est longue.
- Chaque correction, chaque règle, chaque signature détectée est traçable, datée, révocable
- L'opérateur doit pouvoir, à tout moment, voir :
  - Quelles règles sont actives sur son clone et pourquoi
  - Quelles corrections ont été ingérées et quand
  - Quelles contradictions ont été détectées et restent non-tranchées
  - Quelles signatures du corpus source sont préservées (explicitement ou tacitement)
- Pas pour l'éduquer, pas pour qu'il comprenne le pipeline — **pour qu'il puisse challenger ses propres décisions passées**

**Règle de décision** : toute règle / correction / signature ingérée par le clone doit être **auditable** et **révocable** par l'humain dans l'UI. Pas de boîte noire.

---

## 5. Corollaires opérationnels (conséquences pratiques)

### Ce qu'on fait par défaut

- Contraintes mécaniques **hard** sur les sorties (forbidden words, markdown, patterns IA français) — non-négociable
- Observabilité **complète côté backend** (logs, metrics, audit trail) — toujours
- Boucle de feedback **simple et rapide côté opérateur** (👍 / 🤔 / 👎 + correction textuelle)
- Préservation de la voix mesurée par similarité cosinus + critics stylistiques (rythme, voix, heat) — invisible par défaut, disponible sur demande
- Différenciation **Post vs DM** assumée : les deux n'ont pas la même architecture de scenarios ni la même tolérance à l'erreur

### Ce qu'on ne fait pas

- Génération bulk / mass production
- Masquage total du pipeline (tout reste techniquement auditable, même si discret)
- Ingestion silencieuse de corrections qui contredisent l'historique
- Dashboard unique pour tous (chaque rôle a sa surface adaptée)
- Features pensées pour "le créateur solo" au détriment de l'opérateur d'agence

### Ce qu'on mesure (hiérarchie)

1. **Performance réelle sur LinkedIn** (likes, commentaires, DMs entrants, leads convertis) — quand captable
2. **Cohérence inter-temporelle des corrections** (taux de contradictions détectées, taux de règles révoquées)
3. **Temps opérateur par post livré** (friction de production)
4. **Taux de corrections par conversation** (engagement avec le feedback loop)
5. **Fidélité cosinus + critics** — signal technique, utile au backend, secondaire pour l'UI

---

## 6. Voies de développement (12-24 mois)

### Axe Post — montée en profondeur

Typologie des posts avec intents canoniques, chacun avec ses contraintes, sources, critics, et scoring propre :
- Post autonome
- Post lead magnet
- Post actualité croisée
- Post prise de position
- Post framework
- Post cas client
- Post coulisse / transparence

Chaque intent = mini-architecture dédiée. Les corrections sont **tagged par intent** pour éviter la contamination inter-contextes.

### Axe DM — montée en précision

Moins d'intents (3-4 canoniques : 1er message, relance, reply chaud, closing), mais critics **plus stricts** (zero-tolérance sur hard violations). Intégration Breakcold / outils sales engagement pour import conversation + scoring performance (rate d'acceptance, rate RDV booké).

### Axe Agence — passage agence-first

Déclenchement : au 3e client signé OU au 2e setter recruté, refonte pour :
- Concept `organization` central (schéma + RLS Postgres)
- Rôles fine-grained (owner / operator / client_viewer)
- Permissions attribuées (opérateur X a accès à clients A-D en modif, E-F en lecture)
- Audit trail de qui a modifié quoi
- Facturation par organization

### Axe Cohérence — IA gardienne de cohérence

Trois modes de maturité progressive :

- **Mode A — Détection passive** : le système détecte les contradictions inter-corrections, les remonte dans un dashboard "Cohérence", l'humain tranche périodiquement.
- **Mode B — Abstraction active** : le système propose des règles plus abstraites qui subsument N corrections atomiques. L'humain valide / rejette / affine la suggestion.
- **Mode C — Découverte de signatures implicites** : le système observe le corpus source, identifie des patterns stylistiques que l'humain n'a jamais nommés, propose de les préserver explicitement. Extension naturelle du RhythmCritic.

C'est le mode qui rapproche VoiceClone d'un modèle de l'individu — un "world model" restreint à la voix d'une personne. C'est cette direction qui, si poursuivie, distingue durablement le produit d'un "wrapper Claude + RAG + corrections".

### Axe Laboratoire — séparation vernis / app

- Landing commerciale orientée conversion, démo pipeline comme asset
- Route `/labo` pour qui veut creuser (prospect qualifié, curieux tech, recrutement)
- App quotidienne débarrassée des métriques techniques imposées

---

## 7. Décisions non-tranchées (à revoir)

| Décision | Deadline souhaitée | Critère de déclenchement |
|---|---|---|
| Bascule solo-first → agence-first | À déclencher ponctuellement | 3e client signé ou 2e setter recruté |
| Intégration Breakcold / sales engagement | 3-6 mois | Négociation API + volume DM suffisant |
| Mode C (découverte signatures implicites) | 9-12 mois | Après stabilisation Mode A + B |
| Modèle économique (self-serve vs B2B2C) | 6 mois | Après 5-10 clients |
| Ouverture acquisition inbound (SEO, content marketing) | 12-18 mois | Après PMF confirmé sur outbound |
| Retypage scenarios (post_autonome, DM-1st, etc.) | 1-2 mois | Pré-requis pour plusieurs sprints roadmap |

---

## 8. Ce qui nous guide quand on hésite

### Filtre de décision rapide

Avant de valider une feature, 4 questions :

1. **Ça sert l'opérateur d'agence au quotidien ?** (Si non → vernis, à mettre dans `/labo` ou landing)
2. **Ça respecte la préservation de la voix ?** (Si non → refuser)
3. **Ça se comporte bien quand l'humain est contradictoire ?** (Si non → à retravailler)
4. **Ça laisse l'humain auditer / révoquer ?** (Si non → à retravailler)

Une feature qui passe les 4 = livrable. Une feature qui rate une case = reportée ou reformulée.

### Signaux d'alerte

- Une décision justifiée par "c'est plus cool" ou "c'est techniquement intéressant"
- Une décision qui sert un prospect imaginaire plutôt qu'un opérateur réel
- Une décision qui rend une correction irréversible
- Une décision qui cache une règle active à l'opérateur
- Une décision qui parle d'"esprit humain artificiel" au lieu de "ghostwriting LinkedIn"

Si un de ces signaux s'allume, on fait une pause.

---

**Ce document est vivant. Il évolue quand la philo évolue — mais rarement et pour des raisons fortes.**

---

## Annexe — Fondement théorique (direction long-terme, pas UX)

> **Cette section explicite l'horizon intellectuel qui guide la direction technique long-terme. Elle ne remonte jamais dans l'UI produit, ne justifie pas une complexité visible à l'opérateur, et ne doit pas être utilisée comme argument commercial.**

### Le gap structurel entre ce qui est dit et ce qui parle à travers

Lecture lacanienne : il y a une distance irréductible entre le sujet de l'énoncé (ce qui est dit, corrigé, écrit explicitement) et le sujet parlant (ce qui parle à travers, la structure latente qui génère les énoncés). L'auteur ne sait pas lui-même ce qui fait sa voix — il ne connaît que ses effets manifestes.

Conséquence : une architecture qui se contente d'ingérer des énoncés (corpus + corrections) modélise la surface, pas la structure. Elle reproduit, elle n'explique pas.

### Le parallaxe appliqué au style d'un individu

La vérité de la voix d'une personne n'est **dans aucune** source unique :
- Les corrections sont ponctuelles, dépendantes de l'humeur, parfois contradictoires
- Le corpus source est statique, biaisé par le moment de production
- La performance réelle (likes, DMs, leads) est biaisée par l'algorithme plateforme et l'audience

La vérité émerge **dans le gap entre les trois** — dans ce qui persiste à travers les variations. Un clone mode C ne choisit pas une source canonique. Il triangule.

### La limite intrinsèque des LLM

Un LLM prédit le prochain token. Il modélise la surface des énoncés. Il ne modélise pas la structure causale qui fait qu'un individu produit ces énoncés-là et pas d'autres. Ajouter du RAG, du prompt engineering, du fine-tuning améliore la prédiction, ne franchit pas cette limite.

Le mode C vise ce franchissement, en ciblant pas les tokens mais **la structure qui les génère chez un individu spécifique**. C'est un programme de long-terme, exploratoire, qui ne se confond pas avec la roadmap produit immédiate.

### Corollaires techniques

- **Les contradictions humaines ne sont pas un bug mais un signal.** Elles indiquent une structure latente que chaque correction individuelle ne capture que partiellement. Le clone détecte et triangule — il ne choisit pas.
- **La méfiance vis-à-vis du feedback humain est structurelle, pas anti-humaniste.** L'humain ne peut pas avoir une vue statistique sur sa propre signature. Le clone, par construction, peut.
- **Le vrai différenciateur technique de VoiceClone à long terme est philosophique, pas ingénierique.** Tout le monde peut assembler GPT-4 + LangChain + vector DB. Personne ne peut accidentellement modéliser la structure latente de la voix d'un individu s'il ne vise pas explicitement ce problème.

### Ce que cette annexe autorise et n'autorise pas

**Autorise** :
- Orienter la recherche technique vers le mode C (découverte de signatures implicites)
- Pondérer les décisions d'architecture long-terme en faveur d'approches qui modélisent la structure, pas la surface
- Garder une boussole quand on est tenté de "juste ajouter une feature"

**N'autorise pas** :
- Remonter cette réflexion dans la copy UI, le marketing, les pitchs commerciaux
- Justifier une complexité visible à l'opérateur
- Sacrifier un quick win pragmatique au nom d'un idéal théorique
- Transformer VoiceClone en projet de recherche théorique — il reste un outil utilitaire d'agence
