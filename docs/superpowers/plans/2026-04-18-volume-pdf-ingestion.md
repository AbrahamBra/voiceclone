# Volume PDF Ingestion at Clone Creation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow uploading many PDF/DOCX/TXT files during clone creation without blocking the browser or blowing the LLM request size — by routing each file through the existing per-file ingestion pipeline instead of concatenating them into one blob.

**Architecture:** Split clone creation into two phases. Phase 1 creates the persona from LinkedIn profile + posts/DMs only (same `/api/clone` endpoint, just stop sending `documents`). Phase 2 ingests each uploaded file sequentially via the existing `/api/knowledge` endpoint (which already chunks, embeds, and extracts entities per-file). Shared client-side extraction helpers (PDF/DOCX → text) get pulled into a reusable module.

**Tech Stack:** SvelteKit (Svelte 5 runes), Node serverless functions on Vercel, Supabase, `@anthropic-ai/sdk`, `pdfjs-dist`, `mammoth`, `node --test`.

---

## File Structure

**Create:**
- `src/lib/file-extraction.js` — shared helpers `extractFileText(file)` used by both `create/+page.svelte` and `KnowledgePanel.svelte`. Pure, testable wrappers around `pdfjs-dist` and `mammoth`.
- `test/file-extraction.test.js` — unit tests for the helpers using fixtures.
- `test/fixtures/sample.docx`, `test/fixtures/sample.txt` — minimal fixtures.

**Modify:**
- `src/routes/create/+page.svelte` — replace `docsText`/`docBlocks`/`fileTags` mess with a single `pendingFiles: [{name, content, status}]` array. Remove the broken `extractDocxText`. Change `createClone()` to call `/api/clone` without `documents`, then loop `pendingFiles` through `/api/knowledge`.
- `src/lib/components/KnowledgePanel.svelte` — replace inline extraction logic in `handleFile()` with a call to `extractFileText()` (DRY).

**Untouched (intentionally):**
- `api/clone.js` — `documents` field stays accepted for backward compat, we just stop sending it from this flow.
- `api/knowledge.js` — already handles per-file ingestion correctly.

---

## Scope Boundaries

**In scope:**
- Fix the silently-broken DOCX extraction on the create page (does not use mammoth today).
- Route bulk uploads through per-file ingestion during clone creation.
- Per-file progress UI.
- DRY between create page and KnowledgePanel.

**Out of scope (explicit):**
- Server-side extraction (client-side per-file extraction is fine once we stop concatenating).
- OCR / scanned PDFs.
- Batch-ingest from a filesystem path.
- Web UI for resumable uploads if the user closes the tab mid-way.

---

## Chunk 1: Shared extraction helpers (DRY)

### Task 1: Create `file-extraction.js` with failing tests

**Files:**
- Create: `src/lib/file-extraction.js`
- Create: `test/file-extraction.test.js`
- Create: `test/fixtures/sample.txt` (content: `"hello world"`)
- Create: `test/fixtures/sample.docx` (minimal valid .docx — generate with mammoth in a one-off script or copy an existing Word doc)

- [ ] **Step 1: Create fixtures directory and a trivial .txt fixture**

```bash
mkdir -p test/fixtures
printf 'hello world' > test/fixtures/sample.txt
```

- [ ] **Step 2: Generate a minimal sample.docx fixture**

```bash
node -e "
const fs = require('fs');
const { execSync } = require('child_process');
// Use a known-good docx: create via Python or curl a sample. Fallback:
// copy any real .docx from the user's filesystem, or generate via officegen.
// Simplest: use docx from a knowledge/topics fixture if present, else skip docx tests.
" 2>/dev/null || echo "Generate manually: any small .docx saved as test/fixtures/sample.docx"
```

If automated generation is awkward, commit a hand-crafted 1 KB `sample.docx` saved from Word/LibreOffice containing the literal text `hello world`.

- [ ] **Step 3: Write the failing test**

```javascript
// test/file-extraction.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractFileText } from "../src/lib/file-extraction.js";

function fileFromFixture(path, type) {
  const buf = readFileSync(path);
  return {
    name: path.split(/[\\/]/).pop(),
    type,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    text: async () => buf.toString("utf8"),
  };
}

test("extractFileText reads plain text", async () => {
  const file = fileFromFixture("test/fixtures/sample.txt", "text/plain");
  const text = await extractFileText(file);
  assert.equal(text.trim(), "hello world");
});

test("extractFileText reads docx via mammoth", async () => {
  const file = fileFromFixture("test/fixtures/sample.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const text = await extractFileText(file);
  assert.match(text, /hello world/i);
});

test("extractFileText rejects unknown formats", async () => {
  const file = { name: "x.bin", type: "application/octet-stream", arrayBuffer: async () => new ArrayBuffer(0) };
  await assert.rejects(() => extractFileText(file), /unsupported/i);
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `node --test test/file-extraction.test.js`
Expected: FAIL with `Cannot find module '../src/lib/file-extraction.js'`.

- [ ] **Step 5: Implement `extractFileText`**

```javascript
// src/lib/file-extraction.js
export async function extractFileText(file) {
  const name = (file.name || "").toLowerCase();

  if (file.type === "text/plain" || name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".csv")) {
    return await file.text();
  }

  if (name.endsWith(".pdf")) {
    const pdfjsLib = await import("pdfjs-dist");
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc && typeof window !== "undefined") {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).href;
    }
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => item.str).join(" "));
    }
    return pages.join("\n\n");
  }

  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  }

  throw new Error(`Unsupported file format: ${name}`);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test test/file-extraction.test.js`
Expected: 3 pass, 0 fail. If the PDF path is exercised indirectly, ensure `pdfjs-dist` dynamic import resolves — skip the PDF test if it requires a browser polyfill we don't have in Node.

- [ ] **Step 7: Commit**

```bash
git add src/lib/file-extraction.js test/file-extraction.test.js test/fixtures/
git commit -m "feat: shared file-extraction helper (txt/pdf/docx)"
```

---

### Task 2: Wire `KnowledgePanel.svelte` to use the shared helper

**Files:**
- Modify: `src/lib/components/KnowledgePanel.svelte:144-192`

- [ ] **Step 1: Import the helper at the top of the script block**

```javascript
import { extractFileText } from "$lib/file-extraction.js";
```

- [ ] **Step 2: Replace the inline extraction in `handleFile`**

Before (KnowledgePanel.svelte:152-192):
```javascript
try {
  if (file.type === "text/plain" || file.name.endsWith(".txt") || ...) {
    // ~40 lines of inline extraction
  }
} catch { showToast("Erreur de lecture..."); return; }
```

After:
```javascript
let text = "";
try {
  text = await extractFileText(file);
} catch (err) {
  if (/unsupported/i.test(err.message)) {
    showToast("Format non supporté (.txt, .pdf, .docx uniquement)");
  } else {
    showToast("Erreur de lecture. Essayez de copier-coller le texte.");
  }
  uploading = false; currentStep = -1; uploadCurrent = 0; uploadTotal = 0;
  return;
}
```

- [ ] **Step 3: Verify manually**

Start dev server (`npm run dev`), open an existing clone, upload a PDF via the knowledge panel, confirm it still ingests. No regression.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/KnowledgePanel.svelte
git commit -m "refactor: KnowledgePanel uses shared extractFileText helper"
```

---

## Chunk 2: Creation flow — decouple clone from corpus

### Task 3: Replace `docsText` state with `pendingFiles` in create page

**Files:**
- Modify: `src/routes/create/+page.svelte:38-144` (state + helpers)

- [ ] **Step 1: Replace state block**

Before (`src/routes/create/+page.svelte:38-47`):
```javascript
// Step 4: Documents + Génération
let docsText = $state("");
let showDocs = $state(false);
let fileTags = $state([]);
let fileInputEl;
let docBlocks = $state([]);
let currentDocTitle = $state("");
let currentDocContent = $state("");
let generating = $state(false);
let generateStatus = $state("");
```

After:
```javascript
// Step 4: Documents + Génération
let pendingFiles = $state([]); // [{ name, content, status: 'pending'|'uploading'|'done'|'error' }]
let fileInputEl;
let showDocs = $state(false);
let currentDocTitle = $state("");
let currentDocContent = $state("");
let generating = $state(false);
let generateStatus = $state("");
let ingestProgress = $state({ current: 0, total: 0 });
```

- [ ] **Step 2: Rewrite `handleFiles` to populate `pendingFiles` via shared helper**

```javascript
import { extractFileText } from "$lib/file-extraction.js";

async function handleFiles(e) {
  const files = Array.from(e.target.files);
  for (const file of files) {
    try {
      const content = await extractFileText(file);
      if (!content.trim()) {
        pendingFiles = [...pendingFiles, { name: file.name, content: "", status: "error", error: "vide" }];
        continue;
      }
      pendingFiles = [...pendingFiles, { name: file.name, content, status: "pending" }];
    } catch (err) {
      pendingFiles = [...pendingFiles, { name: file.name, content: "", status: "error", error: err.message || "illisible" }];
    }
  }
  e.target.value = "";
}

function removePendingFile(i) {
  pendingFiles = pendingFiles.filter((_, idx) => idx !== i);
}
```

- [ ] **Step 3: Remove `extractPdfText`, `extractDocxText`, `addDocBlock`, `removeDocBlock`, and all `docBlocks`/`docsText` references**

Delete lines `src/routes/create/+page.svelte:81-143` (the pasted-block helpers and broken extraction).

- [ ] **Step 4: Verify the page still compiles**

Run: `npm run dev` and navigate to `/create`. The template will now reference removed state — expected, next task fixes the template.

Don't commit yet — template is broken.

---

### Task 4: Update the create page template to show `pendingFiles`

**Files:**
- Modify: `src/routes/create/+page.svelte` (the `step === 'docs'` template block)

- [ ] **Step 1: Locate the docs step template**

Find the `{#if step === 'docs'}` block. It currently renders `docBlocks` + `fileTags` + a textarea. Simplify to a single list of `pendingFiles`.

- [ ] **Step 2: Replace with minimal template**

```svelte
{#if step === 'docs'}
  <div class="step-body">
    <h3>Documents (optionnel)</h3>
    <p class="muted">PDF, DOCX, TXT, MD. Chaque fichier sera absorbé individuellement après création du clone.</p>

    <div class="file-upload-zone">
      <input
        bind:this={fileInputEl}
        type="file"
        accept=".pdf,.docx,.txt,.md,.csv"
        multiple
        onchange={handleFiles}
        style="display:none"
      />
      <button class="file-upload-btn" onclick={() => fileInputEl.click()}>
        + Ajouter des fichiers
      </button>
      <span class="rubric-src mono">pdf · docx · txt · md</span>
    </div>

    {#if pendingFiles.length > 0}
      <ul class="pending-files">
        {#each pendingFiles as f, i}
          <li class:err={f.status === 'error'} class:done={f.status === 'done'}>
            <span class="fname">{f.name}</span>
            <span class="fsize">{(f.content.length / 1000).toFixed(1)} k caractères</span>
            {#if f.status === 'pending'}
              <button class="icon-btn" onclick={() => removePendingFile(i)} aria-label="Retirer">×</button>
            {:else if f.status === 'uploading'}
              <span class="status">absorption…</span>
            {:else if f.status === 'done'}
              <span class="status">✓</span>
            {:else if f.status === 'error'}
              <span class="status">✗ {f.error || 'erreur'}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if generating}
      <div class="progress">
        {#if ingestProgress.total > 0}
          Absorption {ingestProgress.current}/{ingestProgress.total}…
        {:else}
          {generateStatus}
        {/if}
      </div>
    {/if}

    <div class="step-actions">
      <button onclick={prevStep} disabled={generating}>← Retour</button>
      <button class="primary" onclick={createClone} disabled={generating}>
        {generating ? 'Création…' : 'Créer le clone'}
      </button>
    </div>
  </div>
{/if}
```

- [ ] **Step 3: Verify the page renders**

Run `npm run dev`, navigate through the steps, reach the docs step, add a couple of files, confirm they appear in the list with size and removable.

Don't commit yet — `createClone` still sends `docsText`.

---

### Task 5: Rewrite `createClone` to do two-phase ingestion

**Files:**
- Modify: `src/routes/create/+page.svelte:146-191`

- [ ] **Step 1: Replace `createClone` with two-phase version**

```javascript
async function createClone() {
  const linkedin = [
    personaName.trim() && `Nom: ${personaName.trim()}`,
    personaTitle.trim() && `Titre: ${personaTitle.trim()}`,
    profileText.trim(),
  ].filter(Boolean).join("\n\n");

  const posts = postsText.trim().split(/\n---\n/).map(p => p.trim()).filter(p => p.length > 30);
  if (cloneType !== 'dm' && posts.length < 3) {
    showToast("Minimum 3 posts (séparés par ---)");
    return;
  }
  const dms = dmsText.trim()
    ? dmsText.trim().split(/\n---\n/).map(d => d.trim()).filter(d => d.length > 20)
    : [];

  generating = true;
  generateStatus = "Création du clone (20-30 s)…";
  ingestProgress = { current: 0, total: 0 };

  let persona;
  try {
    // Phase 1: create the persona (no documents)
    const data = await api("/api/clone", {
      method: "POST",
      body: JSON.stringify({
        linkedin_text: linkedin,
        posts: cloneType !== 'dm' ? posts : undefined,
        dms: dms.length > 0 ? dms : undefined,
        name: personaName.trim() || undefined,
        cloneType,
      }),
    });
    persona = data.persona;
  } catch (err) {
    if (err.status === 402) {
      generateStatus = "Budget dépassé. Ajoutez votre clé API dans les paramètres.";
    } else if (err.status === 403) {
      generateStatus = err.data?.error || "Limite de clones atteinte";
    } else {
      generateStatus = "Erreur: " + (err.message || "Server error");
    }
    generating = false;
    return;
  }

  // Phase 2: absorb each file via /api/knowledge (sequential to respect rate limits)
  const toUpload = pendingFiles.filter(f => f.status === 'pending' && f.content.trim());
  ingestProgress = { current: 0, total: toUpload.length };

  for (let i = 0; i < toUpload.length; i++) {
    const f = toUpload[i];
    const idx = pendingFiles.indexOf(f);
    pendingFiles[idx] = { ...f, status: 'uploading' };
    pendingFiles = [...pendingFiles];
    try {
      await api("/api/knowledge", {
        method: "POST",
        body: JSON.stringify({
          personaId: persona.id,
          filename: f.name,
          content: f.content.slice(0, 200_000),
        }),
      });
      pendingFiles[idx] = { ...f, status: 'done' };
    } catch (err) {
      pendingFiles[idx] = { ...f, status: 'error', error: err.message || 'erreur' };
    }
    pendingFiles = [...pendingFiles];
    ingestProgress = { current: i + 1, total: toUpload.length };
  }

  generateStatus = `Clone "${persona.name}" créé !`;
  setTimeout(() => { goto(`/calibrate/${persona.id}`); }, 800);
}
```

- [ ] **Step 2: Verify full flow in browser**

Run `npm run dev`. Create a clone with 2-3 small PDFs. Expected:
- Phase 1 completes in ~20-30 s.
- Then `Absorption 1/3…`, `2/3…`, `3/3…` progresses.
- Each file item turns to `✓` as it completes.
- Redirect to `/calibrate/:id` happens.
- Open the new persona's knowledge panel: the uploaded files appear there.

- [ ] **Step 3: Verify single-file and zero-file flows still work**

- Zero files → no phase 2, direct redirect.
- One large file → single-step phase 2.

- [ ] **Step 4: Commit**

```bash
git add src/routes/create/+page.svelte
git commit -m "feat: two-phase clone creation — per-file ingestion for volume"
```

---

## Chunk 3: Verification and cleanup

### Task 6: Verify regression-free on existing tests

- [ ] **Step 1: Run the full test suite**

Run: `npm test` (resolves to `node --test test/*.test.js`).
Expected: all pre-existing tests still pass, plus the 3 new `file-extraction` tests.

If any existing test breaks, diagnose before moving on — don't paper over.

- [ ] **Step 2: Verify type-check / build still works**

Run: `npm run build`.
Expected: build succeeds.

- [ ] **Step 3: Manual smoke — knowledge panel post-creation still accepts files**

Open an existing persona, upload a PDF via the KnowledgePanel. Confirm extraction still works (same shared helper).

---

### Task 7: Final commit — mark plan done

- [ ] **Step 1: Mark the plan file with completion note**

Append at the bottom of `docs/superpowers/plans/2026-04-18-volume-pdf-ingestion.md`:

```markdown
---

## Completion

Implemented: YYYY-MM-DD
Commits:
- <sha> feat: shared file-extraction helper
- <sha> refactor: KnowledgePanel uses shared helper
- <sha> feat: two-phase clone creation
```

- [ ] **Step 2: Final commit**

```bash
git add docs/superpowers/plans/2026-04-18-volume-pdf-ingestion.md
git commit -m "docs: mark volume-pdf-ingestion plan complete"
```

---

## Rollback strategy

Everything is on a branch/worktree. Any step's regression reverts with `git revert <sha>`. The API endpoints are untouched, so a rollback of the UI doesn't require DB migration or backend redeploy coordination.

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| `pdfjs-dist` tests fail in Node due to DOM deps | Skip PDF test path in Node; test via browser dev server manually |
| `mammoth` needs a real .docx fixture | Commit a hand-crafted 1 KB .docx fixture |
| `/api/knowledge` rate limits on many files | Sequential loop (already in plan) — no parallel bursts |
| User closes tab mid phase-2 | Out of scope — acceptable loss, files can be re-uploaded post-creation via KnowledgePanel |
| `persona.id` naming mismatch on Supabase `intelligence_source_id` | `/api/knowledge` already resolves via `getIntelligenceId` — works out of the box |
