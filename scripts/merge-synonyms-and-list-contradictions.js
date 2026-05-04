// Option 2 — semi-auto :
//   - SCAN propositions Nicolas (cosine ≥ 0.65, same target_kind)
//   - Haiku classifie chaque paire : SYNONYM / CONTRADICTION / DISJOINT
//   - SYNONYMS → auto-merge (keep le plus long texte, cumul source_refs +
//     count, reject l'autre comme status='merged')
//   - CONTRADICTIONS → écrits dans docs/decisions/contradictions-nicolas-<date>.md
//     avec template "garder A / garder B / autre" pour décision user
//
// Dry-run par défaut. --apply pour effectuer les merges en DB.
//
// Usage : node scripts/merge-synonyms-and-list-contradictions.js [--apply] [--persona <slug>]

import dotenv from "dotenv";
import fs from "node:fs";
dotenv.config({ path: "C:/Users/abrah/AhmetA/.env", override: true });

const { createClient } = await import("@supabase/supabase-js");
const Anthropic = (await import("@anthropic-ai/sdk")).default;

const apply = process.argv.includes("--apply");
const personaArgIdx = process.argv.indexOf("--persona");
const personaSlug = personaArgIdx >= 0 ? process.argv[personaArgIdx + 1] : "nicolas-lavall-e";

const COSINE_THRESHOLD = 0.65;
const PAIR_LIMIT = 250;

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const CLASSIFY_SYSTEM = `Tu compares deux règles/propositions du même protocole opérationnel d'un clone IA LinkedIn (setter outbound). Réponds par UN seul mot :

SYNONYM = les 2 disent la même chose, paraphrases (ex: "Max 2 questions" vs "Pas plus de 2 questions par message")
CONTRADICTION = les 2 sont incompatibles, accepter les 2 produit du chaos (ex: "Max 2 questions" vs "Max 3 questions" / "Toujours signer Nicolas" vs "Ne jamais signer")
DISJOINT = sujets différents qui se touchent thématiquement mais ne se contredisent pas

Pas de fluff. Juste : SYNONYM, CONTRADICTION ou DISJOINT.`;

async function classifyPair(a, b) {
  try {
    const result = await Promise.race([
      anthropic.messages.create({
        model: "claude-haiku-4-5", max_tokens: 16, system: CLASSIFY_SYSTEM,
        messages: [{ role: "user", content: `Proposition A : "${a}"\n\nProposition B : "${b}"\n\nClassifie :` }],
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("haiku_timeout")), 10000)),
    ]);
    const text = (result.content?.[0]?.text || "").trim().toUpperCase();
    if (text.startsWith("SYN")) return "synonym";
    if (text.startsWith("CONTRA")) return "contradiction";
    if (text.startsWith("DIS")) return "disjoint";
    return "unknown";
  } catch { return "error"; }
}

console.log(`=== Auto-merge synonyms + list contradictions (${apply ? "APPLY" : "DRY-RUN"}) persona=${personaSlug} ===\n`);

const { data: persona } = await sb.from("personas").select("id, name").eq("slug", personaSlug).single();
if (!persona) { console.error(`persona ${personaSlug} not found`); process.exit(1); }

const { data: docs } = await sb.from("protocol_document").select("id").eq("owner_kind", "persona").eq("owner_id", persona.id);
const docIds = (docs || []).map((d) => d.id);

const { data: props } = await sb.from("proposition")
  .select("id, target_kind, intent, proposed_text, embedding, source_refs, count, document_id")
  .in("document_id", docIds).eq("status", "pending");

const propsWithEmbed = (props || []).filter((p) => {
  if (!p.embedding) return false;
  try { p.embedding = typeof p.embedding === "string" ? JSON.parse(p.embedding) : p.embedding;
    return Array.isArray(p.embedding) && p.embedding.length > 0;
  } catch { return false; }
});
console.log(`Pending props with embedding : ${propsWithEmbed.length}/${props?.length || 0}`);

const byKind = {};
for (const p of propsWithEmbed) (byKind[p.target_kind] ||= []).push(p);

const candidates = [];
for (const [kind, arr] of Object.entries(byKind)) {
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const cos = cosine(arr[i].embedding, arr[j].embedding);
      if (cos >= COSINE_THRESHOLD) candidates.push({ kind, a: arr[i], b: arr[j], cos });
    }
  }
}
candidates.sort((x, y) => y.cos - x.cos);
if (candidates.length > PAIR_LIMIT) candidates.length = PAIR_LIMIT;
console.log(`Candidate pairs (cosine ≥ ${COSINE_THRESHOLD}, top ${PAIR_LIMIT}) : ${candidates.length}\n`);

const synonyms = [], contradictions = [], disjoints = [], errors = [];
let progress = 0;
for (const c of candidates) {
  const v = await classifyPair(c.a.proposed_text, c.b.proposed_text);
  if (v === "synonym") synonyms.push(c);
  else if (v === "contradiction") contradictions.push(c);
  else if (v === "disjoint") disjoints.push(c);
  else errors.push(c);
  progress++;
  if (progress % 25 === 0 || progress === candidates.length) {
    console.log(`  ${progress}/${candidates.length}  syn=${synonyms.length} contra=${contradictions.length} disj=${disjoints.length} err=${errors.length}`);
  }
}

// === MERGE SYNONYMS ===
// Pour chaque synonym pair (A, B), garde la plus longue (= plus complète)
// → keeper. L'autre devient status='merged' avec rationale qui pointe sur keeper.
// Cumule source_refs + count.
const mergedIds = new Set();
const mergePlan = [];
for (const s of synonyms) {
  if (mergedIds.has(s.a.id) || mergedIds.has(s.b.id)) continue; // skip transitively
  const keeper = s.a.proposed_text.length >= s.b.proposed_text.length ? s.a : s.b;
  const loser = keeper === s.a ? s.b : s.a;
  mergedIds.add(loser.id);
  const newRefs = Array.from(new Set([...(keeper.source_refs || []), ...(loser.source_refs || [])]));
  mergePlan.push({
    keeper_id: keeper.id, loser_id: loser.id,
    keeper_text: keeper.proposed_text.slice(0, 80),
    loser_text: loser.proposed_text.slice(0, 80),
    new_refs: newRefs, new_count: newRefs.length,
    cosine: s.cos.toFixed(3), kind: s.kind,
  });
}

console.log(`\n=== MERGE PLAN ===`);
console.log(`Synonym pairs detected     : ${synonyms.length}`);
console.log(`Unique merges (no overlap) : ${mergePlan.length}`);

if (mergePlan.length > 0 && !apply) {
  console.log(`\nSample (first 5):`);
  for (const m of mergePlan.slice(0, 5)) {
    console.log(`  [${m.kind}] cos=${m.cosine}  keeper="${m.keeper_text}"  loser="${m.loser_text}"`);
  }
}

if (apply && mergePlan.length > 0) {
  console.log(`\nApplying merges...`);
  let okMerge = 0, failMerge = 0, mhInsertOk = 0, mhInsertFail = 0;
  for (const m of mergePlan) {
    // Re-fetch loser snapshot pour proposition_merge_history (texte + provenance
    // capturés AVANT que le status passe à 'merged'). Le keeper recevra ensuite
    // les nouveaux source_refs cumulés.
    const { data: loserSnapshot } = await sb.from("proposition")
      .select("proposed_text, count, source_refs, provenance")
      .eq("id", m.loser_id).single();

    const { error: updErr } = await sb.from("proposition")
      .update({ source_refs: m.new_refs, count: m.new_count }).eq("id", m.keeper_id);
    if (updErr) { console.error(`  ✗ keeper ${m.keeper_id.slice(0,8)}: ${updErr.message}`); failMerge++; continue; }
    const { error: lErr } = await sb.from("proposition")
      .update({ status: "merged", resolved_at: new Date().toISOString(), user_note: `auto-merged into ${m.keeper_id} (cosine ${m.cosine}, classified synonym by Haiku)` })
      .eq("id", m.loser_id);
    if (lErr) { console.error(`  ✗ loser ${m.loser_id.slice(0,8)}: ${lErr.message}`); failMerge++; continue; }
    okMerge++;

    // proposition_merge_history : snapshot du loser pour split-back V1.1.
    // merge_source='auto_synonym', merge_cosine = cosine de la détection.
    if (loserSnapshot) {
      const { error: mhErr } = await sb.from("proposition_merge_history").insert({
        persona_id: persona.id,
        kept_proposition_id: m.keeper_id,
        merged_proposition_text: loserSnapshot.proposed_text,
        merged_proposition_count: Math.max(1, loserSnapshot.count || 1),
        merged_provenance: loserSnapshot.provenance || null,
        merged_source_refs: loserSnapshot.source_refs || [],
        merge_source: "auto_synonym",
        merge_cosine: Number(m.cosine),
      });
      if (mhErr) { console.error(`  ⚠ merge_history ${m.keeper_id.slice(0,8)}: ${mhErr.message}`); mhInsertFail++; }
      else mhInsertOk++;
    }
  }
  console.log(`  ✓ merged ${okMerge} pairs (${failMerge} failed)`);
  console.log(`  ✓ merge_history ${mhInsertOk} rows inserted (${mhInsertFail} failed)`);
}

// === CONTRADICTIONS DB INSERT (mig 071 — proposition_contradiction) ===
// Canonicalisation : a_id = LEAST(a, b), b_id = GREATEST → empêche les
// doublons miroirs via UNIQUE(a, b). Idempotent par UNIQUE constraint :
// si la paire existe déjà (status open/resolved/punted), on log et continue.
let contraInsertOk = 0, contraInsertSkipped = 0, contraInsertFail = 0;
if (apply && contradictions.length > 0) {
  console.log(`\nInserting contradictions into proposition_contradiction...`);
  for (const c of contradictions) {
    const [aId, bId] = c.a.id < c.b.id ? [c.a.id, c.b.id] : [c.b.id, c.a.id];
    const { error: insErr } = await sb.from("proposition_contradiction").insert({
      persona_id: persona.id,
      proposition_a_id: aId,
      proposition_b_id: bId,
      kind: c.kind,
      cosine: Number(c.cos.toFixed(3)),
      reason: `auto-detected by Haiku (cosine ${c.cos.toFixed(3)}, same kind)`,
      status: "open",
    });
    if (insErr) {
      // Code 23505 = unique violation = paire déjà enregistrée. On compte
      // comme skipped (idempotence), pas comme failure.
      if (insErr.code === "23505" || /duplicate key/i.test(insErr.message || "")) {
        contraInsertSkipped++;
      } else {
        console.error(`  ✗ contra ${aId.slice(0,8)}/${bId.slice(0,8)}: ${insErr.message}`);
        contraInsertFail++;
      }
    } else {
      contraInsertOk++;
    }
  }
  console.log(`  ✓ ${contraInsertOk} inserted, ${contraInsertSkipped} skipped (already in DB), ${contraInsertFail} failed`);
}

// === CONTRADICTIONS MD ===
const today = new Date().toISOString().slice(0, 10);
const mdPath = `docs/decisions/contradictions-${personaSlug}-${today}.md`;
const lines = [];
lines.push(`# Contradictions à arbitrer — ${persona.name} (${today})\n`);
lines.push(`**${contradictions.length} contradictions détectées** parmi les ${propsWithEmbed.length} propositions pending.\n`);
lines.push(`Pour chaque paire : choisis "garder A", "garder B", "garder les 2 (faux positif)" ou "autre". Tu peux annoter directement ce fichier.\n`);

const byKindContra = {};
for (const c of contradictions) (byKindContra[c.kind] ||= []).push(c);

for (const [kind, arr] of Object.entries(byKindContra)) {
  lines.push(`---\n\n## ${kind} (${arr.length})\n`);
  for (let i = 0; i < arr.length; i++) {
    const c = arr[i];
    lines.push(`### ${kind} #${i + 1} — cosine ${c.cos.toFixed(3)}\n`);
    lines.push(`**A** [\`${c.a.id}\`] (intent: \`${c.a.intent}\`, count=${c.a.count})\n`);
    lines.push(`> ${c.a.proposed_text}\n`);
    lines.push(`**B** [\`${c.b.id}\`] (intent: \`${c.b.intent}\`, count=${c.b.count})\n`);
    lines.push(`> ${c.b.proposed_text}\n`);
    lines.push(`**Décision** : [ ] garder A   [ ] garder B   [ ] garder les 2   [ ] autre : ____________\n`);
  }
}

if (!fs.existsSync("docs/decisions")) fs.mkdirSync("docs/decisions", { recursive: true });
fs.writeFileSync(mdPath, lines.join("\n"));
console.log(`\n=== CONTRADICTIONS ===`);
console.log(`${contradictions.length} contradictions → ${mdPath}`);

console.log(`\n=== SUMMARY ===`);
console.log(`pairs scanned        : ${candidates.length}`);
console.log(`synonyms (mergeable) : ${synonyms.length}  (${mergePlan.length} unique merges${apply ? " applied" : " preview"})`);
console.log(`contradictions       : ${contradictions.length}  → ${mdPath}`);
if (apply) console.log(`contradictions DB    : ${contraInsertOk} new, ${contraInsertSkipped} already-exist, ${contraInsertFail} failed`);
console.log(`disjoints            : ${disjoints.length}`);
console.log(`errors               : ${errors.length}`);
if (!apply) console.log(`\nRe-run with --apply to execute merges + insert contradictions/merge_history into DB.`);
