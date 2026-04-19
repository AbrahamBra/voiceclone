# philosophy.md — Boussole produit VoiceClone

**Usage** : relire avant toute décision produit structurante. Si une feature ne passe pas le filtre, elle est reportée ou rejetée.

---

## 1. Cible

**VoiceClone est un outil opérationnel pour une agence de ghostwriting + setting LinkedIn.** L'opérateur produit du contenu (posts + DMs) dans la voix d'un client, corrige quand ça sonne faux, le clone s'améliore.

User principal = **opérateur d'agence**, pas forcément technique, jongle entre N clones clients + 1 clone agence chaque jour. Jobs-to-be-done quotidiens :

1. Switcher vite entre clones actifs
2. Générer post ou DM dans la voix du client
3. Corriger quand ça sonne faux
4. Monter un nouveau clone quand un client signe

Users secondaires : lead/directeur d'agence (`/admin`), client final (`/share/[token]`), prospect agence (landing). Hiérarchie stricte : une décision qui sert les users secondaires au détriment de l'opérateur est presque toujours mauvaise.

---

## 2. Les 3 règles

### Ship reversible

Toute feature doit pouvoir être retirée sans dégâts. Pas de choix architecturaux ou visuels irréversibles sans pression mesurée. Règles de pouce : un flag pour débrancher, une migration additive plutôt que destructive, une classe CSS plutôt qu'un rewrite.

### Mesurer avant juger

Si on n'a pas de baseline, on ne ship pas une feature "d'optimisation". Le tracking est branché (Plausible + 6 events Sprint 0). On mesure, puis on juge. Les métriques prédites (`×2`, `-50%`) sont remplacées par **"à mesurer"** partout dans la roadmap.

### Refuser complexité technique visible

Les métriques techniques (TTR, kurtosis, collapse, fidelity cosinus, catalogue de règles, audit trail sources) sont **masquées par défaut** dans l'app quotidienne. Le vernis labo a deux lieux légitimes :
- La **démo landing** (asset commercial pour prospect agence)
- La **route `/labo`** (showcase pour curieux tech + prospect qualifié)

Dans l'app quotidienne : une ligne résumée, un badge couleur, un toggle "voir le détail" pour qui veut creuser. Jamais de mur de chiffres imposé.

---

## 3. Ce que VoiceClone n'est pas

Liste **aussi importante** que la cible positive. Chaque item ici est une tentation à refuser.

- **Pas un chatbot généraliste.** Le clone produit du contenu dans la voix d'un client — il ne discute pas de la pluie.
- **Pas un outil de productivité brute.** "Générer 20 posts à la chaîne" est un anti-usage. On privilégie 5 posts fidèles à 20 posts moyens.
- **Pas un laboratoire de recherche pour l'opérateur.** Les artefacts labo sont un asset commercial / de positionnement, pas le cœur de l'UX quotidienne.
- **Pas un outil pour créateurs solo curieux du pipeline.** La cible est l'opérateur d'agence qui produit pour un client tiers, pas quelqu'un qui veut comprendre pourquoi le LLM a choisi ce mot-là.

---

## 4. Filtre de décision rapide

Avant de valider une feature, 4 questions :

1. **Ça sert l'opérateur au quotidien ?** (Si non → vernis, à mettre dans `/labo` ou landing)
2. **Ça respecte la préservation de la voix ?** (Si non → refuser)
3. **Ça se comporte bien quand l'humain est contradictoire ?** (Si non → à retravailler)
4. **Ça laisse l'humain auditer / révoquer ?** (Si non → à retravailler)

Une feature qui passe les 4 = livrable. Une feature qui rate une case = reportée ou reformulée.

### Signaux d'alerte

- Justification par "c'est plus cool" ou "c'est techniquement intéressant"
- Décision qui sert un prospect imaginaire plutôt qu'un opérateur réel
- Décision qui rend une correction irréversible
- Décision qui cache une règle active à l'opérateur

Si un de ces signaux s'allume, on fait une pause.

---

**Décisions non-tranchées et leurs déclencheurs** : voir [decisions.md](decisions.md).
