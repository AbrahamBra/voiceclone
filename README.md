# VoiceClone

Clone IA de style d'ecriture LinkedIn. Analysez le profil et les posts d'une personne pour creer un chatbot qui ecrit exactement comme elle.

**Demo :** [voiceclone-lake.vercel.app](https://voiceclone-lake.vercel.app)

## Fonctionnalites

- **Clonage de voix** — Collez un profil LinkedIn + posts, l'IA extrait le style d'ecriture (ton, expressions, regles)
- **Chat en temps reel** — Streaming SSE avec Claude, conversations persistantes
- **Scenarios** — Discussion libre, creation de posts LinkedIn, prospection, etc.
- **Calibration continue** — Feedback implicite/explicite pour affiner le style au fil du temps
- **Multi-personas** — Gerez plusieurs clones avec themes personnalises
- **Scraping LinkedIn** — Extraction automatique depuis une URL de profil
- **Knowledge base** — Upload de documents (PDF, TXT, CSV) pour enrichir le contexte
- **Metriques & qualite** — Suivi d'utilisation, scores de qualite, rate limiting

## Stack

- **Frontend** — Vanilla JS, CSS (SPA legere, pas de framework)
- **Backend** — Vercel Serverless Functions (Node.js)
- **IA** — Claude (Anthropic API)
- **Base de donnees** — Supabase (PostgreSQL + pgvector pour embeddings)
- **Deploy** — Vercel

## Structure

```
api/            Endpoints serverless (chat, clone, calibrate, feedback, scrape...)
lib/            Logique metier (prompt builder, pipeline, embeddings, validation)
public/         Frontend (index.html, app.js, style.css)
personas/       Configurations de personas (JSON)
knowledge/      Documents de contexte par persona
supabase/       Migrations et seed SQL
eval/           Tests et evaluation
```

## Setup local

```bash
npm install
vercel dev
```

## Variables d'environnement

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Cle API Anthropic |
| `SUPABASE_URL` | URL du projet Supabase |
| `SUPABASE_SERVICE_KEY` | Cle service Supabase |
| `ACCESS_CODES` | Codes d'acces autorises (JSON) |
