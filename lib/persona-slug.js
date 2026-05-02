// Persona slug generation, with collision handling on the (client_id, slug)
// unique constraint. Extracted from api/clone.js so it can be unit-tested
// without spinning up the full handler.
//
// Two layers :
//   - slugify(name)                       : pure transform name → kebab.
//   - generateUniqueSlug(sb, clientId, n) : returns a slug not yet taken
//                                           for this client. Suffixes
//                                           "-2", "-3"… on collision.
//
// Race conditions (two creates in flight for the same client + name) still
// need a 23505 catch at the call site — see api/clone.js. This helper just
// shrinks the window.

export function slugify(name) {
  if (typeof name !== "string") return "";
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function generateUniqueSlug(supabase, clientId, name) {
  const base = slugify(name);
  if (!base) throw new Error("Cannot generate slug from empty name");
  if (!clientId) return base; // no scope → no collision possible (legacy path)

  const { data: existing, error } = await supabase
    .from("personas")
    .select("slug")
    .eq("client_id", clientId)
    .or(`slug.eq.${base},slug.like.${base}-%`);
  if (error) throw new Error(`Failed to check slug uniqueness: ${error.message}`);

  const taken = new Set((existing || []).map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; n <= 999; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  // 999+ collisions on the same name for the same client is not a real
  // scenario — fall back to a timestamp suffix rather than throw.
  return `${base}-${Date.now().toString(36)}`;
}
