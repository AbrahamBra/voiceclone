# VoiceClone White-Label Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Purge all Ahmet-specific content and rebuild the app as a white-label text clone framework with a demo persona ("Alex Renaud").

**Architecture:** Vercel serverless backend with 3-pass Claude pipeline (generate → critique → rewrite). Vanilla JS frontend SPA with 3 screens (access → scenario → chat). All persona config driven by a single `persona/persona.json` file + markdown knowledge base.

**Tech Stack:** Node.js ES modules, Vercel serverless, `@anthropic-ai/sdk`, vanilla HTML/CSS/JS, SSE streaming.

**Spec:** `docs/superpowers/specs/2026-04-11-voiceclone-whitelabel-rebuild-design.md`

---

## File Map

### Files to create (new)

| File | Responsibility |
|------|---------------|
| `persona/persona.json` | Source of truth: identity, voice rules, theme, scenarios |
| `persona/knowledge/topics/strategie-contenu.md` | Content strategy domain knowledge |
| `persona/knowledge/topics/storytelling.md` | Storytelling domain knowledge |
| `persona/scenarios/default.md` | Free chat scenario instructions |
| `persona/scenarios/audit.md` | Content audit scenario instructions |
| `lib/knowledge.js` | Scan knowledge files, build keyword index, resolve topic matches |
| `lib/pipeline.js` | 3-pass pipeline: generate, critique, rewrite |
| `api/config.js` | GET endpoint: access validation + public persona config |

### Files to rewrite from scratch

| File | Responsibility |
|------|---------------|
| `lib/prompt.js` | Build system prompt from persona.json + knowledge + scenario |
| `lib/validate.js` | Input validation adapted to new request format |
| `api/chat.js` | Chat endpoint using new pipeline module |
| `public/index.html` | Generic 3-screen SPA markup |
| `public/style.css` | Design system driven by theme config |
| `public/app.js` | Client logic: SSE, routing, screen transitions |
| `package.json` | Rename package, same deps |
| `README.md` | Framework documentation |
| `eval/run.js` | Unified test runner |
| `eval/checks.js` | Validation checks from persona.json rules |
| `eval/cases/free.json` | Free chat test cases |
| `eval/cases/audit.json` | Audit test cases |
| `eval/cases/critic.json` | Critic pipeline test cases |

### Files to keep as-is

| File | Responsibility |
|------|---------------|
| `lib/sse.js` | SSE stream helpers (13 lines, works perfectly) |
| `api/_rateLimit.js` | In-memory rate limiter (35 lines, works perfectly) |
| `vercel.json` | Vercel deployment config |

### Files/dirs to delete

| Path | Reason |
|------|--------|
| `knowledge/` | Entire dir — replaced by `persona/knowledge/` |
| `context/` | Entire dir — replaced by `persona/persona.json` |
| `lib/critic.js` | Merged into `lib/pipeline.js` |
| `api/verify.js` | Replaced by `api/config.js` |
| `eval/run-critic.js` | Merged into `eval/run.js` |
| `docs/superpowers/specs/2026-04-09-*` | Old Ahmet-specific specs |

---

## Chunk 1: Cleanup + Persona Foundation

### Task 1: Delete all Ahmet-specific content

**Files:**
- Delete: `knowledge/` (entire directory)
- Delete: `context/` (entire directory)
- Delete: `lib/critic.js`
- Delete: `api/verify.js`
- Delete: `eval/run-critic.js`
- Delete: `docs/superpowers/specs/2026-04-09-eval-suite-design.md`
- Delete: `docs/superpowers/specs/2026-04-09-global-improvement-design.md`
- Delete: `docs/superpowers/specs/2026-04-09-structured-logging-design.md`

- [ ] **Step 1: Delete old directories and files**

```bash
rm -rf knowledge/ context/
rm -f lib/critic.js api/verify.js eval/run-critic.js
rm -f docs/superpowers/specs/2026-04-09-eval-suite-design.md
rm -f docs/superpowers/specs/2026-04-09-global-improvement-design.md
rm -f docs/superpowers/specs/2026-04-09-structured-logging-design.md
```

- [ ] **Step 2: Verify no Ahmet references remain in kept files**

```bash
grep -ri "ahmet" lib/sse.js api/_rateLimit.js vercel.json
```

Expected: no output (no matches).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: delete all Ahmet-specific content and old specs"
```

---

### Task 2: Create persona.json

**Files:**
- Create: `persona/persona.json`

- [ ] **Step 1: Create the persona directory and write persona.json**

```json
{
  "name": "Alex Renaud",
  "title": "Expert en strategie de contenu & storytelling",
  "avatar": "AR",
  "description": "Aide les entrepreneurs a transformer leur expertise en contenu qui attire des clients. 12 ans d'experience, 150+ entrepreneurs accompagnes.",

  "voice": {
    "tone": ["Direct", "Pedagogique", "Pragmatique"],
    "personality": ["Stratege patient", "Anti-bullshit", "Genereux en frameworks"],
    "signaturePhrases": [
      "Le contenu n'est pas une fin. C'est un filtre.",
      "Si ton audience ne peut pas te resumer en une phrase, t'as un probleme de positionnement.",
      "La regularite bat la viralite. Toujours."
    ],
    "forbiddenWords": ["game changer", "disruptif", "hacks", "tips", "booster", "mindset", "impactant", "leverage", "scalable"],
    "neverDoes": [
      "Points d'exclamation excessifs",
      "Tutoiement non sollicite",
      "Jargon startup",
      "Promesses de resultats garantis",
      "Formules creuses sans exemple concret"
    ],
    "writingRules": [
      "Phrases courtes. Paragraphes de 2-3 lignes max.",
      "Toujours illustrer avec un exemple concret.",
      "Poser une question avant de donner un conseil.",
      "Utiliser des frameworks nommes (methode PESO, content flywheel, etc.).",
      "Vouvoyer par defaut sauf si le prospect tutoie d'abord."
    ]
  },

  "scenarios": {
    "default": {
      "label": "Discussion libre",
      "description": "Echangez librement avec {name}",
      "file": "scenarios/default.md"
    },
    "audit": {
      "label": "Audit de contenu",
      "description": "{name} analyse votre strategie de contenu",
      "file": "scenarios/audit.md"
    }
  },

  "theme": {
    "accent": "#2563eb",
    "background": "#0a0a0a",
    "surface": "#141414",
    "text": "#e5e5e5"
  }
}
```

- [ ] **Step 2: Validate JSON is parseable**

```bash
node -e "JSON.parse(require('fs').readFileSync('persona/persona.json','utf-8')); console.log('Valid JSON')"
```

Expected: `Valid JSON`

- [ ] **Step 3: Commit**

```bash
git add persona/persona.json
git commit -m "feat: add persona.json for Alex Renaud demo persona"
```

---

### Task 3: Create knowledge base files

**Files:**
- Create: `persona/knowledge/topics/strategie-contenu.md`
- Create: `persona/knowledge/topics/storytelling.md`
- Create: `persona/scenarios/default.md`
- Create: `persona/scenarios/audit.md`

- [ ] **Step 1: Create strategie-contenu.md**

Write `persona/knowledge/topics/strategie-contenu.md`:

```markdown
---
keywords: ["contenu", "strategie", "content", "editorial", "publication", "blog", "newsletter", "article", "calendrier", "pilier", "peso", "distribution"]
---

# Strategie de contenu

## Le content flywheel (roue de contenu)

Le contenu n'est pas une liste de posts. C'est un systeme.

Le flywheel fonctionne en 3 temps :
1. **Creer** — Un pilier de contenu long (article, video, podcast)
2. **Decouper** — Extraire 5-10 micro-contenus du pilier (posts LinkedIn, tweets, carousels)
3. **Distribuer** — Chaque micro-contenu renvoie vers le pilier original

L'objectif : chaque piece de contenu alimente la suivante. Pas de contenu orphelin.

## La methode PESO

Quatre canaux de distribution, chacun avec son role :

- **Paid** (publicite) — Accelerer la visibilite sur du contenu deja valide organiquement. Ne jamais promouvoir du contenu qui n'a pas marche en organique.
- **Earned** (mentions, PR) — Se construire en etant cite par d'autres. La credibilite se gagne, elle ne s'achete pas.
- **Shared** (reseaux sociaux) — LinkedIn, Twitter, YouTube. Le canal principal pour les experts independants.
- **Owned** (site, newsletter) — Le seul canal qu'on possede vraiment. Tout le reste est loue.

## Le contenu pilier

Un contenu pilier est un contenu long (1500+ mots ou 15+ minutes) qui couvre un sujet en profondeur. C'est la fondation du flywheel.

Criteres d'un bon pilier :
- Repond a une question que votre audience pose vraiment
- Demontre votre expertise par la profondeur, pas par le jargon
- Peut etre decoupe en minimum 5 micro-contenus
- A une duree de vie longue (evergreen)

## Frequence et regularite

La regularite bat la viralite. Toujours.

Un post par semaine pendant un an > un post viral suivi de trois mois de silence.

Recommandation minimum :
- 2 posts LinkedIn par semaine
- 1 newsletter par mois
- 1 contenu pilier par mois
```

- [ ] **Step 2: Create storytelling.md**

Write `persona/knowledge/topics/storytelling.md`:

```markdown
---
keywords: ["storytelling", "histoire", "narration", "hook", "accroche", "linkedin", "post", "format", "ecrire", "rediger", "copywriting"]
---

# Storytelling pour le contenu business

## La structure narrative en 4 temps

Toute bonne histoire business suit cette structure :

1. **Le hook** — Une phrase qui arrete le scroll. Pas de question generique. Une affirmation forte ou une situation concrete.
2. **La tension** — Le probleme, le conflit, ce qui ne marchait pas. C'est la ou l'audience se reconnait.
3. **Le pivot** — Le moment de bascule. Ce que vous avez compris, decouvert, change.
4. **La lecon** — L'enseignement actionnable. Pas une morale vague, un conseil precis.

## Les hooks qui fonctionnent sur LinkedIn

Les hooks efficaces ont un point commun : ils creent un ecart entre ce que l'audience croit et ce qui est vrai.

Formules eprouvees :
- "J'ai fait [X] pendant [Y] ans. Voici ce que personne ne dit."
- "On m'a demande [question]. Ma reponse a surpris."
- "[Chiffre precis] + [resultat inattendu]"
- "Arretez de [conseil classique]. Faites [alternative] a la place."

Ce qui ne fonctionne jamais :
- "Dans cet article, je vais vous expliquer..." (promesse vide)
- Questions generiques ("Vous voulez reussir ?")
- Citations d'autres personnes en ouverture

## Transformer l'expertise en histoire

L'erreur classique : ecrire comme un prof. "Les 5 piliers du marketing de contenu."

La correction : ecrire comme un praticien. "Le jour ou j'ai perdu mon plus gros client, j'ai compris que mon contenu ne servait a rien."

Regle : toujours commencer par le concret (une situation, un chiffre, un dialogue) avant d'aller vers le concept.

## Formats LinkedIn qui convertissent

Par ordre d'efficacite pour les experts :
1. **Le recit personnel** — Votre experience + la lecon. Le format roi.
2. **Le carousel** — 8-12 slides, une idee par slide, CTA en fin.
3. **Le framework** — Une methode nommee avec des etapes claires.
4. **Le contrarian** — Prendre le contre-pied d'un conseil populaire. Avec preuves.
```

- [ ] **Step 3: Create default.md scenario**

Write `persona/scenarios/default.md`:

```markdown
# Scenario : Discussion libre

Tu es Alex Renaud, expert en strategie de contenu et storytelling.

## Regles de conversation

1. **Toujours poser une question avant de donner un conseil.** Comprendre le contexte avant de prescrire.
2. **Illustrer chaque conseil avec un exemple concret.** Pas de theorie sans pratique.
3. **Utiliser tes frameworks naturellement** (methode PESO, content flywheel, structure narrative en 4 temps). Ne pas les forcer si le sujet ne s'y prete pas.
4. **Rester dans ton domaine d'expertise.** Si la question sort du contenu/storytelling/strategie editoriale, le dire honnetement et rediriger.
5. **Vouvoyer par defaut.** Passer au tutoiement uniquement si l'interlocuteur tutoie d'abord.
6. **Etre direct et pragmatique.** Pas de langue de bois, pas de compliments vides.
7. **Repondre en francais** sauf si l'interlocuteur ecrit en anglais.

## Ton

Direct mais bienveillant. Tu dis les choses comme elles sont, sans agressivite. Tu es genereux en conseils concrets. Tu detestes le jargon creux et les formules toutes faites.

## Longueur des reponses

- Reponses courtes pour les questions simples (2-4 phrases)
- Reponses structurees pour les questions complexes (paragraphes courts, listes si pertinent)
- Jamais plus de 300 mots sauf demande explicite
```

- [ ] **Step 4: Create audit.md scenario**

Write `persona/scenarios/audit.md`:

```markdown
# Scenario : Audit de contenu

Tu es Alex Renaud. L'utilisateur va te presenter sa strategie de contenu (profil LinkedIn, site web, newsletter, etc.) et tu vas l'auditer.

## Grille d'audit

Evalue sur 5 criteres, chacun note de 1 a 5 :

### 1. Positionnement (1-5)
- L'expertise est-elle claire en 5 secondes ?
- Y a-t-il une promesse de valeur concrete ?
- Le positionnement est-il differenciant ?

### 2. Regularite (1-5)
- Quelle est la frequence de publication ?
- Y a-t-il un calendrier editorial visible ?
- La regularite est-elle maintenue dans le temps ?

### 3. Diversite de formats (1-5)
- Utilise-t-il plusieurs formats (texte, carousel, video, newsletter) ?
- Les formats sont-ils adaptes a l'audience cible ?
- Y a-t-il un contenu pilier qui alimente les micro-contenus ?

### 4. Engagement (1-5)
- Les contenus generent-ils des commentaires qualitatifs ?
- Y a-t-il des conversations dans les commentaires ?
- Le taux d'engagement est-il coherent avec la taille de l'audience ?

### 5. Conversion (1-5)
- Y a-t-il un chemin clair du contenu vers l'offre ?
- Les CTA sont-ils presents et naturels ?
- Le contenu attire-t-il les bons profils (prospects qualifies) ?

## Format de reponse

Presente l'audit ainsi :

```
AUDIT DE CONTENU — [Nom/Profil]
Score global : XX/25

1. Positionnement : X/5 — [commentaire]
2. Regularite : X/5 — [commentaire]
3. Diversite : X/5 — [commentaire]
4. Engagement : X/5 — [commentaire]
5. Conversion : X/5 — [commentaire]

TOP 3 RECOMMANDATIONS :
1. [action concrete]
2. [action concrete]
3. [action concrete]
```

## Regles

- Etre honnetement critique. Un 5/5 est exceptionnel, ne pas le donner par politesse.
- Chaque note doit etre justifiee par un element observable.
- Les recommandations doivent etre actionnables (pas "ameliorez votre contenu" mais "publiez un carousel par semaine sur votre methode X").
- Demander des precisions si l'information est insuffisante pour noter.
```

- [ ] **Step 5: Create empty placeholder directories from spec**

```bash
mkdir -p persona/knowledge/concepts persona/knowledge/sources
touch persona/knowledge/concepts/.gitkeep persona/knowledge/sources/.gitkeep
```

- [ ] **Step 6: Commit**

```bash
git add persona/
git commit -m "feat: add Alex Renaud knowledge base and scenarios"
```

---

## Chunk 2: Backend Core (lib/ modules)

### Task 4: Create lib/knowledge.js

**Files:**
- Create: `lib/knowledge.js`

This module scans `persona/knowledge/` at startup, parses YAML frontmatter from each `.md` file, builds a keyword→file index, and exports a function to find relevant files for a given message.

- [ ] **Step 1: Write lib/knowledge.js**

```javascript
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const PERSONA_DIR = join(process.cwd(), "persona");
const KNOWLEDGE_DIR = join(PERSONA_DIR, "knowledge");

// Parse YAML frontmatter (simple: only handles keywords array)
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { keywords: [], body: content };

  const yaml = match[1];
  const keywordsMatch = yaml.match(/keywords:\s*\[(.*?)\]/);
  if (!keywordsMatch) return { keywords: [], body: content.slice(match[0].length).trim() };

  const keywords = keywordsMatch[1]
    .split(",")
    .map((k) => k.trim().replace(/^["']|["']$/g, "").toLowerCase())
    .filter(Boolean);

  return { keywords, body: content.slice(match[0].length).trim() };
}

// Normalize text for matching (remove accents)
function normalize(text) {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Recursively find all .md files in a directory
function findMarkdownFiles(dir) {
  const files = [];
  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        files.push(...findMarkdownFiles(fullPath));
      } else if (entry.endsWith(".md")) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist — fine
  }
  return files;
}

// Build keyword index at module load time
const keywordIndex = []; // { keywords: string[], path: string, content: string }

for (const filePath of findMarkdownFiles(KNOWLEDGE_DIR)) {
  const raw = readFileSync(filePath, "utf-8");
  const { keywords, body } = parseFrontmatter(raw);
  if (keywords.length > 0) {
    keywordIndex.push({
      keywords: keywords.map(normalize),
      path: relative(PERSONA_DIR, filePath),
      content: body,
    });
  }
}

/**
 * Find knowledge files relevant to the user's recent messages.
 * Returns array of { path, content } for matched files.
 */
export function findRelevantKnowledge(messages) {
  const text = normalize(
    messages
      .slice(-6)
      .map((m) => m.content)
      .join(" ")
  );

  const matched = [];
  for (const entry of keywordIndex) {
    if (entry.keywords.some((kw) => text.includes(kw))) {
      matched.push({ path: entry.path, content: entry.content });
    }
  }
  return matched;
}

/**
 * Load a file from the persona directory by relative path.
 */
export function loadPersonaFile(relativePath) {
  try {
    return readFileSync(join(PERSONA_DIR, relativePath), "utf-8");
  } catch {
    return null;
  }
}

/**
 * Load and parse persona.json.
 */
let _persona = null;
export function getPersona() {
  if (!_persona) {
    _persona = JSON.parse(readFileSync(join(PERSONA_DIR, "persona.json"), "utf-8"));
  }
  return _persona;
}
```

- [ ] **Step 2: Verify module loads without error**

```bash
node -e "import('./lib/knowledge.js').then(m => { console.log('Index entries:', m.findRelevantKnowledge([{content:'contenu strategie'}]).length); console.log('Persona:', m.getPersona().name) })"
```

Expected: `Index entries: 1` and `Persona: Alex Renaud`

- [ ] **Step 3: Commit**

```bash
git add lib/knowledge.js
git commit -m "feat: add knowledge.js — keyword index + persona loader"
```

---

### Task 5: Rewrite lib/prompt.js

**Files:**
- Rewrite: `lib/prompt.js`

Builds the system prompt dynamically from persona.json + knowledge matches + scenario file.

- [ ] **Step 1: Write lib/prompt.js**

```javascript
import { getPersona, findRelevantKnowledge, loadPersonaFile } from "./knowledge.js";

/**
 * Build the complete system prompt for a chat request.
 * @param {string} scenario - Scenario key from persona.json
 * @param {Array} messages - Conversation history
 * @returns {{ prompt: string, detectedPages: string[] }}
 */
export function buildSystemPrompt(scenario, messages) {
  const persona = getPersona();
  const v = persona.voice;

  // Identity block
  let prompt = `Tu es ${persona.name}, ${persona.title}.\n`;
  prompt += `${persona.description}\n\n`;

  // Voice rules
  prompt += "REGLES DE VOIX :\n";
  prompt += `- Ton : ${v.tone.join(", ")}\n`;
  prompt += `- Personnalite : ${v.personality.join(", ")}\n`;
  prompt += `- Phrases signatures a utiliser naturellement : ${v.signaturePhrases.map((p) => `"${p}"`).join(" | ")}\n`;
  prompt += `- Mots INTERDITS (ne jamais utiliser) : ${v.forbiddenWords.join(", ")}\n`;
  prompt += `- Ne jamais faire : ${v.neverDoes.join(" ; ")}\n`;
  prompt += `- Regles d'ecriture : ${v.writingRules.join(" ; ")}\n\n`;

  // Knowledge context
  const knowledgeMatches = findRelevantKnowledge(messages);
  const detectedPages = knowledgeMatches.map((m) => m.path);
  if (knowledgeMatches.length > 0) {
    prompt += "BASE DE CONNAISSANCE — CONTEXTE DETECTE :\n";
    prompt += knowledgeMatches.map((m) => m.content).join("\n\n---\n\n");
    prompt += "\n\n";
  }

  // Scenario instructions
  const scenarioConfig = persona.scenarios[scenario] || persona.scenarios.default;
  if (scenarioConfig?.file) {
    const scenarioContent = loadPersonaFile(scenarioConfig.file);
    if (scenarioContent) {
      prompt += "INSTRUCTIONS DU SCENARIO :\n" + scenarioContent + "\n";
    }
  }

  return { prompt, detectedPages };
}
```

- [ ] **Step 2: Verify prompt builds correctly**

```bash
node -e "
import { buildSystemPrompt } from './lib/prompt.js';
const result = buildSystemPrompt('default', [{ role: 'user', content: 'Comment creer du contenu efficace ?' }]);
console.log('Has identity:', result.prompt.includes('Alex Renaud'));
console.log('Has forbidden words:', result.prompt.includes('game changer'));
console.log('Has knowledge:', result.detectedPages.length > 0);
console.log('Has scenario:', result.prompt.includes('INSTRUCTIONS DU SCENARIO'));
"
```

Expected: all `true`

- [ ] **Step 3: Commit**

```bash
git add lib/prompt.js
git commit -m "feat: rewrite prompt.js — dynamic system prompt from persona config"
```

---

### Task 6: Create lib/pipeline.js

**Files:**
- Create: `lib/pipeline.js`

The 3-pass pipeline: generate (streaming), critique, rewrite (streaming). Replaces the old inline logic in chat.js + lib/critic.js.

- [ ] **Step 1: Write lib/pipeline.js**

```javascript
import Anthropic from "@anthropic-ai/sdk";
import { getPersona } from "./knowledge.js";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";

/**
 * Run the critic check against persona voice rules.
 * @param {Anthropic} client
 * @param {string} responseText - The generated response to check
 * @returns {{ pass: boolean, violations: string[], error: boolean }}
 */
export async function criticCheck(client, responseText) {
  const persona = getPersona();
  const v = persona.voice;

  const rules = [
    `Mots interdits : ${v.forbiddenWords.join(", ")}`,
    `Regles d'ecriture : ${v.writingRules.join(" ; ")}`,
    `Ne jamais faire : ${v.neverDoes.join(" ; ")}`,
  ].join("\n");

  try {
    const result = await client.messages.create({
      model: MODEL,
      max_tokens: 256,
      system: [
        "Tu es un reviewer strict. Voici les regles a verifier :",
        "",
        rules,
        "",
        "Verifie si le message suivant viole une ou plusieurs de ces regles.",
        'Reponds UNIQUEMENT en JSON valide :',
        '{"pass": true} si aucune violation',
        '{"pass": false, "violations": ["description de chaque violation"]} si violation(s)',
      ].join("\n"),
      messages: [{ role: "user", content: responseText }],
    });

    const raw = result.content[0].text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { pass: true, violations: [], error: false };

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      pass: parsed.pass === true,
      violations: Array.isArray(parsed.violations) ? parsed.violations : [],
      error: false,
    };
  } catch {
    return { pass: true, violations: [], error: true };
  }
}

/**
 * Run the full 3-pass pipeline.
 * @param {object} opts
 * @param {string} opts.systemPrompt - Built by prompt.js
 * @param {Array} opts.messages - Trimmed conversation history
 * @param {Function} opts.sse - SSE send function from sse.js
 * @param {object} opts.res - HTTP response (for keep-alive writes)
 * @returns {Promise<{ pass1Text: string, criticResult: object, rewritten: boolean }>}
 */
export async function runPipeline({ systemPrompt, messages, sse, res }) {
  const client = new Anthropic();
  const t0 = Date.now();

  // === PASS 1: Generate (streaming) ===
  sse("thinking");
  const stream1 = client.messages.stream({
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  let pass1Text = "";
  stream1.on("text", (text) => {
    pass1Text += text;
    sse("delta", { text });
  });

  await stream1.finalMessage();
  const t1 = Date.now();

  // === PASS 2: Critique (with keep-alive) ===
  sse("validating");
  const keepAlive = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 5000);

  const verdict = await criticCheck(client, pass1Text);
  clearInterval(keepAlive);
  const t2 = Date.now();

  if (verdict.pass) {
    sse("done");
    console.log(JSON.stringify({
      event: "chat_complete", ts: new Date().toISOString(),
      totalMs: Date.now() - t0,
      pass1: { ms: t1 - t0 },
      critic: { ms: t2 - t1, pass: true, violations: [], error: verdict.error },
      pass3: { triggered: false },
    }));
    return { pass1Text, criticResult: verdict, rewritten: false };
  }

  // === PASS 3: Rewrite (streaming) ===
  sse("rewriting");
  sse("clear");

  const violationFeedback = verdict.violations.join("\n- ");
  const stream3 = client.messages.stream({
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      ...messages,
      { role: "assistant", content: pass1Text },
      {
        role: "user",
        content: `SYSTEME INTERNE — AUTOCRITIQUE :\nTon message precedent viole ces regles :\n- ${violationFeedback}\n\nReecris ton message en corrigeant ces violations. Garde le meme intent et la meme longueur.\nReponds UNIQUEMENT avec le message corrige, rien d'autre.`,
      },
    ],
  });

  return new Promise((resolve, reject) => {
    stream3.on("text", (text) => {
      sse("delta", { text });
    });
    stream3.on("end", () => {
      sse("done");
      const t3 = Date.now();
      console.log(JSON.stringify({
        event: "chat_complete", ts: new Date().toISOString(),
        totalMs: t3 - t0,
        pass1: { ms: t1 - t0 },
        critic: { ms: t2 - t1, pass: false, violations: verdict.violations, error: false },
        pass3: { triggered: true, ms: t3 - t2 },
      }));
      resolve({ pass1Text, criticResult: verdict, rewritten: true });
    });
    stream3.on("error", (err) => {
      // Graceful degradation: pass 1 response is already shown
      sse("done");
      reject(err);
    });
  });
}
```

- [ ] **Step 2: Verify module imports cleanly**

```bash
node -e "import('./lib/pipeline.js').then(() => console.log('pipeline.js loads OK'))"
```

Expected: `pipeline.js loads OK`

- [ ] **Step 3: Commit**

```bash
git add lib/pipeline.js
git commit -m "feat: add pipeline.js — 3-pass generate/critique/rewrite"
```

---

### Task 7: Rewrite lib/validate.js

**Files:**
- Rewrite: `lib/validate.js`

Adapted for the new request format: `{ message, history, scenario }` instead of `{ scenario, messages, profileText }`.

- [ ] **Step 1: Write lib/validate.js**

```javascript
export function validateInput(body) {
  const { message, history, scenario } = body || {};

  if (typeof message !== "string" || message.length === 0 || message.length > 10000) {
    return "message must be a non-empty string under 10000 chars";
  }

  if (typeof scenario !== "string" || scenario.length === 0) {
    return "scenario is required";
  }

  if (!Array.isArray(history)) {
    return "history must be an array";
  }

  if (history.length > 20) {
    return "history must contain at most 20 messages";
  }

  for (const msg of history) {
    if (!msg.role || !["user", "assistant"].includes(msg.role)) {
      return "Each history message must have role 'user' or 'assistant'";
    }
    if (typeof msg.content !== "string" || msg.content.length === 0 || msg.content.length > 10000) {
      return "Each history message content must be a non-empty string under 10000 chars";
    }
  }

  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/validate.js
git commit -m "feat: rewrite validate.js for new request format"
```

---

## Chunk 3: API Endpoints

### Task 8: Create api/config.js

**Files:**
- Create: `api/config.js`

GET endpoint that serves as both access validation and public persona config delivery.

- [ ] **Step 1: Write api/config.js**

```javascript
import { getPersona } from "../lib/knowledge.js";

const ACCESS_CODE = process.env.ACCESS_CODE;

export default function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-access-code");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (!ACCESS_CODE) { res.status(500).json({ error: "Server misconfigured: ACCESS_CODE not set" }); return; }

  // Auth
  if (req.headers["x-access-code"] !== ACCESS_CODE) {
    res.status(403).json({ error: "Invalid access code" });
    return;
  }

  const persona = getPersona();

  // Build public config (strip voice and file paths)
  const scenarios = {};
  for (const [key, val] of Object.entries(persona.scenarios)) {
    scenarios[key] = {
      label: val.label,
      description: val.description.replace(/\{name\}/g, persona.name),
    };
  }

  res.json({
    name: persona.name,
    title: persona.title,
    avatar: persona.avatar,
    description: persona.description,
    scenarios,
    theme: persona.theme,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add api/config.js
git commit -m "feat: add api/config.js — access validation + public persona config"
```

---

### Task 9: Rewrite api/chat.js

**Files:**
- Rewrite: `api/chat.js`

Simplified: uses pipeline.js for the 3-pass logic.

- [ ] **Step 1: Write api/chat.js**

```javascript
import { rateLimit } from "./_rateLimit.js";
import { buildSystemPrompt } from "../lib/prompt.js";
import { runPipeline } from "../lib/pipeline.js";
import { initSSE } from "../lib/sse.js";
import { validateInput } from "../lib/validate.js";

const ACCESS_CODE = process.env.ACCESS_CODE;

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-access-code");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (!ACCESS_CODE) { res.status(500).json({ error: "Server misconfigured: ACCESS_CODE not set" }); return; }

  // Rate limiting
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  const rl = rateLimit(ip);
  if (!rl.allowed) { res.status(429).json({ error: "Too many requests", retryAfter: rl.retryAfter }); return; }

  // Auth
  if (req.headers["x-access-code"] !== ACCESS_CODE) {
    res.status(403).json({ error: "Code d'acces invalide" });
    return;
  }

  // Validation
  const validationError = validateInput(req.body);
  if (validationError) { res.status(400).json({ error: validationError }); return; }

  const { message, history, scenario } = req.body;

  // Build messages array for Claude (max 20 total: 19 history + 1 current)
  const messages = [...history.slice(-19), { role: "user", content: message }];
  const { prompt: systemPrompt } = buildSystemPrompt(scenario, messages);

  const sse = initSSE(res);

  try {
    await runPipeline({ systemPrompt, messages, sse, res });
    res.end();
  } catch (err) {
    console.log(JSON.stringify({
      event: "chat_error", ts: new Date().toISOString(),
      scenario, error: err.message || "Unknown error",
    }));
    if (res.headersSent) {
      sse("error", { text: "Erreur de generation" });
      res.end();
    } else {
      res.status(500).json({ error: "Erreur serveur : " + err.message });
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add api/chat.js
git commit -m "feat: rewrite chat.js — uses pipeline module, new request format"
```

---

### Task 10: Rewrite api/health.js

**Files:**
- Rewrite: `api/health.js`

- [ ] **Step 1: Write api/health.js**

```javascript
export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json({ status: "ok", timestamp: new Date().toISOString() });
}
```

- [ ] **Step 2: Commit**

```bash
git add api/health.js
git commit -m "feat: rewrite health.js — simple health check"
```

---

## Chunk 4: Frontend

### Task 11: Write public/index.html

**Files:**
- Rewrite: `public/index.html`

Generic 3-screen SPA. All persona info loaded dynamically from `/api/config`. Zero hardcoded names or branding.

- [ ] **Step 1: Write public/index.html**

```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Clone IA</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <!-- Screen 1: Access -->
  <div id="screen-access" class="screen active">
    <div class="access-card">
      <div class="access-avatar" id="access-avatar"></div>
      <h1 id="access-name"></h1>
      <p id="access-title" class="subtitle"></p>
      <div class="access-form">
        <input type="password" id="access-code" placeholder="Code d'acces" autocomplete="off">
        <button id="access-btn">Entrer</button>
      </div>
      <p id="access-error" class="error hidden"></p>
    </div>
  </div>

  <!-- Screen 2: Scenario selection -->
  <div id="screen-scenarios" class="screen">
    <div class="scenarios-container">
      <h2>Choisissez un mode</h2>
      <div id="scenario-cards" class="scenario-cards"></div>
    </div>
  </div>

  <!-- Screen 3: Chat -->
  <div id="screen-chat" class="screen">
    <header class="chat-header">
      <div class="chat-avatar" id="chat-avatar"></div>
      <span class="chat-name" id="chat-name"></span>
    </header>
    <div id="chat-messages" class="chat-messages"></div>
    <div class="chat-input-bar">
      <textarea id="chat-input" placeholder="Votre message..." rows="1"></textarea>
      <button id="chat-send">Envoyer</button>
    </div>
    <div id="chat-toast" class="toast hidden"></div>
  </div>

  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat: rewrite index.html — generic 3-screen SPA"
```

---

### Task 12: Write public/style.css

**Files:**
- Rewrite: `public/style.css`

Design system driven by CSS custom properties set from persona theme config.

- [ ] **Step 1: Write public/style.css**

```css
/* ============================================================
   DESIGN SYSTEM — Driven by --accent, --bg, --surface, --text
   Set dynamically from persona.json theme via app.js
   ============================================================ */

:root {
  --accent: #2563eb;
  --bg: #0a0a0a;
  --surface: #141414;
  --text: #e5e5e5;
  --text-muted: #888;
  --radius: 12px;
  --max-width: 640px;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100dvh;
}

/* Screens */
.screen { display: none; min-height: 100dvh; }
.screen.active { display: flex; }

/* ---- Screen 1: Access ---- */
#screen-access {
  align-items: center;
  justify-content: center;
}

.access-card {
  text-align: center;
  padding: 2rem;
  max-width: 360px;
  width: 100%;
}

.access-avatar {
  width: 72px; height: 72px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--bg);
  display: flex; align-items: center; justify-content: center;
  font-size: 1.5rem; font-weight: 700;
  margin: 0 auto 1.5rem;
}

.access-card h1 {
  font-size: 1.5rem;
  font-weight: 600;
  margin-bottom: 0.25rem;
}

.subtitle {
  color: var(--text-muted);
  font-size: 0.9rem;
  margin-bottom: 2rem;
}

.access-form {
  display: flex;
  gap: 0.5rem;
}

.access-form input {
  flex: 1;
  padding: 0.75rem 1rem;
  background: var(--surface);
  border: 1px solid #333;
  border-radius: var(--radius);
  color: var(--text);
  font-size: 0.95rem;
  outline: none;
  transition: border-color 0.2s;
}

.access-form input:focus {
  border-color: var(--accent);
}

.access-form button, #chat-send {
  padding: 0.75rem 1.25rem;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius);
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.access-form button:hover, #chat-send:hover {
  opacity: 0.85;
}

.error {
  color: #ef4444;
  font-size: 0.85rem;
  margin-top: 0.75rem;
}

.hidden { display: none; }

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-6px); }
  40%, 80% { transform: translateX(6px); }
}

.shake { animation: shake 0.4s ease-in-out; }

/* ---- Screen 2: Scenarios ---- */
#screen-scenarios {
  align-items: center;
  justify-content: center;
}

.scenarios-container {
  text-align: center;
  padding: 2rem;
  max-width: 500px;
  width: 100%;
}

.scenarios-container h2 {
  font-size: 1.25rem;
  margin-bottom: 1.5rem;
}

.scenario-cards {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.scenario-card {
  background: var(--surface);
  border: 1px solid #222;
  border-radius: var(--radius);
  padding: 1.25rem;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.2s, transform 0.15s;
}

.scenario-card:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
}

.scenario-card h3 {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 0.25rem;
}

.scenario-card p {
  font-size: 0.85rem;
  color: var(--text-muted);
}

/* ---- Screen 3: Chat ---- */
#screen-chat {
  flex-direction: column;
  height: 100dvh;
}

.chat-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid #222;
  background: var(--surface);
}

.chat-avatar {
  width: 36px; height: 36px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--bg);
  display: flex; align-items: center; justify-content: center;
  font-size: 0.85rem; font-weight: 700;
}

.chat-name {
  font-weight: 600;
  font-size: 0.95rem;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.msg {
  max-width: 85%;
  padding: 0.75rem 1rem;
  border-radius: var(--radius);
  font-size: 0.93rem;
  line-height: 1.5;
  animation: fadeIn 0.2s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.msg-user {
  align-self: flex-end;
  background: var(--accent);
  color: #fff;
  border-bottom-right-radius: 4px;
}

.msg-bot {
  align-self: flex-start;
  background: var(--surface);
  border: 1px solid #222;
  border-bottom-left-radius: 4px;
}

.msg-bot .status {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-top: 0.5rem;
  font-style: italic;
}

.chat-input-bar {
  display: flex;
  gap: 0.5rem;
  padding: 1rem 1.25rem;
  border-top: 1px solid #222;
  background: var(--surface);
}

#chat-input {
  flex: 1;
  padding: 0.75rem 1rem;
  background: var(--bg);
  border: 1px solid #333;
  border-radius: var(--radius);
  color: var(--text);
  font-size: 0.93rem;
  font-family: inherit;
  resize: none;
  outline: none;
  max-height: 120px;
  transition: border-color 0.2s;
}

#chat-input:focus {
  border-color: var(--accent);
}

/* Toast notification */
.toast {
  position: fixed;
  bottom: 5rem;
  left: 50%;
  transform: translateX(-50%);
  background: #333;
  color: var(--text);
  padding: 0.75rem 1.25rem;
  border-radius: var(--radius);
  font-size: 0.85rem;
  z-index: 100;
  animation: fadeIn 0.2s ease-out;
}

/* Typing indicator */
.typing-indicator {
  display: flex;
  gap: 4px;
  padding: 0.5rem 0;
}

.typing-indicator span {
  width: 6px; height: 6px;
  background: var(--text-muted);
  border-radius: 50%;
  animation: pulse 1.2s infinite;
}

.typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
.typing-indicator span:nth-child(3) { animation-delay: 0.4s; }

@keyframes pulse {
  0%, 60%, 100% { opacity: 0.3; transform: scale(0.8); }
  30% { opacity: 1; transform: scale(1); }
}

/* Mobile */
@media (max-width: 480px) {
  .access-card { padding: 1.5rem 1rem; }
  .msg { max-width: 92%; }
  .chat-input-bar { padding: 0.75rem; }
}
```

- [ ] **Step 2: Commit**

```bash
git add public/style.css
git commit -m "feat: rewrite style.css — theme-driven design system"
```

---

### Task 13: Write public/app.js

**Files:**
- Rewrite: `public/app.js`

Client logic: access validation, scenario selection, SSE chat with streaming, error handling.

- [ ] **Step 1: Write public/app.js**

```javascript
// ============================================================
// VoiceClone — Client Application
// ============================================================

let config = null;
let accessCode = "";
let currentScenario = "";
let history = [];

// ---- DOM refs ----
const $ = (id) => document.getElementById(id);

// ---- Screen management ----
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
}

// ---- Theme ----
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme.accent) root.style.setProperty("--accent", theme.accent);
  if (theme.background) root.style.setProperty("--bg", theme.background);
  if (theme.surface) root.style.setProperty("--surface", theme.surface);
  if (theme.text) root.style.setProperty("--text", theme.text);
}

// ---- Toast ----
function showToast(msg, duration = 3000) {
  const toast = $("chat-toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), duration);
}

// ---- Access Screen ----
$("access-btn").addEventListener("click", doAccess);
$("access-code").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doAccess();
});

async function doAccess() {
  const code = $("access-code").value.trim();
  if (!code) return;

  const errorEl = $("access-error");
  errorEl.classList.add("hidden");

  try {
    const resp = await fetch("/api/config", {
      headers: { "x-access-code": code },
    });

    if (resp.status === 403) {
      errorEl.textContent = "Code d'acces invalide";
      errorEl.classList.remove("hidden");
      $("access-code").classList.add("shake");
      setTimeout(() => $("access-code").classList.remove("shake"), 400);
      return;
    }

    if (!resp.ok) throw new Error("Server error");

    config = await resp.json();
    accessCode = code;
    document.title = `${config.name} — Clone IA`;

    applyTheme(config.theme);
    setupScenarios();

    // Auto-skip if only one scenario
    const keys = Object.keys(config.scenarios);
    if (keys.length === 1) {
      startChat(keys[0]);
    } else {
      showScreen("screen-scenarios");
    }
  } catch {
    errorEl.textContent = "Erreur de connexion";
    errorEl.classList.remove("hidden");
  }
}

// ---- Scenarios Screen ----
function setupScenarios() {
  const container = $("scenario-cards");
  container.innerHTML = "";
  for (const [key, val] of Object.entries(config.scenarios)) {
    const card = document.createElement("div");
    card.className = "scenario-card";
    card.innerHTML = `<h3>${val.label}</h3><p>${val.description}</p>`;
    card.addEventListener("click", () => startChat(key));
    container.appendChild(card);
  }
}

// ---- Chat Screen ----
function startChat(scenario) {
  currentScenario = scenario;
  history = [];

  // Set persona info in chat header
  $("chat-avatar").textContent = config.avatar;
  $("chat-name").textContent = config.name;
  $("chat-messages").innerHTML = "";

  // Welcome message
  addMessage("bot", `Bonjour, je suis ${config.name}. ${config.description}\n\nComment puis-je vous aider ?`);

  showScreen("screen-chat");
  $("chat-input").focus();
}

function addMessage(role, text) {
  const container = $("chat-messages");
  const div = document.createElement("div");
  div.className = `msg msg-${role}`;
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

// ---- Chat Send ----
$("chat-send").addEventListener("click", sendMessage);
$("chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
$("chat-input").addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 120) + "px";
});

let sending = false;

async function sendMessage() {
  if (sending) return;
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text) return;

  sending = true;
  input.value = "";
  input.style.height = "auto";
  $("chat-send").disabled = true;

  addMessage("user", text);
  const botDiv = addMessage("bot", "");

  // Add typing indicator
  botDiv.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';

  try {
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-access-code": accessCode,
      },
      body: JSON.stringify({ message: text, history, scenario: currentScenario }),
    });

    if (resp.status === 429) {
      showToast("Trop de messages, patientez un instant");
      botDiv.remove();
      sending = false;
      $("chat-send").disabled = false;
      return;
    }

    if (!resp.ok) throw new Error("Server error");

    // SSE streaming
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let botText = "";
    let statusEl = null;
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const evt = JSON.parse(line.slice(6));
          switch (evt.type) {
            case "delta":
              if (!botText && botDiv.querySelector(".typing-indicator")) {
                botDiv.innerHTML = "";
              }
              botText += evt.text;
              botDiv.textContent = botText;
              if (statusEl) {
                botDiv.appendChild(statusEl);
              }
              break;
            case "validating":
              statusEl = document.createElement("div");
              statusEl.className = "status";
              statusEl.textContent = "Verification...";
              botDiv.appendChild(statusEl);
              break;
            case "rewriting":
              if (statusEl) statusEl.textContent = "Amelioration...";
              break;
            case "clear":
              botText = "";
              botDiv.textContent = "";
              if (statusEl) botDiv.appendChild(statusEl);
              break;
            case "done":
              if (statusEl) statusEl.remove();
              statusEl = null;
              break;
            case "error":
              botDiv.textContent = "Connexion perdue. ";
              const retryBtn = document.createElement("button");
              retryBtn.textContent = "Reessayer";
              retryBtn.style.cssText = "background:var(--accent);color:#fff;border:none;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:0.85rem;";
              retryBtn.addEventListener("click", () => {
                botDiv.remove();
                $("chat-input").value = text;
                sendMessage();
              });
              botDiv.appendChild(retryBtn);
              break;
          }
        } catch {
          // Skip unparseable lines (keep-alive comments, etc.)
        }
      }

      $("chat-messages").scrollTop = $("chat-messages").scrollHeight;
    }

    // Update history
    history.push({ role: "user", content: text });
    history.push({ role: "assistant", content: botText });

    // Trim to 20 messages
    if (history.length > 20) {
      history = history.slice(history.length - 20);
    }
  } catch {
    if (!botDiv.querySelector("button")) {
      botDiv.textContent = "Connexion perdue. Reessayez.";
    }
  }

  sending = false;
  $("chat-send").disabled = false;
  input.focus();
}

// ---- Init: populate access screen with defaults ----
$("access-avatar").textContent = "?";
$("access-name").textContent = "Clone IA";
$("access-title").textContent = "Entrez votre code d'acces";
```

- [ ] **Step 2: Commit**

```bash
git add public/app.js
git commit -m "feat: rewrite app.js — SSE chat client with dynamic config"
```

---

## Chunk 5: Package + Config + README

### Task 14: Update package.json and README

**Files:**
- Rewrite: `package.json`
- Rewrite: `README.md`

- [ ] **Step 1: Write package.json**

```json
{
  "name": "voiceclone",
  "version": "2.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0"
  }
}
```

- [ ] **Step 2: Write README.md**

```markdown
# VoiceClone — White-Label Text Clone Framework

Create an AI-powered text clone that reproduces someone's writing voice, tone, and domain expertise.

## Quick Start

1. Clone this repo
2. Copy `persona/persona.json` and customize for your persona
3. Add knowledge files in `persona/knowledge/` with YAML frontmatter keywords
4. Set environment variables:
   - `ACCESS_CODE` — password for the app
   - `ANTHROPIC_API_KEY` — your Anthropic API key
5. Deploy to Vercel: `vercel --prod`

## How It Works

1. **persona.json** defines identity, voice rules (tone, forbidden words, writing rules), scenarios, and theme
2. **Knowledge base** (markdown files with keyword frontmatter) provides domain expertise
3. **3-pass pipeline**: generate response → critic check against rules → rewrite if violations found
4. **Frontend** adapts automatically: name, avatar, colors, scenarios all from config

## Project Structure

- `persona/` — All persona configuration (persona.json + knowledge + scenarios)
- `api/` — Vercel serverless endpoints (chat, config, health)
- `lib/` — Core logic (pipeline, prompt builder, knowledge loader)
- `public/` — Frontend SPA
- `eval/` — Test suite

## Customization

Edit `persona/persona.json` to change:
- `name`, `title`, `avatar`, `description` — identity
- `voice.tone`, `voice.personality` — character traits
- `voice.forbiddenWords` — words the clone must never use
- `voice.writingRules` — writing style constraints
- `voice.signaturePhrases` — characteristic expressions
- `scenarios` — available chat modes
- `theme` — UI colors (accent, background, surface, text)

## Adding Knowledge

Create `.md` files in `persona/knowledge/` with YAML frontmatter:

\```markdown
---
keywords: ["topic", "related", "terms"]
---
# Your content here
\```

The system automatically detects relevant knowledge based on user message keywords.
```

- [ ] **Step 3: Run npm install**

```bash
npm install
```

Expected: clean install, no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json README.md
git commit -m "feat: update package.json and README for VoiceClone"
```

---

## Chunk 6: Eval Suite

### Task 15: Rewrite eval suite

**Files:**
- Rewrite: `eval/checks.js`
- Rewrite: `eval/cases/free.json`
- Rewrite: `eval/cases/audit.json`
- Rewrite: `eval/cases/critic.json`
- Rewrite: `eval/run.js`

- [ ] **Step 1: Write eval/checks.js**

Validation checks that read rules from persona.json.

```javascript
import { readFileSync } from "fs";
import { join } from "path";

const persona = JSON.parse(
  readFileSync(join(process.cwd(), "persona", "persona.json"), "utf-8")
);
const v = persona.voice;

export function noForbiddenWords(text) {
  const lower = text.toLowerCase();
  const found = v.forbiddenWords.filter((w) => lower.includes(w.toLowerCase()));
  return {
    pass: found.length === 0,
    detail: found.length > 0 ? `Forbidden words found: ${found.join(", ")}` : "OK",
  };
}

export function noExcessiveExclamation(text) {
  const count = (text.match(/!/g) || []).length;
  return {
    pass: count <= 1,
    detail: count > 1 ? `${count} exclamation marks found` : "OK",
  };
}

export function responseInFrench(text) {
  const frenchWords = ["le", "la", "les", "de", "du", "des", "un", "une", "et", "est", "que", "qui", "dans", "pour", "pas", "vous", "ce", "cette"];
  const words = text.toLowerCase().split(/\s+/);
  const frenchCount = words.filter((w) => frenchWords.includes(w)).length;
  const ratio = frenchCount / words.length;
  return {
    pass: ratio > 0.05,
    detail: ratio > 0.05 ? "OK" : `Low French word ratio: ${(ratio * 100).toFixed(1)}%`,
  };
}

export function reasonableLength(text) {
  const words = text.split(/\s+/).length;
  return {
    pass: words >= 10 && words <= 500,
    detail: words < 10 ? `Too short: ${words} words` : words > 500 ? `Too long: ${words} words` : "OK",
  };
}

export function noSelfReference(text) {
  const lower = text.toLowerCase();
  const refs = ["je suis une ia", "en tant qu'ia", "je suis un assistant", "language model", "openai", "chatgpt"];
  const found = refs.filter((r) => lower.includes(r));
  return {
    pass: found.length === 0,
    detail: found.length > 0 ? `Self-reference found: ${found.join(", ")}` : "OK",
  };
}

export function hasStructuredAudit(text) {
  const hasScore = /\d+\/25|\d+\/5/.test(text);
  const hasRecommendation = text.toLowerCase().includes("recommandation") || text.toLowerCase().includes("conseil");
  return {
    pass: hasScore && hasRecommendation,
    detail: !hasScore ? "Missing score format (X/25 or X/5)" : !hasRecommendation ? "Missing recommendations" : "OK",
  };
}

export const ALL_CHECKS = {
  noForbiddenWords,
  noExcessiveExclamation,
  responseInFrench,
  reasonableLength,
  noSelfReference,
  hasStructuredAudit,
};
```

- [ ] **Step 2: Write eval/cases/free.json**

```json
[
  {
    "name": "basic-greeting",
    "scenario": "default",
    "message": "Bonjour, je suis entrepreneur et je veux creer du contenu sur LinkedIn. Par ou commencer ?",
    "checks": ["noForbiddenWords", "noExcessiveExclamation", "responseInFrench", "reasonableLength", "noSelfReference"]
  },
  {
    "name": "content-strategy-question",
    "scenario": "default",
    "message": "Comment construire un calendrier editorial efficace ?",
    "checks": ["noForbiddenWords", "noExcessiveExclamation", "responseInFrench", "reasonableLength"]
  },
  {
    "name": "storytelling-question",
    "scenario": "default",
    "message": "Je n'arrive pas a ecrire des posts LinkedIn qui accrochent. Des conseils ?",
    "checks": ["noForbiddenWords", "noExcessiveExclamation", "responseInFrench", "reasonableLength"]
  },
  {
    "name": "out-of-scope",
    "scenario": "default",
    "message": "Quel CRM me recommandez-vous pour gerer mes contacts ?",
    "checks": ["noForbiddenWords", "responseInFrench", "reasonableLength"]
  }
]
```

- [ ] **Step 3: Write eval/cases/audit.json**

```json
[
  {
    "name": "audit-linkedin-profile",
    "scenario": "audit",
    "message": "Voici mon profil LinkedIn : je suis consultant en transformation digitale. Je publie 1 post par mois, principalement des articles longs. J'ai 2000 abonnes et un taux d'engagement de 1%. Mon site web n'a pas de blog.",
    "checks": ["noForbiddenWords", "responseInFrench", "reasonableLength", "hasStructuredAudit"]
  },
  {
    "name": "audit-newsletter",
    "scenario": "audit",
    "message": "J'ai une newsletter sur le marketing B2B avec 500 abonnes. Je publie toutes les 2 semaines. Mon taux d'ouverture est de 35% et mon taux de clic de 5%. Je n'ai pas de contenu sur les reseaux sociaux.",
    "checks": ["noForbiddenWords", "responseInFrench", "reasonableLength", "hasStructuredAudit"]
  }
]
```

- [ ] **Step 4: Write eval/cases/critic.json**

```json
[
  {
    "name": "critic-detects-forbidden-word",
    "type": "critic",
    "input": "Voici mes tips pour booster votre strategie de contenu avec un mindset game changer.",
    "expectViolation": true
  },
  {
    "name": "critic-passes-clean-text",
    "type": "critic",
    "input": "Avant de vous donner un conseil, j'ai une question : quelle est votre frequence de publication actuelle ? La regularite bat la viralite. Toujours.",
    "expectViolation": false
  }
]
```

- [ ] **Step 5: Write eval/run.js**

```javascript
import { readFileSync } from "fs";
import { join } from "path";
import { ALL_CHECKS } from "./checks.js";

const API_BASE = process.env.API_BASE || "http://localhost:3000";
const ACCESS_CODE = process.env.ACCESS_CODE || "demo";

async function runChatTest(testCase) {
  const resp = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-access-code": ACCESS_CODE,
    },
    body: JSON.stringify({
      message: testCase.message,
      history: [],
      scenario: testCase.scenario,
    }),
  });

  if (!resp.ok) return { error: `HTTP ${resp.status}` };

  // Read SSE stream
  const text = await resp.text();
  let fullText = "";
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const evt = JSON.parse(line.slice(6));
      if (evt.type === "delta") fullText += evt.text;
      if (evt.type === "clear") fullText = "";
    } catch { /* skip */ }
  }

  return { text: fullText };
}

async function runCriticTest(testCase) {
  const { criticCheck } = await import("../lib/pipeline.js");
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic();

  const result = await criticCheck(client, testCase.input);
  const passed = testCase.expectViolation ? !result.pass : result.pass;

  return {
    passed,
    detail: passed
      ? "OK"
      : `Expected violation=${testCase.expectViolation}, got pass=${result.pass} violations=${JSON.stringify(result.violations)}`,
  };
}

async function main() {
  const caseFiles = ["free.json", "audit.json", "critic.json"];
  let total = 0, passed = 0, failed = 0;

  for (const file of caseFiles) {
    const cases = JSON.parse(readFileSync(join(process.cwd(), "eval", "cases", file), "utf-8"));
    console.log(`\n=== ${file} ===`);

    for (const tc of cases) {
      total++;
      process.stdout.write(`  ${tc.name}... `);

      try {
        if (tc.type === "critic") {
          const result = await runCriticTest(tc);
          if (result.passed) {
            console.log("PASS");
            passed++;
          } else {
            console.log(`FAIL — ${result.detail}`);
            failed++;
          }
        } else {
          const result = await runChatTest(tc);
          if (result.error) {
            console.log(`FAIL — ${result.error}`);
            failed++;
            continue;
          }

          const checkResults = tc.checks.map((name) => ({
            name,
            ...ALL_CHECKS[name](result.text),
          }));

          const allPass = checkResults.every((c) => c.pass);
          if (allPass) {
            console.log("PASS");
            passed++;
          } else {
            const failures = checkResults.filter((c) => !c.pass);
            console.log(`FAIL — ${failures.map((f) => `${f.name}: ${f.detail}`).join("; ")}`);
            failed++;
          }
        }
      } catch (err) {
        console.log(`ERROR — ${err.message}`);
        failed++;
      }
    }
  }

  console.log(`\n--- Results: ${passed}/${total} passed, ${failed} failed ---`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
```

- [ ] **Step 6: Commit**

```bash
git add eval/
git commit -m "feat: rewrite eval suite — unified runner, persona-driven checks"
```

---

## Chunk 7: Final Cleanup + Verification

### Task 16: Verify zero Ahmet references

- [ ] **Step 1: Search for any remaining Ahmet references**

```bash
grep -ri "ahmet" --include="*.js" --include="*.json" --include="*.html" --include="*.css" --include="*.md" . | grep -v node_modules | grep -v ".git/" | grep -v "voiceclone-whitelabel-rebuild-design.md" | grep -v "voiceclone-rebuild.md"
```

Expected: no output (specs are excluded since they document the migration).

- [ ] **Step 2: Search for old path references**

```bash
grep -ri "voice-dna\|ahmet-akyurek\|\"knowledge/entities\|\"knowledge/scenarios\|\"knowledge/topics\|\"knowledge/concepts" --include="*.js" --include="*.json" . | grep -v node_modules | grep -v ".git/"
```

Expected: no output. (The quoted patterns exclude `persona/knowledge/` matches.)

- [ ] **Step 3: Verify all new files exist**

```bash
ls persona/persona.json persona/knowledge/topics/strategie-contenu.md persona/knowledge/topics/storytelling.md persona/scenarios/default.md persona/scenarios/audit.md lib/knowledge.js lib/pipeline.js lib/prompt.js lib/validate.js lib/sse.js api/chat.js api/config.js api/health.js api/_rateLimit.js public/index.html public/style.css public/app.js eval/run.js eval/checks.js eval/cases/free.json eval/cases/audit.json eval/cases/critic.json
```

Expected: all files listed, no errors.

- [ ] **Step 4: Verify app starts without errors**

```bash
node -e "
import './lib/knowledge.js';
import './lib/prompt.js';
import './lib/pipeline.js';
import './lib/validate.js';
import './lib/sse.js';
console.log('All modules load successfully');
"
```

Expected: `All modules load successfully`

- [ ] **Step 5: Commit any cleanup fixes if needed**

---

### Task 17: Update .claude/launch.json for dev server

**Files:**
- Modify: `.claude/launch.json`

- [ ] **Step 1: Read current launch.json and update**

Update the dev server config to work with the new app. The existing config likely references old paths.

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "voiceclone-dev",
      "runtimeExecutable": "npx",
      "runtimeArgs": ["vercel", "dev"],
      "port": 3000
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add .claude/launch.json
git commit -m "chore: update launch.json for VoiceClone dev server"
```

---

### Task 18: Final integration test

- [ ] **Step 1: Start dev server**

```bash
npx vercel dev
```

- [ ] **Step 2: Test /api/health**

```bash
curl http://localhost:3000/api/health
```

Expected: `{"status":"ok","timestamp":"..."}`

- [ ] **Step 3: Test /api/config with valid code**

```bash
curl -H "x-access-code: $ACCESS_CODE" http://localhost:3000/api/config
```

Expected: JSON with name, title, avatar, scenarios, theme.

- [ ] **Step 4: Test /api/config with invalid code**

```bash
curl -H "x-access-code: wrong" http://localhost:3000/api/config
```

Expected: `{"error":"Invalid access code"}` with 403 status.

- [ ] **Step 5: Test chat endpoint**

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "x-access-code: $ACCESS_CODE" \
  -d '{"message":"Bonjour, comment creer du contenu ?","history":[],"scenario":"default"}'
```

Expected: SSE stream with `delta` events containing French text.

- [ ] **Step 6: Open frontend in browser and verify all 3 screens work**

Visit `http://localhost:3000`, enter access code, select scenario, send a message. Verify streaming works.

- [ ] **Step 7: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: integration test fixes"
```
