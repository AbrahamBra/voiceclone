# VoiceClone

Clone IA de style d'ecriture LinkedIn. Analysez le profil et les posts d'une personne pour creer un chatbot qui ecrit exactement comme elle.

**Demo :** [voiceclone-lake.vercel.app](https://voiceclone-lake.vercel.app)

## Ce qui rend l'approche unique

La plupart des "clones IA" se contentent d'un prompt du type *"ecris comme X"*. VoiceClone va beaucoup plus loin :

**1. Extraction structuree du style**
A partir de posts LinkedIn, l'IA ne se contente pas d'imiter — elle decompose la voix en composants atomiques : ton, traits de personnalite, expressions signatures, mots interdits, anti-patterns, et regles d'ecriture precises. Le resultat est une configuration JSON exploitable, pas juste du texte libre.

**2. Pipeline generate-check-rewrite**
Chaque reponse passe par un pipeline en 2 passes :
- **Generate** — Claude produit la reponse en streaming
- **Check** — Des regles deterministes (~0ms) detectent les violations : mots interdits, auto-revelation IA, fuite de prompt, cliches IA, markdown non desire, longueur excessive
- **Rewrite** — Si une violation "hard" est detectee, la reponse est automatiquement reecrite en corrigeant le probleme

Pas de scoring LLM couteux — les checks sont programmatiques et instantanes.

**3. Calibration continue par feedback**
Le clone s'ameliore a chaque interaction :
- **Feedback explicite** — L'utilisateur corrige une reponse, l'IA analyse la correction et l'enregistre comme regle permanente
- **Feedback implicite** — L'utilisateur edite directement un message, le diff est automatiquement analyse pour en extraire les preferences de style
- **Consolidation** — Les corrections repetees (3x+) sont promues en regles permanentes dans le prompt systeme

**4. Graphe de connaissances auto-enrichi**
Les corrections ne sont pas juste stylistiques. Quand l'utilisateur corrige un fait, VoiceClone extrait automatiquement les entites (concepts, frameworks, croyances, outils) et leurs relations pour construire une ontologie du domaine de la personne clonee.

**5. Prompt a budget de tokens**
Le prompt systeme est construit dynamiquement avec un budget strict (~3500 tokens) et un systeme de priorite :
1. Regles de voix (toujours incluses)
2. Corrections recentes (priorite haute)
3. Instructions du scenario actif
4. Ontologie / concepts cles
5. Knowledge base contextuelle (remplit le budget restant)

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
