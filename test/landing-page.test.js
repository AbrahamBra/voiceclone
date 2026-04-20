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
  // Toutes ces chaînes sont LITTÉRALEMENT présentes dans la version actuelle
  // de +page.svelte (vérifié à la rédaction du plan). Le test est case-sensitive,
  // donc les capitales comptent. Si tu ajoutes une chaîne ici, vérifie-la avant
  // avec : grep -n "ta chaîne" src/routes/+page.svelte
  const forbidden = [
    'BUILD_HASH = "',           // déclaration JS du hash hardcodé
    "/ laboratoire",            // brand sub-title
    "Tu vois le pipeline tourner", // phrase du sub hero
    "Pas un chatbot de plus",   // fin de la headline (capital P)
    "observable en direct",     // accent italique de la headline
    "$lib/landing-demo",        // import path
    "SCENARIOS",                // export consommé du module supprimé
    "PHASE_DELAYS",             // idem
    "TYPE_SPEED_OUTPUT",        // idem
    "case-strip",               // CSS class de la zone scénarios
    "panel-fidelity",           // CSS class du panel fidélité
    "runScenario",              // runner scripté
    "typewriter(",              // helper du runner
  ];
  for (const s of forbidden) {
    assert.ok(
      !source.includes(s),
      `+page.svelte contient encore la chaîne interdite: "${s}"`
    );
  }
});

test("landing: hero copy présent", () => {
  // Substrings choisies pour tenir sur UNE SEULE ligne dans la source Svelte
  // (l'indentation du <p class="hero-body"> casse le texte sur 3 lignes,
  // donc on évite les substrings qui chevauchent un saut de ligne).
  const required = [
    "Un clone d'écriture qui apprend de tes corrections", // toute la tagline (line solo)
    "Tu lui parles d'un prospect",                         // début ligne 1 du body
    "reprends en deux mots",                               // milieu ligne 2 du body
    "il écrit comme toi",                                  // fin ligne 3 du body
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
