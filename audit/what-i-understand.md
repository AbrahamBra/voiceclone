# what-i-understand.md — VoiceClone

Compréhension inférée à froid après lecture du code. **À valider par toi avant que je passe à la critique écran par écran.**

---

## A. One-liner (validé avec AhmetA le 2026-04-18)

> **VoiceClone est l'outil opérationnel d'une agence de ghostwriting + setting LinkedIn. L'agence y monte un clone par client (service posts, service DM, ou les deux), l'entraîne par feedback continu, et s'en sert au quotidien pour produire le contenu facturé. Usage secondaire : l'agence s'en sert pour son propre compte.**

Conséquences pour l'audit :
- **User réel** = opérateur d'agence (un collaborateur) qui jongle entre N clones clients + 1 clone agence chaque jour. Pas un curieux du pipeline, pas un client final.
- Le **client final** de l'agence peut arriver dans l'app via `/share/[token]` (handoff). UX secondaire mais existante.
- La **vitesse de switch inter-clones** et la **lisibilité multi-persona** deviennent prioritaires — bien plus que la beauté d'un écran isolé.
- Le pipeline "observable" (landing lab, cockpit, marginalia) est un **différenciateur commercial** (ce que l'agence montre à un prospect pour vendre), pas l'interface quotidienne.

Red flag confirmé à cette lecture : **l'app ne fait pas de différence UX entre "je bosse pour mon client A" et "je bosse pour mon client B" et "je bosse pour mon agence"**. Tout est au même niveau dans le hub. Un opérateur d'agence qui gère 20 clients va devoir scroller. Pas de filtres, pas de groupes, pas de tri par activité. On y reviendra en phase 3.

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
- **Composants dead** : `PersonaCard.svelte` et `ScenarioPill.svelte` existent dans le repo mais jamais importés. Vestiges d'un précédent redesign (voir `docs/superpowers/plans/2026-04-15-ui-revolution.md`).

---

## C. Modèle mental inféré

### C.1 Concepts que l'utilisateur doit comprendre

Niveau 1 (incontournables, présents dès le hub) :
- **Clone / Persona** : l'entité principale. Possède un nom, avatar, titre, style.
- **Scenario** : un préset de contexte conversationnel (ex : `default`, plus tout ce qui est dans `scenarios` du config).
- **Fidélité** : score cosinus 0-1 entre la sortie et le corpus source. Seuil 0.720.

Niveau 2 (apparaissent dans le chat) :
- **Collapse index** : 0-100, préservation du style. ≥70 sain, 50-70 alerte, <50 effondré.
- **Règles** : catalogue d'anti-patterns (forbidden_word, self_reveal, ai_pattern_fr, ai_cliche, markdown, fidelity_drift…). Classées hard / strong / light.
- **Rewrite** : passe 2 déclenchée quand les hard violations sautent.
- **Drift** : fidélité sous le seuil.

Niveau 3 (réservé aux power-users, dans les marginalia / tooltips) :
- **TTR (Type-Token Ratio)** : diversité lexicale.
- **Kurtosis** : concentration des phrases courtes/longues.
- **Signature presence** : fréquence des tournures signatures du persona.
- **Question ratio**, **forbidden hits**, **avg sentence length**.

Niveau 4 (IntelligencePanel) :
- **Entités** (concept, framework, tool, person, company, metric, belief).
- **Relations** (contradicts, enforces…).
- **Contradictions**.
- **Corrections** (historique).

**Verdict** : quatre niveaux de concepts empilés sur le même écran. C'est énorme.

### C.2 Vocabulaire propre vs. standard

Standard : clone, scenario, chat, conversation, feedback, correction, knowledge, fidelity.

Propre à l'app, à définir pour un nouveau user :
- **laboratoire** (sub-title du brand) — positionnement éditorial, pas un concept UX standard
- **collapse** — dans le contexte LLM c'est technique mais non standard pour un marketer
- **fingerprint** (StyleFingerprint SVG) — métaphore visuelle maison
- **marginalia** — référence typographique (annotations de marge) utilisée comme nom de composant ET comme nom visible dans le design
- **cockpit** — utilisé comme nom de composant ET visible dans l'UI ("ChatCockpit")
- **audit strip** — barre du bas

L'app parle beaucoup comme un carnet de laboratoire scientifique/typographique. C'est une direction éditoriale assumée, cf. les polices mono, les `p-idx`, les séparateurs dashed, le "réglure de page" (grid background).

### C.3 Métaphores visuelles / spatiales

- **Carnet de labo** : grid-lines sur le fond (`linear-gradient`), font-mono partout, `01 / prompt`, `02 / sortie`, vermillon comme accent unique, headlines en italique typographique.
- **Jauges physiques** : les 3 gauges du cockpit sont rendues comme des instruments (`[collapse | 87.2] [fidélité | 0.834] [règles | 0]`) avec un style "état-data" (ok/warn/bad).
- **Diff typographique** : rewrite = strike-through avec decoration vermillon, conservée dans la marginalia pour audit.
- **Fingerprint** : un SVG circulaire qui encode `ttr, kurtosis, questionRatio, signaturePresence, forbiddenHits, avgSentenceLen` comme couronne visuelle — présent sur la clone-card, le cockpit, chaque message bot.

Le langage visuel est cohérent (vermillon + mono + grid + dashed rules) mais **dense, austère, technique**. Zéro moment d'humanité dans la chrome.

---

## D. Hypothèses sur le positionnement

### D.1 Persona cible (validée)

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

### D.2 Concurrents probables

- **Magic Post / Taplio / Cost Per Thousand** (côté ghostwriting LinkedIn) — plus polished, moins technique
- **Promptfoo / OpenPipe / Langsmith** (côté observabilité pipeline) — plus rigoureux, non grand-public
- **Character.ai / Delphi** (côté clone de personnalité) — plus grand-public mais moins rigoureux stylistiquement
- **Arc, Linear, Raycast** (côté direction esthétique) — la landing vise ce niveau de raffinement visuel

Tu n'es sur aucun des trois marchés à 100%. Ça peut être un positionnement distinctif, ou le symptôme d'un produit qui ne sait pas pour qui il optimise. Je suspecte que la deuxième lecture est la vraie.

### D.3 Promesse de valeur mise en avant

Landing (pour prospect agence) : "Un clone d'écriture **observable en direct** — pas un chatbot de plus." → Argument commercial : l'agence a un **vrai système**, pas un wrapper ChatGPT.

Guide (pour opérateur interne et client handoff) : "Le clone s'améliore à chaque correction." → Argument opérationnel : plus tu t'en sers, meilleur c'est.

README (pour dev solo / recruitment tech) : Promesse technique pure.

**Gap majeur** : aucune des trois promesses ne s'adresse à l'**usage quotidien** de l'opérateur ("je livre mon lot de 15 posts/jour sans douleur"). L'app optimise pour convaincre (landing) et pour éduquer (guide), mais **pas pour le travail répétitif réel**. Phase 3 devra challenger ça sur chaque écran.

---

## E. Questions ouvertes (red flags UX)

Question 1 résolue par AhmetA : cible = agence multi-clients. Les 9 restantes :

1. ~~Qui est le user cible ?~~ **Résolu** : agence ghostwriting+setting, opérateur interne principal, client final via share secondaire.

2. **Le mode multi-scenario** : un persona peut avoir plusieurs scenarios. Le hub les expose comme des boutons sous la card (`clone-scenarios`). Concrètement, un user est-il censé switcher entre "post LinkedIn" et "DM prospection" à chaque message, ou c'est un état sticky ? Pas vu de UI de switch dans le chat lui-même.

3. **Le rôle de la calibration `/calibrate/[id]`** : obligatoire après création ? Optionnelle ? Rejouable ? Rien ne force, rien ne relie. Elle semble être **flottante** dans l'app.

4. **La sidebar 3 onglets** du chat (Connaissance / Intelligence / Conversations) : c'est un déséquilibre d'importance majeur. Conversations est l'usage 80% du temps, les deux autres sont épisodiques. Pourquoi les mettre au même niveau ?

5. **Les 4 panels droite** (règles / prospect / correction / réglages) : idem, quel pourcentage de temps passe le user sur chacun ? Mon instinct dit 1% sur "règles" (c'est une consultation rare), 5% sur "prospect" (usage dédié), 60% sur "correction" (mais seulement sur une réponse spécifique), 5% sur "réglages". Et pourtant ils ont tous un tab-btn égal.

6. **Le cockpit lui-même** : 3 jauges en permanence, dont 2 (collapse, fidélité) demandent un modèle mental poussé. Un user qui ne comprend pas ces chiffres les ignore ou pire s'y perd. Est-ce que **vraiment** 100% du temps il faut afficher ces jauges ?

7. **L'AuditStrip bottom** : une narrative française auto-générée qui décrit la session. C'est charmant, mais qui la lit ? À quoi elle sert dans le workflow réel ? Est-ce qu'elle est regardée, ou elle prend juste 40px de scroll ?

8. **Pas de preview du message avant envoi** : Enter → streaming. Vu la complexité du pipeline derrière (coût, latence), y a-t-il un use-case pour un "draft mode" ? Ou c'est volontairement excluant ?

9. **Le scenario dans l'URL** : `/chat/[id]?scenario=X`. Mais rien dans l'UI du chat ne montre qu'on est dans un scenario X et pas Y, sauf un petit label mono dans le ChatCockpit. Est-ce que ce niveau de subtilité est suffisant ?

10. **Le StyleFingerprint SVG** : présent sur la clone-card du hub, le cockpit du chat, et chaque bot message. C'est une belle trouvaille visuelle, mais **que fait-on quand on le comprend ?** Est-il actionnable, ou purement décoratif ?

---

## Notes méta sur l'audit

- Exploré **en code** (pas en browser live) par choix. Les interactions runtime (animations, latences, erreurs réseau) sont inférées par lecture, pas observées.
- KPI cité par toi : **UX, fluidité, efficience**. Je vais scorer chaque écran contre ces 3 axes en phase 3, mais ils sont qualitatifs — la priorisation finale restera à ton jugement.
- Je n'ai **pas** exploré : les fichiers `lib/pipeline.ts`, `checks.ts`, `rewrite.ts`, `fidelity.js`, les migrations Supabase, les tests. L'audit est strictement UX/surface, pas backend logic.

---

**Valide ou corrige ma compréhension avant que je lance l'audit écran par écran.**

Trois corrections rapides que tu peux faire pour accélérer Phase 3 :
- **Q1 (cible)** : "ghostwriter / consultant / client final / multiple ?"
- **Q2 (priorité écran)** : dans quel ordre tu veux que j'audite les 8 écrans ? Par défaut je ferai : `/chat` → `/create` → `/hub` → `/calibrate` → landing → `/guide` → `/admin` → `/share`. Inverse ou change si tu veux commencer par autre chose.
- **Q3 (compromis)** : tu veux voir les deux versions (évolutive + zéro compromis) pour chaque écran, ou seulement une ? Phase 3 est longue — économisons si besoin.
