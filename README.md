# SetClone

Clone conversationnel pour setters et ghostwriters LinkedIn. Reproduit le ton, le rythme et le **protocole opérationnel** d'une personne à partir de ses documents source, des feedbacks utilisateur et des corrections setter.

Différenciateur : ce n'est pas un wrapper Claude. Le clone vit. Chaque feedback ou correction est consolidé en **règle de protocole versionnée** (artefacts `hard` / `strong` / `light` avec décroissance temporelle), réinjectée dans le prompt à la génération suivante.

Pipeline d'inférence : **génère → critic voix + critic rythme → réécrit si écart**, encadré par un protocole versionné et une boucle d'apprentissage asynchrone qui transforme les signaux en règles.

## Naming (lisez ceci avant d'auditer)

- **SetClone** = nom produit actuel (renommage récent)
- **voiceclone** = ancien nom, encore présent dans les chemins Vercel (`voiceclone.vercel.app`), variables internes, certaines tables. Le projet Vercel s'appelle toujours `voiceclone`.
- **AhmetA** = nom du dossier racine et de l'agence du founder (1er client). Le repo vit historiquement sous `AhmetA/`. **AhmetA n'est pas le produit** — c'est l'agence qui l'utilise.
- `package.json` : `"name": "setclone"`. C'est la source de vérité.

## Architecture — trois couches qui convergent sur le prompt

- **Voix** — fidélité stylistique (cosine thématique sur posts importés + métriques de style) et critic rythmique avec setter baseline (distance Mahalanobis vs profil persona). Fichiers : [lib/critic/](lib/critic/), [lib/fidelity*.js](lib/).
- **Protocole v2** — règles opérationnelles versionnées extraites des documents source (`doc-extractor` single-call), du feedback (`feedback-detect`) et des corrections setter (`correction-consolidation`). Décroissance temporelle des artefacts inactifs, derivation logique entre règles. Fichiers : [lib/protocol-v2-*](lib/), [lib/protocol-v2-extractors/](lib/protocol-v2-extractors/).
- **Matière** — graphe de connaissances (entités + relations), RAG hybride (chunks vectorisés Voyage-3) sur posts et docs, source playbooks éditables par type d'action outbound. Fichiers : [lib/knowledge*.js](lib/), [lib/rag.js](lib/rag.js), [lib/graph-extraction*.js](lib/), [lib/embeddings.js](lib/embeddings.js).

## Boucle d'apprentissage (la spine du produit)

Pipeline asynchrone, 100% découplé de l'inférence :

```
[user message / setter correction / feedback button]
        ↓ écrit dans
feedback_events  /  corrections  /  learning_events  (Postgres)
        ↓ consommés par
cron-protocol-v2-drain  (toutes les 5 min, atomic claim)
        ↓ produit
propositions  (proposals d'artefacts protocole, embeddings Voyage)
        ↓ consommé par
cron-consolidate  (toutes les 10 min)  +  cron-auto-critique  (toutes les 6h)
        ↓ produit
protocol_v2 artifacts  (versionnés, taggés hard/strong/light)
        ↓ réinjecté dans
prompt d'inférence du clone à la génération suivante
        ↑ mesuré par
cron-fidelity  (quotidien 3h UTC) — score voix vs baseline
```

Tables clés : `feedback_events`, `corrections`, `propositions`, `protocol_v2_artifacts`, `learning_events`, `business_outcomes`. Migrations dans [supabase/](supabase/).

## Maturity levels des documents source (L1 / L2 / L3)

Le clone est créé à partir d'un (ou plusieurs) document source dont la maturité dicte la stratégie d'extraction :

- **L1** — doc brut, peu structuré (notes vrac, transcript). Extraction conservatrice, peu de règles dures.
- **L2** — doc structuré (process documenté, playbook formel). Extraction normale.
- **L3** — doc scénarisé (séquences de messages préformatées par cas). L'extracteur ne pose **pas** les questions playbook (séquences déjà encodées).

Conséquence pratique : la catégorisation du document à l'import (`persona_context` / `operational_playbook` / `scenarios`) **doit** être faite avant extraction, sinon pollution des artefacts. Voir [lib/protocol-v2-extractor-router.js](lib/protocol-v2-extractor-router.js) et [lib/protocol-v2-doc-extractor.js](lib/protocol-v2-doc-extractor.js) (recall doc → règles : ~5% → ~80% depuis PR #222).

## Surfaces

### Web (SvelteKit, [src/routes/](src/routes/))

| Route | Rôle |
|---|---|
| `/` | landing publique (contenu 100% synthétique, jamais de vraie data client) |
| `/create` | wizard de création de clone (import doc, choix maturity, init protocole) |
| `/calibrate/[persona]` | onboarding clone — voix, protocole, knowledge |
| `/chat/[persona]` | cockpit conversationnel SSE, injection protocole live, feedback inline |
| `/brain/[persona]` | inspection clone (intelligence, règles, scores) |
| `/lab` | review-deck pour superviser les sorties générées |
| `/admin` | panneau admin |
| `/demo` | démo publique |
| `/guide` | guide utilisateur |
| `/share/[token]` | partage clone via token signé |

### API serverless ([api/](api/))

Synchrone :
- `POST /api/chat` — inférence SSE clone (orchestration pipeline)
- `POST /api/clone` — génération brouillon (legacy)
- `POST /api/v2/draft` — endpoint **synchrone JSON** pour CRM / n8n / Zapier / Breakcold (auth `x-api-key`, idempotency par `external_lead_ref`, retourne draft + qualification)
- `POST /api/v2/feedback`, `POST /api/v2/propositions`, `POST /api/v2/protocol`, `POST /api/v2/review-deck`, `POST /api/v2/protocol/extract`, `POST /api/v2/protocol/import-doc`, `POST /api/v2/protocol/publish`, `GET /api/v2/protocol/source-playbooks`, `GET /api/v2/protocol/stream`
- `POST /api/feedback`, `GET /api/feedback-events`, `GET /api/feedback-roi`, `GET /api/learning-events`
- `POST /api/calibrate`, `POST /api/knowledge`, `GET /api/personas`, `GET /api/conversations`, `GET /api/messages`
- `POST /api/scrape` (LinkedIn profile scrape pour `/api/v2/draft`)
- `POST /api/auto-critique`, `GET /api/fidelity`, `POST /api/fidelity-tuning`, `GET /api/eval`
- `GET /api/share`, `POST /api/account/delete`, `GET /api/usage`, `GET /api/metrics`, `GET /api/contributors`, `GET /api/config`, `GET /api/settings`

Cron Vercel (voir [vercel.json](vercel.json)) :
- `*/5 * * * *` → `/api/cron-protocol-v2-drain` (drain feedback → propositions, atomic claim, 60s max)
- `*/10 * * * *` → `/api/cron-consolidate` (consolidation propositions → artefacts, 300s max)
- `0 */6 * * *` → `/api/cron-auto-critique` (auto-critique sur conversations récentes, 300s max)
- `0 3 * * *` → `/api/cron-fidelity` (recompute fidelity scores, 300s max)

## Stack

- **SvelteKit 5** + **Svelte 5** sur **Vercel** (`@sveltejs/adapter-vercel`)
- **Vite 8** pour le dev UI
- **Vercel Functions** (Node) pour `api/`, **Vercel Cron** pour la boucle d'apprentissage
- **Supabase Postgres** + **pgvector** pour storage et RAG
- **Anthropic Claude** :
  - Sonnet (`claude-sonnet-4-6`) pour génération principale
  - Haiku (`claude-haiku-4-5-20251001`) pour classification, extraction, parallélisations
  - Routage dans [lib/model-router.js](lib/model-router.js)
- **Voyage AI** (`voyage-3`) pour les embeddings (chunks RAG, propositions, entités)
- **mammoth** + **pdfjs-dist** pour parsing docs source (.docx, .pdf)

## Structure repo

```
api/                        endpoints serverless (chat SSE, draft JSON, cron, settings, feedback)
api/v2/                     surface protocole-v2 + draft Breakcold + propositions + review-deck
lib/                        pipeline core (prompt, pipeline, fidelity, knowledge graph, supabase)
lib/critic/                 critics rythme + voix + setter baseline + Mahalanobis
lib/protocol-v2-*           extracteur single-call, router, versioning, drain, embeddings, narrator
lib/protocol-v2-extractors/ patterns + scoring + hard_rules + templates + process
lib/prompts/                templates de prompt (clone, feedback, knowledge)
src/routes/                 SvelteKit pages (10 routes — voir tableau ci-dessus)
src/lib/                    code partagé client (composants, stores, scenarios, tracking)
supabase/                   migrations Postgres numérotées (002 → 069+) — schema.sql en base
scripts/                    scripts d'audit, backfill, migration, seed (~80 scripts)
test/                       tests Node natifs (`node --test`)
eval/                       evals critic (`npm run eval:critic`)
audit/, knowledge/, personas/, templates/   data + fixtures
```

## Setup

```bash
git clone <repo>
npm install
cp .env.example .env
# Variables requises : ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VOYAGE_API_KEY
# Appliquer toutes les migrations supabase/*.sql sur ta DB
```

**Dev** :
```bash
vercel dev          # full stack (UI + functions api/ + cron simulés) — à utiliser pour tout test bout-en-bout
npm run dev         # UI seulement (vite) — ne sert PAS api/, ne révèle pas les bugs API
```

## Tests

```bash
npm test                  # node --test sur test/*.test.js
npm run eval:critic       # eval critic voix sur dataset gold
npm run lint              # eslint
npm run format            # prettier
```

## Notes pour auditeurs externes

- **Le repo a 80+ scripts dans [scripts/](scripts/)** — la majorité sont des outils ponctuels (backfill, audit, diag) liés à des incidents passés. Ne pas les considérer comme du code production.
- **Le dossier [audit/](audit/), [knowledge/](knowledge/), [personas/](personas/), [templates/](templates/), [eval/](eval/), [data/](data/)** contiennent des fixtures, gold sets et data d'expérimentation, pas du code applicatif.
- **`POSTS` (route et tables associées) est en cours de dépréciation** — ne pas considérer comme infrastructure permanente.
- **Pas de claim de conformité RGPD** — l'app héberge sur infrastructure EU mais n'est pas certifiée.
- Ce dépôt est privé. Tous droits réservés.
