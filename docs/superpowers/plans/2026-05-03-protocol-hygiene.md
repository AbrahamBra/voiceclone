# Protocol Hygiene — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nettoyer deux sources de bruit dans le protocole Nicolas qui polluent les outputs chat : (1) purger les ~12 entrées legacy `voice.writingRules` injectées dans le prompt en parallèle du protocole V2, (2) nettoyer la section identity (~23k chars de dump Notion brut avec caractères mojibake et balises `<aside>`).

**Architecture:**
- Audit-first : un script lit l'état actuel de chaque persona et émet un rapport. Aucune écriture sans validation utilisateur.
- Migration des `writingRules` jugés utiles vers le protocole V2 comme propositions (intent=`add_rule`, target_kind=`hard_rules` ou `errors` selon le cas), via le pipeline normal d'extraction puis triage manuel ou via Plan A.
- Nettoyage identity en deux passes : (a) sanitization syntaxique (mojibake, tags HTML/Notion) sans perte de contenu, (b) ré-extraction LLM si besoin pour réduire à du prose dense.
- Backup systématique avant toute mutation : on snapshot la persona dans `scripts/_tmp-persona-backup-<persona>-<timestamp>.json`.

**Tech Stack:**
- Node.js 24 + `@supabase/supabase-js`
- Anthropic SDK pour la phase de ré-extraction identity
- Node test runner natif (`node --test`)

**Out of scope :**
- Plan A (triage + revert) gère le devenir des propositions générées par cette purge — si Plan A est déjà déployé, les propositions issues d'ici tombent dans son pipeline. Sinon elles restent pending pour review manuelle dans l'UI existante.
- Plan C (picker dynamique + suppression limite 30) — orthogonal.

---

## Context Snapshot

**voice.writingRules :**
- Stocké dans `personas.voice` JSONB, accessible via `v.writingRules` dans `lib/prompt.js:149`.
- Concaténé en une seule ligne : `"- Regles d'ecriture : <rule1> ; <rule2> ; ..."` injectée dans le system prompt.
- Sur Nicolas : 12 entrées (chiffre annoncé par l'utilisateur 2026-05-03 — à confirmer par audit Task 1).
- Coexiste avec les `protocol_artifact` V2 du nouveau système. Contradictions et redondances probables.

**Identity section :**
- `protocol_section` avec `kind='identity'`, `order=0` sur le doc actif Nicolas (cf migration 067).
- ~23k chars de prose contenant : caractères mojibake (`?ￂﾠ` au lieu d'espace insécable), balises Notion (`<aside>`, etc.), structure brute non-narrative.
- Utilisé par le prompt assembly (cf `lib/prompt.js`) — donc directement visible au LLM.

---

## File Structure

**À créer :**

| Path | Responsabilité |
|---|---|
| `scripts/audit-voice-writing-rules.js` | Lecture + rapport par persona des `voice.writingRules` actuelles, croisée avec les artifacts V2 existants pour détecter doublons sémantiques |
| `scripts/migrate-voice-rules-to-v2.js` | Pour chaque rule retenue : crée une proposition `pending` avec target_kind=`hard_rules` (ou autre, configurable). Backup avant. |
| `scripts/wipe-voice-writing-rules.js` | Vide `personas.voice.writingRules = []` après confirmation. Backup avant. |
| `scripts/sanitize-identity-section.js` | Nettoyage syntaxique non-destructif (mojibake → unicode propre, strip `<aside>` etc.). Sortie : nouvelle prose proposée + diff caractère par caractère pour review. |
| `scripts/reextract-identity-section.js` | Wrapper Sonnet : prend la prose nettoyée (Task 4), demande "réécris en prose dense de 2-3k chars en gardant tout ce qui est substantif (parcours, voix, convictions)". Met à jour `protocol_section.prose`. |
| `lib/identity-sanitizer.js` | Pure functions de sanitization (réutilisable, testable) |
| `test/identity-sanitizer.test.js` | Tests des règles de sanitization |

**À modifier :**

| Path | Modification |
|---|---|
| `lib/prompt.js:149` | Optionnel selon décision Task 5 : si on garde `writingRules` vide pour audit (assert tableau vide en runtime), pas de change. Si on supprime carrément l'injection, retirer la ligne 149 (et 147-148 par cohérence si on bascule tout sur le V2). |

---

## Task 1: Audit voice.writingRules across all active personas

**Files:**
- Create: `scripts/audit-voice-writing-rules.js`

- [ ] **Step 1: Write the audit script**

```js
// scripts/audit-voice-writing-rules.js
//
// Lecture + rapport : pour chaque persona active, dump voice.writingRules,
// voice.forbiddenWords, voice.neverDoes — et croise avec les artifacts V2
// déjà actifs pour signaler les doublons sémantiques évidents (string
// inclusion, à défaut de matching embedding qu'on garde pour Task 2 si besoin).
//
// Usage :
//   node --env-file=.env.local scripts/audit-voice-writing-rules.js [--persona=<slug>]
//
// Sortie : tableau lisible + JSON file dans scripts/_tmp-audit-voice-<timestamp>.json

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: "C:/Users/abrah/AhmetA/.env.local" });

const personaArg = process.argv.find((a) => a.startsWith("--persona="))?.split("=")[1] || null;

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function audit() {
  let q = sb.from("personas").select("id, name, slug, voice").not("voice", "is", null);
  if (personaArg) q = q.eq("slug", personaArg);
  const { data: personas } = await q;
  if (!personas || personas.length === 0) {
    console.log("No personas with a voice JSONB found.");
    return;
  }

  const report = [];
  for (const p of personas) {
    const v = p.voice || {};
    const writingRules = Array.isArray(v.writingRules) ? v.writingRules : [];
    const forbiddenWords = Array.isArray(v.forbiddenWords) ? v.forbiddenWords : [];
    const neverDoes = Array.isArray(v.neverDoes) ? v.neverDoes : [];

    // Pull active V2 artifacts of kind hard_check / pattern for comparison.
    const { data: doc } = await sb.from("protocol_document")
      .select("id").eq("owner_kind", "persona").eq("owner_id", p.id)
      .is("source_core", null).eq("status", "active").maybeSingle();

    let artifactTexts = [];
    if (doc) {
      const { data: sections } = await sb.from("protocol_section").select("id").eq("document_id", doc.id);
      const sectionIds = (sections || []).map((s) => s.id);
      if (sectionIds.length > 0) {
        const { data: artifacts } = await sb.from("protocol_artifact")
          .select("content").in("source_section_id", sectionIds).eq("is_active", true);
        artifactTexts = (artifacts || []).map((a) => (a.content?.text || "").toLowerCase());
      }
    }

    function findOverlap(rule) {
      const r = (rule || "").toLowerCase();
      if (!r) return null;
      // Cheap heuristic : substring (≥10 chars) intersection.
      for (const t of artifactTexts) {
        if (r.length >= 10 && (t.includes(r) || r.includes(t))) return t.slice(0, 80);
      }
      return null;
    }

    const enrichedRules = writingRules.map((r, i) => ({
      idx: i,
      text: r,
      v2_overlap: findOverlap(r),
    }));

    report.push({
      persona: { id: p.id, name: p.name, slug: p.slug },
      counts: {
        writingRules: writingRules.length,
        forbiddenWords: forbiddenWords.length,
        neverDoes: neverDoes.length,
        v2_artifacts: artifactTexts.length,
      },
      writingRules: enrichedRules,
      forbiddenWords,
      neverDoes,
    });
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const out = `scripts/_tmp-audit-voice-${ts}.json`;
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`✓ Audit written to ${out}\n`);

  // Pretty print
  for (const r of report) {
    console.log(`\n=== ${r.persona.name} (${r.persona.slug}) ===`);
    console.log(`  writingRules: ${r.counts.writingRules}, forbiddenWords: ${r.counts.forbiddenWords}, neverDoes: ${r.counts.neverDoes}, v2_artifacts: ${r.counts.v2_artifacts}`);
    for (const rule of r.writingRules) {
      const tag = rule.v2_overlap ? `🔁 maybe duplicates "${rule.v2_overlap}"` : "✓ unique";
      console.log(`  [${rule.idx}] ${tag}`);
      console.log(`        ${rule.text}`);
    }
  }
}

audit().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run on Nicolas first**

```bash
node --env-file=.env.local scripts/audit-voice-writing-rules.js --persona=nicolas-lavall-e
```

Expected output: a list of the 12 rules with overlap detection, plus a JSON dump for review.

- [ ] **Step 3: Manually classify each rule**

Open the generated JSON file and add a manual classification field on each rule (`keep` / `drop` / `migrate`) :
- `keep` : useful, not yet covered, leave in voice (rare — should be the exception now that V2 exists)
- `drop` : redundant with V2 artifact OR vague platitude
- `migrate` : useful and not in V2 → create a proposition for Plan A's triage to handle

Save your classified file as `scripts/_tmp-audit-voice-<timestamp>-classified.json`.

- [ ] **Step 4: Run audit on the other active personas**

```bash
node --env-file=.env.local scripts/audit-voice-writing-rules.js
```

Repeat the classification for each.

- [ ] **Step 5: Commit audit script**

```bash
git add scripts/audit-voice-writing-rules.js
git commit -m "chore(audit): script to inspect persona.voice.writingRules vs V2 artifacts

Reports voice rules per persona with cheap substring overlap detection
against active V2 artifacts. Output is a JSON file the operator
classifies (keep/drop/migrate) before any mutation. Plan B 2026-05-03, Task 1."
```

---

## Task 2: Migrate retained rules to V2 propositions

**Files:**
- Create: `scripts/migrate-voice-rules-to-v2.js`

- [ ] **Step 1: Write migration script**

```js
// scripts/migrate-voice-rules-to-v2.js
//
// Reads a classified audit JSON (produced by audit-voice-writing-rules.js +
// manual classification) and creates V2 propositions for each rule tagged
// 'migrate'. Status='pending' so they go through Plan A's triage (or manual
// UI accept).
//
// Usage :
//   node --env-file=.env.local scripts/migrate-voice-rules-to-v2.js --classified=<path-to-classified.json> [--apply] [--target-kind=<kind>]
//
// Default --target-kind=hard_rules. Operator can override per-rule by adding a
// `target_kind` field on individual rules in the classified file.

import dotenv from "dotenv";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: "C:/Users/abrah/AhmetA/.env.local" });

const args = process.argv.slice(2);
const classifiedPath = args.find((a) => a.startsWith("--classified="))?.split("=")[1];
const defaultTargetKind = args.find((a) => a.startsWith("--target-kind="))?.split("=")[1] || "hard_rules";
const APPLY = args.includes("--apply");

if (!classifiedPath) { console.error("--classified=<path> required"); process.exit(1); }

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const report = JSON.parse(fs.readFileSync(classifiedPath, "utf8"));

console.log(`=== Migrating voice.writingRules → V2 propositions (${APPLY ? "APPLY" : "DRY-RUN"}) ===\n`);

for (const personaReport of report) {
  const toMigrate = (personaReport.writingRules || []).filter((r) => r.classification === "migrate");
  if (toMigrate.length === 0) {
    console.log(`${personaReport.persona.slug}: nothing to migrate.`);
    continue;
  }

  // Resolve global doc
  const { data: doc } = await sb.from("protocol_document")
    .select("id").eq("owner_kind", "persona").eq("owner_id", personaReport.persona.id)
    .is("source_core", null).eq("status", "active").maybeSingle();
  if (!doc) {
    console.warn(`  ${personaReport.persona.slug}: no active global doc, skipping.`);
    continue;
  }

  console.log(`\n${personaReport.persona.slug}: ${toMigrate.length} rules to migrate to ${defaultTargetKind}`);
  for (const rule of toMigrate) {
    const targetKind = rule.target_kind || defaultTargetKind;
    const proposedText = rule.text;
    const intent = targetKind === "hard_rules" ? "add_rule" : "add_paragraph";

    if (!APPLY) {
      console.log(`  [DRY] ${intent} → ${targetKind}: "${proposedText.slice(0, 80)}"`);
      continue;
    }

    const row = {
      document_id: doc.id,
      source: "voice_legacy_migration",
      intent,
      target_kind: targetKind,
      proposed_text: proposedText,
      rationale: `Migrated from persona.voice.writingRules[${rule.idx}] on ${new Date().toISOString().slice(0, 10)}`,
      confidence: 0.7, // medium — the classifier said keep, Plan A's gray zone will refine
      status: "pending",
      provenance: { source: "voice_legacy_migration", original_index: rule.idx },
    };

    const { error } = await sb.from("proposition").insert(row);
    if (error) console.warn(`  ✗ insert failed: ${error.message}`);
    else console.log(`  ✓ migrated [${rule.idx}]: "${proposedText.slice(0, 60)}"`);
  }
}

console.log(APPLY ? "\nDone." : "\n(dry-run: no inserts)");
```

- [ ] **Step 2: Dry-run on a classified Nicolas audit**

```bash
node --env-file=.env.local scripts/migrate-voice-rules-to-v2.js --classified=scripts/_tmp-audit-voice-<ts>-classified.json
```

Expected: prints the proposed inserts. Manually verify count matches the `migrate`-tagged rules in your classified file.

- [ ] **Step 3: Apply**

```bash
node --env-file=.env.local scripts/migrate-voice-rules-to-v2.js --classified=scripts/_tmp-audit-voice-<ts>-classified.json --apply
```

Verify in Supabase :

```sql
SELECT count(*), source FROM proposition
WHERE source = 'voice_legacy_migration'
GROUP BY source;
```

Expected count = number of `migrate`-tagged rules.

- [ ] **Step 4: Commit migration script**

```bash
git add scripts/migrate-voice-rules-to-v2.js
git commit -m "feat(migrate): voice.writingRules → V2 propositions

Reads a classified audit, inserts retained rules as pending propositions
on the global doc. They flow into Plan A's triage (or manual UI accept).
Plan B 2026-05-03, Task 2."
```

---

## Task 3: Wipe voice.writingRules after migration

**Files:**
- Create: `scripts/wipe-voice-writing-rules.js`

- [ ] **Step 1: Write the wipe script (with backup)**

```js
// scripts/wipe-voice-writing-rules.js
//
// Sets persona.voice.writingRules = [] AFTER taking a full snapshot of
// persona.voice into scripts/_tmp-persona-voice-backup-<persona>-<ts>.json.
//
// Idempotent : if writingRules is already empty, no-op.
//
// Usage :
//   node --env-file=.env.local scripts/wipe-voice-writing-rules.js --persona=<slug> [--apply]

import dotenv from "dotenv";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: "C:/Users/abrah/AhmetA/.env.local" });

const args = process.argv.slice(2);
const personaArg = args.find((a) => a.startsWith("--persona="))?.split("=")[1];
const APPLY = args.includes("--apply");

if (!personaArg) { console.error("--persona=<slug> required"); process.exit(1); }

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: p } = await sb.from("personas").select("id, name, slug, voice").eq("slug", personaArg).maybeSingle();
if (!p) { console.error(`Persona '${personaArg}' not found`); process.exit(1); }

const cur = p.voice?.writingRules || [];
console.log(`Persona: ${p.name} (${p.slug})`);
console.log(`Current writingRules count: ${cur.length}`);

if (cur.length === 0) {
  console.log("Already empty. No-op.");
  process.exit(0);
}

if (!APPLY) {
  console.log("(dry-run: re-run with --apply to wipe)");
  process.exit(0);
}

// Backup first
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = `scripts/_tmp-persona-voice-backup-${p.slug}-${ts}.json`;
fs.writeFileSync(backupPath, JSON.stringify({ persona_id: p.id, slug: p.slug, voice_before_wipe: p.voice }, null, 2));
console.log(`✓ Backup written to ${backupPath}`);

const newVoice = { ...(p.voice || {}), writingRules: [] };
const { error } = await sb.from("personas").update({ voice: newVoice }).eq("id", p.id);
if (error) { console.error(`✗ update failed: ${error.message}`); process.exit(1); }

console.log("✓ writingRules wiped (set to []).");
```

- [ ] **Step 2: Dry-run on Nicolas**

```bash
node --env-file=.env.local scripts/wipe-voice-writing-rules.js --persona=nicolas-lavall-e
```

- [ ] **Step 3: Apply (only after Task 2 migration is done and verified)**

```bash
node --env-file=.env.local scripts/wipe-voice-writing-rules.js --persona=nicolas-lavall-e --apply
```

Verify backup file exists and contains the original 12 rules.

Verify the persona row :

```sql
SELECT slug, jsonb_array_length(coalesce(voice->'writingRules', '[]'::jsonb)) AS wr_count
FROM personas WHERE slug='nicolas-lavall-e';
-- expect 0
```

- [ ] **Step 4: Smoke test the prompt**

Open a fresh chat with Nicolas, send a message, and inspect the assembled prompt (via dev tools or by adding a temporary `console.log(core)` in `lib/prompt.js` after line 149). Confirm the line `- Regles d'ecriture :` is now empty (just `: ` with nothing after) — proves the legacy rules are gone.

If the empty line is visually awkward in the prompt, harden `lib/prompt.js:149` to skip the line when the array is empty (see optional Task 6 below).

- [ ] **Step 5: Commit**

```bash
git add scripts/wipe-voice-writing-rules.js
git commit -m "feat(wipe): clear persona.voice.writingRules with backup

Backs up the persona's voice JSONB to a tmp file before zeroing
writingRules. Idempotent. Plan B 2026-05-03, Task 3."
```

---

## Task 4: Identity sanitizer (pure functions + tests)

**Files:**
- Create: `lib/identity-sanitizer.js`
- Create: `test/identity-sanitizer.test.js`

- [ ] **Step 1: Write failing tests**

```js
// test/identity-sanitizer.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeIdentityProse } from "../lib/identity-sanitizer.js";

test("strips Notion <aside> tags but keeps inner content", () => {
  const input = "Hello\n<aside>\n💡 Insight here\n</aside>\nWorld";
  const out = sanitizeIdentityProse(input);
  assert.match(out, /Hello/);
  assert.match(out, /Insight here/);
  assert.doesNotMatch(out, /<aside>/);
});

test("converts mojibake non-breaking-space ?ￂﾠ to a regular space", () => {
  const input = "Mot1?ￂﾠMot2";
  const out = sanitizeIdentityProse(input);
  assert.equal(out.includes("?ￂﾠ"), false);
  assert.match(out, /Mot1\s+Mot2/);
});

test("collapses 3+ blank lines to 2", () => {
  const input = "Line1\n\n\n\n\nLine2";
  const out = sanitizeIdentityProse(input);
  assert.equal(out, "Line1\n\nLine2");
});

test("strips zero-width characters and BOM", () => {
  const input = "﻿Title​Body";
  const out = sanitizeIdentityProse(input);
  assert.equal(out, "TitleBody");
});

test("trims trailing whitespace per line", () => {
  const input = "Line1   \nLine2\t\t\n";
  const out = sanitizeIdentityProse(input);
  assert.equal(out, "Line1\nLine2");
});

test("idempotent : sanitize(sanitize(x)) === sanitize(x)", () => {
  const input = "<aside>?ￂﾠ\nFoo​  \n\n\n\nBar</aside>";
  const once = sanitizeIdentityProse(input);
  const twice = sanitizeIdentityProse(once);
  assert.equal(once, twice);
});
```

- [ ] **Step 2: Run, verify fail**

```bash
node --test test/identity-sanitizer.test.js
```

- [ ] **Step 3: Implement**

```js
// lib/identity-sanitizer.js
//
// Pure, idempotent sanitization for protocol_section.prose where kind='identity'.
// Targets the specific corruption patterns observed in dumps from Notion :
//   - <aside>...</aside> wrapper tags around callout blocks
//   - Other Notion structural tags (<details>, <summary>) — strip wrapper, keep text
//   - Mojibake : ?ￂﾠ in place of U+00A0 NBSP, etc.
//   - Zero-width chars (BOM ﻿, ZWSP ​, ZWJ ‍, ZWNJ ‌)
//   - Excess blank lines (3+ consecutive newlines collapsed to 2)
//   - Trailing whitespace per line
//
// Non-destructive : every textual content remains, only the noise is stripped.
// Idempotent : calling twice gives the same result as once.

const NOTION_WRAPPER_TAGS = ["aside", "details", "summary", "caption"];
const ZERO_WIDTH = /[﻿​‌‍]/g;

// Common mojibake replacements observed.
// Map source byte sequences to their intended unicode chars.
const MOJIBAKE_MAP = [
  // The literal 4-char string "?ￂﾠ" — UTF-8 of NBSP misdecoded as latin-1.
  ["?ￂﾠ", " "],
  // Common "â€™" → "'", "â€œ" → "\"" etc, defensive.
  ["Â ", " "],
  ["â€™", "'"],
  ["â€œ", "\""],
  ["â€", "\""],
  ["â€"", "\""],
  ["â€"", "\""],
  ["â€"", "—"],
  ["â€"", "–"],
];

export function sanitizeIdentityProse(input) {
  if (typeof input !== "string") return "";
  let s = input;

  // 1. Strip Notion wrapper tags (keep inner content)
  for (const tag of NOTION_WRAPPER_TAGS) {
    const open = new RegExp(`<\\s*${tag}[^>]*>`, "gi");
    const close = new RegExp(`<\\s*/\\s*${tag}\\s*>`, "gi");
    s = s.replace(open, "").replace(close, "");
  }

  // 2. Mojibake replacements
  for (const [bad, good] of MOJIBAKE_MAP) {
    s = s.split(bad).join(good);
  }

  // 3. Zero-width chars
  s = s.replace(ZERO_WIDTH, "");

  // 4. Trim trailing whitespace per line
  s = s.split("\n").map((l) => l.replace(/[ \t]+$/g, "")).join("\n");

  // 5. Collapse 3+ blank lines to 2
  s = s.replace(/\n{3,}/g, "\n\n");

  // 6. Trim leading/trailing whitespace globally
  s = s.trim();

  return s;
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
node --test test/identity-sanitizer.test.js
```

- [ ] **Step 5: Commit**

```bash
git add lib/identity-sanitizer.js test/identity-sanitizer.test.js
git commit -m "feat(identity): pure sanitizer for Notion-imported identity prose

Strips aside/details/summary tags, common mojibake (?ￂﾠ → space),
zero-width chars, collapses excess blanks. Idempotent. Plan B 2026-05-03, Task 4."
```

---

## Task 5: Sanitize identity section + optional re-extraction

**Files:**
- Create: `scripts/sanitize-identity-section.js`
- Create: `scripts/reextract-identity-section.js`

- [ ] **Step 1: Sanitization script (no LLM, just the pure sanitizer)**

```js
// scripts/sanitize-identity-section.js
//
// Pulls protocol_section.prose where kind='identity' for a persona, runs
// sanitizeIdentityProse, prints a diff (chars before/after, lines before/after,
// preview), and writes the new prose if --apply.
//
// Usage :
//   node --env-file=.env.local scripts/sanitize-identity-section.js --persona=<slug> [--apply]

import dotenv from "dotenv";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { sanitizeIdentityProse } from "../lib/identity-sanitizer.js";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: "C:/Users/abrah/AhmetA/.env.local" });

const args = process.argv.slice(2);
const personaArg = args.find((a) => a.startsWith("--persona="))?.split("=")[1];
const APPLY = args.includes("--apply");
if (!personaArg) { console.error("--persona=<slug> required"); process.exit(1); }

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: p } = await sb.from("personas").select("id, slug, name").eq("slug", personaArg).single();
if (!p) { console.error("persona not found"); process.exit(1); }

const { data: doc } = await sb.from("protocol_document")
  .select("id").eq("owner_kind", "persona").eq("owner_id", p.id)
  .is("source_core", null).eq("status", "active").single();

const { data: section } = await sb.from("protocol_section")
  .select("id, prose").eq("document_id", doc.id).eq("kind", "identity").single();

if (!section) { console.error("no identity section"); process.exit(1); }

const before = section.prose || "";
const after = sanitizeIdentityProse(before);

console.log(`=== Identity sanitize for ${p.slug} ===`);
console.log(`  chars before: ${before.length}`);
console.log(`  chars after:  ${after.length}`);
console.log(`  lines before: ${before.split("\n").length}`);
console.log(`  lines after:  ${after.split("\n").length}`);
console.log(`\n--- preview (first 600 chars after) ---`);
console.log(after.slice(0, 600));
console.log(`---`);

if (!APPLY) {
  console.log("\n(dry-run)");
  process.exit(0);
}

// Backup
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const backup = `scripts/_tmp-identity-backup-${p.slug}-${ts}.txt`;
fs.writeFileSync(backup, before);
console.log(`✓ backup: ${backup}`);

const { error } = await sb.from("protocol_section")
  .update({ prose: after, author_kind: "auto_sanitize" })
  .eq("id", section.id);
if (error) { console.error(`✗ update failed: ${error.message}`); process.exit(1); }
console.log("✓ identity prose updated.");
```

- [ ] **Step 2: Dry-run on Nicolas**

```bash
node --env-file=.env.local scripts/sanitize-identity-section.js --persona=nicolas-lavall-e
```

Expected output: shows char count drops (e.g. 23 000 → ~18 000-20 000 just from stripping tags + mojibake fixes), preview readable.

- [ ] **Step 3: Apply**

```bash
node --env-file=.env.local scripts/sanitize-identity-section.js --persona=nicolas-lavall-e --apply
```

- [ ] **Step 4: Decide if re-extraction LLM is needed**

If the sanitized prose is still too long (>5k chars) or structurally messy, proceed to Step 5. Otherwise stop here — the syntax cleanup may be enough.

- [ ] **Step 5: Optional re-extraction script (LLM)**

```js
// scripts/reextract-identity-section.js
//
// Takes the current identity prose (after sanitize), asks Sonnet to rewrite
// in dense ~2-3k char prose preserving every substantive element : parcours,
// voice, convictions, philosophy, anecdotes. Drops noise : structural
// markers, redundant intro text, journal-style filler.
//
// Usage :
//   node --env-file=.env.local scripts/reextract-identity-section.js --persona=<slug> [--apply]

import dotenv from "dotenv";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: "C:/Users/abrah/AhmetA/.env.local" });

const args = process.argv.slice(2);
const personaArg = args.find((a) => a.startsWith("--persona="))?.split("=")[1];
const APPLY = args.includes("--apply");
if (!personaArg) { console.error("--persona=<slug> required"); process.exit(1); }

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const { data: p } = await sb.from("personas").select("id, slug, name").eq("slug", personaArg).single();
const { data: doc } = await sb.from("protocol_document")
  .select("id").eq("owner_kind", "persona").eq("owner_id", p.id)
  .is("source_core", null).eq("status", "active").single();
const { data: section } = await sb.from("protocol_section")
  .select("id, prose").eq("document_id", doc.id).eq("kind", "identity").single();

const before = section.prose || "";
console.log(`Identity prose chars (before LLM): ${before.length}`);

const prompt = `Tu réécris la section "identité" du protocole d'un persona pour qu'elle soit dense, lisible et utilisable comme contexte system prompt.

CONTRAINTES :
- Garde TOUS les éléments substantifs : parcours, voix, convictions, philosophy, anecdotes structurantes, ton.
- Drop : structure de doc (titres "Section 1", "Bio", "À propos"), filler ("comme dit précédemment"), méta-commentaires.
- Cible : 2000-3000 caractères, prose continue, pas de liste à puces sauf si vraiment indispensable.
- Style : sobre, concret, à la 3e personne ("Nicolas est...", "Sa philosophie...").

Voici le contenu source :

---
${before}
---

Réécris-le en respectant les contraintes. Réponds UNIQUEMENT avec la prose réécrite, rien d'autre.`;

const response = await anthropic.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 4000,
  messages: [{ role: "user", content: prompt }],
});

const after = response.content?.[0]?.text?.trim() || "";
console.log(`Identity prose chars (after LLM):  ${after.length}\n`);
console.log(`--- preview ---\n${after.slice(0, 600)}\n---\n`);

if (!APPLY) { console.log("(dry-run)"); process.exit(0); }

const ts = new Date().toISOString().replace(/[:.]/g, "-");
fs.writeFileSync(`scripts/_tmp-identity-llm-backup-${p.slug}-${ts}.txt`, before);

await sb.from("protocol_section").update({ prose: after, author_kind: "llm_reextract" }).eq("id", section.id);
console.log("✓ identity prose replaced by LLM-rewritten version.");
```

- [ ] **Step 6: Run dry-run, manually review the LLM output**

```bash
node --env-file=.env.local scripts/reextract-identity-section.js --persona=nicolas-lavall-e
```

Read the LLM output carefully. If it loses important nuance, either tweak the prompt and re-run, or skip this step entirely (Step 3's sanitize may be sufficient).

- [ ] **Step 7: Apply only if you're satisfied**

```bash
node --env-file=.env.local scripts/reextract-identity-section.js --persona=nicolas-lavall-e --apply
```

- [ ] **Step 8: Commit both scripts**

```bash
git add scripts/sanitize-identity-section.js scripts/reextract-identity-section.js
git commit -m "feat(identity): sanitize + optional LLM re-extract for identity prose

Two-pass cleanup: (1) syntactic sanitization via lib/identity-sanitizer.js,
(2) optional Sonnet rewrite to dense 2-3k chars. Both have backups.
Plan B 2026-05-03, Task 5."
```

---

## Task 6 (optional): Harden lib/prompt.js to skip empty rule lines

**Files:**
- Modify: `lib/prompt.js` (lines 144-149)

Justification : after Task 3, `v.writingRules` is `[]`. The current code emits `- Regles d'ecriture :  \n` (empty value), which is awkward and adds noise to the prompt. Same applies if `forbiddenWords` or `neverDoes` end up empty for other personas.

- [ ] **Step 1: Replace lines 144-149 with conditional emission**

Current (148-149):
```js
core += `- Mots INTERDITS (ne jamais utiliser) : ${v.forbiddenWords.join(", ")}\n`;
core += `- Ne jamais faire : ${v.neverDoes.join(" ; ")}\n`;
core += `- Regles d'ecriture : ${v.writingRules.join(" ; ")}\n\n`;
```

Replace with:
```js
if (Array.isArray(v.forbiddenWords) && v.forbiddenWords.length > 0) {
  core += `- Mots INTERDITS (ne jamais utiliser) : ${v.forbiddenWords.join(", ")}\n`;
}
if (Array.isArray(v.neverDoes) && v.neverDoes.length > 0) {
  core += `- Ne jamais faire : ${v.neverDoes.join(" ; ")}\n`;
}
if (Array.isArray(v.writingRules) && v.writingRules.length > 0) {
  core += `- Regles d'ecriture : ${v.writingRules.join(" ; ")}\n`;
}
core += "\n";
```

Apply the same pattern to `tone`, `personality`, `signaturePhrases` (lines 144-146) if any of them can also be empty in practice — verify via the Task 1 audit output.

- [ ] **Step 2: Run existing prompt tests**

```bash
node --test test/prompt.test.js
```

Expected: green. If any test asserted on the literal `- Regles d'ecriture : ...` substring being present, port it to assert presence-when-non-empty / absence-when-empty.

- [ ] **Step 3: Commit**

```bash
git add lib/prompt.js
git commit -m "refactor(prompt): skip voice rule lines when array is empty

Avoids emitting hollow lines like 'Regles d'ecriture :' after Task 3
wipes legacy voice.writingRules. Plan B 2026-05-03, Task 6."
```

---

## Task 7: End-to-end verification

**Files:** none — pure verification.

- [ ] **Step 1: Compare chat output before/after**

For Nicolas, send the same prospect message in two chats : one before this plan (use a backup or the archived persona `nicolas-lavall-e-archived-2026-05-01` if still queryable), one after. Note qualitative differences :
- Less repetition / less generic "rules" parroting ?
- Identity section more usable in the prompt ?
- No regressions on tone or signature phrases ?

- [ ] **Step 2: Token budget check**

The identity section was a major contributor to system prompt size. Measure before/after :

```sql
SELECT length(ps.prose) FROM protocol_section ps
JOIN protocol_document pd ON pd.id = ps.document_id
WHERE pd.owner_id = (SELECT id FROM personas WHERE slug='nicolas-lavall-e')
  AND pd.status = 'active' AND pd.source_core IS NULL
  AND ps.kind = 'identity';
```

Expect a drop from ~23 000 to ~3 000 chars (or ~18 000 if you only sanitized).

- [ ] **Step 3: Document outcome**

Append the before/after numbers and qualitative notes to this plan file under `## Execution Log`.

---

## Self-Review

**Spec coverage:**
- ✅ Audit voice.writingRules (Task 1)
- ✅ Migrate retained rules to V2 propositions (Task 2)
- ✅ Wipe legacy writingRules with backup (Task 3)
- ✅ Identity sanitization, syntactic + optional LLM (Tasks 4 & 5)
- ✅ Prompt hardening to handle empty arrays (Task 6 optional)
- ✅ Verification end-to-end (Task 7)

**Type consistency:**
- All scripts read/write the same `personas.voice` shape ✓
- `sanitizeIdentityProse` is a pure function returning string ✓
- Migration script's proposition row matches the schema used by Plan A's `applyAcceptWithSnapshot` ✓

**Open assumptions to validate during execution:**
1. The `voice` JSONB has the keys `writingRules`, `forbiddenWords`, `neverDoes`, `tone`, `personality`, `signaturePhrases` consistently across personas. If some personas use different shapes, Task 1 will surface that — adapt scripts then.
2. The identity section already exists for every active persona (per migration 067 backfill). If a new persona was created without that backfill running, Task 5 will error — handle by creating the section first.
3. Migration step in Task 2 relies on `proposition.source` accepting an arbitrary string ('voice_legacy_migration'). Verify against any DB CHECK constraint — if there is an enum, add `voice_legacy_migration` to it via a small DDL migration.

**Coordination note for the parallel "refonte du cerveau" :**
This plan is the most decoupled of the three (A/B/C). It touches `personas.voice` (legacy), `protocol_section.prose` (still-current), and `proposition` (still-current). If the refonte changes the shape of `personas.voice` or removes it entirely, Tasks 1 and 3 become trivial (or moot). If the refonte changes how identity flows into the prompt, Tasks 4 and 5 may need re-targeting (e.g. write into a different table) but the sanitization + LLM rewrite logic in `lib/identity-sanitizer.js` and `scripts/reextract-identity-section.js` remains reusable.
