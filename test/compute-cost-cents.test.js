import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCostCents, MODEL_PRICING } from "../lib/supabase.js";

const SONNET = "claude-sonnet-4-20250514";
const HAIKU = "claude-haiku-4-5-20251001";

test("cost is non-negative when cache reads exceed uncached input tokens", () => {
  // Regression for the billing bug: long cached system prompt (50k tok)
  // + short user turn (200 tok uncached). Previously produced cost_cents < 0
  // and decremented spent_cents.
  const cost = computeCostCents(200, 100, 50_000, SONNET);
  assert.ok(cost > 0, `expected positive cost, got ${cost}`);
});

test("Sonnet pricing — pure uncached input billed at $3/MTok", () => {
  const cost = computeCostCents(1_000_000, 0, 0, SONNET);
  // 1M input tok × $3/MTok = $3 = 300 cents
  assert.equal(cost, 300);
});

test("Sonnet pricing — cache reads billed at $0.30/MTok (10% of input)", () => {
  const cost = computeCostCents(0, 0, 1_000_000, SONNET);
  assert.equal(cost, 30);
});

test("Sonnet pricing — output billed at $15/MTok", () => {
  const cost = computeCostCents(0, 1_000_000, 0, SONNET);
  assert.equal(cost, 1500);
});

test("Haiku 4.5 pricing differs from Sonnet", () => {
  const cost = computeCostCents(1_000_000, 0, 0, HAIKU);
  // 1M × $0.80 = $0.80 = 80 cents
  assert.equal(cost, 80);
});

test("Unknown model falls back to Sonnet pricing", () => {
  const sonnet = computeCostCents(1000, 500, 200, SONNET);
  const unknown = computeCostCents(1000, 500, 200, "claude-mystery-model");
  assert.equal(unknown, sonnet);
});

test("Realistic prod pattern — long cached system prompt + short generation", () => {
  // Mirrors the actual case that produced negative costs in prod.
  // Long cached system prompt (~30k tok), tiny user turn (300 tok uncached),
  // ~600 tok generation.
  const cost = computeCostCents(300, 600, 30_000, SONNET);
  // input: 300 × 3 / 1M × 100 = 0.09 c
  // cache_read: 30000 × 0.30 / 1M × 100 = 0.9 c
  // output: 600 × 15 / 1M × 100 = 0.9 c
  // total ≈ 1.89 c
  assert.ok(cost > 1.8 && cost < 2.0, `expected ~1.89c, got ${cost}`);
});

test("MODEL_PRICING is exported and contains current models", () => {
  assert.ok(MODEL_PRICING[SONNET]);
  assert.ok(MODEL_PRICING[HAIKU]);
  assert.equal(MODEL_PRICING[SONNET].input, 3.00);
});
