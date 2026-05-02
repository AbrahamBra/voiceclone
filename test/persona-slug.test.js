import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { slugify, generateUniqueSlug } from "../lib/persona-slug.js";

describe("slugify", () => {
  it("kebab-cases ASCII names", () => {
    assert.equal(slugify("Nicolas Lavallée"), "nicolas-lavall-e");
    assert.equal(slugify("Mohamed Camara"), "mohamed-camara");
  });

  it("collapses runs of non-alphanum into a single dash", () => {
    assert.equal(slugify("a   b---c"), "a-b-c");
  });

  it("trims leading and trailing dashes", () => {
    assert.equal(slugify("--abc--"), "abc");
    assert.equal(slugify("?Abraham?"), "abraham");
  });

  it("handles empty / non-string", () => {
    assert.equal(slugify(""), "");
    assert.equal(slugify(null), "");
    assert.equal(slugify(undefined), "");
    assert.equal(slugify(42), "");
  });
});

// Tiny supabase mock — only the .from().select().eq().or() chain we use.
function mockSupabase(existingSlugs) {
  return {
    from() { return this; },
    select() { return this; },
    eq() { return this; },
    or() { return Promise.resolve({ data: existingSlugs.map((s) => ({ slug: s })), error: null }); },
  };
}

describe("generateUniqueSlug", () => {
  it("returns the base slug when no collision", async () => {
    const sb = mockSupabase([]);
    assert.equal(await generateUniqueSlug(sb, "c1", "Nicolas Lavallée"), "nicolas-lavall-e");
  });

  it("appends -2 on first collision", async () => {
    const sb = mockSupabase(["nicolas-lavall-e"]);
    assert.equal(await generateUniqueSlug(sb, "c1", "Nicolas Lavallée"), "nicolas-lavall-e-2");
  });

  it("finds the next free number when -2/-3/-4 are taken", async () => {
    const sb = mockSupabase(["nicolas", "nicolas-2", "nicolas-3", "nicolas-4"]);
    assert.equal(await generateUniqueSlug(sb, "c1", "Nicolas"), "nicolas-5");
  });

  it("ignores gaps and picks the smallest free number", async () => {
    const sb = mockSupabase(["nicolas", "nicolas-3", "nicolas-7"]);
    assert.equal(await generateUniqueSlug(sb, "c1", "Nicolas"), "nicolas-2");
  });

  it("falls back to base when no clientId scope (legacy path)", async () => {
    const sb = mockSupabase(["nicolas"]); // would collide if scoped
    assert.equal(await generateUniqueSlug(sb, null, "Nicolas"), "nicolas");
  });

  it("throws on empty name", async () => {
    const sb = mockSupabase([]);
    await assert.rejects(() => generateUniqueSlug(sb, "c1", ""), /empty name/);
    await assert.rejects(() => generateUniqueSlug(sb, "c1", "???"), /empty name/);
  });

  it("propagates supabase errors with context", async () => {
    const sb = {
      from() { return this; },
      select() { return this; },
      eq() { return this; },
      or() { return Promise.resolve({ data: null, error: { message: "boom" } }); },
    };
    await assert.rejects(() => generateUniqueSlug(sb, "c1", "Nicolas"), /Failed to check slug uniqueness: boom/);
  });
});
