// Restructure protocol-v2 sections for all active personas, in two passes :
//
//   PASS 1 — voice → sections (no LLM, deterministic) :
//     personas.voice.writingRules    → section hard_rules
//     personas.voice.forbiddenWords  → section hard_rules (append)
//     personas.voice.neverDoes       → section errors
//     personas.voice.signaturePhrases→ section templates
//
//   PASS 2 — raw_document → sections (meta-LLM split via Anthropic) :
//     For personas with operating_protocols.raw_document, ask claude-haiku
//     to split the doc into 6 canonical buckets and fill the sections
//     that pass 1 didn't already populate (process / icp_patterns / scoring).
//
// Defensive policy :
//   - NEVER overwrite a section that already has content, EXCEPT for
//     Nicolas hard_rules (which has a 16KB raw blob mistakenly dumped
//     by yesterday's backfill script).
//   - Idempotent : re-running on a fully restructured persona is a no-op.
//
// CLI : node scripts/restructure-protocol-v2-content.js [--apply]
import { config } from "dotenv";
config({ path: ".env.local", override: true });
config({ override: true });
// Dynamic imports AFTER dotenv runs — lib/supabase.js reads process.env at module load,
// and ESM hoists static imports above top-level code. Without dynamic import,
// supabase client would init with empty env vars.
const { supabase } = await import("../lib/supabase.js");
const { callClaudeWithTimeout, parseJsonFromText } = await import("../lib/claude-helpers.js");

const apply = process.argv.includes("--apply");

const NICOLAS_ID = "2f5f1414-9d65-499d-a3d7-6be2826c6098";

// ─── Pass 1 — voice → prose ──────────────────────────────────

function buildHardRulesProse(voice) {
  const lines = [];
  if (voice?.tone?.length) {
    lines.push(`**Ton de voix :** ${voice.tone.join(", ")}.`);
    lines.push("");
  }
  if (voice?.personality?.length) {
    lines.push(`**Personnalité :** ${voice.personality.join(", ")}.`);
    lines.push("");
  }
  if (voice?.writingRules?.length) {
    lines.push("## Règles d'écriture");
    for (const r of voice.writingRules) lines.push(`- ${r}`);
    lines.push("");
  }
  if (voice?.forbiddenWords?.length) {
    lines.push("## Mots interdits");
    lines.push(`Ne jamais utiliser : ${voice.forbiddenWords.map((w) => `"${w}"`).join(", ")}.`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

function buildErrorsProse(voice) {
  if (!voice?.neverDoes?.length) return "";
  const lines = ["## À ne jamais faire", ""];
  for (const e of voice.neverDoes) lines.push(`- ${e}`);
  return lines.join("\n");
}

function buildTemplatesProse(voice) {
  if (!voice?.signaturePhrases?.length) return "";
  const lines = ["## Phrases signature", "", "Formules récurrentes à réutiliser quand c'est pertinent :", ""];
  for (const p of voice.signaturePhrases) lines.push(`- "${p}"`);
  return lines.join("\n");
}

// ─── Pass 2 — meta-LLM split ──────────────────────────────────

const SPLIT_SYSTEM = `Tu reçois le PROTOCOLE OPÉRATIONNEL d'un clone d'agence ghostwriting LinkedIn.

Découpe le contenu en 6 sections canoniques :
- hard_rules : règles absolues (vouvoiement, anti-emojis, formules interdites...)
- errors : erreurs à éviter, do/don't, préférences de formulation
- process : étapes opérationnelles (qualification, relance, closing...)
- icp_patterns : ICP / taxonomie prospects (qui on cible, signaux à capter)
- scoring : axes de qualification, scoring de leads
- templates : skeletons de DM/post par scénario, phrases-types

Pour chaque section, retourne le texte EXTRAIT du document (en français, lisible non-tech). Si une section n'est pas couverte par le doc, retourne "" (chaîne vide).

Sortie OBLIGATOIRE en JSON pur (un seul objet, 6 clés). Pas de markdown autour, pas de \`\`\`. Pas de commentaire.

{
  "hard_rules": "...",
  "errors": "...",
  "process": "...",
  "icp_patterns": "...",
  "scoring": "...",
  "templates": "..."
}`;

async function metaSplit(rawDocument) {
  const response = await callClaudeWithTimeout({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    system: SPLIT_SYSTEM,
    messages: [{ role: "user", content: rawDocument }],
    timeoutMs: 60000,
    timeoutLabel: "split_timeout",
  });
  const text = response?.content?.[0]?.text;
  if (!text) return null;
  return parseJsonFromText(text);
}

// ─── Apply to one persona ─────────────────────────────────────

async function processPersona(p) {
  console.log(`\n--- ${p.name} (${p.slug}) ---`);

  // Load active doc + sections.
  const { data: doc } = await supabase
    .from("protocol_document")
    .select("id")
    .eq("owner_id", p.id)
    .eq("status", "active")
    .maybeSingle();
  if (!doc?.id) {
    console.log("  ❌ no active doc, skip");
    return { name: p.name, error: "no_active_doc" };
  }

  const { data: sections } = await supabase
    .from("protocol_section")
    .select("id, kind, prose")
    .eq("document_id", doc.id);
  const byKind = new Map();
  for (const s of sections || []) byKind.set(s.kind, s);

  // Build voice-derived prose.
  const fromVoice = {
    hard_rules: buildHardRulesProse(p.voice || {}),
    errors: buildErrorsProse(p.voice || {}),
    templates: buildTemplatesProse(p.voice || {}),
  };

  // Load raw_doc for meta-split.
  const { data: ops } = await supabase
    .from("operating_protocols")
    .select("raw_document")
    .eq("persona_id", p.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const rawDoc = ops?.raw_document || null;

  let split = null;
  if (rawDoc && rawDoc.length > 200) {
    if (apply) {
      console.log(`  📡 meta-split raw_doc (${rawDoc.length} chars) via claude-haiku-4-5...`);
      try {
        split = await metaSplit(rawDoc);
        if (split) {
          const lens = Object.fromEntries(
            Object.entries(split).map(([k, v]) => [k, (v || "").length]),
          );
          console.log(`     split lens: ${JSON.stringify(lens)}`);
        }
      } catch (e) {
        console.log(`  ⚠️  meta-split failed: ${e.message}`);
      }
    } else {
      console.log(`  📡 [dry-run] would meta-split raw_doc (${rawDoc.length} chars)`);
    }
  }

  // Decide what to write per section.
  const updates = []; // {kind, section_id, current_len, new_prose, action}
  const ALL_KINDS = ["hard_rules", "errors", "process", "icp_patterns", "scoring", "templates"];

  for (const kind of ALL_KINDS) {
    const section = byKind.get(kind);
    if (!section) continue;
    const currentLen = section.prose?.length || 0;
    const isNicolasHardRules =
      p.id === NICOLAS_ID && kind === "hard_rules";

    // Build candidate prose : voice first, then split fills if voice was empty.
    const voiceProse = fromVoice[kind] || "";
    const splitProse = split?.[kind] || "";

    let newProse;
    if (voiceProse && splitProse) {
      newProse = `${voiceProse}\n\n---\n\n${splitProse}`.trim();
    } else {
      newProse = (voiceProse || splitProse).trim();
    }

    if (!newProse) {
      updates.push({ kind, section_id: section.id, currentLen, action: "skip_no_content" });
      continue;
    }

    if (isNicolasHardRules) {
      updates.push({ kind, section_id: section.id, currentLen, newProse, action: "nicolas_wipe_replace" });
    } else if (currentLen === 0) {
      updates.push({ kind, section_id: section.id, currentLen, newProse, action: "fill_empty" });
    } else {
      updates.push({ kind, section_id: section.id, currentLen, action: "skip_already_filled" });
    }
  }

  // Print plan.
  for (const u of updates) {
    const tag = {
      skip_no_content: "⏭️",
      skip_already_filled: "⏭️",
      fill_empty: "✏️",
      nicolas_wipe_replace: "🗑️→✏️",
    }[u.action];
    const newLen = u.newProse?.length || 0;
    console.log(
      `  ${tag} ${u.kind.padEnd(13)} ${u.action.padEnd(22)} (current=${u.currentLen}, new=${newLen})`,
    );
  }

  // Execute writes if --apply.
  if (apply) {
    for (const u of updates) {
      if (!u.newProse) continue;
      const { error } = await supabase
        .from("protocol_section")
        .update({ prose: u.newProse })
        .eq("id", u.section_id);
      if (error) console.log(`  ❌ ${u.kind}: ${error.message}`);
    }
  }

  return { name: p.name, updates };
}

async function main() {
  console.log(`=== Restructure protocol-v2 content (${apply ? "APPLY" : "DRY-RUN"}) ===`);

  const { data: personas } = await supabase
    .from("personas")
    .select("*")
    .eq("is_active", true)
    .order("name");

  const results = [];
  for (const p of personas || []) {
    const r = await processPersona(p);
    results.push(r);
  }

  console.log("\n=== Synthèse ===");
  for (const r of results) {
    if (r.error) {
      console.log(`  ${r.name.padEnd(22)} ❌ ${r.error}`);
      continue;
    }
    const filled = (r.updates || []).filter((u) => u.action === "fill_empty" || u.action === "nicolas_wipe_replace").length;
    const skipped = (r.updates || []).filter((u) => u.action.startsWith("skip")).length;
    console.log(`  ${r.name.padEnd(22)} filled=${filled} skipped=${skipped}`);
  }
  if (!apply) console.log("\nRe-run with --apply to execute.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
