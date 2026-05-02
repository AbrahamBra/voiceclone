import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePlaybookProse,
  defaultToggleForScenario,
  shortLabelForToggle,
} from "../src/lib/playbook-parser.js";

const SAMPLE_VISITE_PROFIL = `
> **Source du lead** : visite profil.

## 1. ICEBREAKER — « CURIOSITÉ SYMÉTRIQUE »

**Principe** : la personne a visité ton profil.

## Message 1 - AUTOMATIQUE

> saalut PRÉNOM
> j'ai remarqué que tu étais passé

## 2. QUALIFIER LA RÉPONSE + SWOT / TOWS

**Étape d'analyse, pas de message à envoyer.**

## 3. CREUSEMENT — « QUESTION MIROIR »

Question miroir contenu.

## 4. PROPOSITION DE CALL — « 15 MIN ENTRE PAIRS »

Call contenu.

## 5. SORTIE PROPRE

Sortie contenu.

## 6. R1 RÉSERVÉ

R1 contenu.

### 💡 RAPPEL — LES 10 RÈGLES D'OR DU SETTING NICOLAS

1. SWOT / TOWS AVANT le message de creusement.
2. Pas de pitch avant douleur.
3. Max 6 lignes par message.
`;

const SAMPLE_SPYER = `
## 0. RÈGLES ABSOLUES POUR CE CANAL

🚫 JAMAIS dire « j'ai vu que tu commentais ».

## 1. ICEBREAKER — « REMARQUE PROFIL + QUESTION DE QUALIF »

Helllo PRÉNOM.

## 2. QUALIFIER LA RÉPONSE + SWOT / TOWS

Qualif.

## 5. SORTIE PROPRE

Sortie.

### RÈGLES D'OR DU SETTING NICOLAS

1. Pas de pitch.
`;

test("parsePlaybookProse — extrait les toggles numérotés", () => {
  const r = parsePlaybookProse(SAMPLE_VISITE_PROFIL);
  assert.equal(r.parsed, true);
  const indices = r.toggles.map((t) => t.idx);
  assert.deepEqual(indices, [1, 2, 3, 4, 5, 6]);
  const t1 = r.toggles.find((t) => t.idx === 1);
  assert.match(t1.title, /ICEBREAKER/);
  // La prose du T1 doit contenir le sous-titre Message 1 et le contenu mais
  // s'arrêter avant T2.
  assert.match(t1.prose, /Message 1/);
  assert.ok(!t1.prose.includes("QUALIFIER"));
});

test("parsePlaybookProse — gère T0 quand présent (spyer)", () => {
  const r = parsePlaybookProse(SAMPLE_SPYER);
  assert.equal(r.parsed, true);
  assert.deepEqual(r.toggles.map((t) => t.idx), [0, 1, 2, 5]);
  const t0 = r.toggles.find((t) => t.idx === 0);
  assert.match(t0.title, /RÈGLES ABSOLUES/);
});

test("parsePlaybookProse — extrait les règles d'or", () => {
  const r = parsePlaybookProse(SAMPLE_VISITE_PROFIL);
  assert.ok(r.goldenRules);
  assert.match(r.goldenRules, /SWOT.*TOWS AVANT/);
  assert.match(r.goldenRules, /Max 6 lignes/);
});

test("parsePlaybookProse — fallback si pas de structure ## N.", () => {
  const r = parsePlaybookProse("Just some prose without any toggle headers.");
  assert.equal(r.parsed, false);
  assert.equal(r.toggles.length, 1);
  assert.equal(r.toggles[0].idx, 0);
  assert.equal(r.toggles[0].title, "Playbook complet");
});

test("parsePlaybookProse — entrée vide ou nulle", () => {
  assert.deepEqual(parsePlaybookProse(""), { toggles: [], goldenRules: null, parsed: false });
  assert.deepEqual(parsePlaybookProse(null), { toggles: [], goldenRules: null, parsed: false });
});

test("defaultToggleForScenario — mappe scenario_type vers toggle index", () => {
  const toggles = [
    { idx: 0 }, { idx: 1 }, { idx: 2 }, { idx: 3 }, { idx: 4 }, { idx: 5 }, { idx: 6 },
  ];
  assert.equal(defaultToggleForScenario("DM_1st", toggles), 1);
  assert.equal(defaultToggleForScenario("DM_relance", toggles), 1);
  assert.equal(defaultToggleForScenario("DM_reply", toggles), 2);
  assert.equal(defaultToggleForScenario("DM_closing", toggles), 4);
});

test("defaultToggleForScenario — fallback quand toggle manque", () => {
  // T2 manque → DM_reply doit fallback sur T3
  const toggles = [{ idx: 1 }, { idx: 3 }, { idx: 5 }];
  assert.equal(defaultToggleForScenario("DM_reply", toggles), 3);
  // Aucun mapping standard → premier toggle
  const sparse = [{ idx: 5 }];
  assert.equal(defaultToggleForScenario("DM_1st", sparse), 5);
});

test("shortLabelForToggle — extrait un label court depuis le titre", () => {
  assert.equal(shortLabelForToggle({ idx: 1, title: "ICEBREAKER — « CURIOSITÉ SYMÉTRIQUE »" }), "icebreaker");
  assert.equal(shortLabelForToggle({ idx: 5, title: "SORTIE PROPRE" }), "sortie");
  assert.equal(shortLabelForToggle({ idx: 0, title: "RÈGLES ABSOLUES POUR CE CANAL" }), "règles");
  assert.equal(shortLabelForToggle({ idx: 9, title: "" }), "T9");
});
