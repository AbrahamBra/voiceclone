# Setclone

Clone conversationnel pour setters et ghostwriters LinkedIn. Reproduit le ton, le rythme et le protocole opérationnel d'une personne à partir de ses posts publics, des feedbacks utilisateur et des corrections setter.

Pipeline : **génère → vérifie → réécrit**, piloté par Claude (Sonnet/Haiku routé), encadré par un protocole opérationnel versionné et une boucle d'apprentissage qui consolide les corrections en règles persistantes.

## Architecture

Trois couches qui convergent sur le prompt d'inférence :

- **Voix** — fidélité stylistique (cosine thématique + métriques de style) et critic rythmique avec setter baseline (Mahalanobis).
- **Protocole** — règles opérationnelles versionnées (artefacts hard / strong / light) extraites des documents source, du feedback et des corrections setter, avec décroissance temporelle des artefacts inactifs.
- **Matière** — graphe de connaissances (entités + relations), RAG hybride sur posts importés, source playbooks éditables.

## Surfaces

- `/chat/[persona]` — cockpit conversationnel SSE avec injection protocole live
- `/calibrate/[persona]` — onboarding clone (import doc source, voix, protocole)
- `/lab` — review-deck pour superviser les sorties générées
- `POST /api/v2/draft` — endpoint synchrone JSON pour CRM / n8n / Zapier (draft + confidence)

## Stack

- SvelteKit 5 sur Vercel
- Vercel Functions + Supabase Postgres + pgvector
- Anthropic Claude (Sonnet pour la génération, Haiku pour classification et extraction parallèles)
- Voyage-3 pour les embeddings
- Vercel Cron (consolidation feedbacks, drain protocole, fidelity batch, auto-critique)

## Structure

```
api/                Endpoints serverless (chat SSE, draft JSON, cron, settings)
api/v2/             Surface protocole-v2 (extract, publish, source-playbooks, propositions)
lib/                Pipeline core (checks, rewrite, fidelity, knowledge graph)
lib/protocol-v2-*   Extracteurs, décroissance, versioning, embeddings d'artefacts
lib/critic/         Rythme, voix, setter baseline, Mahalanobis
src/routes/         SvelteKit pages (chat, calibrate, lab, demo, guide, login)
supabase/           Migrations Postgres (personas, artifacts, feedback_events, learning_events)
test/               Tests Node natifs (`node --test`)
```

## Setup

```bash
git clone <repo>
npm install
cp .env.example .env   # ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_*_KEY, VOYAGE_API_KEY
# Applique les migrations Supabase puis :
vercel dev             # `npm run dev` (vite) ne sert que l'UI, pas les fonctions api/
```

## Tests

```bash
npm test               # node --test sur test/*.test.js
```

## Licence

Privé. Tous droits réservés.
