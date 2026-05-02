// ============================================================
// RLS isolation — proves the anon key cannot reach any public table.
//
// Threat model: someone obtains the Supabase URL + anon key (both are
// public — they ship in any frontend that ever talks to Supabase
// directly). Can they read or write any client data?
//
// In this app, the answer must be "no" for every public table:
// the backend uses service_role for everything, the frontend never
// touches Supabase. So every public table must (a) have RLS enabled
// and (b) have no policies that grant anon / authenticated / public.
//
// This test enforces both conditions automatically. It also runs two
// live sanity checks against the anon key. It writes nothing to prod.
//
// Requires migration 066 (audit helper functions).
//
// Run:
//   SUPABASE_URL=...  \
//   SUPABASE_SERVICE_ROLE_KEY=...  \
//   SUPABASE_ANON_KEY=...  \
//   node --test test/rls-isolation.test.js
// ============================================================

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
const HAS_ENV = !!(URL && SERVICE && ANON);

describe("RLS isolation — anon key must be locked out of every public table", () => {
  if (!HAS_ENV) {
    it("skipped (set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY to run)", () => {});
    return;
  }

  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });

  it("every public table has row level security enabled", async () => {
    const { data, error } = await admin.rpc("list_public_tables_rls");
    assert.ifError(error);
    assert.ok(Array.isArray(data) && data.length > 0,
      "list_public_tables_rls returned no tables — has migration 066 been applied?");

    const offenders = data.filter((r) => r.rowsecurity !== true);
    assert.equal(
      offenders.length,
      0,
      `tables WITHOUT RLS enabled (anon key can read them):\n  - ${offenders
        .map((r) => r.tablename)
        .join("\n  - ")}`,
    );
  });

  it("no public-table policy grants access to anon, authenticated, or public role", async () => {
    const { data, error } = await admin.rpc("list_public_table_policies");
    assert.ifError(error);

    const dangerous = (data || []).filter(
      (p) =>
        Array.isArray(p.roles) &&
        p.roles.some((r) => r === "anon" || r === "authenticated" || r === "public"),
    );
    assert.equal(
      dangerous.length,
      0,
      `permissive policies (anon key can use them):\n  - ${dangerous
        .map((p) => `${p.tablename}.${p.policyname} → roles=${p.roles.join(",")} cmd=${p.cmd}`)
        .join("\n  - ")}`,
    );
  });

  it("anon key cannot call the audit helpers (defense in depth)", async () => {
    const { error: e1 } = await anon.rpc("list_public_tables_rls");
    assert.ok(e1, "anon must NOT be able to call list_public_tables_rls()");

    const { error: e2 } = await anon.rpc("list_public_table_policies");
    assert.ok(e2, "anon must NOT be able to call list_public_table_policies()");
  });

  it("anon key SELECT on clients returns zero rows (live sanity)", async () => {
    // Even if `clients` has thousands of rows, anon should see none.
    const { data, error } = await anon.from("clients").select("id").limit(1);
    // PostgREST's behavior with RLS + no anon policy is "return empty array, no error".
    // An error here would also be acceptable (some Supabase configs deny outright),
    // but data must NEVER contain rows.
    if (error) return; // explicit deny — also fine
    assert.deepEqual(data, [],
      `anon key leaked rows from clients (got ${data?.length} rows) — RLS hole`);
  });
});
