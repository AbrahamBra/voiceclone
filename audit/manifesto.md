# VoiceClone — manifeste court

> *Il y a un gap structurel entre le sujet de l'énoncé (ce qui est dit) et le sujet parlant (ce qui parle à travers). L'auteur ne sait pas ce qu'il désire vraiment. Son « style » n'est pas dans ses règles conscientes — il est dans les motifs latents qui le structurent à son insu.*

---

## Le problème concret

Les agences de ghostwriting LinkedIn utilisent ChatGPT comme tout le monde. Le souci : ChatGPT écrit comme ChatGPT — pas comme le client. Le client refuse les drafts. Le setter réécrit. L'agence perd le bénéfice de l'automatisation. À la fin, la prod revient au copywriter humain pendant que le produit "IA" sert de vitrine.

VoiceClone est ce qu'on construit pour sortir de ce pattern.

## L'observation technique qui nous guide

Un LLM prédit le prochain token le plus probable étant donné les précédents. Il modélise la surface des énoncés. Il ne modélise pas **ce qui, dans un individu, fait qu'il écrit X et pas Y**. C'est une limite structurelle, pas un problème d'ingénierie — ajouter du RAG, du prompt engineering ou du fine-tuning l'améliore, ne la dépasse pas.

La conséquence : quand l'auteur corrige son clone, il corrige des **effets** sans pouvoir nommer la **cause**. Il dit "pas comme ça", il ne dit pas pourquoi — parce qu'il ne le sait pas lui-même. Ses corrections sont donc bruitées, contradictoires dans le temps, dépendantes du contexte. Les accumuler naïvement dégrade le clone à long terme.

## Ce qu'on fait concrètement

Un clone stylistique par client, construit avec une **discipline hybride** :

- Pipeline déterministe `generate → check → rewrite (max 1 passe)` piloté par Claude Sonnet/Haiku routé
- Contraintes **hard** sur les signatures indésirables : patterns IA français, auto-révélations, forbidden words, markdown dans le texte, faux hooks
- RAG hybride (Voyage-3 + pgvector HNSW + RRF) sur corpus posts + DMs + docs métier
- Graphe de connaissances dynamique par persona, avec relations `contradicts` / `enforces`
- Critics stylistiques en parallèle : **RhythmCritic** (Mahalanobis persona-relatif sur la distribution de rythme), **VoiceCritic** (règles lexicales persona-spécifiques), **HeatThermometer** (scoring heat prospect sur les DMs avec signaux narratifs ancrés dans de vraies conversations)
- Consolidation des corrections avec clustering greedy, cap à 25 règles actives, decay 120j, graduation logic
- Monitoring de fidélité en continu (cosinus thématique + métriques stylistiques) et collapse index pour détecter la convergence vers un ton LLM générique

Pas de fine-tuning coûteux. Pas de prompt engineering magique. Juste des contraintes mécaniques + de l'observabilité + un learning incrémental honnête.

## L'ambition plus profonde (mode C)

Le saut qu'on vise n'est pas "mieux prédire les tokens". C'est **modéliser la structure causale qui génère ces tokens chez un individu spécifique**.

Concrètement : détecter les signatures implicites que l'auteur lui-même n'a jamais nommées.

Exemples :
- *87% de ses posts commencent par "Je" ou "On" — c'est une signature.*
- *Il place systématiquement une question rhétorique au 3e paragraphe — c'est une signature.*
- *Son TTR baisse quand il parle de son parcours, remonte quand il parle de ses clients — c'est une signature.*

L'auteur les ignore. Elles le définissent.

Si on arrive à les extraire et à les préserver consciemment, le clone cesse d'être un "wrapper Claude + RAG + corrections" et devient un **modèle de l'individu** — une forme restreinte de *world model*, au sens de LeCun, mais appliqué à la voix d'une personne plutôt qu'au monde physique.

C'est cette direction qui rend le projet **non-reproductible** par assemblage de briques open-source. Le différenciateur technique devient philosophique.

## Principe directeur qui en découle

L'IA n'est pas là pour obéir à l'humain. Elle est là pour **maintenir la cohérence que l'humain est incapable de maintenir seul**.

- L'humain se contredit dans le temps — donnée, pas défaut
- Les corrections sont des votes en confiance limitée, pas des commandements
- Le clone triangule entre corpus / corrections / performance réelle — aucun point de vue unique n'est la vérité
- Quand deux corrections se contredisent, le clone **rappelle** à l'humain ce qu'il a décidé. Il ne choisit pas silencieusement.

## Où on en est honnêtement

Premiers clients (agence AhmetA + 2 clients externes). Les setters et les clients sont surpris par la qualité des sorties — elle tient la comparaison avec ChatGPT "brut" de façon visible.

Mais :
- Le lifelong learning est semi-supervisé
- La détection de contradictions inter-corrections n'existe pas encore
- L'extraction de signatures implicites est embryonnaire (RhythmCritic est un début)
- Le ground-truth performance LinkedIn réelle n'est pas branché
- Le système est "solo-first" dans son code, alors qu'il est utilisé "agence-first" — dette structurelle à rembourser

On est à un stade où **les bases techniques sont là, la direction philosophique est claire, il reste à l'outiller vraiment**.

## Ce qui vient

- **Architecture intents** pour les posts (autonome / lead magnet / actualité croisée / prise de position / framework / cas client / coulisse) — chacun avec contraintes et sources propres
- **Cohérence** : détection systématique des contradictions inter-corrections, abstraction active des règles, dashboard de révocation
- **Mode C** : détection de signatures implicites dans le corpus, proposition de les nommer/préserver
- **Agence-first** : rôles et permissions pour soutenir la structure économique réelle
- **Ground-truth performance** via intégration sales engagement (Breakcold ou équivalent)

## Pour qui lit ça

Si tu fais du ghostwriting, du setting, ou si tu réfléchis à comment modéliser la voix d'un individu sans fine-tuning géant : appelle-moi.

Si tu es juste fatigué de voir des "startups IA" qui sont des wrappers OpenAI déguisés, VoiceClone est la tentative de faire autre chose — sans se prendre pour un projet de recherche, mais en assumant la profondeur du problème.

Pas de vapor. Le code existe, tourne en prod, a des utilisateurs. La direction long-terme est explicite. Les limites aussi.

---

**Contact** : AhmetA · [email / LinkedIn]
