# Global Improvement Plan — ahmet-clone v2

**Date**: 2026-04-09
**Objectif**: Monter la satisfaction globale de ~6.5/10 a 8.5/10
**Approche**: 5 iterations sequentielles, chacune autonome et committee separement
**Stade projet**: Phase dev/demo — changements breaking autorises

---

## Scores actuels et cibles

| Axe | Actuel | Cible | Iteration |
|-----|--------|-------|-----------|
| Securite | 5/10 | 8/10 | 1 |
| UX/Latence | 6/10 | 8.5/10 | 2 |
| Qualite clone vocal | 7/10 | 8.5/10 | 3 |
| Code quality | 7/10 | 8.5/10 | 4 |
| Eval suite | 7/10 | 8.5/10 | 5 |
| Knowledge base | 9/10 | 9/10 | - (deja excellent) |

---

## Iteration 1 — Securite & Robustesse

### 1.1 Supprimer le fallback du code d'acces

**Fichier**: `api/chat.js:5`
**Avant**: `const ACCESS_CODE = process.env.ACCESS_CODE || "ahmet99";`
**Apres**: `const ACCESS_CODE = process.env.ACCESS_CODE;`
Si `ACCESS_CODE` n'est pas defini, toutes les requetes retournent 500 avec message explicite.

Ajouter un guard en haut du handler:
```js
if (!ACCESS_CODE) {
  res.status(500).json({ error: "Server misconfigured: ACCESS_CODE not set" });
  return;
}
```

### 1.2 Migrer vers header-only pour le code d'acces

**IMPORTANT**: Les sections 1.2 et 1.5 doivent etre implementees ensemble. La fonction `handleAccess()` du frontend doit pointer vers `/api/verify` (section 1.5) ET utiliser le header (section 1.2) dans le meme commit. Sinon, la validation d'acces casse.

**Fichier**: `api/chat.js:182`
**Avant**: `const code = req.query.code || req.headers["x-access-code"];`
**Apres**: `const code = req.headers["x-access-code"];`

**Fichier**: `public/app.js` — fonction `sendMessage()` (ligne 213)
**Avant**: `fetch("/api/chat?code=" + encodeURIComponent(accessCode), ...)`
**Apres**: `fetch("/api/chat", { headers: { "Content-Type": "application/json", "x-access-code": accessCode }, ... })`

**Fichier**: `public/app.js` — fonction `handleAccess()` (ligne 52)
**Avant**: `fetch("/api/chat?code=" + encodeURIComponent(code), ...)`
**Apres**: `fetch("/api/verify", { method: "POST", headers: { "x-access-code": code } })` — pointe vers `/api/verify` (voir 1.5)

**Fichier**: `eval/run.js:27`
**Avant**: `fetch(\`${API_URL}?code=${ACCESS_CODE}\`, ...)`
**Apres**: `fetch(API_URL, { headers: { "Content-Type": "application/json", "x-access-code": ACCESS_CODE }, ... })`

### 1.3 Validation d'input

**Fichier**: `api/chat.js` — apres l'auth check, avant `buildSystemPrompt`

Regles de validation:
- `scenario` doit etre "free" ou "analyze" (whitelist stricte)
- `messages` doit etre un Array de max 20 elements
- Chaque message doit avoir `role` (string, "user"|"assistant") et `content` (string, max 10000 chars)
- `profileText` si present doit etre string de max 20000 chars
- Retourner 400 avec message specifique si violation

```js
function validateInput(body) {
  const { scenario, messages, profileText } = body;

  if (!["free", "analyze"].includes(scenario)) {
    return "Invalid scenario: must be 'free' or 'analyze'";
  }

  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20) {
    return "messages must be an array of 1-20 items";
  }

  for (const msg of messages) {
    if (!msg.role || !["user", "assistant"].includes(msg.role)) {
      return "Each message must have role 'user' or 'assistant'";
    }
    if (typeof msg.content !== "string" || msg.content.length === 0 || msg.content.length > 10000) {
      return "Each message content must be a non-empty string under 10000 chars";
    }
  }

  if (profileText !== undefined && (typeof profileText !== "string" || profileText.length > 20000)) {
    return "profileText must be a string under 20000 chars";
  }

  return null;
}
```

### 1.4 Rate limiting in-memory

**Nouveau fichier**: `api/_rateLimit.js`

Rate limiter simple basé sur un Map en memoire. Sur Vercel serverless, chaque instance a sa propre Map — ca ne couvre pas le rate limiting distribue, mais ca protege contre le burst d'un seul utilisateur.

```js
const store = new Map();
const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 20;

export function rateLimit(ip) {
  const now = Date.now();
  const record = store.get(ip);

  if (!record || now - record.windowStart > WINDOW_MS) {
    store.set(ip, { windowStart: now, count: 1 });
    return { allowed: true };
  }

  record.count++;
  if (record.count > MAX_REQUESTS) {
    return { allowed: false, retryAfter: Math.ceil((record.windowStart + WINDOW_MS - now) / 1000) };
  }

  return { allowed: true };
}
```

**Integration dans `api/chat.js`**: appeler `rateLimit(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")` avant l'auth check.

### 1.5 Endpoint `/api/verify.js`

**Nouveau fichier**: `api/verify.js`

Endpoint leger pour valider le code d'acces sans consommer de tokens Anthropic.

```js
export default function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const ACCESS_CODE = process.env.ACCESS_CODE;
  if (!ACCESS_CODE) {
    res.status(500).json({ error: "Server misconfigured" });
    return;
  }

  const code = req.headers["x-access-code"];
  if (code === ACCESS_CODE) {
    res.status(200).json({ valid: true });
  } else {
    res.status(403).json({ valid: false });
  }
}
```

**Modification frontend** `public/app.js:handleAccess()`: pointer vers `/api/verify` au lieu de `/api/chat`.

---

## Iteration 2 — UX & Latence (Streaming Pass 1)

### 2.1 Probleme actuel

Le chemin heureux (pass 1 acceptee par le critic, ~80% des cas) n'a AUCUN streaming reel:
1. Pass 1: `messages.create()` synchrone (3-8s d'attente)
2. Critic: `messages.create()` synchrone (1-2s)
3. Le texte complet est envoye d'un coup via SSE

L'utilisateur voit "..." pendant 5-10 secondes.

### 2.2 Solution: Stream-then-validate

**Nouveau flow**:
1. **Pass 1 streamee**: utiliser `messages.stream()`, envoyer les deltas au client EN TEMPS REEL
2. **Accumuler le texte complet** pendant le streaming
3. **Apres le stream**, envoyer `{ type: "validating" }` au client
4. **Critic check** sur le texte accumule
5. **Si pass**: envoyer `{ type: "done" }` — l'utilisateur a deja tout vu
6. **Si fail**: envoyer `{ type: "rewriting" }` au client, puis streamer pass 3

**Fichier**: `api/chat.js` — remplacement du bloc pass 1

```js
// === PASS 1: Generate (streaming to client) ===
const stream1 = client.messages.stream({
  model: "claude-sonnet-4-20250514",
  max_tokens: 1024,
  system: systemPrompt,
  messages: trimmedMessages,
});

let pass1Text = "";

stream1.on("text", (text) => {
  pass1Text += text;
  res.write("data: " + JSON.stringify({ type: "delta", text }) + "\n\n");
});

await stream1.finalMessage();
const t1 = Date.now();

// === PASS 2: Critic check (with keep-alive pings) ===
res.write("data: " + JSON.stringify({ type: "validating" }) + "\n\n");

// Keep-alive ping every 5s to prevent Vercel edge proxy from closing idle SSE
const keepAlive = setInterval(() => {
  res.write(": keep-alive\n\n"); // SSE comment line, ignored by client parsers
}, 5000);

const verdict = await criticCheck(client, pass1Text, corrections);
clearInterval(keepAlive);
const t2 = Date.now();

if (verdict.pass) {
  res.write("data: " + JSON.stringify({ type: "done" }) + "\n\n");
  res.end();
  // log...
  return;
}

// === PASS 3: Critic failed — rewrite ===
res.write("data: " + JSON.stringify({ type: "rewriting" }) + "\n\n");
// Clear previous text on client side
res.write("data: " + JSON.stringify({ type: "clear" }) + "\n\n");
// Stream pass 3...
```

### 2.3 Modification frontend

**Fichier**: `public/app.js` — gestion des nouveaux event types

```js
// In the SSE parsing loop:
if (data.type === "thinking") {
  bubble.textContent = "...";
} else if (data.type === "delta") {
  fullText += data.text;
  bubble.textContent = fullText;
} else if (data.type === "validating") {
  // Optional: subtle indicator (no text change needed, text already displayed)
} else if (data.type === "rewriting") {
  // Show indicator that Ahmet is refining
  bubble.classList.add("rewriting");
} else if (data.type === "clear") {
  // Critic failed, clear text for pass 3
  fullText = "";
  bubble.textContent = "";
  bubble.classList.remove("rewriting");
} else if (data.type === "done") {
  break;
}
```

**CSS addition**: animation subtile pour l'etat "rewriting" (opacity pulse).

### 2.4 Impact latence

| Chemin | Avant | Apres |
|--------|-------|-------|
| Heureux (pas de violation) | 7s de blanc puis texte d'un coup | Texte stream des la 1ere seconde |
| Avec violation | 7s de blanc + stream pass 3 | Stream pass 1 + 2s blanc + stream pass 3 |

### 2.5 Gestion d'erreur mid-stream

Si `stream1` emet une erreur apres avoir deja envoye des deltas partiels:
- Envoyer `{ type: "error", text: "Erreur de generation" }` au client
- Le frontend affiche le texte partiel deja recu + un indicateur d'erreur
- Ne PAS envoyer `{ type: "clear" }` — le texte partiel est mieux que rien
- Logger l'erreur avec le nombre de chars deja envoyes

---

## Iteration 3 — Qualite du Clone Vocal

### 3.1 Renforcer le critic avec Sonnet

**Fichier**: `api/chat.js:136`
**Avant**: `model: "claude-haiku-4-5-20251001"`
**Apres**: `model: "claude-sonnet-4-20250514"`

**Trade-off**: +$0.003/requete, mais detection des violations beaucoup plus fiable. Haiku rate des violations subtiles (ton condescendant, critique implicite deguisee).

Alternative si le cout est un souci: garder Haiku mais ajouter des checks programmatiques cote serveur (comme dans eval/checks.js) en complement.

**Decision**: utiliser Sonnet pour le critic. Le cout marginal est negligeable compare au gain de fidelite.

### 3.2 Fixer le check `vouvoiement`

**Fichier**: `eval/checks.js:153`

**Probleme**: les regex `\b` ne gerent pas bien les mots francais. `/\btu\b/` matche dans "structure", "statue", etc. car `\b` voit la frontiere entre lettre et non-lettre.

**Scope**: Ce check s'applique UNIQUEMENT au scenario "analyze" (prospection DM). En free-chat, Ahmet tutoie naturellement (cf. voice-dna.json: "Tutoiement systematique"). Le check recoit un param `scenario` pour filtrer.

**Solution**: utiliser des lookbehind/lookahead plus stricts, et ne verifier que dans le bloc `<dm>`.

```js
export function vouvoiement(response, params) {
  // This check only applies to analyze scenario DMs
  if (params?.scenario && params.scenario !== "analyze") {
    return { pass: true };
  }

  // Only check inside <dm> block — outside it, tutoiement is fine
  const dmMatch = response.match(/<dm>([\s\S]*?)<\/dm>/);
  if (!dmMatch) return { pass: true }; // No DM block = nothing to check
  const lower = dmMatch[1].toLowerCase();

  // Match tutoiement only as standalone pronouns/determiners
  // Preceded by space/start, followed by space/punctuation/end
  const tuPatterns = [
    /(?:^|[\s,;.!?'"(])tu(?=[\s,;.!?'")\n]|$)/m,
    /(?:^|[\s,;.!?'"(])ton(?=[\s,;.!?'")\n]|$)/m,
    /(?:^|[\s,;.!?'"(])ta(?=[\s,;.!?'")\n]|$)/m,
    /(?:^|[\s,;.!?'"(])tes(?=[\s,;.!?'")\n]|$)/m,
    /(?:^|[\s,;.!?'"(])toi(?=[\s,;.!?'")\n]|$)/m,
  ];

  for (const pat of tuPatterns) {
    if (pat.test(lower)) {
      return { pass: false, detail: `found tutoiement in DM` };
    }
  }
  return { pass: true };
}
```

### 3.3 Parser dynamiquement les mots interdits

**Fichier**: `eval/checks.js` — remplacer les listes hardcodees

Au lieu de hardcoder `FORBIDDEN_WORDS`, les charger depuis `context/voice-dna.json` au demarrage de l'eval.

```js
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadVoiceDNA() {
  const raw = readFileSync(join(__dirname, "..", "context", "voice-dna.json"), "utf-8");
  const dna = JSON.parse(raw);
  const v = dna.voice_dna;

  // Handle entries like "tips / astuces / hacks - registre trop superficiel"
  // Split on " - " first to remove the explanation, then split on " / " to get individual words
  const forbiddenWords = v.language_patterns.words_to_avoid.flatMap(entry => {
    const word = entry.split(" - ")[0].trim();
    // If the word part contains " / ", split into individual words
    if (word.includes(" / ")) {
      return word.split(" / ").map(w => w.trim());
    }
    return [word];
  });

  const forbiddenPhrases = v.never_say.phrases.map(p => p.split(" - ")[0].trim());

  return { forbiddenWords, forbiddenPhrases };
}

const { forbiddenWords: FORBIDDEN_WORDS, forbiddenPhrases: FORBIDDEN_PHRASES } = loadVoiceDNA();
```

**Note**: Ce code ne doit tourner que dans l'eval runner (Node.js CLI). Si `eval/checks.js` est importe cote serveur (Vercel), le `__dirname` ne fonctionnera pas. Utiliser `process.cwd()` comme dans `api/chat.js` si necessaire.

Les AI_PATTERNS restent hardcodes (ils viennent du humanizer-rules.md, pas du voice-dna.json).

### 3.4 Ajouter un check `noMarkdown`

**Fichier**: `eval/checks.js` — nouveau check

Ahmet n'utilise jamais de bold, headers, ou bullet points markdown.

```js
export function noMarkdown(response) {
  // Allow <analysis>, <dm>, <transition> tags (those are ours)
  const cleaned = response
    .replace(/<analysis>[\s\S]*?<\/analysis>/g, "")
    .replace(/<dm>[\s\S]*?<\/dm>/g, "")
    .replace(/<transition>[\s\S]*?<\/transition>/g, "");

  if (/\*\*[^*]+\*\*/.test(cleaned)) {
    return { pass: false, detail: "found **bold** markdown" };
  }
  if (/^#{1,6}\s/m.test(cleaned)) {
    return { pass: false, detail: "found # header markdown" };
  }
  // Detect markdown bullets (- or *) but NOT arrow lists (→) which Ahmet uses
  if (/^[-*]\s/m.test(cleaned) && !/^→/m.test(cleaned)) {
    return { pass: false, detail: "found bullet list markdown" };
  }
  return { pass: true };
}
```

### 3.5 Ajouter des checks positifs dans l'eval

**Fichier**: `eval/checks.js` — nouveaux checks

```js
// Check that response uses at least one signature phrase pattern
const SIGNATURE_PATTERNS = [
  /ce n'est pas .+\. c'est/i,
  /en psychologie/i,
  /resultat \?/i,
  /r[ée]sultat \?/i,
  /ce m[ée]canisme/i,
];

export function usesSignatureStyle(response) {
  const text = normalize(response);
  const found = SIGNATURE_PATTERNS.some(pat => pat.test(text));
  if (!found) {
    return { pass: false, detail: "no signature phrase pattern detected" };
  }
  return { pass: true };
}

// Check response has Ahmet's paragraph structure (short paragraphs, lots of air)
export function shortParagraphs(response) {
  const paragraphs = response.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const longParagraphs = paragraphs.filter(p => p.split(/\n/).length > 4);
  if (longParagraphs.length > 0) {
    return { pass: false, detail: `${longParagraphs.length} paragraph(s) exceed 4 lines` };
  }
  return { pass: true };
}
```

Ces checks ne sont pas appliques a tous les cas. Le mecanisme de filtrage:
- Dans les test cases JSON, ajouter un champ `_meta.substantive: true` pour les cas qui doivent verifier le style signature
- `usesSignatureStyle` et `shortParagraphs` ne sont ajoutes comme checks que pour les cas avec `_meta.substantive: true`
- En pratique: les cas greeting, adversarial, et AI-detection n'ont PAS `_meta.substantive`
- Les cas thematiques (oral, coaching, pouvoir) ONT `_meta.substantive`

---

## Iteration 4 — Code Quality & Maintenabilite

### 4.1 Restructurer le backend en modules

**Structure cible**:
```
api/
  chat.js          → handler HTTP (slim, ~80 lignes)
  verify.js        → endpoint de verification (iteration 1)
  _rateLimit.js    → rate limiter (iteration 1)
lib/
  prompt.js        → buildSystemPrompt, buildKnowledgeContext, detectRelevantPages
  critic.js        → criticCheck
  sse.js           → helpers SSE (writeEvent, writeError)
  validate.js      → validateInput
```

**Fichier `lib/prompt.js`**:
Extraire les fonctions `loadPage`, `TOPIC_MAP`, `detectRelevantPages`, `buildKnowledgeContext`, `buildSystemPrompt` de `api/chat.js`.

**Fichier `lib/critic.js`**:
Extraire `criticCheck` de `api/chat.js`.

**Fichier `lib/sse.js`**:
```js
export function writeEvent(res, type, data = {}) {
  res.write("data: " + JSON.stringify({ type, ...data }) + "\n\n");
}

export function writeError(res, message) {
  writeEvent(res, "error", { text: message });
  res.end();
}
```

**Fichier `lib/validate.js`**:
Extraire `validateInput` (cree en iteration 1).

**Resultat**: `api/chat.js` passe de ~330 lignes a ~80 lignes. Chaque module est testable independamment.

### 4.2 Nettoyer voice-dna.json

**Decision**: garder `context/voice-dna.json` comme source de verite pour les mots interdits (consomme par `eval/checks.js` via parsing dynamique, iteration 3). Ajouter un commentaire en tete du fichier documentant son role.

Supprimer les listes hardcodees de `eval/checks.js` qui sont maintenant parsees dynamiquement.

### 4.3 Endpoint health check

**Nouveau fichier**: `api/health.js`

```js
export default function handler(req, res) {
  // No env details exposed — health check is public
  res.status(200).json({
    status: "ok",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
  });
}
```

**Note**: Ne PAS exposer l'etat des variables d'environnement sur un endpoint public avec CORS `*`. L'info `accessCodeSet`/`anthropicKeySet` est utile en debug mais constitue une fuite d'info.

### 4.4 CORS headers explicites

**Fichier**: `api/chat.js` — ajouter en debut de handler:

```js
res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-access-code");

if (req.method === "OPTIONS") {
  res.status(200).end();
  return;
}
```

Meme chose pour `api/verify.js` et `api/health.js`.

---

## Iteration 5 — Eval Suite & Observabilite

### 5.1 Pointer l'eval vers localhost par defaut

**Fichier**: `eval/run.js:16`
**Avant**: `const API_URL = process.env.EVAL_API_URL || "https://ahmet-clone.vercel.app/api/chat";`
**Apres**: `const API_URL = process.env.EVAL_API_URL || "http://localhost:3001/api/chat";`

Port 3001 correspond a la config `.claude/launch.json` (`--port 3001`). Ceci evite de consommer des tokens prod accidentellement. Pour tester contre la prod, passer explicitement `EVAL_API_URL`.

### 5.2 Tester le critic separement

**Nouveau fichier**: `eval/cases/critic.json`

Cas de test pour valider que le critic detecte correctement les violations:

```json
[
  {
    "id": "critic-implicit-criticism",
    "name": "Critic detects implicit criticism",
    "input": "Je ne vois rien sur votre profil qui montre votre presence. C'est pourtant determinant, non ?",
    "expectedViolations": ["critique implicite", "question accusatrice"],
    "expectPass": false
  },
  {
    "id": "critic-clean-response",
    "name": "Critic accepts clean response",
    "input": "Vous pilotez des comites strategiques chez Airbus. Comment gerez-vous l'attention sur des sujets techniques complexes ?",
    "expectPass": true
  }
]
```

**Nouveau fichier**: `eval/run-critic.js` — appelle directement la fonction `criticCheck` sans passer par l'API.

### 5.3 Mettre a jour eval/run.js pour le header auth

**Fichier**: `eval/run.js:27`
Migrer de query param vers header (coherent avec iteration 1).

### 5.4 README.md

**Nouveau fichier**: `README.md`

Sections:
- Description du projet (2 lignes)
- Setup local (env vars, `npm install`, `npx vercel dev`)
- Architecture (schema du pipeline 3-pass)
- Knowledge base (structure des dossiers)
- Eval suite (comment lancer, interpreter les resultats)
- Deploiement (Vercel)

---

## Fichiers touches par iteration

| Iteration | Fichiers modifies | Fichiers crees |
|-----------|-------------------|----------------|
| 1 | api/chat.js, public/app.js, eval/run.js | api/verify.js, api/_rateLimit.js |
| 2 | api/chat.js, public/app.js, public/style.css | - |
| 3 | eval/checks.js, api/chat.js | - |
| 4 | api/chat.js | lib/prompt.js, lib/critic.js, lib/sse.js, lib/validate.js, api/health.js |
| 5 | eval/run.js | eval/cases/critic.json, eval/run-critic.js, README.md |

## Risques et mitigations

| Risque | Mitigation |
|--------|------------|
| Streaming pass 1 + critic = UX confuse si rewrite | Indicateur visuel "Ahmet affine..." + clear progressif |
| Rate limit in-memory reset a chaque cold start | Acceptable pour le stade dev/demo. Upgrader vers KV store si necessaire en prod |
| Sonnet comme critic = cout x10 vs Haiku | Marginal (~$0.003/req). Le gain de fidelite justifie le cout |
| Restructuration lib/ peut casser les imports Vercel | Vercel supporte les imports relatifs dans /lib. Tester localement avant deploy |
