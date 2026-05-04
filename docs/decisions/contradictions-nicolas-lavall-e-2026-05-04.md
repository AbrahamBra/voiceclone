# Contradictions à arbitrer — Nicolas Lavallée (2026-05-04)

**34 contradictions détectées** parmi les 379 propositions pending.

Pour chaque paire : choisis "garder A", "garder B", "garder les 2 (faux positif)" ou "autre". Tu peux annoter directement ce fichier.

---

## process (15)

### process #1 — cosine 0.846

**A** [`738d257e-3c84-4237-a114-729d54fe0045`] (intent: `add_paragraph`, count=1)

> Relance 1 (J+3 après M3 sans réponse) : action = envoyer message de relance créneau avec lien cal.com. Output = confirmation ou silence. Transition vers Relance 2 / Sortie propre à J+7 si pas de réponse.

**B** [`23284de0-f4a0-4eaf-8773-1548fa18cc00`] (intent: `add_paragraph`, count=2)

> Relance 1 (J+2 après M3) : prérequis = pas de réponse au message de proposition de call. Action = envoyer le skeleton Relance 1 (créneaux disponibles + lien CAL.COM). Output = confirmation du call ou silence. Transition vers Relance 2 finale (J+4).

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### process #2 — cosine 0.844

**A** [`8175645b-0341-4c26-a54f-174b7caafe4a`] (intent: `add_paragraph`, count=1)

> Étape 1 — Icebreaker (M1) : prérequis = DR acceptée + persona buyer confirmé + SWOT/TOWS généré. Action = envoyer message court ancré sur le profil avec curiosité inversée. Output = réponse prospect ou silence. Transition : lire le niveau de signal → étape 2.

**B** [`50c7fb08-77e0-43a9-9188-3c9cd2807e68`] (intent: `add_paragraph`, count=1)

> Étape M1 — Icebreaker DR reçue : prérequis = DR acceptée. Action = envoyer le message automatique icebreaker (curiosité, sans pitch). Output = réponse prospect ou absence. Transition : si réponse → M2 ; si silence → Relance 1 à J+2.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### process #3 — cosine 0.819

**A** [`0f649afb-e3fb-4e77-a40f-f7dd71b7ed40`] (intent: `add_paragraph`, count=1)

> Étape Relance 1 (J+3) : prérequis = absence de réponse au Message 2. Action = nouvelle observation business/secteur tirée du TOWS + nouvelle question ouverte différente. Ne pas reformuler M2. Transition : Relance 2 (sortie propre) si silence J+7.

**B** [`fb5f3833-6c50-43c0-9ac7-5469b6a58699`] (intent: `add_paragraph`, count=5)

> Étape Relance 1 (J+2) : prérequis = aucune réponse à M1. Action = envoyer une observation précise sur le business/secteur du prospect (1-2 phrases issues du TOWS) + question courte et ouverte différente de l'icebreaker. Output = réponse ou silence. Transition : si silence → Relance 2 à J+4.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### process #4 — cosine 0.801

**A** [`5d47ff63-0dd0-4e43-9938-7596b310b092`] (intent: `add_paragraph`, count=1)

> Relance R1 call (J+3 après M3) : si le prospect n'a pas répondu à la proposition de call, envoyer une relance légère avec créneaux disponibles + lien Cal.com. Transition vers sortie propre si silence persistant jusqu'à J+7.

**B** [`23284de0-f4a0-4eaf-8773-1548fa18cc00`] (intent: `add_paragraph`, count=2)

> Relance 1 (J+2 après M3) : prérequis = pas de réponse au message de proposition de call. Action = envoyer le skeleton Relance 1 (créneaux disponibles + lien CAL.COM). Output = confirmation du call ou silence. Transition vers Relance 2 finale (J+4).

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### process #5 — cosine 0.800

**A** [`ded461d9-ce35-4fdf-8323-387e67d7b24f`] (intent: `add_paragraph`, count=2)

> Relance 2 finale (J+7) : prérequis = absence de réponse à la Relance 1. Action = déclencher la sortie propre (cf. template Sortie propre). Output = fin de séquence. Transition = clôture du prospect.

**B** [`411f05ea-2c0b-4bd2-bf28-e2596938f98e`] (intent: `add_paragraph`, count=2)

> Étape Relance 2 / Sortie propre (J+4) : prérequis = silence après Relance 1. Action = envoyer message de sortie propre sans pression. Output = fin de séquence. Transition : aucune — prospect archivé, aucune relance supplémentaire autorisée.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### process #6 — cosine 0.772

**A** [`f06eab1a-489f-441f-a2b9-adbb953dc56a`] (intent: `add_paragraph`, count=1)

> Étape Sortie Propre : prérequis = l'un des 4 cas (silence post-relance, hors persona, early stage confirmé, mauvais timing). Action = envoyer le message fixe de sortie. Output = clôture de la séquence. Transition = aucune relance ultérieure ; prospect conservé en réseau LinkedIn pour réactivation possible à J+180.

**B** [`411f05ea-2c0b-4bd2-bf28-e2596938f98e`] (intent: `add_paragraph`, count=2)

> Étape Relance 2 / Sortie propre (J+4) : prérequis = silence après Relance 1. Action = envoyer message de sortie propre sans pression. Output = fin de séquence. Transition : aucune — prospect archivé, aucune relance supplémentaire autorisée.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### process #7 — cosine 0.764

**A** [`ece4c65e-b196-4884-8cb6-cfeafaeb1884`] (intent: `add_paragraph`, count=1)

> Relance 1 M1 (J+3, automatique) : prérequis = absence de réponse au M1. Action = envoyer un soft bump sans reformuler la demande. Output = réponse ou silence. Transition : si silence J+7 → Relance 2 / Sortie propre.

**B** [`da07f05e-a085-4e6b-b456-91430eaf5ec6`] (intent: `add_paragraph`, count=1)

> Étape 5a — Relance unique (silence) : prérequis = absence de réponse après 5 à 7 jours. Action = envoyer une relance unique basée sur une nouvelle observation (jamais un rappel du message précédent). Output = réponse ou silence définitif. Transition : silence → sortie propre.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### process #8 — cosine 0.759

**A** [`01327959-abbe-432a-84da-6e486c0199ef`] (intent: `add_paragraph`, count=1)

> Relance R2 call (J+7 après M3) → Sortie propre. Si aucune réponse après R1 (J+3), déclencher la séquence de sortie propre à J+7. Fin de la séquence call pour ce prospect.

**B** [`5d47ff63-0dd0-4e43-9938-7596b310b092`] (intent: `add_paragraph`, count=1)

> Relance R1 call (J+3 après M3) : si le prospect n'a pas répondu à la proposition de call, envoyer une relance légère avec créneaux disponibles + lien Cal.com. Transition vers sortie propre si silence persistant jusqu'à J+7.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### process #9 — cosine 0.752

**A** [`ce03b6ab-364e-4d12-80b0-041f76202c45`] (intent: `add_paragraph`, count=1)

> Étape 5b — Sortie propre : prérequis = relance sans réponse OU persona hors-cible identifié à n'importe quelle étape. Action = sortie propre immédiate, aucun message supplémentaire.

**B** [`010218bb-25c5-48ab-a8fe-848ad397d227`] (intent: `add_paragraph`, count=2)

> Étape Sortie propre : déclenchée après silence post-relance unique (toggle 1, 3 ou 4), hors persona buyer (qualification 2.1), early stage confirmé, ou mauvais timing manifeste. Action = envoyer le message de sortie propre fixe (sans personnalisation). Output = clôture de la séquence. Pas de transition ultérieure prévue.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### process #10 — cosine 0.752

**A** [`f06eab1a-489f-441f-a2b9-adbb953dc56a`] (intent: `add_paragraph`, count=1)

> Étape Sortie Propre : prérequis = l'un des 4 cas (silence post-relance, hors persona, early stage confirmé, mauvais timing). Action = envoyer le message fixe de sortie. Output = clôture de la séquence. Transition = aucune relance ultérieure ; prospect conservé en réseau LinkedIn pour réactivation possible à J+180.

**B** [`010fa711-66d4-4517-8b03-6c17fb5069c3`] (intent: `add_paragraph`, count=1)

> Étape Exit (sortie propre) — Déclencheurs : (1) silence après relance unique (toggles 1, 3 ou 4) ; (2) hors persona buyer (qualification 2.1) ; (3) early stage confirmé ; (4) mauvais timing manifeste. Action : envoyer le message de sortie fixe. Exception : DR non acceptée après 14j → archiver sans message.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### process #11 — cosine 0.750

**A** [`26eab836-549e-469a-abb5-e2f74b3806a3`] (intent: `add_paragraph`, count=1)

> Étape M1 [influenceur] : prérequis = connexion fraîchement acceptée + aucun historique de conversation. Action = rédiger message manuel structuré (remarque + transition optionnelle + question). Output = réponse ou déclenchement relance J+2.

**B** [`50c7fb08-77e0-43a9-9188-3c9cd2807e68`] (intent: `add_paragraph`, count=1)

> Étape M1 — Icebreaker DR reçue : prérequis = DR acceptée. Action = envoyer le message automatique icebreaker (curiosité, sans pitch). Output = réponse prospect ou absence. Transition : si réponse → M2 ; si silence → Relance 1 à J+2.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### process #12 — cosine 0.749

**A** [`01327959-abbe-432a-84da-6e486c0199ef`] (intent: `add_paragraph`, count=1)

> Relance R2 call (J+7 après M3) → Sortie propre. Si aucune réponse après R1 (J+3), déclencher la séquence de sortie propre à J+7. Fin de la séquence call pour ce prospect.

**B** [`c4eaceb3-3b7e-47ad-9c9d-4c8a958d649a`] (intent: `add_paragraph`, count=3)

> Relance 2 finale (J+4 après M3) : prérequis = pas de réponse à Relance 1. Action = envoyer sortie propre (Toggle 5). Fin de séquence sur ce prospect.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### process #13 — cosine 0.748

**A** [`a2d4a898-a080-40a7-8ae7-7ef8f3a5a3ad`] (intent: `add_paragraph`, count=1)

> Scénario 'visite profil' : le prospect a visité le profil sans envoyer de demande. Étape 0 = envoyer une DR. Étape M1 (icebreaker) : prérequis = DR acceptée. Action = envoyer message automatique ancré sur la visite. Output = réponse ou relance J+2. Transition vers M2 si réponse, vers Relance 1 si silence.

**B** [`8175645b-0341-4c26-a54f-174b7caafe4a`] (intent: `add_paragraph`, count=1)

> Étape 1 — Icebreaker (M1) : prérequis = DR acceptée + persona buyer confirmé + SWOT/TOWS généré. Action = envoyer message court ancré sur le profil avec curiosité inversée. Output = réponse prospect ou silence. Transition : lire le niveau de signal → étape 2.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### process #14 — cosine 0.744

**A** [`c79cf0dd-31bf-4ca5-ae70-3e87123e2000`] (intent: `add_paragraph`, count=3)

> Étape M2 — Creusement : prérequis = DR acceptée. Action = envoyer Message 2 (multi-messages, ancré sur TOWS, question miroir WT). Output = réponse prospect ou silence. Transition : Relance 1 à J+2 si silence.

**B** [`585093fb-a28f-470c-9de7-416a5fda410d`] (intent: `add_paragraph`, count=1)

> Étape 3 — Creusement (signal faible) : prérequis = signal faible détecté. Action = envoyer un message de creusement avec question miroir ancrée dans le levier WT du SWOT/TOWS. Output = réponse ou silence. Transition : si réponse → réévaluer signal ; si silence → relance J+5-7.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### process #15 — cosine 0.733

**A** [`738d257e-3c84-4237-a114-729d54fe0045`] (intent: `add_paragraph`, count=1)

> Relance 1 (J+3 après M3 sans réponse) : action = envoyer message de relance créneau avec lien cal.com. Output = confirmation ou silence. Transition vers Relance 2 / Sortie propre à J+7 si pas de réponse.

**B** [`ece4c65e-b196-4884-8cb6-cfeafaeb1884`] (intent: `add_paragraph`, count=1)

> Relance 1 M1 (J+3, automatique) : prérequis = absence de réponse au M1. Action = envoyer un soft bump sans reformuler la demande. Output = réponse ou silence. Transition : si silence J+7 → Relance 2 / Sortie propre.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

---

## errors (1)

### errors #1 — cosine 0.816

**A** [`143c39a7-682b-4d9d-9fb3-2027634a2b36`] (intent: `add_paragraph`, count=1)

> Éviter toute personnalisation ou reformulation dans le message de sortie propre — préférer le template fixe tel quel : 'pas de souci {PRÉNOM}, je ne veux pas encombrer ta messagerie, si un jour le timing est bon, tu sais où me trouver / bonne continuation 🙂 / Nicolas'.

**B** [`5f808c5f-5361-46fa-ad2e-ce0487a42d29`] (intent: `add_paragraph`, count=1)

> Éviter de fusionner le message de sortie propre en un seul bloc de texte — préférer 4 bulles séparées ('pas de souci PRÉNOM…' / 'si un jour le timing…' / 'bonne continuation 🙂' / 'Nicolas') pour un rendu plus humain.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

---

## scoring (3)

### scoring #1 — cosine 0.809

**A** [`abbe74e8-f2e1-4bd3-b1fd-c728495feab5`] (intent: `add_paragraph`, count=1)

> Axe Signal prospect — 0 = silence après M1 ; 1 = réponse polie/surface sans engagement ; 2 = diagnostic accepté avec engagement partiel ; 3 = problème concret cité, porte ouverte sur enjeux ou retour engagé sur diagnostic. Règle de décision : score 3 → proposer le call ; score 1-2 → creusement ; score 0 après relance → sortie propre.

**B** [`5a277c8b-0b5f-41f9-8e12-bcd47768d8c7`] (intent: `add_paragraph`, count=2)

> Axe Signal — Niveau de réponse prospect : 0 = silence (pas de réponse après 5-7 jours), 1 = signal faible (réponse polie et surface : 'je développe mon réseau', 'votre post était inspirant'), 2 = signal fort (cite un problème concret, ouvre une porte sur ses enjeux). Règle : score 1 → étape creusement ; score 2 → proposition call ; score 0 → relance unique.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### scoring #2 — cosine 0.782

**A** [`abbe74e8-f2e1-4bd3-b1fd-c728495feab5`] (intent: `add_paragraph`, count=1)

> Axe Signal prospect — 0 = silence après M1 ; 1 = réponse polie/surface sans engagement ; 2 = diagnostic accepté avec engagement partiel ; 3 = problème concret cité, porte ouverte sur enjeux ou retour engagé sur diagnostic. Règle de décision : score 3 → proposer le call ; score 1-2 → creusement ; score 0 après relance → sortie propre.

**B** [`87973733-3697-4a0d-9594-9e32bcef3878`] (intent: `add_paragraph`, count=1)

> Règle de décision — Condition de proposition du call : si axe 1 ≥ 2 ET axe 2 ≥ 1 ET axe 3 = 0 → proposer le call de diagnostic. Si l'une de ces trois conditions n'est pas remplie → ne pas proposer le call, maintenir en conversation ou nurturing selon les scores.

Règle de décision — Gestion du signal de fermeture : si axe 3 ≥ 2 → sortir proprement du fil actif et basculer en nurturing passif (contenu sans relance commerciale à J+30/J+60, puis archivage si aucune réaction après 2 nurtures).

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### scoring #3 — cosine 0.766

**A** [`abbe74e8-f2e1-4bd3-b1fd-c728495feab5`] (intent: `add_paragraph`, count=1)

> Axe Signal prospect — 0 = silence après M1 ; 1 = réponse polie/surface sans engagement ; 2 = diagnostic accepté avec engagement partiel ; 3 = problème concret cité, porte ouverte sur enjeux ou retour engagé sur diagnostic. Règle de décision : score 3 → proposer le call ; score 1-2 → creusement ; score 0 après relance → sortie propre.

**B** [`c10e8da2-62bc-4421-81fa-1a73cfa0c0b7`] (intent: `add_paragraph`, count=1)

> Axe 'fermeture/ouverture' — 0: aucun signal lisible, 1: réponse neutre sans question ni clôture marquée, 2: double politesse + absence de question en retour + formule de clôture longue, 3: question en retour ET/OU partage d'un détail concret ET/OU demande d'informations supplémentaires. Règle de décision : Si axe 'fermeture' ≥ 2 → sortie propre, pas de relance, nurture passif dans 60-90 jours. Si axe 'fermeture' = 3 (signal ouverture fort) → répondre brièvement puis rebondir sur la situation, ne pas aller sur l'offre avant expression d'une douleur.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

---

## templates (2)

### templates #1 — cosine 0.809

**A** [`2a46bed6-229f-4f2f-b7d5-a962ea303f3f`] (intent: `add_paragraph`, count=1)

> Skeleton Relance 1 (J+3, si pas de réponse à M3) :
'{{Prénom}}, j'ai quelques créneaux qui se libèrent début de semaine prochaine'
'tu veux qu'on en profite pour le caler ?'
'{{LIEN CAL.COM}}'
⚠️ Envoyer en plusieurs messages séparés.

**B** [`0fab8dd4-ae00-45be-83a0-6df961b68b9a`] (intent: `add_paragraph`, count=3)

> Skeleton Relance 1 (J+2 après M3) :
'PRÉNOM, j'ai quelques créneaux qui se libèrent dans la semaine // semaine prochaine'
'tu veux qu'on en profite pour le caler ?'
'LIEN CAL.COM'

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### templates #2 — cosine 0.766

**A** [`1165d434-5569-49e1-8db0-4863f3fc181b`] (intent: `add_paragraph`, count=1)

> Skeleton Fallback M1 [influenceur] (profil creux) :
« Hello {PRÉNOM}, vu que tu pilotes {BOÎTE} / que tu bosses sur {SUJET}
{question A ou B la plus large du guide question}
Nicolas »

**B** [`be8cb5d5-cb7e-47f3-93ed-5ed3ef223726`] (intent: `add_paragraph`, count=1)

> Skeleton M1 [influenceur] :
« Helllo {PRÉNOM}, {REMARQUE — 1 phrase ≤ 120 chars, ancrée sur UN élément concret du profil}
{TRANSITION — 1 phrase pont, optionnelle}
{QUESTION OUVERTE — 1 seule question semi-fermée, douleur infopreneur}
Nicolas »

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

---

## hard_rules (9)

### hard_rules #1 — cosine 0.802

**A** [`de69185c-8c93-4d4f-8cad-c114be916498`] (intent: `add_rule`, count=1)

> Maximum 1 seule relance si silence — jamais 2. Ne jamais dépasser 3 touches au total sur une même personne.

**B** [`d9971437-6671-4202-87e1-891914dfca06`] (intent: `add_rule`, count=1)

> Jamais plus de 3 touches (messages) sur une même personne : M1 icebreaker + Relance 1 (J+2) + Relance 2 (J+4), puis silence définitif.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### hard_rules #2 — cosine 0.790

**A** [`62b4f73a-fcad-4d93-aed9-1e403729b8b0`] (intent: `add_rule`, count=1)

> RÈGLE ABSOLUE : la qualification du prospect (fiche prospect) doit être complétée AVANT l'envoi du M1 en contexte 1er degré. Aucun message ne doit être rédigé sans avoir qualifié le profil en amont sur la liste des 1ères relations.

**B** [`4b89fb57-9fb8-4973-ae18-c7945c4963df`] (intent: `add_rule`, count=2)

> Règle : En cas de doute sur la qualification du prospect (impossible à classer), envoyer une question de qualification avant tout autre message : 'tu en es où concrètement aujourd'hui, premiers clients ou encore en structuration de l'offre ?'

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### hard_rules #3 — cosine 0.785

**A** [`296e686c-c148-4612-ba92-e42d47b2186e`] (intent: `add_rule`, count=1)

> JAMAIS plus de 3 touches sur une même personne (hors demande de connexion). Aucun message supplémentaire après la Relance 2.

**B** [`de69185c-8c93-4d4f-8cad-c114be916498`] (intent: `add_rule`, count=1)

> Maximum 1 seule relance si silence — jamais 2. Ne jamais dépasser 3 touches au total sur une même personne.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### hard_rules #4 — cosine 0.783

**A** [`2ab74ff9-14db-4590-84c9-1ade5d759c5b`] (intent: `add_rule`, count=1)

> La Relance 2 (J+12 à J+14) renvoie systématiquement vers la Sortie propre (Toggle 5) — aucun autre message de relance ne suit.

**B** [`0f967612-2444-4b46-96d1-51fc8b03ba91`] (intent: `add_rule`, count=1)

> La Relance 2 finale est toujours la Sortie propre (J+4) — aucun autre message ne suit sans réponse du prospect.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### hard_rules #5 — cosine 0.775

**A** [`6e2cc728-05f7-45b7-a784-0605605e054b`] (intent: `add_rule`, count=1)

> Règle MAX-6-LIGNES : ne jamais écrire plus de 6 lignes par message.

**B** [`d827b484-52a2-47e8-98f9-36f7c248c8ad`] (intent: `add_rule`, count=0)

> Toujours envoyer les messages en plusieurs blocs séparés (multi-messages), jamais en un seul bloc de texte : l'approche multi-messages paraît plus humaine.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### hard_rules #6 — cosine 0.755

**A** [`dbb496a7-b42b-4d5c-af49-d8666428fa88`] (intent: `add_rule`, count=2)

> Jamais plus de 3 touches (messages) sur une même personne dans un cycle de prospection DR.

**B** [`8b0929aa-4180-4c0a-9c93-5918567077a9`] (intent: `add_rule`, count=1)

> Règle : un seul message envoyé, puis attendre une réponse. Ne jamais envoyer 2 messages consécutifs sans réponse intermédiaire du prospect.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### hard_rules #7 — cosine 0.749

**A** [`bdac7cef-ff55-4ce0-9fdc-b6edc6fb2278`] (intent: `add_rule`, count=1)

> 1 seule relance si silence — jamais 2 relances sur la même conversation.

**B** [`d9971437-6671-4202-87e1-891914dfca06`] (intent: `add_rule`, count=1)

> Jamais plus de 3 touches (messages) sur une même personne : M1 icebreaker + Relance 1 (J+2) + Relance 2 (J+4), puis silence définitif.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### hard_rules #8 — cosine 0.745

**A** [`aee75726-7bf5-48f0-a7c8-647fefb5b1bf`] (intent: `add_rule`, count=1)

> JAMAIS demander un call ou pitcher l'offre dans le M1 (message premier degré / approche réseau).

**B** [`9c722347-7697-4172-8ccd-30873577178f`] (intent: `add_rule`, count=3)

> Toujours proposer un call de 15 minutes — jamais 30 min ni 1h. C'est un échange entre pairs, pas une démo.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### hard_rules #9 — cosine 0.742

**A** [`bc399d78-7fc4-4450-b82c-9681edab8898`] (intent: `add_rule`, count=1)

> [Spyer] Jamais écrire 'j'ai vu que tu commentais / suivais / étais actif sur' — formulation qui signe le comportement voyeur et fait braquer le prospect.

**B** [`fbecd2ba-a84a-4765-b518-95b83c8b9524`] (intent: `add_rule`, count=1)

> Le M1 spyer doit être ancré sur un élément volontairement public du profil du prospect (boîte, rôle, produit, dernier post). Appliquer le test : 'aurais-je pu écrire ce message sans ouvrir son profil ?' — si oui, recommencer.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

---

## icp_patterns (4)

### icp_patterns #1 — cosine 0.758

**A** [`f3e06cb4-b199-4487-b7ef-c64c6bf98b7d`] (intent: `add_paragraph`, count=2)

> Hors-scope Ellipse — Profil attractif non-infopreneur : segment exclu du pipeline actif HOM × Ellipse / signaux : douleur présente mais activité ≠ infopreneuriat / traitement : approche pair à pair, pas de pitch, mise en veille / question-clé : aucune qualification commerciale — conversation neutre uniquement.

**B** [`4cc6dcb2-181e-4996-820e-f5c50b48b39a`] (intent: `add_paragraph`, count=1)

> Focus collaboration Ellipse — Segment prioritaire : Infopreneur. Dans ce contexte partenaire, concentrer l'effort d'outbound sur les profils Infopreneur, tout en restant ouvert aux autres secteurs si douleur réelle et maturité suffisante.

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### icp_patterns #2 — cosine 0.746

**A** [`c826d873-c016-48d6-98f9-20bf0c168a95`] (intent: `add_paragraph`, count=1)

> P-EARLY Early Stage (<12 mois, 0 revenu) — signaux : création de structure récente, mention 'en cours de lancement', absence de clients déclarés / question-clé : 'tu en es où concrètement, premiers clients ou encore en structuration ?' / sortie si confirmé : sortie propre bienveillante.

**B** [`ed5ae3ef-bf36-42c5-9237-2b98472ac8b9`] (intent: `add_paragraph`, count=1)

> P-IN — Infopreneur / Business existant avec revenus réels / signaux : infopreneuriat actif, plateau ou croissance chaotique ou changement d'échelle / sensible à : leadership, stratégie, structuration, organisation / question de qualification : « je suis curieux, tu en es où concrètement aujourd'hui, premiers clients ou encore en structuration de l'offre ? »

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### icp_patterns #3 — cosine 0.742

**A** [`32731566-7362-48ca-9293-131d233c6808`] (intent: `add_paragraph`, count=1)

> P1 Infopreneur focus principal / segment : infopreneurs ≥5 collaborateurs, CA 500k€–20M€ / signaux : titre Founder/CEO + headcount LinkedIn ≥5 + activité formation/contenu/info-produit / question : comment tu structures ta croissance entre production de contenu et développement commercial ?

**B** [`ec95ef29-9f31-4c70-89d6-1ea0b00e777a`] (intent: `add_paragraph`, count=2)

> Segment P2 — Infopreneur / CEO de business en ligne (coaching, formation). Signaux : audience LinkedIn existante, contenu publié, CA entre 500k€ et 5M€, structure légère (coachs, équipe réduite). Référence sociale mobilisable : Ludik Factory / Poker Academy. Question-clé : comment tu structures ta croissance au-delà de ta communauté actuelle ?

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________

### icp_patterns #4 — cosine 0.738

**A** [`e719edec-0559-46ce-872a-aff66f9f5bc6`] (intent: `add_paragraph`, count=1)

> Segment P-PremierDegré : Infopreneur avec activité existante qui marche, cherchant à structurer la suite / signaux : profil LinkedIn 'infopreneur', formation en ligne, communauté active, headcount solo ou micro / question-clé : qu'est-ce qui t'empêche d'aller plus loin aujourd'hui dans ton activité ?

**B** [`32731566-7362-48ca-9293-131d233c6808`] (intent: `add_paragraph`, count=1)

> P1 Infopreneur focus principal / segment : infopreneurs ≥5 collaborateurs, CA 500k€–20M€ / signaux : titre Founder/CEO + headcount LinkedIn ≥5 + activité formation/contenu/info-produit / question : comment tu structures ta croissance entre production de contenu et développement commercial ?

**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________
