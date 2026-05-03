# Contradictions à arbitrer — Nicolas Lavallée (2026-05-03)

**19 contradictions détectées** parmi les 247 propositions pending.

Pour chaque paire : choisis "garder A", "garder B", "garder les 2 (faux positif)" ou "autre". Tu peux annoter directement ce fichier.

---

## hard_rules (6)

### hard_rules #1 — cosine 0.847

**A** [`f8a47083-30ba-4c46-b551-e2fc4a4a5abb`] (intent: `add_rule`, count=1)

> Jamais plus de 8 lignes au total dans un message.

**B** [`6e2cc728-05f7-45b7-a784-0605605e054b`] (intent: `add_rule`, count=1)

> Règle MAX-6-LIGNES : ne jamais écrire plus de 6 lignes par message.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### hard_rules #2 — cosine 0.830

**A** [`6e2cc728-05f7-45b7-a784-0605605e054b`] (intent: `add_rule`, count=1)

> Règle MAX-6-LIGNES : ne jamais écrire plus de 6 lignes par message.

**B** [`57be27f8-dfcb-4a10-ab4f-d7a90d199e19`] (intent: `add_rule`, count=3)

> Jamais plus de 8 lignes au total par message.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### hard_rules #3 — cosine 0.819

**A** [`6b1aaa17-2643-43f1-b9f8-c4c678e53cdd`] (intent: `add_rule`, count=1)

> Jamais mentionner l'offre, le prix ou le mot 'accompagnement' dans un message.

**B** [`f655ede0-73a0-478e-8a36-207b3ff400f7`] (intent: `add_rule`, count=1)

> Ne jamais mentionner l'offre, le prix ou le mot 'accompagnement' dans aucun message avant que le prospect ait exprimé une douleur.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### hard_rules #4 — cosine 0.764

**A** [`b8b8dc59-de28-4228-aae5-12f31dd1937d`] (intent: `add_rule`, count=1)

> Le premier message ne dépasse jamais 8 lignes au total.

**B** [`6e2cc728-05f7-45b7-a784-0605605e054b`] (intent: `add_rule`, count=1)

> Règle MAX-6-LIGNES : ne jamais écrire plus de 6 lignes par message.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### hard_rules #5 — cosine 0.755

**A** [`dbb496a7-b42b-4d5c-af49-d8666428fa88`] (intent: `add_rule`, count=2)

> Jamais plus de 3 touches (messages) sur une même personne dans un cycle de prospection DR.

**B** [`8b0929aa-4180-4c0a-9c93-5918567077a9`] (intent: `add_rule`, count=1)

> Règle : un seul message envoyé, puis attendre une réponse. Ne jamais envoyer 2 messages consécutifs sans réponse intermédiaire du prospect.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### hard_rules #6 — cosine 0.746

**A** [`0e543def-7251-44c5-a8d5-181e0e5c5cba`] (intent: `add_rule`, count=1)

> Toujours envoyer le brief pré-call à Nicolas avant chaque call qualifié, en incluant impérativement la douleur exprimée en mots exacts (verbatim prospect entre guillemets).

**B** [`82f5888c-2103-4445-89a7-4747c2323c5b`] (intent: `add_rule`, count=1)

> Lors de la proposition de call, reformuler la douleur du prospect avec SES propres mots — jamais avec notre vocabulaire ou nos formulations.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

---

## process (9)

### process #1 — cosine 0.844

**A** [`50c7fb08-77e0-43a9-9188-3c9cd2807e68`] (intent: `add_paragraph`, count=1)

> Étape M1 — Icebreaker DR reçue : prérequis = DR acceptée. Action = envoyer le message automatique icebreaker (curiosité, sans pitch). Output = réponse prospect ou absence. Transition : si réponse → M2 ; si silence → Relance 1 à J+2.

**B** [`8175645b-0341-4c26-a54f-174b7caafe4a`] (intent: `add_paragraph`, count=1)

> Étape 1 — Icebreaker (M1) : prérequis = DR acceptée + persona buyer confirmé + SWOT/TOWS généré. Action = envoyer message court ancré sur le profil avec curiosité inversée. Output = réponse prospect ou silence. Transition : lire le niveau de signal → étape 2.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### process #2 — cosine 0.826

**A** [`55eeb373-1f4d-48e8-b736-7d96414431eb`] (intent: `add_paragraph`, count=1)

> Étape Analyse (pré-rédaction) : prérequis = interaction contenu détectée. Action = qualifier le persona et analyser le profil LinkedIn via Claude AVANT toute rédaction. Output = fiche prospect (pattern dominant + enjeux). Aucun message envoyé à cette étape. Transition vers M1 si prospect qualifié, vers sortie propre si hors cible.

**B** [`479d0123-9aab-42c0-a3e9-c8cbdbc56651`] (intent: `add_paragraph`, count=1)

> Sous-étape Analyse 2.2 — Analyse profil LinkedIn via Claude : prérequis = prospect IN-CIBLE. Action = exécuter Prompt 1 (analyse profil) via extension Chrome Claude sur URL LinkedIn prospect. Output = fiche prospect 10-15 lignes : identité, phase business, pattern dominant, enjeux probables. Transition vers Prompt 2 une fois fiche générée ET réponse prospect reçue.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### process #3 — cosine 0.805

**A** [`da07f05e-a085-4e6b-b456-91430eaf5ec6`] (intent: `add_paragraph`, count=1)

> Étape 5a — Relance unique (silence) : prérequis = absence de réponse après 5 à 7 jours. Action = envoyer une relance unique basée sur une nouvelle observation (jamais un rappel du message précédent). Output = réponse ou silence définitif. Transition : silence → sortie propre.

**B** [`96a8caf3-f662-4a84-9ca6-841965298d0e`] (intent: `add_paragraph`, count=1)

> Étape Relance 1 (J+2) : prérequis = Message 2 envoyé, pas de réponse à J+2. Action = envoyer nouvelle observation TOWS + question ouverte différente (multi-messages). Output = réponse ou silence. Transition : Relance 2 finale (J+4) → Sortie propre si toujours silence.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### process #4 — cosine 0.794

**A** [`4a0b9382-09ce-4489-ba45-1dff78a5fea1`] (intent: `add_paragraph`, count=1)

> Étape Relance 2 — finale (J+4) : prérequis = Relance 1 envoyée, pas de réponse. Action = exécuter le scénario Sortie propre (Toggle 5). Fin de séquence.

**B** [`a1c04cb6-c905-4770-81ca-249b0c594432`] (intent: `add_paragraph`, count=1)

> Étape 5b — Sortie propre : prérequis = persona hors-cible confirmé OU silence maintenu après relance unique. Action = clore la séquence proprement sans relance supplémentaire.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### process #5 — cosine 0.764

**A** [`956041f4-a819-4bb1-a5ad-135ecf1437a2`] (intent: `add_paragraph`, count=1)

> Étape DR-reçue (analyse & qualification) : prérequis = demande de connexion reçue. Action = AUCUN message envoyé. Qualifier le persona buyer + analyser le profil LinkedIn via Claude avant toute rédaction. Output = fiche prospect + décision in-cible / hors-cible. Transition vers M1 si in-cible, vers sortie propre si hors-cible.

**B** [`479d0123-9aab-42c0-a3e9-c8cbdbc56651`] (intent: `add_paragraph`, count=1)

> Sous-étape Analyse 2.2 — Analyse profil LinkedIn via Claude : prérequis = prospect IN-CIBLE. Action = exécuter Prompt 1 (analyse profil) via extension Chrome Claude sur URL LinkedIn prospect. Output = fiche prospect 10-15 lignes : identité, phase business, pattern dominant, enjeux probables. Transition vers Prompt 2 une fois fiche générée ET réponse prospect reçue.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### process #6 — cosine 0.744

**A** [`585093fb-a28f-470c-9de7-416a5fda410d`] (intent: `add_paragraph`, count=1)

> Étape 3 — Creusement (signal faible) : prérequis = signal faible détecté. Action = envoyer un message de creusement avec question miroir ancrée dans le levier WT du SWOT/TOWS. Output = réponse ou silence. Transition : si réponse → réévaluer signal ; si silence → relance J+5-7.

**B** [`c79cf0dd-31bf-4ca5-ae70-3e87123e2000`] (intent: `add_paragraph`, count=1)

> Étape M2 — Creusement : prérequis = DR acceptée. Action = envoyer Message 2 (multi-messages, ancré sur TOWS, question miroir WT). Output = réponse prospect ou silence. Transition : Relance 1 à J+2 si silence.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### process #7 — cosine 0.739

**A** [`956041f4-a819-4bb1-a5ad-135ecf1437a2`] (intent: `add_paragraph`, count=1)

> Étape DR-reçue (analyse & qualification) : prérequis = demande de connexion reçue. Action = AUCUN message envoyé. Qualifier le persona buyer + analyser le profil LinkedIn via Claude avant toute rédaction. Output = fiche prospect + décision in-cible / hors-cible. Transition vers M1 si in-cible, vers sortie propre si hors-cible.

**B** [`a45cc37f-35a1-4f98-9b19-f997821be428`] (intent: `add_paragraph`, count=1)

> Sous-étape Analyse 2.1 — Qualification persona : classer le prospect en IN-CIBLE / HORS-CIBLE / DOUTE. Si HORS-CIBLE → déclencher sortie propre. Si DOUTE → envoyer question de qualification. Si IN-CIBLE → passer à l'analyse profil Claude (2.2).

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### process #8 — cosine 0.734

**A** [`fb5f3833-6c50-43c0-9ac7-5469b6a58699`] (intent: `add_paragraph`, count=1)

> Étape Relance 1 (J+2) : prérequis = aucune réponse à M1. Action = envoyer une observation précise sur le business/secteur du prospect (1-2 phrases issues du TOWS) + question courte et ouverte différente de l'icebreaker. Output = réponse ou silence. Transition : si silence → Relance 2 à J+4.

**B** [`c79cf0dd-31bf-4ca5-ae70-3e87123e2000`] (intent: `add_paragraph`, count=1)

> Étape M2 — Creusement : prérequis = DR acceptée. Action = envoyer Message 2 (multi-messages, ancré sur TOWS, question miroir WT). Output = réponse prospect ou silence. Transition : Relance 1 à J+2 si silence.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### process #9 — cosine 0.733

**A** [`55eeb373-1f4d-48e8-b736-7d96414431eb`] (intent: `add_paragraph`, count=1)

> Étape Analyse (pré-rédaction) : prérequis = interaction contenu détectée. Action = qualifier le persona et analyser le profil LinkedIn via Claude AVANT toute rédaction. Output = fiche prospect (pattern dominant + enjeux). Aucun message envoyé à cette étape. Transition vers M1 si prospect qualifié, vers sortie propre si hors cible.

**B** [`f7ea33a4-fc6f-4518-af39-c4cf3908ee76`] (intent: `add_paragraph`, count=1)

> Sous-étape Analyse 2.3 — SWOT/TOWS + message recommandé (Prompt 2) : prérequis = fiche prospect générée (Prompt 1) ET réponse prospect reçue. Action = exécuter le métaprompt Setting LinkedIn dans Claude. Output = SWOT/TOWS complet + message recommandé prêt à envoyer.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

---

## icp_patterns (4)

### icp_patterns #1 — cosine 0.835

**A** [`32731566-7362-48ca-9293-131d233c6808`] (intent: `add_paragraph`, count=1)

> P1 Infopreneur focus principal / segment : infopreneurs ≥5 collaborateurs, CA 500k€–20M€ / signaux : titre Founder/CEO + headcount LinkedIn ≥5 + activité formation/contenu/info-produit / question : comment tu structures ta croissance entre production de contenu et développement commercial ?

**B** [`7adf13b9-d625-41b6-aa63-8bc4dd36c2d4`] (intent: `add_paragraph`, count=1)

> P1 Founder / CEO / Dirigeant — secteur Infopreneurs & formation en ligne. Signaux : titre Founder, CEO, Co-fondateur + audience personnelle visible + programme ou école en ligne mentionné. Headcount LinkedIn 5–30. CA estimé 500 k–5 M€. Question-clé : comment tu gères la livraison et la délégation depuis que ta clientèle a décollé ?

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### icp_patterns #2 — cosine 0.753

**A** [`3402e394-6e58-4fa6-86bf-3c0c75c2407a`] (intent: `add_paragraph`, count=1)

> Segment P1 — CEO/Founder francophone plafonné entre 500k€ et 20M€ de CA. Signaux : titre CEO ou Founder, structure existante (≥ 1 salarié), marché francophone. Différenciateurs vs coachs dev-perso, programmes low-cost (LiveMentor) et consultants juniors ex-McKinsey/BCG. Question-clé : qu'est-ce qui t'a bloqué entre ton palier actuel et le suivant ?

**B** [`7adf13b9-d625-41b6-aa63-8bc4dd36c2d4`] (intent: `add_paragraph`, count=1)

> P1 Founder / CEO / Dirigeant — secteur Infopreneurs & formation en ligne. Signaux : titre Founder, CEO, Co-fondateur + audience personnelle visible + programme ou école en ligne mentionné. Headcount LinkedIn 5–30. CA estimé 500 k–5 M€. Question-clé : comment tu gères la livraison et la délégation depuis que ta clientèle a décollé ?

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### icp_patterns #3 — cosine 0.742

**A** [`ec95ef29-9f31-4c70-89d6-1ea0b00e777a`] (intent: `add_paragraph`, count=1)

> Segment P2 — Infopreneur / CEO de business en ligne (coaching, formation). Signaux : audience LinkedIn existante, contenu publié, CA entre 500k€ et 5M€, structure légère (coachs, équipe réduite). Référence sociale mobilisable : Ludik Factory / Poker Academy. Question-clé : comment tu structures ta croissance au-delà de ta communauté actuelle ?

**B** [`32731566-7362-48ca-9293-131d233c6808`] (intent: `add_paragraph`, count=1)

> P1 Infopreneur focus principal / segment : infopreneurs ≥5 collaborateurs, CA 500k€–20M€ / signaux : titre Founder/CEO + headcount LinkedIn ≥5 + activité formation/contenu/info-produit / question : comment tu structures ta croissance entre production de contenu et développement commercial ?

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### icp_patterns #4 — cosine 0.739

**A** [`0feac9ae-e65a-4c39-87cb-3066c541affc`] (intent: `add_paragraph`, count=1)

> P — Infopreneur / signaux : activité de formation, coaching, contenu digital, audience LinkedIn significative, modèle économique B2C ou B2B récurrent / question-clé : 'tu en es où concrètement aujourd'hui, premiers clients ou encore en structuration de l'offre ?'

**B** [`32731566-7362-48ca-9293-131d233c6808`] (intent: `add_paragraph`, count=1)

> P1 Infopreneur focus principal / segment : infopreneurs ≥5 collaborateurs, CA 500k€–20M€ / signaux : titre Founder/CEO + headcount LinkedIn ≥5 + activité formation/contenu/info-produit / question : comment tu structures ta croissance entre production de contenu et développement commercial ?

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________
