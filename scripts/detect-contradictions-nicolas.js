// Scan Nicolas's pending propositions to detect contradictory pairs.
//
// Strategy :
//   1. Fetch all pending propositions Nicolas (across his 5 active docs).
//   2. Group by target_kind (contradictions only make sense within a section).
//   3. For each group, compute cosine pairs ≥ 0.65 (deliberately permissive —
//      we want to catch numerical divergence "max 2" vs "max 3" which embed
//      with high cosine ~0.93, but also broader semantic opposites).
//   4. For each candidate pair, ask Haiku to classify : synonym / contradiction
//      / disjoint. Only contradictions are surfaced.
//   5. Print a human-readable report grouped by target_kind.
//
// Read-only — no DB writes. Just shows the user what to arbitrate.
//
// Usage : node scripts/detect-contradictions-nicolas.js

import dotenv from "dotenv";
dotenv.config({ path: "C:/Users/abrah/AhmetA/.env", override: true });

const { createClient } = await import("@supabase/supabase-js");
const Anthropic = (await import("@anthropic-ai/sdk")).default;

const NICOLAS_SLUG = "nicolas-lavall-e";
const COSINE_THRESHOLD = 0.65;
const PAIR_LIMIT = 200;       // safety cap on Haiku calls

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const CLASSIFY_SYSTEM = `Tu compares deux règles/propositions du même protocole opérationnel d'un clone IA LinkedIn (setter outbound). Réponds par UN seul mot :

SYNONYM = les 2 disent la même chose, paraphrases (ex: "Max 2 questions" vs "Pas plus de 2 questions par message")
CONTRADICTION = les 2 sont incompatibles, accepter les 2 produit du chaos (ex: "Max 2 questions" vs "Max 3 questions" / "Toujours signer Nicolas" vs "Ne jamais signer")
DISJOINT = sujets différents qui se touchent thématiquement mais ne se contredisent pas (ex: "Pas de bullets" vs "Max 6 lignes")

Pas de fluff. Juste : SYNONYM, CONTRADICTION ou DISJOINT.`;

async function classifyPair(a, b) {
  try {
    const result = await Promise.race([
      anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 16,
        system: CLASSIFY_SYSTEM,
        messages: [{
          role: "user",
          content: `Proposition A : "${a}"\n\nProposition B : "${b}"\n\nClassifie :`,
        }],
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("haiku_timeout")), 10000)),
    ]);
    const text = (result.content?.[0]?.text || "").trim().toUpperCase();
    if (text.startsWith("SYN")) return "synonym";
    if (text.startsWith("CONTRA")) return "contradiction";
    if (text.startsWith("DIS")) return "disjoint";
    return "unknown";
  } catch (err) {
    return "error";
  }
}

console.log("=== Détection contradictions intra-doc Nicolas ===\n");

const { data: nicolas } = await sb.from("personas").select("id").eq("slug", NICOLAS_SLUG).single();
const { data: docs } = await sb.from("protocol_document").select("id").eq("owner_kind", "persona").eq("owner_id", nicolas.id);
const docIds = (docs || []).map((d) => d.id);

const { data: props } = await sb.from("proposition")
  .select("id, target_kind, intent, proposed_text, embedding, status, document_id, created_at")
  .in("document_id", docIds)
  .eq("status", "pending");

console.log(`Propositions pending Nicolas : ${props?.length || 0}`);

// Parse embeddings (stored as JSON strings)
const propsWithEmbed = (props || []).filter((p) => {
  if (!p.embedding) return false;
  try {
    p.embedding = typeof p.embedding === "string" ? JSON.parse(p.embedding) : p.embedding;
    return Array.isArray(p.embedding) && p.embedding.length > 0;
  } catch { return false; }
});
console.log(`Avec embedding valide   : ${propsWithEmbed.length}`);

// Group by target_kind
const byKind = {};
for (const p of propsWithEmbed) {
  (byKind[p.target_kind] ||= []).push(p);
}
console.log(`Groupes target_kind     : ${Object.keys(byKind).length}`);
for (const [k, arr] of Object.entries(byKind)) {
  console.log(`  ${k.padEnd(15)} ${arr.length} props`);
}
console.log("");

// For each group, find candidate pairs (cosine ≥ threshold)
const candidates = [];
for (const [kind, arr] of Object.entries(byKind)) {
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const cos = cosine(arr[i].embedding, arr[j].embedding);
      if (cos >= COSINE_THRESHOLD) {
        candidates.push({ kind, a: arr[i], b: arr[j], cos });
      }
    }
  }
}
candidates.sort((x, y) => y.cos - x.cos);

console.log(`Candidat pairs (cosine ≥ ${COSINE_THRESHOLD}) : ${candidates.length}`);
if (candidates.length > PAIR_LIMIT) {
  console.log(`  → cap to top ${PAIR_LIMIT} by cosine descending`);
  candidates.length = PAIR_LIMIT;
}
console.log("");

// Classify each pair via Haiku
const results = { synonym: [], contradiction: [], disjoint: [], unknown: [], error: [] };
let progress = 0;
for (const c of candidates) {
  const verdict = await classifyPair(c.a.proposed_text, c.b.proposed_text);
  results[verdict].push(c);
  progress++;
  if (progress % 20 === 0 || progress === candidates.length) {
    console.log(`  ${progress}/${candidates.length}  syn=${results.synonym.length} contra=${results.contradiction.length} disj=${results.disjoint.length} err=${results.error.length+results.unknown.length}`);
  }
}

console.log("\n=== CONTRADICTIONS DÉTECTÉES ===\n");
if (results.contradiction.length === 0) {
  console.log("Aucune contradiction détectée parmi les paires haute-similarité.");
} else {
  // Group by target_kind
  const byKindContra = {};
  for (const c of results.contradiction) (byKindContra[c.kind] ||= []).push(c);
  for (const [kind, arr] of Object.entries(byKindContra)) {
    console.log(`\n━━━ ${kind} (${arr.length} contradictions) ━━━`);
    for (const c of arr) {
      console.log(`\n  cosine=${c.cos.toFixed(3)}`);
      console.log(`    A [${c.a.id.slice(0, 8)}]: ${c.a.proposed_text.slice(0, 200)}`);
      console.log(`    B [${c.b.id.slice(0, 8)}]: ${c.b.proposed_text.slice(0, 200)}`);
    }
  }
}

console.log(`\n=== SUMMARY ===`);
console.log(`pairs scanned       : ${candidates.length}`);
console.log(`synonyms (mergeable): ${results.synonym.length}`);
console.log(`contradictions      : ${results.contradiction.length}  ← À ARBITRER`);
console.log(`disjoints (OK)      : ${results.disjoint.length}`);
console.log(`unknown/error       : ${results.unknown.length + results.error.length}`);
