# Accueil — Copy refresh + démo killée — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refondre `src/routes/+page.svelte` pour qu'il raconte le produit réel (chat 2-zones avec feedback ✓/★) plutôt qu'un pipeline factice ; supprimer la démo scriptée et le hash hardcodé ; promouvoir le formulaire d'accès en élément central.

**Architecture:** Page Svelte 5 + SvelteKit côté SSR. Trois zones : header allégé, hero recentré, formulaire d'accès promu. La logique d'auth (auto-redirect vers `/chat/<lastPersona>` ou `/create`) reste intacte. Le hash de version est injecté au build via `vite.config.js` plutôt que codé en dur.

**Tech Stack:** Svelte 5 (runes) · SvelteKit 2 · Vite 8 · node:test pour la verification.

**Spec source:** [`docs/superpowers/specs/2026-04-20-accueil-copy-refresh-design.md`](../specs/2026-04-20-accueil-copy-refresh-design.md)

---

## File Structure

- **Modify** `vite.config.js` — ajoute `define` pour injecter `VITE_BUILD_HASH` (résolution Vercel env → git CLI → fallback `'dev'`)
- **Modify** `src/routes/+page.svelte` — refonte complète (suppression démo, nouveau hero, formulaire promu, `<title>` raccourci, lecture du hash via `import.meta.env`)
- **Delete** `src/lib/landing-demo.js` — plus de consommateur après cette PR
- **Modify** `src/lib/scenarios.js` — suppression du commentaire ligne 30 qui devient orphelin
- **New test** `test/landing-page.test.js` — vérifie en source que les chaînes interdites disparaissent (`pipeline 4 étapes`, `BUILD_HASH = "`, `/ laboratoire`, `pas un chatbot`) et que les éléments attendus sont présents (hero copy, form prominent)

**Note sur les tests :** la stack actuelle (`node --test`) n'a pas de runner pour composants Svelte. On vérifie au niveau **source** (string-matching sur `+page.svelte`) plutôt que DOM rendu. C'est suffisant pour cette refonte qui est essentiellement de la suppression + remplacement de copy. Les critères SSR-runtime sont vérifiés en smoke manuel à la fin.

---

## Chunk 1 — Build hash injection

### Task 1.1: Ajouter le define `VITE_BUILD_HASH` dans `vite.config.js`

**Files:**
- Modify: `vite.config.js`

- [ ] **Step 1: Lire le fichier actuel**

```bash
cat vite.config.js
```

Confirmer le contenu attendu (16 lignes, `defineConfig` avec `plugins`, `optimizeDeps`, `server`).

- [ ] **Step 2: Ajouter la résolution du hash en haut du fichier**

Remplacer le contenu complet par :

```javascript
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import { execSync } from "node:child_process";

function resolveBuildHash() {
  // 1) Vercel injects this in the build env
  const vercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (vercel) return vercel.slice(0, 7);
  // 2) Local builds with git available
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    // 3) Fallback (no git context, e.g. tarball install)
    return "dev";
  }
}

export default defineConfig({
  plugins: [sveltekit()],
  define: {
    "import.meta.env.VITE_BUILD_HASH": JSON.stringify(resolveBuildHash()),
  },
  optimizeDeps: {
    include: ["pdfjs-dist"],
    exclude: ["pdfjs-dist/build/pdf.worker.min.mjs"],
  },
  server: {
    fs: {
      // Allow hoisted node_modules (needed when running from a git worktree)
      allow: ["../../../.."],
    },
  },
});
```

- [ ] **Step 3: Vérifier que vite résout bien le hash en local**

```bash
npm run dev -- --port 5174 &
sleep 3
curl -s "http://localhost:5174/" | grep -oE 'VITE_BUILD_HASH[^,}]+' | head -1
kill %1
```

Expected: une ligne contenant un hash de 7 caractères (le HEAD courant, ex. `3939745`), pas la chaîne `'dev'` ni vide.

> Note : sur Windows + git bash, `kill %1` peut ne pas fonctionner. Alternative : `taskkill //F //IM node.exe` ou simplement Ctrl+C dans le terminal qui a lancé dev. Le check important est que la valeur résolue n'est pas `dev`.

- [ ] **Step 4: Commit**

```bash
git add vite.config.js
git commit -m "build: inject VITE_BUILD_HASH from Vercel env / git / fallback"
```

---

## Chunk 2 — Test de critères source

### Task 2.1: Écrire le test qui valide les critères de la spec

**Files:**
- Create: `test/landing-page.test.js`

- [ ] **Step 1: Créer le test (assertions source-level)**

```javascript
// Vérifie que la refonte de la page d'accueil respecte les critères de la spec
// 2026-04-20-accueil-copy-refresh-design.md.
// Source-level checks (pas de DOM render) — suffisant pour une refonte qui est
// principalement de la suppression de chaînes + remplacement de copy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAGE_PATH = resolve(__dirname, "../src/routes/+page.svelte");
const source = readFileSync(PAGE_PATH, "utf8");

test("landing: chaînes interdites supprimées", () => {
  const forbidden = [
    "pipeline 4 étapes",
    'BUILD_HASH = "',
    "/ laboratoire",
    "pas un chatbot",
    "Generate",
    "rewrite",
    "fidelity",
    "$lib/landing-demo",
    "SCENARIOS",
    "PHASE_DELAYS",
    "TYPE_SPEED_OUTPUT",
    "case-strip",
    "panel-fidelity",
  ];
  for (const s of forbidden) {
    assert.ok(
      !source.includes(s),
      `+page.svelte contient encore la chaîne interdite: "${s}"`
    );
  }
});

test("landing: hero copy présent", () => {
  const required = [
    "Un clone d'écriture qui apprend de tes corrections",
    "Tu lui parles d'un prospect",
    "Au bout de cent corrections, il écrit comme toi",
  ];
  for (const s of required) {
    assert.ok(
      source.includes(s),
      `+page.svelte ne contient pas la chaîne attendue: "${s}"`
    );
  }
});

test("landing: hash de version lu depuis import.meta.env", () => {
  assert.ok(
    source.includes("import.meta.env.VITE_BUILD_HASH"),
    "+page.svelte doit lire le hash depuis import.meta.env.VITE_BUILD_HASH"
  );
});

test("landing: formulaire d'accès toujours présent", () => {
  // L'élément <form class="access"> + handler submitCode doivent survivre
  assert.ok(source.includes("submitCode"), "submitCode handler manquant");
  assert.ok(source.includes("/api/personas"), "POST vers /api/personas manquant");
});

test("landing: chemin auth (auto-redirect) intact", () => {
  // Les fonctions clés du chemin authentifié doivent être préservées
  const required = ["pickPersona", "resolveHome", "vc_last_persona", "/chat/", "/create"];
  for (const s of required) {
    assert.ok(
      source.includes(s),
      `+page.svelte ne contient plus l'élément du chemin auth: "${s}"`
    );
  }
});

test("landing: title raccourci", () => {
  assert.ok(
    source.includes("VoiceClone — accès") || source.includes("VoiceClone — Accès"),
    "+page.svelte doit utiliser un title court (sans 'laboratoire')"
  );
});
```

- [ ] **Step 2: Lancer le test pour confirmer qu'il échoue**

```bash
node --test test/landing-page.test.js
```

Expected: plusieurs `fail` — la page actuelle contient encore `pipeline 4 étapes`, `BUILD_HASH = "`, `/ laboratoire`, etc. C'est attendu, on va les supprimer dans le chunk suivant.

- [ ] **Step 3: Commit le test (en rouge — c'est notre filet de sécurité)**

```bash
git add test/landing-page.test.js
git commit -m "test(landing): critères de la refonte (red, fix-up dans suite)"
```

---

## Chunk 3 — Refonte de `+page.svelte`

Cette chunk fait la refonte d'un coup en réécrivant le fichier complet. La granularité TDD bite-size n'a pas de sens ici (suppression DOM + CSS + insertion nouveau hero forment un tout cohérent). On valide à la fin avec le test du Chunk 2.

### Task 3.1: Réécrire `src/routes/+page.svelte`

**Files:**
- Modify: `src/routes/+page.svelte` (réécriture complète, ~150 lignes au lieu des 939 actuelles)

- [ ] **Step 1: Sauvegarder l'ancien contenu pour référence (mental)**

Lire `src/routes/+page.svelte` une dernière fois pour avoir en tête :
- Les imports auth (`accessCode`, `sessionToken` depuis `$lib/stores/auth.js`) — à conserver
- Les fonctions `pickPersona`, `resolveHome`, `submitCode`, `fmtClock`, `onMount`, `onDestroy` — à conserver (sauf `clockInterval` qu'on garde aussi)
- Les variables CSS héritées (`--paper`, `--ink`, `--vermillon`, `--rule-strong`, `--font`, `--font-ui`, `--font-mono`, `--touch-min`, `--fs-small`, `--max-width`, `--ink-40`, `--ink-70`, `--ink-90`, `--ink-20`, `--rule`, `--paper-subtle`, `--grid`) — à réutiliser, ne pas redéfinir

- [ ] **Step 2: Réécrire le fichier**

Contenu complet attendu :

```svelte
<script>
  import { onMount, onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import { accessCode, sessionToken } from "$lib/stores/auth.js";

  // Live clock — petit clin d'œil "lab" qui ne ment pas.
  let now = $state(new Date());
  let clockInterval;
  const BUILD_HASH = import.meta.env.VITE_BUILD_HASH ?? "dev";

  // Access form state
  let codeInput = $state("");
  let authLoading = $state(false);
  let authError = $state("");
  let authShake = $state(false);

  function pickPersona(personas) {
    if (!Array.isArray(personas) || personas.length === 0) return null;
    try {
      const lastId = localStorage.getItem("vc_last_persona");
      if (lastId) {
        const match = personas.find((p) => p.id === lastId);
        if (match) return match;
        localStorage.removeItem("vc_last_persona");
      }
    } catch {}
    return personas[0];
  }

  async function resolveHome(codeOverride) {
    try {
      const headers = codeOverride ? { "x-access-code": codeOverride } : {};
      if (!codeOverride && $accessCode) headers["x-access-code"] = $accessCode;
      if (!codeOverride && $sessionToken) headers["x-session-token"] = $sessionToken;
      const resp = await fetch("/api/personas", { headers });
      if (!resp.ok) return "/create";
      const data = await resp.json();
      const target = pickPersona(data.personas);
      return target ? `/chat/${target.id}` : "/create";
    } catch {
      return "/create";
    }
  }

  onMount(async () => {
    clockInterval = setInterval(() => { now = new Date(); }, 1000);
    if ($accessCode || $sessionToken) {
      const dest = await resolveHome();
      goto(dest);
    }
  });

  onDestroy(() => {
    clearInterval(clockInterval);
  });

  async function submitCode(e) {
    e?.preventDefault?.();
    const code = codeInput.trim();
    if (!code) return;
    authError = "";
    authLoading = true;
    try {
      const resp = await fetch("/api/personas", { headers: { "x-access-code": code } });
      if (resp.status === 403) {
        authError = "refusé";
        authShake = true;
        setTimeout(() => { authShake = false; }, 300);
        authLoading = false;
        return;
      }
      if (!resp.ok) throw new Error("server");
      const data = await resp.json();
      accessCode.set(code);
      if (data.session?.token) sessionToken.set(data.session.token);
      const target = pickPersona(data.personas);
      goto(target ? `/chat/${target.id}` : "/create");
    } catch {
      authError = "erreur réseau";
      authLoading = false;
    }
  }

  function fmtClock(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
  }
</script>

<svelte:head>
  <title>VoiceClone — accès</title>
</svelte:head>

<a href="#main" class="skip-link">Aller au contenu principal</a>

<main class="page" id="main">
  <header class="head">
    <div class="brand">
      <span class="brand-mark">◎</span>
      <span class="brand-name">VoiceClone</span>
    </div>
    <nav class="head-meta">
      <span class="kv"><span class="k">heure</span><span class="v">{fmtClock(now)}</span></span>
      <span class="kv"><span class="k">version</span><span class="v">{BUILD_HASH}</span></span>
    </nav>
  </header>

  <section class="hero">
    <h1 class="hero-mark">◎ VoiceClone</h1>
    <p class="hero-tag">Un clone d'écriture qui apprend de tes corrections.</p>
    <p class="hero-body">
      Tu lui parles d'un prospect, il propose un message. Tu valides, ou tu le
      reprends en deux mots. La fois d'après, il a retenu. Au bout de cent
      corrections, il écrit comme toi.
    </p>

    <form class="access" onsubmit={submitCode}>
      <span class="access-k">◇ accès</span>
      <input
        type="password"
        autocomplete="off"
        placeholder="code"
        bind:value={codeInput}
        class:shake={authShake}
        disabled={authLoading}
      />
      <button type="submit" disabled={authLoading}>
        {authLoading ? "…" : "→"}
      </button>
      {#if authError}<span class="access-err">{authError}</span>{/if}
    </form>
  </section>

  <footer class="foot">
    <a class="foot-link" href="/guide">guide</a>
  </footer>
</main>

<style>
  .page {
    min-height: 100dvh;
    padding: 0;
    background:
      linear-gradient(var(--grid) 1px, transparent 1px) 0 0 / 100% 24px,
      var(--paper);
    color: var(--ink);
    font-family: var(--font-ui);
    display: flex;
    flex-direction: column;
  }

  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 20px;
    border-bottom: 1px solid var(--rule-strong);
    font-family: var(--font-mono);
    font-size: 11px;
    gap: 20px;
    flex-wrap: wrap;
  }
  .brand { display: inline-flex; align-items: baseline; gap: 8px; letter-spacing: 0.01em; }
  .brand-mark { color: var(--vermillon); font-size: 14px; }
  .brand-name { font-weight: 600; color: var(--ink); }
  .head-meta { display: inline-flex; gap: 20px; flex-wrap: wrap; }
  .kv { display: inline-flex; gap: 6px; align-items: baseline; }
  .k { color: var(--ink-40); }
  .v { color: var(--ink); font-variant-numeric: tabular-nums; }

  .hero {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 64px 20px;
    max-width: 640px;
    margin: 0 auto;
    width: 100%;
    gap: 20px;
    text-align: center;
  }
  .hero-mark {
    font-family: var(--font);
    font-size: clamp(28px, 4vw, 40px);
    font-weight: 500;
    color: var(--ink);
    margin: 0;
    letter-spacing: -0.01em;
  }
  .hero-tag {
    font-family: var(--font);
    font-size: clamp(18px, 2.4vw, 22px);
    font-style: italic;
    color: var(--vermillon);
    margin: 0;
    line-height: 1.3;
    max-width: 38ch;
  }
  .hero-body {
    font-family: var(--font-ui);
    font-size: 15px;
    line-height: 1.6;
    color: var(--ink-70);
    margin: 0;
    max-width: 50ch;
  }

  .access {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    margin-top: 24px;
    padding: 14px 18px;
    border: 1px solid var(--rule-strong);
    background: var(--paper-subtle, transparent);
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--ink-40);
  }
  .access-k { color: var(--ink-40); }
  .access input {
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--ink-20);
    padding: 6px 8px;
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--ink);
    width: 140px;
    transition: border-color 0.08s linear;
    outline: none;
  }
  .access input:focus { border-bottom-color: var(--vermillon); }
  .access input::placeholder { color: var(--ink-20); }
  .access button {
    background: transparent;
    border: 1px solid var(--ink-20);
    padding: 4px 12px;
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--ink);
    cursor: pointer;
    transition: border-color 0.08s linear, color 0.08s linear;
  }
  .access button:hover { border-color: var(--vermillon); color: var(--vermillon); }
  .access button:disabled { opacity: 0.4; cursor: not-allowed; }
  .access-err { color: var(--vermillon); margin-left: 4px; }

  .shake { animation: shake 0.28s linear; }
  @keyframes shake {
    20%, 60% { transform: translateX(-3px); }
    40%, 80% { transform: translateX(3px); }
  }

  .foot {
    display: flex;
    justify-content: center;
    padding: 20px;
    border-top: 1px solid var(--rule-strong);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-40);
  }
  .foot-link {
    color: var(--ink-70);
    text-decoration: none;
    border-bottom: 1px dashed var(--ink-40);
  }
  .foot-link:hover { color: var(--vermillon); border-bottom-color: var(--vermillon); }

  @media (max-width: 480px) {
    .head-meta .kv:nth-child(1) { display: none; }
    .access {
      flex-wrap: wrap;
      width: 100%;
      max-width: 320px;
    }
    .access input {
      width: 100%;
      min-height: var(--touch-min);
      font-size: var(--fs-small);
    }
    .access button {
      min-height: var(--touch-min);
      min-width: var(--touch-min);
      font-size: var(--fs-small);
    }
  }
</style>
```

- [ ] **Step 3: Lancer le test du Chunk 2 — il doit passer**

```bash
node --test test/landing-page.test.js
```

Expected: tous les tests `pass`. Si un test échoue, lire le message, ajuster le code source pour respecter le critère, recommencer. Ne pas modifier le test pour le faire passer.

- [ ] **Step 4: Lancer la suite complète pour vérifier qu'on n'a rien cassé**

```bash
npm test
```

Expected: tous les tests existants restent verts. Si un test ailleurs casse, c'est probablement un consommateur caché de quelque chose qu'on a supprimé — investiguer avant de continuer.

- [ ] **Step 5: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat(landing): refonte page d'accueil — copy honnête, démo killée"
```

---

## Chunk 4 — Cleanup orphans

### Task 4.1: Supprimer `src/lib/landing-demo.js`

**Files:**
- Delete: `src/lib/landing-demo.js`

- [ ] **Step 1: Vérifier zéro consommateur restant (paranoïa)**

```bash
grep -rn "landing-demo" src/ api/ test/ 2>/dev/null || echo "no matches"
```

Expected: aucune ligne (sauf éventuellement `src/lib/scenarios.js` qu'on nettoie au step suivant).

- [ ] **Step 2: Supprimer le fichier**

```bash
git rm src/lib/landing-demo.js
```

- [ ] **Step 3: Lancer la suite de tests**

```bash
npm test
```

Expected: tous verts.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove landing-demo.js (no consumers after landing refonte)"
```

### Task 4.2: Nettoyer le commentaire orphelin dans `scenarios.js`

**Files:**
- Modify: `src/lib/scenarios.js`

- [ ] **Step 1: Lire la ligne 30 et son contexte**

```bash
sed -n '25,35p' src/lib/scenarios.js
```

Expected output: contient une ligne du genre `// unrelated landing-demo SCENARIOS array in $lib/landing-demo.js.` (et probablement les lignes voisines qui forment la mise en garde "do not confuse with").

- [ ] **Step 2: Supprimer cette ligne (et les lignes voisines de la mise en garde si elles n'ont plus de sens isolément)**

Utiliser l'outil Edit pour retirer la phrase qui mentionne `landing-demo.js`. Garder uniquement le commentaire si la phrase précédente reste utile ; sinon supprimer le bloc entier.

- [ ] **Step 3: Vérifier qu'il ne reste plus aucune mention**

```bash
grep -n "landing-demo" src/lib/scenarios.js && echo "FOUND" || echo "clean"
```

Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/scenarios.js
git commit -m "chore(scenarios): remove orphan reference to deleted landing-demo.js"
```

---

## Chunk 5 — Verification SSR

### Task 5.1: Smoke test SSR + manuel

**Files:** (aucun — pure verification)

- [ ] **Step 1: Build de prod**

```bash
npm run build
```

Expected: build success, sortie indique que `/` est un endpoint SSR. Noter la taille du chunk JS associé à `/` (devrait être nettement plus petit qu'avant).

- [ ] **Step 2: Lancer le serveur de preview**

```bash
npm run preview -- --port 5175 &
sleep 3
```

- [ ] **Step 3: Vérifier le SSR — hero présent dans le HTML brut**

```bash
curl -s http://localhost:5175/ > /tmp/ssr.html
grep -c "Un clone d'écriture qui apprend de tes corrections" /tmp/ssr.html
grep -c "submitCode\|access" /tmp/ssr.html
grep -c "pipeline 4 étapes\|BUILD_HASH\|laboratoire" /tmp/ssr.html
```

Expected:
- premier grep : ≥ 1 (hero copy SSR-rendered)
- deuxième grep : ≥ 1 (markup form présent)
- troisième grep : 0 (rien des chaînes interdites)

- [ ] **Step 4: Vérifier le hash de version dans le HTML servi**

```bash
grep -oE 'version</span><span class="v">[a-f0-9]{7}' /tmp/ssr.html | head -1
```

Expected: une chaîne se terminant par 7 caractères hex (le hash réel du commit). Pas `25e585b` (l'ancien hardcodé), pas `dev`, pas vide.

- [ ] **Step 5: Stopper le preview**

```bash
kill %1 2>/dev/null || true
```

- [ ] **Step 6 (manuel) : Smoke test browser**

Ouvrir `http://localhost:5175/` dans un navigateur. Vérifier visuellement :
- Header sobre (brand + heure + version)
- Hero centré avec la copy validée
- Formulaire d'accès visible et utilisable (essayer un faux code → "refusé" en rouge avec animation shake)
- Footer minimal avec lien "guide"
- Pas de panels qui clignotent, pas de scenario carousel

- [ ] **Step 7: Si tout passe, dernier commit (souvent rien à committer ; sinon ajustements visuels mineurs)**

```bash
git status
# Si modifs CSS mineures suite au smoke visuel :
git add -p
git commit -m "polish(landing): ajustements visuels après smoke"
```

---

## Définitions de "done"

Cette PR est mergeable quand :

1. ✅ `node --test test/landing-page.test.js` passe (tous les critères source vérifiés)
2. ✅ `npm test` passe (aucune régression sur le reste)
3. ✅ `npm run build` réussit
4. ✅ Smoke SSR : la copy du hero apparaît dans le HTML brut, les chaînes interdites n'y sont plus, le hash de version est un vrai hash
5. ✅ Smoke browser : la page rendue correspond visuellement au design (header sobre, hero centré, form promu, footer slim)
6. ✅ Commits sont atomiques par task (5–7 commits au total)

## Hors scope (à ne PAS faire dans cette PR)

- Refonte de `/guide` ou `/create` — ne pas toucher
- Nouvelle page marketing pour prospects froids — décidé en brainstorming, pas de douleur d'acquisition validée
- Tests visuels Playwright/Cypress — overkill pour cette refonte, smoke manuel suffit
- Refactor des stores `auth.js` ou de l'API `/api/personas` — orthogonal
