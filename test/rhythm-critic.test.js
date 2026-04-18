import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRhythmMetrics } from "../lib/critic/rhythmMetrics.js";
import { extractDraft } from "../lib/critic/extractDraft.js";
import { degradeRhythm } from "../lib/critic/degradeRhythm.js";
import { computeBaseline, mahalanobisDistance, BASELINE_DIMS } from "../lib/critic/mahalanobis.js";
import { evaluateRhythm } from "../lib/critic/rhythmCritic.js";
import { evaluateVoice } from "../lib/critic/voiceCritic.js";

const THOMAS_VOICE = {
  forbiddenWords: ["cordialement", "synergies", "leverager"],
  signaturePhrases: ["c'est propre", "ok intéressant", "avec plaisir ;)"],
};

test("computeRhythmMetrics — texte vide", () => {
  const m = computeRhythmMetrics("");
  assert.equal(m.rm_n_sentences, 0);
  assert.equal(m.rm_len_mean, 0);
});

test("computeRhythmMetrics — variance détectée", () => {
  // 3 phrases courtes + 1 longue => variance élevée, short_ratio élevé
  const m = computeRhythmMetrics("Salut. Ok. Nice. Mais en vrai si tu regardes bien ça change beaucoup de choses pour ton acquisition.");
  assert.equal(m.rm_n_sentences, 4);
  assert.ok(m.rm_short_ratio >= 0.5, `short_ratio trop bas: ${m.rm_short_ratio}`);
  assert.ok(m.rm_len_std > 5, `std trop bas: ${m.rm_len_std}`);
});

test("extractDraft — bloc MESSAGE A ENVOYER", () => {
  const text = "MESSAGE A ENVOYER :\nSalut Cecilia\nTon modèle est malin\n\nPOURQUOI CETTE APPROCHE :\nParce que blabla";
  const out = extractDraft(text);
  assert.match(out, /Salut Cecilia/);
  assert.doesNotMatch(out, /POURQUOI/);
  assert.doesNotMatch(out, /blabla/);
});

test("extractDraft — bloc full-meta retourne vide", () => {
  const text = "APPRENTISSAGE ENREGISTRE :\nLeçon retenue : ...";
  assert.equal(extractDraft(text), "");
});

test("extractDraft — texte normal retourne tel quel", () => {
  const text = "Salut Marc ! Comment vas-tu ?";
  assert.equal(extractDraft(text), text);
});

test("degradeRhythm — flatten_punct spike dryness", () => {
  const gold = "Salut. Nice ton post ! Tu fais quoi aujourd'hui ?";
  const degraded = degradeRhythm(gold, "flatten_punct");
  const mGold = computeRhythmMetrics(gold);
  const mDeg = computeRhythmMetrics(degraded);
  assert.ok(mDeg.rm_dryness > mGold.rm_dryness, "dryness doit augmenter");
});

test("degradeRhythm — uniformize fusionne les phrases courtes", () => {
  const gold = "Ok. Nice. Tu vois. Je vois ça tous les jours aussi.";
  const degraded = degradeRhythm(gold, "uniformize");
  const mGold = computeRhythmMetrics(gold);
  const mDeg = computeRhythmMetrics(degraded);
  // Fusion attendue : 4 phrases courtes → 1 seule.
  assert.ok(mDeg.rm_n_sentences < mGold.rm_n_sentences, `n_sentences doit diminuer: gold=${mGold.rm_n_sentences} deg=${mDeg.rm_n_sentences}`);
  assert.ok(mDeg.rm_short_ratio < mGold.rm_short_ratio, `short_ratio doit diminuer: gold=${mGold.rm_short_ratio} deg=${mDeg.rm_short_ratio}`);
});

test("computeBaseline — shapes correctes", () => {
  const vectors = [
    { rm_len_mean: 10, rm_len_std: 2, rm_len_cv: 0.2, rm_short_ratio: 0.3, rm_long_ratio: 0.1, rm_transition_rate: 0.2, rm_fragment_ratio: 0.1, rm_dryness: 0.05 },
    { rm_len_mean: 12, rm_len_std: 3, rm_len_cv: 0.25, rm_short_ratio: 0.25, rm_long_ratio: 0.2, rm_transition_rate: 0.15, rm_fragment_ratio: 0.2, rm_dryness: 0.1 },
    { rm_len_mean: 8, rm_len_std: 1.5, rm_len_cv: 0.18, rm_short_ratio: 0.4, rm_long_ratio: 0.05, rm_transition_rate: 0.3, rm_fragment_ratio: 0.05, rm_dryness: 0.02 },
  ];
  const baseline = computeBaseline(vectors);
  for (const dim of BASELINE_DIMS) {
    assert.ok(typeof baseline.mean[dim] === "number", `mean.${dim}`);
    assert.ok(typeof baseline.std[dim] === "number", `std.${dim}`);
    assert.ok(baseline.std[dim] >= 0.05, `std.${dim} doit être ≥ MIN_STD`);
  }
  assert.equal(baseline.sample_count, 3);
});

test("mahalanobisDistance — 0 sur le centre, >0 hors centre", () => {
  const baseline = { mean: Object.fromEntries(BASELINE_DIMS.map(d => [d, 0.5])), std: Object.fromEntries(BASELINE_DIMS.map(d => [d, 0.1])) };
  const center = Object.fromEntries(BASELINE_DIMS.map(d => [d, 0.5]));
  const far = Object.fromEntries(BASELINE_DIMS.map(d => [d, 0.9]));
  assert.equal(mahalanobisDistance(center, baseline).distance, 0);
  assert.ok(mahalanobisDistance(far, baseline).distance > 3);
});

test("evaluateRhythm — applique extractDraft en interne", () => {
  const pollution = "MESSAGE A ENVOYER :\nSalut Marc. Nice. Tu fais quoi ?\n\nPOURQUOI CETTE APPROCHE :\nParce que.";
  const clean = "Salut Marc. Nice. Tu fais quoi ?";
  const r1 = evaluateRhythm(pollution);
  const r2 = evaluateRhythm(clean);
  assert.equal(r1.signals.rm_n_sentences, r2.signals.rm_n_sentences, "nb phrases doit être identique après extraction");
});

test("evaluateRhythm — sans baseline, pas de mahalanobis dans signals", () => {
  const r = evaluateRhythm("Salut. Nice. Tu fais quoi ?");
  assert.equal(r.baselineUsed, false);
  assert.equal(r.signals.mahalanobis_distance, undefined);
});

test("evaluateVoice — forbidden word flag", () => {
  const r = evaluateVoice("Cordialement, je reviens vers vous.", THOMAS_VOICE);
  assert.ok(r.shouldFlag);
  assert.equal(r.signals.v_forbidden_count, 1);
  assert.ok(r.reasons.some(x => x.startsWith("V1")));
});

test("evaluateVoice — expression interdite multi-mots", () => {
  const voice = { forbiddenWords: ["bien à vous", "je me permets"] };
  const r = evaluateVoice("Je me permets de vous recontacter.", voice);
  assert.ok(r.shouldFlag);
  assert.equal(r.signals.v_forbidden_count, 1);
});

test("evaluateVoice — verbe anglais conjugué", () => {
  const r = evaluateVoice("Tu scales ton business comment ?", THOMAS_VOICE);
  assert.ok(r.shouldFlag);
  assert.equal(r.signals.v_anglicized_count, 1);
  assert.ok(r.reasons.some(x => x.startsWith("V2")));
});

test("evaluateVoice — anglicismes NOMS autorisés (lead, call, setup, scaling)", () => {
  const r = evaluateVoice("On peut faire un call pour ton setup ? Scaling est ok ?", THOMAS_VOICE);
  assert.equal(r.signals.v_anglicized_count, 0, "pas de verbe anglais conjugué");
  assert.ok(!r.shouldFlag);
});

test("evaluateVoice — tiret connecteur mid-phrase", () => {
  const r = evaluateVoice("J'ai vu ton post — c'est intéressant", THOMAS_VOICE);
  assert.ok(r.signals.v_has_hyphen_connector);
  assert.ok(r.reasons.some(x => x.startsWith("V3")));
});

test("evaluateVoice — bullet list en début de ligne = PAS un connecteur", () => {
  const r = evaluateVoice("Voici :\n- point 1\n- point 2", THOMAS_VOICE);
  assert.equal(r.signals.v_has_hyphen_connector, false);
});

test("evaluateVoice — signature phrases counted (positive, no flag)", () => {
  const r = evaluateVoice("Ok intéressant. C'est propre.", THOMAS_VOICE);
  assert.equal(r.signals.v_signature_count, 2);
  assert.equal(r.shouldFlag, false);
});

test("evaluateVoice — texte clean Thomas", () => {
  const r = evaluateVoice("Salut Marc, nice ton dernier post. Tu acquiers comment tes clients ?", THOMAS_VOICE);
  assert.equal(r.shouldFlag, false);
  assert.equal(r.signals.v_forbidden_count, 0);
  assert.equal(r.signals.v_anglicized_count, 0);
});

test("evaluateVoice — persona sans règles = score neutre", () => {
  const r = evaluateVoice("Quel que soit le texte.", {});
  assert.equal(r.score, 1);
  assert.equal(r.shouldFlag, false);
});

test("evaluateRhythm — intègre voice signals et flag", () => {
  const r = evaluateRhythm("Cordialement, leverager cette opportunité.", { personaVoice: THOMAS_VOICE });
  assert.ok(r.shouldFlag);
  assert.ok(r.voiceUsed);
  assert.ok(r.signals.v_forbidden_count >= 2);
  assert.ok(r.reasons.some(x => x.startsWith("V1")));
});

test("evaluateRhythm — avec baseline, mahalanobis présent et reason drift si |z|≥2", () => {
  const baseline = {
    mean: { rm_len_mean: 15, rm_len_std: 5, rm_len_cv: 0.5, rm_short_ratio: 0.2, rm_long_ratio: 0.3, rm_transition_rate: 0.2, rm_fragment_ratio: 0.1, rm_dryness: 0.05 },
    std: { rm_len_mean: 3, rm_len_std: 2, rm_len_cv: 0.1, rm_short_ratio: 0.1, rm_long_ratio: 0.1, rm_transition_rate: 0.1, rm_fragment_ratio: 0.1, rm_dryness: 0.05 },
  };
  // Texte avec dryness 1.0 => z = (1.0 - 0.05) / 0.05 = 19 → flag garanti
  const r = evaluateRhythm("Ok. Nice. Ça marche.", { baseline });
  assert.ok(r.baselineUsed);
  assert.ok(r.signals.mahalanobis_distance > 0);
  assert.ok(r.reasons.some(x => x.startsWith("rhythm_drift")), `reasons=${JSON.stringify(r.reasons)}`);
});
