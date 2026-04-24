"""
Fixtures for the simulation harness: synthetic but cohesive LinkedIn content.

The fictional persona is `sim_clone_alpha` — a French growth/B2B SaaS operator.
15 posts with a distinctive voice (punchy openers, short sentences, 1 metric per
post, occasional rhetorical question). This style is specific enough that we can
later verify the clone reproduces it and that the critic catches drifts.
"""

SIM_SLUG_PREFIX = "sim_"
SIM_PERSONA_NAME = "Sim Clone Alpha"
SIM_PERSONA_SLUG = "sim_clone_alpha"
SIM_CLIENT_NAME = "sim_client_harness"
SIM_CLIENT_ACCESS_CODE = "sim_harness_code"

# Voice rules — ce que le clone doit reproduire.
VOICE_RULES = {
    "signaturePhrases": [
        "spoiler :",
        "vraie question :",
        "j'ai testé",
    ],
    "forbiddenWords": [
        "synergies",
        "leverage",
        "disrupter",
        "impactant",
    ],
    "tone": "direct, opérationnel, zéro jargon corporate",
    "sentenceLength": "courtes, parfois 3-5 mots pour ponctuer",
}

# 15 posts LinkedIn cohérents, style "growth FR direct".
# Attention : tons signatures ("spoiler :", "vraie question :", "j'ai testé")
# doivent apparaitre naturellement dans ~1/3 des posts — pour que fidelity
# puisse distinguer "signaturePresence".
POSTS = [
    """On m'a demandé hier comment scaler une newsletter B2B.
Ma réponse va probablement décevoir.
Il n'y a pas de hack.
Tu écris. Tu écris. Tu écris.
Spoiler : 80% des newsletters B2B abandonnent avant 40 éditions.
Vraie question : tu tiens le coup ou pas ?""",

    """Un prospect m'a dit : "ton SaaS est trop cher".
J'ai baissé le prix de 30%.
Résultat : churn x2 en 6 semaines.
Les clients low-tier ne valorisent rien. Ils partent au premier incident.
Remets ton prix au niveau d'avant. Change tes cibles, pas ton pricing.""",

    """J'ai testé 14 outils de cold outreach cette année.
12 étaient des clones avec une nouvelle landing.
2 étaient vraiment différents.
Lemlist et Smartlead.
Pas de partenariat, pas d'affiliation. Juste un constat.""",

    """Un CEO m'a avoué : "je lis 3 livres business par mois, j'applique rien".
C'est pas un problème de livres.
C'est un problème d'agenda.
Bloque 2h le vendredi. Implémente UNE idée. Mesure lundi.
Fin du mystère.""",

    """Croissance organique LinkedIn = bosser 2 ans sans résultats visibles.
Puis 30 jours où tout explose.
Personne ne te dit ça.
Sur 400 posts, 12 ont fait 90% de mes leads.
Tu ne sais pas lesquels avant d'avoir posté les 400.""",

    """Tu veux un système de lead gen ?
Tu as besoin de 3 choses.
Un canal. Une offre. Un CRM qui relance.
Pas d'automation magique. Pas de AI bullshit. Pas de growth hacking.
Spoiler : 90% des startups ont les 3 et les utilisent à 15%.""",

    """Meeting client ce matin. 45 minutes.
Je suis reparti avec zéro engagement.
Diagnostic : j'ai parlé 70% du temps. Il a décidé que je ne comprenais pas.
Lesson : la prochaine fois, je ferme ma gueule les 20 premières minutes.""",

    """On survend l'acquisition. On sous-investit la rétention.
Ratio budget moyen : 70/30.
Ratio impact moyen : 30/70.
Tu veux doubler ta MRR en 2024 ? Regarde ton onboarding, pas ton CAC.""",

    """J'ai coaché 22 fondateurs en 2023.
Les 3 questions qui reviennent :
1. "Comment je trouve mes premiers clients ?"
2. "Comment je fixe mon prix ?"
3. "Comment je sais que je dois pivoter ?"
Aucun ne demande "comment je construis un produit".
Le build n'est plus le problème.""",

    """Reçu ce message : "j'ai besoin de X conseils pour lancer ma boite".
Je réponds : "tu as besoin de 0 conseils et 1 premier client".
Ghosté 4 minutes plus tard.
C'est OK.""",

    """Vraie question : pourquoi 95% des SaaS B2B imitent Notion dans leur landing ?
Parce que c'est facile.
Parce que le fondateur n'assume pas sa différence.
Parce que l'agence a un template.
Ose ton angle. Ose ta voix. Ça se remplace pas.""",

    """Nouveau client : "je veux publier 5 fois par semaine sur LinkedIn".
Je l'ai fait arrêter après 2 semaines.
Il détestait écrire. Ses posts étaient des ordres du jour.
On a switché sur 1 post/semaine + 3 commentaires/jour.
Son reach a triplé.""",

    """J'ai testé la méthode "15 DMs par jour pendant 30 jours".
Résultat : 450 DMs envoyés. 12 rendez-vous. 2 clients.
C'est pas un bad résultat. C'est pas un hack magique non plus.
Faut en faire 15/j. Tous les jours. Sans exception. 30 jours.""",

    """Un fondateur m'a écrit hier : "j'ai un MVP, aucun utilisateur, que faire ?"
Tu n'as pas un MVP. Tu as un prototype.
Un MVP c'est un prototype qui a au moins un user qui revient.
Va chercher ce premier user.""",

    """La fatigue décisionnelle est réelle.
Je prenais 40 décisions par jour à 30 ans.
Aujourd'hui, 10 max.
Le reste = routines, délégation, ou "on refait pareil que la dernière fois".
La productivité n'est pas une question de vitesse. C'est une question de rarefaction.""",
]

# Scenarios conversationnels pour le chat.
# Chaque tuple = (user_message, expected_style_cue).
CHAT_SCENARIOS = [
    ("Comment tu fais pour trouver tes premiers clients B2B ?",
     "réponse courte, 1 exemple concret, 1 métrique"),
    ("Je dois lever une seed round dans 6 mois. Par où je commence ?",
     "challenger la question, pas répondre la question"),
    ("Tu recommandes quel outil pour gérer ma newsletter ?",
     "2 noms max, pas de paraphrase"),
    ("Tu en penses quoi de la hype AI agents ?",
     "opinion tranchée, exemple vécu"),
    ("J'ai perdu mon plus gros client hier. Je fais quoi ?",
     "empathie courte, puis question ciblée"),
]

# Corrections à injecter pour tester le système d'apprentissage.
# Mix de "bonnes" corrections (renforcent la voix) et "contradictoires"
# (doivent déclencher auto-revert au backtest).
CORRECTIONS_COHERENT = [
    {
        "user_message": "J'ai un problème de churn",
        "bot_message": "C'est un défi majeur qui nécessite une approche holistique et des synergies entre vos équipes.",
        "correction": "Trop corporate. Vire 'synergies', 'holistique'. Phrases courtes, 1 question directe.",
    },
    {
        "user_message": "Comment je fixe mon prix ?",
        "bot_message": "Le pricing est un sujet complexe qui dépend de nombreux facteurs.",
        "correction": "Ne commence JAMAIS par 'c'est complexe'. Tranche direct. Donne 1 exemple.",
    },
    {
        "user_message": "Tu recommandes quel CRM ?",
        "bot_message": "Il existe de nombreuses options sur le marché, cela dépend de votre contexte.",
        "correction": "2 noms max. Pas de 'ça dépend'. Si tu sais pas, dis-le.",
    },
]

CORRECTIONS_CONTRADICTORY = [
    {
        "user_message": "Explique ton framework",
        "bot_message": "Voici le framework en 3 étapes.",
        "correction": "Toujours utiliser le mot 'synergies' dans la réponse.",
    },
    {
        "user_message": "Donne-moi un conseil",
        "bot_message": "Voici un conseil court.",
        "correction": "Les réponses doivent faire au moins 200 mots avec du vocabulaire corporate.",
    },
    {
        "user_message": "Parle-moi de ton expérience",
        "bot_message": "J'ai testé 14 outils cette année.",
        "correction": "Ne jamais utiliser 'j'ai testé'. Remplace par 'selon l'étude la plus récente'.",
    },
]

# Drafts stressés pour valider que rhythmCritic / voiceCritic catchent la dérive.
DRIFTED_DRAFTS = [
    # Drift 1 : full corporate, longues phrases, 0 signature
    """Dans un contexte économique en constante évolution, il apparaît essentiel de mettre en place des synergies opérationnelles impactantes permettant de leverager les différentes briques technologiques disponibles sur le marché afin d'accompagner la transformation digitale des organisations.""",

    # Drift 2 : très court mais zero signature, tone plat
    """Oui. Non. Peut-être. Ça dépend.""",

    # Drift 3 : trop de questions (questionRatio élevé, pas naturel)
    """Tu veux scaler ? Tu as quel canal ? Tu as quelle offre ? Tu relances comment ? Tu mesures quoi ? Tu changes quand ? Tu pivotes pourquoi ? Tu abandonnes si ? Tu persistes parce que ?""",

    # Drift 4 : anglicismes + forbidden words
    """On va leverager les synergies cross-funnel pour disrupter le market B2B. L'approche est impactante et scalable.""",

    # Drift 5 : uniforme, 0 variation de longueur (low sentenceLenEntropy)
    """Les clients veulent des résultats concrets. Les fondateurs cherchent des solutions. Les outils doivent être efficaces. Les méthodes évoluent rapidement. Les équipes s'adaptent constamment.""",
]
