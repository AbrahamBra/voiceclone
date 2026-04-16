# VoiceClone

Clones IA de voix ecrite. Analysez le profil LinkedIn et les posts d'une personne pour creer un clone qui ecrit, repond et prospecte exactement comme elle.

**Demo :** [voiceclone-lake.vercel.app](https://voiceclone-lake.vercel.app)

## Comment ca marche

A partir de 30 posts LinkedIn, VoiceClone decompose la voix en composants atomiques (ton, personnalite, expressions signatures, mots interdits, regles d'ecriture) et construit un graphe de connaissances du domaine de la personne. Le clone s'ameliore ensuite a chaque interaction grace a une boucle de feedback auto-supervisee.

### Pipeline de generation

```
Message utilisateur
    |
    v
Classification d'intent (regex fast-path + Haiku fallback)
    |
    v
Routage multi-modele (Haiku pour le chat simple, Sonnet pour le complexe)
    |
    v
Construction du prompt (budget adaptatif jusqu'a 12k tokens)
    |
    v
Generation streaming (SSE) + prompt caching Anthropic
    |
    v
Checks programmatiques (~0ms) : mots interdits, auto-reveal IA, fuite prompt, cliches
    |
    v
Rewrite automatique si violation hard
    |
    v
Detection post-reponse : corrections implicites, validation, metacognition
```

### Boucle d'apprentissage

Chaque echange est analyse pour extraire des corrections de style, des instructions directes, des insights metacognitifs (methodologies, valeurs, anecdotes sectorielles). Les corrections sont :

- **Decayees** lineairement sur 120 jours (les anciennes perdent en influence)
- **Consolidees** par clustering semantique (3+ corrections similaires → 1 regle permanente)
- **Contradictoirement resolues** (si deux corrections s'opposent, la plus recente gagne)
- **Injectees dans un graphe de connaissances** avec detection automatique de contradictions

### Intelligence partagee

Plusieurs clones peuvent partager la meme intelligence (corrections, entites, knowledge). Un clone "setter" et un clone "post creation" pour la meme personne partagent les apprentissages sans duplication.

### Fidelity Score

Mesure automatique de la fidelite vocale : les textes generes par le clone sont compares aux posts originaux par similarite semantique, clusteres par theme. Score 0-100 affiche sur chaque carte clone avec historique de progression.

## Fonctionnalites

- **Clonage depuis LinkedIn** — Profil + posts via API (LinkdAPI), ou upload CSV/PDF
- **Clonage de DMs** — Analyse du style conversationnel en messages prives
- **Chat temps reel** — Streaming SSE, conversations persistantes, historique complet
- **Scenarios** — Conversation, creation de posts LinkedIn, qualification de leads, audit
- **Calibration** — Generation de 5 messages test, notation, corrections automatiques
- **Multi-personas** — Hub avec themes personnalises, partage entre utilisateurs
- **Knowledge base** — Upload de documents (PDF, DOCX, TXT, CSV) avec RAG pgvector
- **Panel Intelligence** — Entites, relations, contradictions, corrections, fidelity score
- **Admin** — Metriques, activite par client, budget, usage tokens, personas grid
- **Budget adaptatif** — Le prompt grandit avec la pertinence du contexte retrieve

## Stack

| Couche | Technologie |
|--------|-------------|
| Frontend | SvelteKit 2, Svelte 5, Vite 8 |
| Backend | Vercel Serverless Functions (Node.js 22) |
| IA Generation | Claude Sonnet 4 + Haiku 4.5 (Anthropic API) |
| Embeddings | Voyage-3 (VoyageAI) |
| Base de donnees | Supabase PostgreSQL + pgvector |
| Deploy | Vercel |

## Structure

```
api/            17 endpoints serverless (chat, clone, calibrate, feedback, fidelity, scrape...)
lib/            18 modules metier (pipeline, prompt, embeddings, rag, model-router, fidelity...)
src/
  routes/       Pages SvelteKit (hub, chat, guide, admin)
  lib/
    components/ Composants Svelte (ChatPanel, IntelligencePanel, CloneWizard...)
    stores/     Stores Svelte (auth, chat, persona, ui)
scripts/        Ingestion de donnees, bootstrap graphe, extraction ontologie
supabase/       16 migrations SQL
eval/           Suite d'evaluation (cas free/audit/critic + simulation persona)
test/           Tests unitaires (checks, prompt, correction lifecycle)
```

## Setup local

```bash
npm install
vercel dev
```

## Variables d'environnement

| Variable | Requis | Description |
|----------|--------|-------------|
| `ANTHROPIC_API_KEY` | oui | Cle API Anthropic (Sonnet + Haiku) |
| `SUPABASE_URL` | oui | URL du projet Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | oui | Cle service role Supabase |
| `ADMIN_CODE` | oui | Code d'acces admin |
| `VOYAGE_API_KEY` | non | Embeddings Voyage-3 (RAG + fidelity) |
| `LINKDAPI_KEY` | non | API LinkdAPI pour extraction LinkedIn |
| `CLAUDE_MODEL` | non | Override du modele (defaut: claude-sonnet-4-20250514) |
