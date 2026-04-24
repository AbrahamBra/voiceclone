# Refonte homepage — plan d'implémentation

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aligner la landing (`src/routes/+page.svelte`) sur la v-actuelle du produit (protocole d'onboarding, dialogue méta sur correction, tabs Post|DM). Copy humanisée, captures mockups synthétiques.

**Architecture:** Édition ciblée d'un seul fichier Svelte (`+page.svelte`). Structure 3 écrans (hero/preuve/moat) gardée, esthétique préservée. Copy et contenu des 3 captures remplacés, moat réécrit sans chiffre, meta tags mis à jour, CSS nettoyé + nouveaux styles pour les 3 captures.

**Tech Stack:** Svelte 5 (runes), CSS vanilla (tokens déjà définis : `--paper`, `--ink`, `--vermillon`, `--rule`, etc.).

**Spec source:** [docs/superpowers/specs/2026-04-24-homepage-refonte-design.md](../specs/2026-04-24-homepage-refonte-design.md)

---

## Chunk 1 — Hero + meta tags

Contient : `<svelte:head>`, `.overline`, `.headline`, `.sub`, `.triptyque` (3 beats). Pas de changement CSS dans ce chunk.

### Task 1 : Mise à jour meta tags

**Files:**
- Modify: `src/routes/+page.svelte:133-136`

- [ ] **Step 1 — Remplacer le `<svelte:head>` actuel**

Remplacer :
```svelte
<svelte:head>
  <title>VoiceClone — Setter IA pour DM prospects + posts LinkedIn (agences ghostwriting)</title>
  <meta name="description" content="Le setter drafte les DM prospects en secondes dans la voix de ton client. Pour les agences ghostwriting : le même cerveau drafte aussi les posts LinkedIn de tes clients, avec la même base de connaissance." />
</svelte:head>
```

Par :
```svelte
<svelte:head>
  <title>VoiceClone — Le process de ton client, exécuté par ton setter (agences ghostwriting)</title>
  <meta name="description" content="Les règles de ton client, écrites dès l'onboarding. Tes setters draftent dedans. Quand ils corrigent, le clone apprend. DM + posts LinkedIn, un seul cerveau." />
</svelte:head>
```

### Task 2 : Mise à jour Hero (overline, H1, sub, 3 beats)

**Files:**
- Modify: `src/routes/+page.svelte:152-199`

- [ ] **Step 1 — Remplacer `.overline` (ligne ~153)**

L'overline actuelle reste identique :
```svelte
<div class="overline mono">
  ◇ pour les agences ghostwriting qui pilotent 5+ clients
</div>
```
→ aucun changement, vérifier qu'elle est intacte.

- [ ] **Step 2 — Remplacer `.headline` (ligne ~157-161)**

Remplacer :
```svelte
<h1 class="headline">
  <span>10 clients. 10 voix. Un setter.</span>
  <span>Ton setter colle le DM d'un prospect.</span>
  <span class="accent">Le draft sort dans la voix de ton <em>client</em>.</span>
</h1>
```

Par :
```svelte
<h1 class="headline">
  <span>10 clients. 10 façons de DM. Un setter qui tient la ligne.</span>
  <span>Ton setter colle le DM d'un prospect.</span>
  <span class="accent">Le draft sort comme <em>ton client</em> l'écrirait.</span>
</h1>
```

Note : l'accent vermillon reste sur `<em>ton client</em>` (cohérent avec le CSS `.accent em` déjà en place).

- [ ] **Step 3 — Remplacer `.sub` (ligne ~163-169)**

Remplacer :
```svelte
<p class="sub">
  Un client = son cerveau à lui. Son style, ses tics, ses dossiers prospects.
  Ton setter écrit avec lui, pas à sa place.
  <br /><br />
  Tu tiens une agence ghostwriting ? Le même clone drafte aussi les
  <em>posts LinkedIn</em> de tes clients. DM et posts, une seule voix.
</p>
```

Par :
```svelte
<p class="sub">
  Un client = sa façon de faire. Ses règles, ses ouvertures, sa cadence de relance,
  écrites noir sur blanc dès l'onboarding. Ton setter tape dedans, pas à côté.
  Quand il corrige, le clone demande pourquoi. La règle rentre avec son contexte.
  <br /><br />
  Tu tiens une agence ghostwriting ? Le même cerveau drafte aussi les
  <em>posts LinkedIn</em> de tes clients. DM et posts, une seule ligne.
</p>
```

- [ ] **Step 4 — Remplacer les 3 beats (ligne ~171-199)**

Remplacer :
```svelte
<ul class="triptyque" aria-label="Ce que VoiceClone fait concrètement">
  <li class="beat">
    <h3 class="beat-title">son cerveau à lui</h3>
    <p class="beat-body">
      Les posts qu'il a écrits. Les mots qu'il évite.
      Les prospects qu'il suit. VoiceClone garde tout
      en tête. Ton setter zappe entre 5 clients
      sans perdre la voix.
    </p>
  </li>
  <li class="beat">
    <h3 class="beat-title">DM au cœur. Posts inclus.</h3>
    <p class="beat-body">
      Conçu pour les DM : 1er message, relance, reply, closing.
      Ton setter passe de
      <strong>30 minutes à 30 secondes par draft</strong>.
      Les agences ghostwriting activent aussi les posts
      LinkedIn. Un seul clone pour les deux canaux.
    </p>
  </li>
  <li class="beat">
    <h3 class="beat-title">corrige une fois. Jamais deux.</h3>
    <p class="beat-body">
      Le <em class="quoted">« n'hésitez pas »</em> qui traîne dans un draft ?
      Tu le vires une fois, la règle s'ajoute. Le setter
      junior qui arrive dans 3 mois ne le tapera même plus.
    </p>
  </li>
</ul>
```

Par :
```svelte
<ul class="triptyque" aria-label="Ce que VoiceClone fait concrètement">
  <li class="beat">
    <h3 class="beat-title">ses règles, écrites dès l'onboarding</h3>
    <p class="beat-body">
      Sa façon de DM, ses ouvertures interdites, sa cadence de relance,
      sa signature. Noir sur blanc dès la création du clone.
      Ton setter tape dedans, pas à côté.
    </p>
  </li>
  <li class="beat">
    <h3 class="beat-title">corrige une fois, explique au clone</h3>
    <p class="beat-body">
      Tu vires un mot, le clone demande <em class="quoted">« pourquoi »</em>.
      La règle rentre avec son contexte. Le setter junior
      qui arrive dans 3 mois n'y retape pas deux fois.
    </p>
  </li>
  <li class="beat">
    <h3 class="beat-title">DM et posts, un seul cerveau</h3>
    <p class="beat-body">
      Même base pour les DM prospects et les posts LinkedIn.
      Ton setter passe d'un canal à l'autre sans reconfigurer.
      La ligne tient partout.
    </p>
  </li>
</ul>
```

### Task 3 : Vérifier & commit

- [ ] **Step 1 — Lire le fichier pour vérifier la cohérence**

Ouvrir `src/routes/+page.svelte`, scroller la section hero, vérifier qu'il n'y a pas de balise cassée, de `<br>` orphelin, de `<em>` non fermé.

- [ ] **Step 2 — Commit**

```bash
git add src/routes/+page.svelte
git commit -m "refactor(landing): hero + meta — pivot voix→process, copy humanisée"
```

---

## Chunk 2 — Preuve (3 captures remplacées)

Remplace le contenu des 3 `.capture` (markup interne). Le wrapper `.captures` / `.capture-frame` / `.frame-bar` / `.frame-body` reste. Le CSS des 3 nouveaux contenus est ajouté dans Chunk 3.

### Task 1 : Capture 01 — setup onboarding

**Files:**
- Modify: `src/routes/+page.svelte:223-244`

- [ ] **Step 1 — Remplacer capture 01**

Remplacer le bloc `<figure class="capture">` #1 (lignes ~223-244) par :

```svelte
<figure class="capture">
  <div class="capture-frame" aria-hidden="true">
    <div class="frame-bar mono"><span>◎</span><span>onboarding · setup du clone</span></div>
    <div class="frame-body">
      <div class="frame-stub setup-stub">
        <div class="setup-block">
          <span class="setup-label mono">ouvertures interdites</span>
          <span class="setup-detail">jamais « Bonjour ». jamais « J'espère que… »</span>
        </div>
        <div class="setup-block">
          <span class="setup-label mono">cadence de relance</span>
          <span class="setup-detail">J+3 → J+7 → on coupe</span>
        </div>
        <div class="setup-block">
          <span class="setup-label mono">signature</span>
          <span class="setup-detail">« — A. » sans formule</span>
        </div>
        <div class="setup-block">
          <span class="setup-label mono">process closing</span>
          <span class="setup-detail">pas de call avant 3 échanges</span>
        </div>
      </div>
    </div>
  </div>
  <figcaption>
    <span class="cap-num mono">01</span>
    Pas besoin que le clone devine la façon de ton client à partir de 3 posts.<br />
    Ton client écrit ses règles une fois. Le clone les exécute dès le 1er draft.
  </figcaption>
</figure>
```

### Task 2 : Capture 02 — dialogue méta

**Files:**
- Modify: `src/routes/+page.svelte:246-269` (ancien bloc capture #2)

- [ ] **Step 1 — Remplacer capture 02**

Remplacer le bloc `<figure class="capture">` #2 par :

```svelte
<figure class="capture">
  <div class="capture-frame" aria-hidden="true">
    <div class="frame-bar mono"><span>◎</span><span>cockpit · correction</span></div>
    <div class="frame-body">
      <div class="frame-stub">
        <span class="stub-meta mono">setter vire « n'hésitez pas »</span>
        <div class="dialogue-row dialogue-clone">
          <span class="dialogue-who mono">clone</span>
          <span class="dialogue-body">Pourquoi tu vires ça ?</span>
        </div>
        <div class="dialogue-row dialogue-setter">
          <span class="dialogue-who mono">setter</span>
          <span class="dialogue-body">trop soft, on ferme, on propose pas</span>
        </div>
        <div class="dialogue-row dialogue-clone">
          <span class="dialogue-who mono">clone</span>
          <span class="dialogue-body">noté, règle ajoutée. plus jamais dans un DM closing.</span>
        </div>
      </div>
    </div>
  </div>
  <figcaption>
    <span class="cap-num mono">02</span>
    Tu corriges une fois. Tu expliques une fois.<br />
    Le clone retient le pourquoi. La règle vaut pour toute l'équipe.
  </figcaption>
</figure>
```

### Task 3 : Capture 03 — Post|DM tabs

**Files:**
- Modify: `src/routes/+page.svelte:271-293` (ancien bloc capture #3)

- [ ] **Step 1 — Remplacer capture 03**

Remplacer le bloc `<figure class="capture">` #3 par :

```svelte
<figure class="capture">
  <div class="capture-frame" aria-hidden="true">
    <div class="frame-bar mono"><span>◎</span><span>cockpit · Post | DM</span></div>
    <div class="frame-body">
      <div class="frame-stub tabs-stub">
        <div class="tabs-row mono">
          <span class="tab">Post</span>
          <span class="tab tab-active">DM</span>
        </div>
        <div class="tabs-panels">
          <div class="tab-panel tab-panel-muted">
            <span class="stub-meta mono">post · brouillon</span>
            <p class="mini-draft">3 questions à se poser avant de relancer un prospect silencieux. — A.</p>
          </div>
          <div class="tab-panel">
            <span class="stub-meta mono">dm · draft</span>
            <p class="mini-draft">Sophie, 2 lignes pile : on mappe ta stack jeudi. — A.</p>
          </div>
        </div>
        <span class="brain-badge mono">même base · 2 canaux</span>
      </div>
    </div>
  </div>
  <figcaption>
    <span class="cap-num mono">03</span>
    Ton setter drafte les DM. Le ghostwriter drafte les posts.<br />
    Un seul cerveau, deux onglets.
  </figcaption>
</figure>
```

### Task 4 : Commit

- [ ] **Step 1 — Commit**

```bash
git add src/routes/+page.svelte
git commit -m "refactor(landing): preuve — 3 captures alignées sur les beats (onboarding, dialogue méta, tabs)"
```

Note : le CSS des nouvelles classes (`setup-block`, `dialogue-row`, `tabs-row`, `brain-badge`, etc.) arrive au Chunk 3. Le rendu sera cassé entre ce commit et le suivant — c'est OK, les deux commits resteront sur la même PR.

---

## Chunk 3 — Moat + CSS cleanup/ajouts + vérification

### Task 1 : Moat — retirer PILOT_RULES_COUNT + nouveau paragraphe

**Files:**
- Modify: `src/routes/+page.svelte:14-17` (constante PILOT_RULES_COUNT)
- Modify: `src/routes/+page.svelte:297-315` (section moat markup)

- [ ] **Step 1 — Supprimer la constante `PILOT_RULES_COUNT`**

Dans le `<script>` (ligne ~16-17), supprimer :
```javascript
// TODO remplacer par le chiffre réel d'un client pilote une fois mesuré.
const PILOT_RULES_COUNT = 147;
```

- [ ] **Step 2 — Remplacer le markup du moat**

Remplacer le bloc `<section class="moat">` (de `<section class="moat" ...>` jusqu'à sa fermeture `</section>`) par :

```svelte
<section class="moat" aria-labelledby="moat-title">
  <div class="section-kicker mono">◇ le moat</div>
  <h2 class="section-title" id="moat-title">
    Le process tient. Même quand ton équipe change.
  </h2>

  <div class="moat-body">
    <p class="moat-para">
      Setter senior qui part, junior qui arrive : même draft, même voix, même cadence.
      Le process du client ne vit pas dans la tête d'un humain. Il est écrit,
      et chaque correction le précise. Quand un nouveau rejoint l'équipe, il écrit
      dans la bonne ligne dès son premier draft. Plus de semaine à relire les archives.
    </p>
    <p class="moat-punch">
      Tes setters changent. Le process reste. Les corrections aussi.
    </p>
  </div>

  <div class="moat-cta">
    <a class="btn-primary" href="/demo">
      → Essaie le clone en 5 min.
    </a>
    <p class="cta-sub mono">stateless. pas de compte. tu colles, tu vois.</p>
    <a class="demo-link mono" href={DEMO_CTA_HREF}>ou rejoins la waitlist →</a>
  </div>
</section>
```

Changements par rapport à l'ancien markup :
- Title : `Le cerveau tient. Même quand ton équipe change.` → `Le process tient. Même quand ton équipe change.`
- `.moat-para` : nouveau contenu sans `<strong class="big-num">{PILOT_RULES_COUNT}</strong>`
- `.moat-punch` : `Tes setters changent. Le clone reste. Les règles apprises aussi.` → `Tes setters changent. Le process reste. Les corrections aussi.`
- CTA moat inchangé.

### Task 2 : CSS cleanup — supprimer styles inutiles

**Files:**
- Modify: `src/routes/+page.svelte` (bloc `<style>`)

- [ ] **Step 1 — Supprimer les styles des anciennes captures 02 et 03**

Supprimer les blocs CSS suivants :

```css
/* anciennes captures 02 (rule detection) */
.rule-row { … }
.rule-dot { … }
.rule-label { … }
.rule-detail { … }
.rule-action { … }
.rule-btn { … }
.rule-hint { … }

/* anciennes captures 03 (fb-list) */
.fb-list { … }
.fb-list li { … }
.fb-list li:last-child { … }
.fb-date { … }
```

- [ ] **Step 2 — Supprimer `.big-num`**

Supprimer le bloc :
```css
.big-num {
  font-family: var(--font-mono);
  font-weight: 500;
  font-size: 1.3em;
  color: var(--vermillon);
  font-variant-numeric: tabular-nums;
  margin: 0 2px;
}
```

### Task 3 : CSS nouveau — styles pour les 3 nouvelles captures

**Files:**
- Modify: `src/routes/+page.svelte` (bloc `<style>`, section « Écran 2 — Preuve »)

- [ ] **Step 1 — Ajouter styles `setup-*` (capture 01)**

Après `.stub-tag { … }`, ajouter :

```css
/* Capture 01 — setup onboarding */
.setup-stub {
  gap: 8px;
}
.setup-block {
  display: grid;
  grid-template-columns: 1fr;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid var(--rule);
  background: var(--paper-subtle, #f6f5f1);
}
.setup-label {
  font-size: 10.5px;
  color: var(--ink-40);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.setup-detail {
  font-size: 13px;
  color: var(--ink);
  line-height: 1.4;
}
```

- [ ] **Step 2 — Ajouter styles `dialogue-*` (capture 02)**

À la suite, ajouter :

```css
/* Capture 02 — dialogue méta */
.dialogue-row {
  display: grid;
  grid-template-columns: 48px 1fr;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--rule);
  align-items: baseline;
}
.dialogue-clone {
  background: var(--paper);
  border-left: 2px solid var(--vermillon);
}
.dialogue-setter {
  background: var(--paper-subtle, #f6f5f1);
  margin-left: 16px;
}
.dialogue-who {
  font-size: 10.5px;
  color: var(--ink-40);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding-top: 2px;
}
.dialogue-clone .dialogue-who {
  color: var(--vermillon);
}
.dialogue-body {
  font-size: 13px;
  color: var(--ink);
  line-height: 1.5;
}
```

- [ ] **Step 3 — Ajouter styles `tabs-*` + `brain-badge` (capture 03)**

À la suite, ajouter :

```css
/* Capture 03 — tabs Post|DM */
.tabs-stub {
  gap: 10px;
}
.tabs-row {
  display: inline-flex;
  gap: 18px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--rule);
}
.tab {
  font-size: 11.5px;
  color: var(--ink-40);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding-bottom: 4px;
  position: relative;
}
.tab-active {
  color: var(--ink);
}
.tab-active::after {
  content: "";
  position: absolute;
  left: 0; right: 0; bottom: -7px;
  height: 1px;
  background: var(--vermillon);
}
.tabs-panels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 4px;
}
.tab-panel {
  padding: 8px 10px;
  border: 1px solid var(--rule);
  background: var(--paper);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tab-panel-muted {
  opacity: 0.55;
}
.mini-draft {
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--ink);
  margin: 0;
}
.brain-badge {
  align-self: center;
  font-size: 10.5px;
  color: var(--vermillon);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 3px 8px;
  border: 1px dashed var(--vermillon);
  margin-top: 2px;
}
```

### Task 4 : Commit intermédiaire

- [ ] **Step 1 — Commit**

```bash
git add src/routes/+page.svelte
git commit -m "refactor(landing): moat sans chiffre + CSS cleanup/ajouts pour les 3 nouvelles captures"
```

### Task 5 : Vérification bout-en-bout (cf `feedback_prod_without_ui_test.md`)

**Référence skill :** `@preview_tools` workflow (preview_start → preview_screenshot → preview_resize).

- [ ] **Step 1 — Démarrer le dev server**

Utiliser `preview_start` sur la racine du projet (command `npm run dev`).

- [ ] **Step 2 — Charger la landing en non-auth**

`preview_eval` : `localStorage.clear(); window.location.href = '/'`.
Puis `preview_snapshot` — vérifier : overline, H1 (3 lignes, accent vermillon sur « ton client »), sub, 3 beats, 3 captures, moat, footer.

- [ ] **Step 3 — Screenshot desktop**

`preview_screenshot` full page. Vérifier visuellement : pas de débordement, accent vermillon OK, 3 colonnes dans `.triptyque` et `.captures`.

- [ ] **Step 4 — Responsive 900px (stack)**

`preview_resize` width=900. Vérifier : triptyque et captures passent en 1 colonne.
`preview_screenshot` pour preuve.

- [ ] **Step 5 — Responsive 600px (mobile)**

`preview_resize` width=600. Vérifier : padding réduits, font-sizes réduites, tout lisible.
`preview_screenshot` pour preuve.

- [ ] **Step 6 — Flow « démo pré-entraînée »**

`preview_resize` width=1280.
`preview_click` sur le bouton « fouiller une démo pré-entraînée → ». Vérifier via `preview_snapshot` qu'on arrive bien sur `/chat/<persona-démo>` et pas ailleurs.

- [ ] **Step 7 — Flow « code d'accès »**

Revenir sur `/`. `preview_fill` un code bidon dans l'input access, `preview_click` le bouton `→`. Vérifier : erreur « refusé » + shake (regarder `preview_console_logs` pour pas d'erreur JS).

- [ ] **Step 8 — Meta tags dans le `<head>` rendu**

`preview_eval` : `document.title` et `document.querySelector('meta[name="description"]').content`. Vérifier qu'ils matchent le spec.

- [ ] **Step 9 — Commit final si tout passe**

Si tous les checks passent, pas de nouveau commit. Si un fix a été nécessaire, commit :
```bash
git add src/routes/+page.svelte
git commit -m "fix(landing): <description courte>"
```

- [ ] **Step 10 — Pousser + PR**

Demander à l'utilisateur avant de pousser (comportement destructif = visibilité externe, même si branche claude/*). Si OK :
```bash
git push -u origin claude/thirsty-hawking-b2c8b8
gh pr create --title "refactor(landing): refonte homepage — process client + dialogue méta" --body "$(cat <<'EOF'
## Summary
- Pivot positionnement : « voix clonée » → « process du client, exécuté par le setter »
- Hero réécrit (H1 + sub + 3 beats : onboarding / dialogue méta / tabs Post|DM)
- 3 captures cockpit remplacées (mockups synthétiques)
- Moat sans chiffre pilote, punchline gardée
- Meta tags alignés
- Copy passée au humanizer (em-dashes, redondances, négative parallélisme)

Spec : docs/superpowers/specs/2026-04-24-homepage-refonte-design.md

## Test plan
- [ ] Preview Vercel : landing charge en non-auth
- [ ] 3 captures rendent correctement (desktop, 900px, 600px)
- [ ] Flow démo pré-entraînée arrive sur la bonne persona
- [ ] Code d'accès invalide → refusé + shake
- [ ] Meta title/description corrects dans le `<head>`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes

- **Aucun test unitaire** : ce projet n'a pas de test pour la landing. Vérification visuelle via preview_tools exclusivement.
- **Svelte 5 runes** : aucun `$state` / `$effect` touché, seul du markup statique et la suppression d'une constante.
- **Chunk 2 laisse le rendu cassé temporairement** : les 3 captures utilisent des classes sans CSS jusqu'au Chunk 3. Acceptable car les 3 chunks sont sur la même PR, et le commit 2 reste lisible en cas de bisect.
- **Surfaces publiques 100% synthétique** (cf `feedback_public_surfaces_synthetic_only.md`) : tous les prénoms (Sophie), phrases (« n'hésitez pas », « trop soft, on ferme »), signatures (« — A. ») sont fictifs.
