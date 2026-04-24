 VoiceClone

Système de clonage de style d'écriture (voix textuelle) avec apprentissage incrémental continu.  
Conçu pour reproduire fidèlement le rythme, les contraintes opérationnelles et les micro-nuances d'une personne à partir de ses posts LinkedIn et feedbacks utilisateur.

Le cœur est un pipeline **generate → check (regex déterministe) → rewrite (max 1 passe)** piloté par Claude (Sonnet/Haiku routé), renforcé par un graphe de connaissances dynamique, un RAG hybride et une boucle de consolidation embedding-based.

## Philosophie du projet

Pas de prompt engineering magique ni de fine-tuning coûteux.  
On mise sur :
- Contraintes mécaniques dures (longueur exacte, ratio questions, emoji, anglicismes fermés, etc.)
- Circuit-breaker binaire sur violations hard
- Graphe de connaissances avec relations `contradicts` / `enforces`
- Consolidation greedy des feedbacks en règles abstraites ou opérationnelles
- Monitoring de fidélité (cosine thématique + métriques stylistiques) et risque de style collapse

Le système apprend réactivement via feedbacks (5 canaux détectés) et tente de s'auto-corriger via backtest sur consolidation.

**Statut actuel** : Hybride sophistiqué, mais le lifelong learning reste semi-supervisé et le monitoring de collapse (TTR, kurtosis, etc.) encore immature sur les personas ultra-courts en français.

## Fonctionnalités principales

- Génération streaming avec routing modèle (complexité)
- Checks programmatiques + rewrite unique sur hard violations (mots interdits, patterns IA français, self-reveal, etc.)
- RAG hybride : Voyage-3 + pgvector (HNSW + RRF keyword + cosine)
- Graphe de connaissances dynamique (entités + relations, extraction via Haiku, decay temporel, walk 2-hops)
- Consolidation embedding-based des feedbacks (clustering greedy, synthèse Haiku, promotion dans writingRules avec cap 25 + graduation + decay 120 jours)
- Fidelity score batch (cosine thématique + style metrics : longueur, questions, signatures, TTR, kurtosis…)
- Collapse index expérimental pour détecter la convergence vers un ton LLM contraint
- Calibration continue via Supabase (personas, corrections, knowledge graph)

## Stack technique

- **Frontend** : Svelte (Vercel)
- **Backend** : Serverless Vercel Functions + Supabase (Postgres + pgvector)
- **LLM** : Anthropic Claude (Sonnet / Haiku)
- **Embeddings** : Voyage-3 (1024-dim)
- **Vector store** : pgvector HNSW
- **Autres** : RRF retrieval, greedy clustering, decay temporel, consolidation asynchrone

## Structure du repo (essentiel)

├── lib/                  # Pipeline core : generate, checks, rewrite, buildSystemPrompt
├── knowledge/            # Graphe + extraction
├── personas/             # JSON de base + rules
├── supabase/             # Migrations, schema (knowledge_entities, relations, corrections, fidelity_scores…)
├── scripts/              # graph-extraction.js, etc.
└── fidelity.js           # Calcul du score + collapse index (batch)

Le cœur intelligent se trouve dans `lib/pipeline.ts`, `checks.ts`, `rewrite.ts`, `correction-consolidation.js` et `fidelity.js`.

## Installation & setup

1. Clone le repo
2. `npm install`
3. Copie `.env.example` → `.env` et remplis :
   - Variables Anthropic
   - Supabase URL + keys (anon + service_role)
   - Voyage API key (si utilisé)
4. Applique les migrations Supabase
5. `npm run dev`

**Note** : Le projet est pensé serverless-first. Les timeouts Vercel (60s) et budgets tokens (12k max avec allocation prioritaire) sont gérés explicitement.

## Usage

- Crée ou importe un persona (posts LinkedIn + description)
- Chatte avec le clone → feedbacks (corrections, instructions, negative) alimentent automatiquement le graphe et la consolidation
- Batch fidelity pour mesurer la dérive
- Consolidation se déclenche tous les ~10 feedbacks (configurable)

Pour les personas idiosyncratiques (ex. style ultra-sec 5-15 mots, multi-messages WhatsApp), les règles opérationnelles dures sont le principal garde-fou.

## Limitations connues (honnêtes)

- Clustering greedy order-dependent + centroid drift
- TTR fragile sur messages courts français (fenêtre fixe 200 derniers mots, contractions non éclatées)
- Collapse index sur-dépendant du TTR et encore bruité
- Pas de guard inline fidelity avant streaming (tout est post-response ou batch)
- Graph walk 2-hops naïf (pas de pondération relationnelle fine ni cycle detection)
- Backtest et revert encore partiellement manuels ou fire-and-forget sur certains chemins
- Risque de style collapse subtil non pleinement quantifié sur le long terme (micro-humour, timing punchlines)

Le système protège bien les contraintes mécaniques, mais la préservation des micro-nuances idiosyncratiques reste un chantier ouvert.

## Roadmap / Prochains pas (dans l’ordre de priorité que je recommande)

1. Backtest automatique avec delta fidelity + delta collapseIndex + auto-revert
2. Seuil adaptatif de clustering par persona + typing des règles (opérationnel vs abstrait)
3. Amélioration robuste du TTR (sliding window, éclatement contractions, moyenne multi-messages)
4. Pondération intelligente dans varianceLoss + réduction de l’influence cumulée du TTR
5. Guard inline léger (fidelity draft avant streaming)
6. Monitoring live plus riche + tracking temporel de la variance des outputs

## Contribution

Le projet est solo et expérimental. Les challenges techniques les plus intéressants tournent autour de :
- Meilleures métriques anti-collapse sans LLM supplémentaire
- Rendre le lifelong learning plus proactif (self-play ou critic parallèle)
- Réduire le bruit du clustering tout en restant serverless-cheap

Si tu veux contribuer : ouvre une issue ou une PR centrée sur un gap précis (pas de feature business ou UI).

## Licence

MIT (ou celle que tu préfères).

---

Ce README est direct, technique et reflète exactement le niveau réel du projet : ambitieux sur l’hybride déterministe + apprentissage incrémental, mais avec des faiblesses claires et assumées sur le monitoring et la robustesse du collapse detection.

Tu peux le copier-coller tel quel et l’ajuster légèrement (ajouter badges Vercel/Supabase si tu veux, ou un screenshot du graphe). Il donne envie à quelqu’un qui s’intéresse à la techno pure (comme toi) sans sur-vendre.

Si tu veux une version plus courte, plus visuelle (avec emojis modérés) ou avec une section « Pourquoi ce n’est pas

