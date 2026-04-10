# ahmet-clone

Clone vocal IA d'Ahmet Akyurek, coach en presence executive et impact a l'oral.

## Architecture

Pipeline 3-pass avec streaming temps reel :

```
User → [Pass 1: Sonnet streaming] → Client voit le texte en direct
                                   ↓
                              [Pass 2: Critic Sonnet]
                                   ↓
                         pass → done (texte deja affiche)
                         fail → [Pass 3: Sonnet rewrite streaming]
```

### Structure

```
api/
  chat.js       → Handler HTTP principal (slim, ~100 lignes)
  verify.js     → Validation code d'acces (sans tokens)
  health.js     → Health check
  _rateLimit.js → Rate limiter in-memory
lib/
  prompt.js     → Construction du prompt (knowledge base, topics)
  critic.js     → Boucle d'autocritique
  sse.js        → Helpers SSE
  validate.js   → Validation d'input
knowledge/
  entities/     → Profil Ahmet (identite, style)
  concepts/     → Concepts fondamentaux (4 fichiers)
  topics/       → Sujets d'expertise (2 fichiers)
  scenarios/    → Instructions par scenario (free, analyze, humanizer, identity)
  meta/         → Corrections apprises par feedback
  sources/      → Transcripts et articles sources
context/
  voice-dna.json → ADN vocal detaille (source de verite pour les mots interdits)
eval/
  run.js        → Test runner principal (28 cas)
  run-critic.js → Test du critic independamment (6 cas)
  checks.js     → 17 fonctions de validation programmatique
  cases/        → Cas de test JSON (free, analyze, critic)
public/
  index.html    → SPA (3 ecrans : acces, scenario, chat)
  app.js        → Client JS (SSE streaming, formatage)
  style.css     → Design system dark/intellectual
```

## Setup local

```bash
# Variables d'environnement requises
export ACCESS_CODE="votre-code"
export ANTHROPIC_API_KEY="sk-ant-..."

# Installation
npm install

# Dev server (port 3001)
npx vercel dev --listen 0.0.0.0 --port 3001
```

## Eval suite

```bash
# Lancer contre le serveur local (defaut: localhost:3001)
node eval/run.js

# Lancer un seul cas
node eval/run.js --case free-greeting

# Lancer contre la prod
EVAL_API_URL=https://ahmet-clone.vercel.app/api/chat node eval/run.js

# Tester le critic separement
node eval/run-critic.js
```

## Deploiement

Deploye sur Vercel. `vercel.json` configure les rewrites API.

```bash
vercel deploy
```
