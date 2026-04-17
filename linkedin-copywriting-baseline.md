# Couche 1b — LinkedIn DM Copywriting Baseline (v2)

**Scope** : **DMs de prospection LinkedIn** (1st message + follow-ups). Complémentaire du setter-baseline (mécaniques) : ici, **craft d'écriture** ancré sur les meilleurs practitioners US.

**Différences v1 → v2** : refonte totale. Les règles v1 étaient génériques. Cette v2 est ancrée sur des references vérifiables et des frameworks éprouvés par data (reply rates réels).

**Références principales :**
- **Josh Braun** — Poke the Bear, permission-based, anti-pitch
- **Jason Bay** (Outbound Squad) — CLAP framework, problem-first
- **Kyle Coleman** — buyer-centric writing
- **Alex Hormozi** ($100M Leads) — value equation, offer framing
- **Morgan Ingram** — 3x3 research, cadence
- **Corey Kossack** (reply-rate data) — question-based endings
- **Chris Orlob** (Gong) — data-driven outbound patterns
- **Becc Holland** (Flip the Script) — personalization that works
- **Chris Voss** (Never Split the Difference) — accusation audit, calibrated questions

**Instructions :** coche `[x]` ce que tu gardes. 🔒 absolu / 🔓 surchargeable par persona.

---

## α. Opener / Hook DM

- [ ] **α1** 🔒 Pas de "Bonjour/Hi/Hello" seul sur la 1ère ligne
  - *Détection :* `/^(bonjour|bonsoir|salut|hello|hi|hey|coucou)[\s,.!]*\n/i`
  - *Réf :* **Josh Braun** — "starting with a greeting wastes the notification preview"
  - *Why :* tu brûles le seul espace où le prospect décide d'ouvrir

- [ ] **α2** 🔒 Pas de "How are you?" / "J'espère que vous allez bien"
  - *Détection :* regex FR/EN variantes
  - *Réf :* **Braun** + **Coleman** — "weakest opener in the dataset, ~3% reply rate vs 18% for problem-openers"
  - *Why :* fake rapport, marqueur mass outreach

- [ ] **α3** 🔒 Pas de "Je me permets" / "I'm reaching out to"
  - *Détection :* regex
  - *Réf :* **Bay** — "permission-asking weakens your stance"
  - *Why :* posture basse = signal "vendeur banal"

- [ ] **α4** 🔓 Opener = **Trigger Event** OU **Point douleur** OU **Pattern interrupt**
  - *Détection :* présence d'un des 3 patterns :
    - Trigger : mention d'événement récent (levée, embauche, poste récent, post LinkedIn cité, job change)
    - Douleur : question directe sur un problème métier ("Tes SDRs perdent combien d'heures sur X ?")
    - Pattern interrupt : format inattendu (humour, one-liner, format chiffre), voir **α5**
  - *Réf :* **Morgan Ingram** (3x3 : 3 min de recherche, 3 points ultra-spécifiques) / **Braun** "Poke the Bear" / **Orlob** — "triggers 2-4x reply rate"
  - *Why :* c'est le seul signal qui prouve que tu n'envoies pas le même message à 500 personnes

- [ ] **α5** 🔓 Permission-based opener accepté : "Would it be crazy to..." / "Pas sûr que ce soit pertinent..."
  - *Détection :* présence de patterns Braun (`pas sûr que|would it be crazy|open to|tell me if I'm off base`)
  - *Réf :* **Josh Braun** — signature move, inverse la dynamique pression
  - *Why :* baisse la pression commerciale → paradoxalement augmente les réponses

## β. Personnalisation (signal de non-spam)

- [ ] **β1** 🔒 Au moins UN signal de recherche dans les 30 premiers mots : mention entreprise ET (poste OU post récent OU client type OU localisation)
  - *Détection :* présence de 2+ tokens issus du profil prospect
  - *Réf :* **Ingram 3x3** — data Lavender : reply rate x3 quand 2+ éléments personnalisés
  - *Why :* seule trace "ce message n'est pas générique"

- [ ] **β2** 🔒 Aucune variable template non-résolue (`{{firstname}}`, `[PRENOM]`, `XXX`)
  - *Détection :* regex
  - *Why :* hard-kill crédibilité

- [ ] **β3** 🔓 Pas de compliment générique ("super profil", "parcours inspirant", "j'admire ton travail")
  - *Détection :* liste regex
  - *Réf :* **Becc Holland** — "compliment flu : empty praise = empty reply"
  - *Why :* flatterie générique = signal "je n'ai rien à dire"

- [ ] **β4** 🔓 Si compliment il y a, il doit être **spécifique** (fait précis + inférence)
  - *Détection :* heuristique — compliment + chiffre/citation/référence = OK ; compliment + adjectif seul = flag
  - *Réf :* **Holland** — "earned specificity"

## γ. Problem Framing (le cœur du message US)

- [ ] **γ1** 🔓 Le problème nommé doit être **spécifique au segment prospect**, pas universel
  - *Détection :* heuristique — si le problème est extractible et pourrait s'appliquer à n'importe quel poste → flag
  - *Réf :* **Bay CLAP** (Context → Link → Anchor → Pull) / **Coleman** — "specific pain > general pain"
  - *Why :* "plus de leads" = mort, "vos SDRs qui passent 40% du temps à chercher des emails" = vivant

- [ ] **γ2** 🔓 Éviter la promesse de solution avant d'avoir posé le problème (rule : problem-first, jamais solution-first)
  - *Détection :* position relative — si une phrase "nous proposons/notre outil fait" apparaît avant une phrase problème
  - *Réf :* **Bay**, **Braun** — "lead with pain, never lead with product"
  - *Why :* prospect n'achète pas ton outil, il achète la résolution d'un pain

- [ ] **γ3** 🔓 "Accusation audit" autorisé : dire ce que le prospect pense déjà ("vous devez recevoir 50 messages comme celui-ci par jour")
  - *Détection :* pattern "je sais que / vous devez / probablement"
  - *Réf :* **Chris Voss** — accusation audit désarme la résistance
  - *Why :* dire la pensée du prospect avant lui = baisse immédiate de la garde

- [ ] **γ4** 🔒 Pas de "We help X do Y" mal ficelé sans chiffre/preuve
  - *Détection :* pattern `(nous|we) (aidons|help)` sans chiffre ni nom de client dans la phrase suivante
  - *Réf :* **Hormozi $100M Leads** — "claims without proof repel"
  - *Why :* affirmation sans preuve = anti-crédibilité

## δ. Offer / Valeur

- [ ] **δ1** 🔓 Présence d'au moins UN élément de **spécificité** : chiffre, nom de client, durée, ROI concret
  - *Détection :* compteur token-spécificité
  - *Réf :* **Ogilvy** / **Hormozi Value Equation** (Dream Outcome × Perceived Likelihood / Time × Effort)
  - *Why :* spécifique = crédible, vague = ignoré

- [ ] **δ2** 🔒 Pas de sur-promesse ("x10 votre CA", "doublez en 30 jours", "ROI garanti")
  - *Détection :* regex multiples + pattern chiffre+durée
  - *Réf :* **Orlob (Gong data)** — sur-promesse = -40% reply rate
  - *Why :* bullshit detector instantané

- [ ] **δ3** 🔓 Preuve sociale si utilisée = 1 nom précis > "beaucoup de clients"
  - *Détection :* présence "plusieurs clients / nos clients / beaucoup d'entreprises" sans nom propre
  - *Réf :* **Hormozi** — "vague social proof = no social proof"

- [ ] **δ4** 🔓 Risk reversal si mentionné = concret (garantie spécifique, essai sans CB, money-back)
  - *Détection :* présence "garantie|guarantee|sans engagement" sans détail
  - *Réf :* **Hormozi** — "a guarantee without terms is noise"

## ε. CTA / Close

- [ ] **ε1** 🔒 Un seul CTA par message
  - *Détection :* compteur CTA (question ouverte + lien créneau = 2 = violation)
  - *Réf :* règle copywriting universelle / **Bay**
  - *Why :* 2 CTA = 0 décision

- [ ] **ε2** 🔓 Soft CTA > Hard CTA en 1er message
  - *Détection :* si 1er message contient `calendly|booking|lien|réservez` → soft CTA préférable
  - *Réf :* **Braun** — "never ask for the meeting on the first message" / **Bay**
  - *Why :* hard CTA au 1er message = 5-8% reply. Soft CTA (question) = 15-25%.

- [ ] **ε3** 🔓 CTA sous forme de **question ouverte** centrée prospect
  - *Détection :* dernière phrase = question et pronom sujet = tu/vous (pas "je")
  - *Réf :* **Kossack data** — questions ouvertes centrées prospect = +2x reply
  - *Why :* question ouverte = invitation à réfléchir, pas à répondre oui/non

- [ ] **ε4** 🔒 Pas de question fermée rhétorique ("Ça vous intéresse ?", "Seriez-vous ouvert ?")
  - *Détection :* regex
  - *Réf :* **Coleman** — "yes/no questions invite no"
  - *Why :* formulation qui invite le "non", contre-productive

- [ ] **ε5** 🔓 Pas de lien externe dans le 1er DM
  - *Détection :* regex URL + `context=first_contact`
  - *Réf :* **Braun** / data LinkedIn — lien en 1er message = DM dépriorisé par l'algo + signal commercial
  - *Why :* lien = "je veux te pousser quelque part", avant même que la conversation existe

## ζ. Length / Form

- [ ] **ζ1** 🔒 1er DM ≤ 75 mots
  - *Détection :* `wordCount > 75 && context=first_contact`
  - *Réf :* **Gong data** (Orlob) — sweet spot 50-75 mots, drop de reply après
  - *Why :* au-delà = pitch, le prospect scroll

- [ ] **ζ2** 🔓 Follow-ups ≤ 50 mots
  - *Détection :* `wordCount > 50 && context=follow_up`
  - *Réf :* **Bay** — "shorter gets more replies on follow-ups"

- [ ] **ζ3** 🔓 Max 3 paragraphes visuels
  - *Détection :* `split(\n\n).length > 3`
  - *Réf :* **Coleman** — "mobile-first structure"

- [ ] **ζ4** 🔒 Jamais de bullet points / markdown
  - *Détection :* regex
  - *Why :* tu parles dans une DM, pas un deck

## η. Voice / Tone (craft)

- [ ] **η1** 🔓 Ratio "tu/vous" > "je/nous" × 1.5
  - *Détection :* compteur pronoms
  - *Réf :* **Gary Halbert** — "count your you's" / **Coleman**
  - *Why :* copywriting 101

- [ ] **η2** 🔒 Aucun jargon corporate (`synergie|alignement|disruption|scaler|valeur ajoutée|écosystème|opportunité unique`)
  - *Détection :* liste
  - *Réf :* **Braun** / **Holland**
  - *Why :* marker "consultant 2008" / sales bot

- [ ] **η3** 🔓 Conditionnel de politesse max 1 occurrence
  - *Détection :* `(voudrais|souhaiterais|aimerais|pourrais)` count > 1
  - *Réf :* copywriting direct FR
  - *Why :* empilement de conditionnels = faiblesse de posture

- [ ] **η4** 🔓 Pas de "Bien à vous" / "Cordialement" / "Cdt" en DM
  - *Détection :* regex signatures email
  - *Réf :* **Coleman** — "channel mismatch kills intimacy"
  - *Why :* DM ≠ email, formalité = distance

- [ ] **η5** 🔓 Tu peux être drôle / tranchant (recommandé), mais jamais sarcastique méprisant
  - *Détection :* heuristique difficile — flag si mots tranchants + prénom prospect (risque personal attack)
  - *Réf :* **Will Aitken** — "humor > professionalism, but never at prospect's expense"

## θ. Follow-up / Cadence

- [ ] **θ1** 🔒 Jamais 2 follow-ups consécutifs sans réponse prospect entre les deux
  - *Détection :* analyse conversation — dernier N msgs tous côté clone
  - *Réf :* **Ingram** — "2 unanswered + 1 more = block"

- [ ] **θ2** 🔓 Follow-up doit apporter **une nouvelle info** ou **un nouvel angle**, jamais "je me permets de relancer"
  - *Détection :* similarité sémantique follow-up vs message précédent (>0.85 embed cosine = flag)
  - *Réf :* **Bay** — "every follow-up is a fresh value add"
  - *Why :* relance identique = harcèlement

- [ ] **θ3** 🔒 Pas de culpabilisation ("pas eu de retour", "vous avez oublié", "je n'ai rien reçu de vous")
  - *Détection :* regex
  - *Réf :* **Holland** — "guilt-based follow-ups kill trust forever"

- [ ] **θ4** 🔓 "Break-up message" autorisé (et recommandé) après N follow-ups sans réponse
  - *Détection :* si context = follow-up N+, présence de patterns type "je ne veux pas encombrer, je laisse ça là / I'll assume this isn't a priority"
  - *Réf :* **Braun** + **Bay** — break-up message = 20-30% reply rate surprise

## ι. Algo / Plateforme LinkedIn

- [ ] **ι1** 🔒 Connection request ≤ 280 caractères (marge sur 300)
  - *Détection :* `charCount > 280 && context=connection_request`
  - *Why :* limite dure LinkedIn, message tronqué = flop

- [ ] **ι2** 🔓 Emoji : 0 en B2B senior (CEO/Dir), max 1 ailleurs
  - *Détection :* compteur emoji + lecture `persona.tone` ou `prospect.seniority`
  - *Réf :* data mixte, consensus : emoji = signal informalité, pas toujours le bienvenu

- [ ] **ι3** 🔓 Pas de hashtag en DM
  - *Détection :* regex `#\w+`
  - *Réf :* **Coleman** — "hashtag in DM signals automation"

- [ ] **ι4** 🔓 Pas de PS dans un DM court (< 100 mots)
  - *Détection :* `/P\.?S\./i` + wordCount
  - *Réf :* **Braun** — "PS makes sense in email, feels forced in DM"

---

## Règles que TU veux ajouter (expertise terrain)

- [ ] **Z1** ...
- [ ] **Z2** ...
- [ ] **Z3** ...

---

## Frameworks de référence utilisés

| Framework | Auteur | Règles alimentées |
|-----------|--------|-------------------|
| Permission-based opener | Josh Braun | α5 |
| Poke the Bear | Josh Braun | α4, γ2 |
| CLAP (Context-Link-Anchor-Pull) | Jason Bay | γ1, γ2, ε3 |
| 3x3 Research Rule | Morgan Ingram | α4, β1 |
| Value Equation | Alex Hormozi ($100M Leads) | δ1, δ2, δ3, δ4 |
| Accusation Audit | Chris Voss | γ3 |
| Calibrated Questions | Chris Voss | ε3 |
| Flip the Script Personalization | Becc Holland | β3, β4, θ3 |
| Gong Reply Data | Chris Orlob | δ2, ζ1 |
| Buyer-Centric Writing | Kyle Coleman | β1, γ1, η4 |
| Count-your-you's | Gary Halbert | η1 |

## Différences clés v1 → v2

1. Ajout catégories **α/β/γ/δ** structurantes (opener / personnalisation / problem / offer)
2. Chaque règle a une **réf vérifiable** (plus d'intuition seule)
3. Focus data : **reply rate** est le KPI cité, pas l'intuition stylistique
4. Séparation **first contact vs follow-up** (cadence)
5. Break-up message explicité comme pattern positif (v1 n'en parlait pas)
6. **Permission-based openers** autorisés (Braun) — contre-intuitif mais data-backed

**Temps de relecture estimé : 45 min.**
