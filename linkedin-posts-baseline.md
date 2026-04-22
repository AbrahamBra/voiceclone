# Couche 1c — LinkedIn Posts Baseline

> **STATUT : SPEC NON IMPLÉMENTÉE (2026-04-22).**
> Ce fichier décrit un `PostCritic` qui n'existe pas dans le code. Aucune règle ci-dessous n'est branchée dans le pipeline. Le seul critic actif est `RhythmCritic` (DM only — [lib/critic/rhythmCritic.js](lib/critic/rhythmCritic.js)). Pour intégrer cette baseline, il faut d'abord vérifier le volume réel de génération de posts en prod, puis bâtir `PostCritic` par étapes (shadow → guard) à l'image de `RhythmCritic`.

**Scope** : génération de **posts LinkedIn** (feed, personal branding, thought-leadership). **Différent des DMs.** Critic séparé : `PostCritic` (vs `RhythmCritic` qui reste sur DMs).

**Contraintes plateforme fondamentales :**
- ~210 caractères visibles avant "see more" → **le hook se joue là**
- Lecture 1-2 sec au scroll mobile
- Pas de bold/italic natif (unicode tricks = looks cheap)
- Liens sortants dans le post = reach cassé par algo → **lien en premier commentaire**
- Reach optimal : 1200-2100 caractères (sweet spot texte pur), 150-400 pour "punchline posts"
- Questions en clôture → commentaires → algo boost

**Ancrages experts US/EN** (chaque règle renvoie à une référence vérifiable)

**Instructions** : coche `[x]` ce que tu gardes. Légende : 🔒 absolue / 🔓 surchargeable par persona.

---

## H. Hook (les 210 premiers caractères)

- [ ] **H1** 🔒 Première ligne ≤ 12 mots
  - *Détection :* `words(line[0]) > 12`
  - *Réf :* **Justin Welsh** — "Hook = 1 ligne. Pas 2. Pas 3." / **Jasmin Alić** — hook < 10 words rule
  - *Why :* la preview mobile coupe violemment, un hook qui dépasse 210 chars tue le clic "see more"

- [ ] **H2** 🔓 Le hook doit faire une promesse, une tension, ou un chiffre spécifique
  - *Détection :* présence d'au moins un : nombre, superlatif précis (`le seul`, `la seule`), question provocante, claim contrarien
  - *Réf :* **Eugene Schwartz** (Breakthrough Advertising) — "Enter the conversation in reader's head" / **Joe Sugarman** — slippery slope
  - *Why :* sans promesse/tension, zéro raison de cliquer "see more"

- [ ] **H3** 🔒 Pas de "I'm excited to announce" / "Thrilled to share" / "Ravi de vous annoncer"
  - *Détection :* regex variantes FR/EN (`ravi|heureux|fier|excited|thrilled|delighted|honored|pleased`)
  - *Réf :* **Dickie Bush** — "The Announcer Archetype is dead" / **Lara Acosta** — anti-announcement hooks
  - *Why :* hook LinkedIn 2020, maintenant = marker d'amateur corporate

- [ ] **H4** 🔓 Un des 7 formats de hook validés : **observation contrarian / liste numérotée / story ouverture / question tranchante / erreur confessée / chiffre choc / analogie inattendue**
  - *Détection :* matcher patterns (`N reasons why`, `I used to believe`, `X years ago`, `Stop doing`, `Here's what nobody tells you`, etc.)
  - *Réf :* **Justin Welsh** — "7 hook frameworks" / **Nicolas Cole** (Ship 30 for 30) — typology of openers
  - *Why :* ces 7 patterns surperforment en reach de 3-5x vs ouvertures neutres

- [ ] **H5** 🔒 Pas d'emoji au premier caractère
  - *Détection :* `/^\p{Extended_Pictographic}/u`
  - *Réf :* **Richard van der Blom** (LinkedIn Algorithm Insights 2024) — emoji en pos 1 = -12% reach moyen
  - *Why :* signal "low-value content" pour l'algo et le lecteur

## F. Focus (One Big Idea)

- [ ] **F1** 🔒 Un seul sujet principal par post
  - *Détection :* heuristique — compter les transitions thématiques (changement de pronom + nouveau nom propre non-référé)
  - *Réf :* **Dan Koe** — "One piece. One idea. One payoff." / **Nicolas Cole** — "atomic essay"
  - *Why :* multi-topic = dilution, le lecteur ne sait pas quoi retenir

- [ ] **F2** 🔓 Le post doit passer le test "what's the one takeaway ?" en une phrase
  - *Détection :* n/a automatisable — flag si > 1500 chars ET pas de ligne-résumé en fin
  - *Réf :* **Sahil Bloom** — "test de la phrase unique"
  - *Why :* sans payoff identifiable, le post est un journal intime public

## S. Structure (White space, scannable)

- [ ] **S1** 🔒 Aucun paragraphe > 3 lignes mobiles (≈ 120 caractères)
  - *Détection :* split `\n\n`, chaque block ≤ 120 chars
  - *Réf :* **Justin Welsh** — "short lines, lots of white space" / **Lara Acosta** — la règle du "thumb test"
  - *Why :* wall-of-text = scroll instantané sur mobile (80% des lectures LinkedIn)

- [ ] **S2** 🔓 Minimum 5 sauts de ligne dans un post > 500 chars
  - *Détection :* ratio `count("\n") / charCount < 0.01` ET charCount > 500
  - *Réf :* **Lara Acosta** — "air kills"
  - *Why :* densité visuelle = signal de refus de lire

- [ ] **S3** 🔓 Phrases courtes ≥ 40% du post
  - *Détection :* ratio phrases ≤ 8 mots
  - *Réf :* **Ann Handley** (Everybody Writes) — "short sentences punch"
  - *Why :* rhythm lecture mobile, scannabilité

- [ ] **S4** 🔓 Si liste : points en début de ligne, pas inline
  - *Détection :* si `count(",")` > 6 sans `\n` → probable liste inline = à casser
  - *Réf :* **Nicolas Cole** — "lists live in lines, not in sentences"

## V. Voice (POV, spécificité, toi-count)

- [ ] **V1** 🔓 Ratio "you/your/tu/toi" > "I/me/mon" d'au moins 1.2x
  - *Détection :* count vous/tu/votre/ton vs je/moi/mon
  - *Réf :* **Gary Halbert** — "count your you's" / **Claude Hopkins** (Scientific Advertising)
  - *Why :* copywriting 101 — post centré lecteur, pas auteur

- [ ] **V2** 🔒 Pas de humblebrag pattern ("small win", "grateful for", "blessed to have")
  - *Détection :* liste regex FR/EN (`reconnaissant|béni|touché|#grateful|#blessed|small win|humble brag`)
  - *Réf :* **Katelyn Bourgoin** — "humblebrag triggers cringe, not connection" / **Dan Koe**
  - *Why :* marker d'inauthenticité, anti-signal

- [ ] **V3** 🔓 Au moins un élément spécifique (chiffre précis, nom, date, montant)
  - *Détection :* présence d'au moins un token numérique OU nom propre
  - *Réf :* **David Ogilvy** — "specifics beat generalities every time" / **Sugarman**
  - *Why :* spécifique = crédible, générique = invisible

- [ ] **V4** 🔒 Pas de guru-speak ("I just dropped knowledge", "let me tell you", "listen up")
  - *Détection :* liste regex
  - *Réf :* **Sahil Bloom** — "authority without assertion"

- [ ] **V5** 🔓 POV assumé : le post doit contenir au moins une affirmation tranchée
  - *Détection :* présence marqueurs (`je pense que`, `selon moi`, `my take`, `unpopular opinion`) OU structure contrarian
  - *Réf :* **Justin Welsh** — "vanilla posts die"
  - *Why :* sans POV, le post est un digest

## C. Close / CTA

- [ ] **C1** 🔓 Fin avec une question ouverte (pour commentaires) OU une punchline retour-hook
  - *Détection :* dernière phrase = question OU écho lexical au hook
  - *Réf :* **Justin Welsh** — "circular structure" / **Nicolas Cole**
  - *Why :* commentaires boostent reach, punchline boucle l'expérience

- [ ] **C2** 🔒 Pas de CTA externe direct dans le post ("click here", "lien dans ma bio", "DM me")
  - *Détection :* regex URL dans le corps + regex CTA sortant
  - *Réf :* **Richard van der Blom** — posts avec lien externe = -30 à -50% reach
  - *Why :* algo LinkedIn pénalise le trafic sortant

- [ ] **C3** 🔓 Pas de P.S. verbeux (max 2 lignes si P.S. il y a)
  - *Détection :* `/P\.S\./i` et mesurer ligne suivante
  - *Réf :* **Dan Koe** — "PS should be a punch, not a paragraph"

## A. Algo / Plateforme

- [ ] **A1** 🔓 Longueur cible : 1200-2100 caractères (texte pur), 150-400 (punchline post)
  - *Détection :* flag si entre 500 et 1100 (zone morte) OU > 2200
  - *Réf :* **Richard van der Blom** (LinkedIn Algorithm Report 2024)
  - *Why :* zone morte reach-wise, statistiquement

- [ ] **A2** 🔓 3-5 hashtags max, en fin de post
  - *Détection :* count `#[\w]+` — flag si > 5 ou si hashtags inline dans le texte
  - *Réf :* **LinkedIn official creator guide** / van der Blom
  - *Why :* > 5 = spam signal, inline = pollution lecture

- [ ] **A3** 🔒 Pas de "engagement bait" ("agree or disagree?", "thoughts?", "comment 'yes' if...")
  - *Détection :* liste regex
  - *Réf :* **LinkedIn Terms** + van der Blom — shadowban risk
  - *Why :* détecté par l'algo → reach effondré

- [ ] **A4** 🔒 Pas de multi-mentions tagging ("@person1 @person2 @person3")
  - *Détection :* count `@[\w]+` > 2
  - *Réf :* van der Blom — > 2 mentions non-liées = spam signal

## X. Anti-patterns LinkedIn spécifiques

- [ ] **X1** 🔒 Pas d'"airport story / Uber driver story" fabulée
  - *Détection :* difficile à automatiser — heuristique : post contenant ("chauffeur uber", "dans l'avion", "hier un inconnu m'a dit") + leçon de vie
  - *Réf :* **Katelyn Bourgoin** — "fake parable pattern"
  - *Why :* meme LinkedIn, immédiatement identifié comme fabriqué

- [ ] **X2** 🔓 Pas de "Here's what nobody tells you..." si le contenu est banal
  - *Détection :* pattern hook + analyse contenu (difficile ; Signal A embedding aide)
  - *Réf :* **Lara Acosta** — "don't cash a check your body can't cash"

- [ ] **X3** 🔒 Pas de ALL CAPS de plus de 1 mot
  - *Détection :* `/\b[A-Z]{2,}\s+[A-Z]{2,}\b/`
  - *Réf :* copywriting classique
  - *Why :* cry-text, marker amateur

- [ ] **X4** 🔓 Pas de faux dialogue inventé ("Mon boss m'a dit : 'tu ne vas jamais y arriver'")
  - *Détection :* guillemets `"..."` sur phrase type témoignage non sourcé
  - *Réf :* **Bourgoin** — "dialogue fabrication pattern"

---

## Règles que TU veux ajouter

- [ ] **Z1** ...
- [ ] **Z2** ...

---

## Synthèse des frameworks de référence

| Framework | Auteur | Usage dans le critic |
|-----------|--------|----------------------|
| 5 Levels of Awareness | Eugene Schwartz | calibrer hook selon audience |
| Slippery Slope | Joe Sugarman | chaque ligne → la suivante (détecter micro-hooks) |
| PAS (Problem-Agitate-Solution) | classique | structure post long |
| Before-After-Bridge | classique | story posts |
| 4 U's (Urgent, Useful, Unique, Ultra-specific) | Michael Masterson | hook test |
| One Big Idea | David Ogilvy / Dan Koe | F1 / F2 |
| Count-your-you's | Gary Halbert | V1 |
| Atomic Essay | Nicolas Cole | F1 |
| 7 Hook Formats | Justin Welsh | H4 |

## Architecture finale

```
App génère :
├─ DMs prospection   → RhythmCritic
│                       ├─ Couche 1a : setter-baseline
│                       └─ Couche 1b : DM LinkedIn copy (à retravailler)
│
└─ Posts LinkedIn    → PostCritic (nouveau)
                        └─ Couche 1c : posts-baseline (ce fichier)
```

**Deux critics séparés, deux pipelines, deux outcomes** :
- DM → signal = RDV pris
- Post → signal = reach, commentaires, leads entrants

Cela implique Phase 1bis à dédoubler : pour les posts, le signal "heat" n'existe pas (pas de prospect qui répond). Le signal business est : `impressions`, `comments`, `profile_views`, `inbound_leads`.

**À discuter avant de coder :** est-ce que tu veux dès maintenant traiter les posts en pipeline séparé, ou on reste focus DMs pour l'instant et on traite posts plus tard ?

---

## 2026-04-22 — État d'avancement

- Les 7 sous-types post canoniques ([src/lib/scenarios.js](src/lib/scenarios.js)) ont bien des overrides prompt dans [api/chat.js](api/chat.js) (incl. `post_cas_client` ajouté en même temps que ce commit).
- `buildSystemPrompt` ([lib/prompt.js](lib/prompt.js)) connaît maintenant `scenarioKind` et arrête d'imposer le format WhatsApp-multi-messages aux posts.
- Les 3 `post.md` par persona (Victor / Paolo / Thomas) ont été réalignés : plus de typologie contradictoire, plus de header `**Format :**` forcé.
- Le `PostCritic` décrit ci-dessus reste à construire. Pré-requis : vérifier usage prod (`critic_commit_date` vs `last_prod_message_date` côté posts) avant de planifier.
