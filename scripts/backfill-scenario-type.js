#!/usr/bin/env node
// Backfill scenario_type for conversations where it's NULL.
//
// Classification logic:
//   1. Pull conv + first user message + persona.type
//   2. If persona.type='post' → assume post_autonome (most common)
//   3. If persona.type='dm' → assume DM_1st
//   4. If 'both' → lightweight LLM classifier (claude-haiku-4-5, ~$0.001/call)
//
// Usage: node -r dotenv/config scripts/backfill-scenario-type.js [--dry-run] [--limit N]

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const CANONICAL_TYPES = [
  "post_autonome",
  "post_lead_magnet",
  "post_actu",
  "post_prise_position",
  "post_framework",
  "post_cas_client",
  "post_coulisse",
  "DM_1st",
  "DM_relance",
  "DM_reply",
  "DM_closing",
];

const CLASSIFIER_SYSTEM = `Tu classifies une conversation entre un opérateur et son clone IA en un type canonique.

Types disponibles :
- post_autonome : post LinkedIn générique sans angle particulier
- post_lead_magnet : post promouvant un asset (guide, ressource)
- post_actu : post réagissant à une actu / annonce
- post_prise_position : post controversé / opinion forte
- post_framework : post explicatif d'un framework / méthode
- post_cas_client : post racontant une histoire / cas client
- post_coulisse : post sur la coulisse de l'activité
- DM_1st : premier DM à un prospect (icebreaker)
- DM_relance : relance d'un prospect silencieux
- DM_reply : réponse à un message du prospect
- DM_closing : DM pour proposer un RDV / closer

Tu réponds UNIQUEMENT avec le type, rien d'autre.`;

const HAIKU = "claude-haiku-4-5";

async function classifyWithLLM(anthropic, firstUserMsg, personaType) {
  const userMsg = `Type persona : ${personaType}
Premier message utilisateur :
"${firstUserMsg.slice(0, 600)}"

Type :`;
  try {
    const r = await anthropic.messages.create({
      model: HAIKU,
      max_tokens: 30,
      system: CLASSIFIER_SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    });
    const text = (r.content?.[0]?.text || "").trim();
    if (CANONICAL_TYPES.includes(text)) return text;
    // try to find a canonical type embedded in the response
    for (const t of CANONICAL_TYPES) if (text.includes(t)) return t;
    return null;
  } catch (e) {
    console.error("classifier_error:", e.message);
    return null;
  }
}

function heuristicGuess(personaType, firstUserMsg) {
  if (personaType === "post") return "post_autonome";
  if (personaType === "dm") return "DM_1st";
  // 'both' or unknown → try by message shape
  const len = (firstUserMsg || "").length;
  if (len > 250 && !/^(salut|hello|bonjour|hi|coucou)/i.test(firstUserMsg)) return "post_autonome";
  return null; // fallback to LLM
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const limitIdx = argv.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(argv[limitIdx + 1]) : 100;

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error("ANTHROPIC_API_KEY missing"); process.exit(1); }
  const anthropic = new Anthropic({ apiKey });

  const { data: convs } = await sb
    .from("conversations")
    .select("id, persona_id, scenario, title")
    .is("scenario_type", null)
    .limit(limit);

  console.log(`backfill-scenario-type — ${convs?.length || 0} conv to classify, dryRun=${dryRun}`);

  const personaCache = new Map();
  async function getPersonaType(pid) {
    if (personaCache.has(pid)) return personaCache.get(pid);
    const { data } = await sb.from("personas").select("type").eq("id", pid).single();
    const t = data?.type || "both";
    personaCache.set(pid, t);
    return t;
  }

  let stats = { heuristic: 0, llm: 0, failed: 0, applied: 0 };
  for (const c of convs || []) {
    const personaType = await getPersonaType(c.persona_id);
    const { data: firstMsg } = await sb
      .from("messages")
      .select("content")
      .eq("conversation_id", c.id)
      .eq("role", "user")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const userMsg = firstMsg?.content || c.title || "";

    let scenario_type = heuristicGuess(personaType, userMsg);
    if (scenario_type) stats.heuristic++;
    else {
      scenario_type = await classifyWithLLM(anthropic, userMsg, personaType);
      if (scenario_type) stats.llm++;
    }
    if (!scenario_type) {
      stats.failed++;
      console.log(`[fail] conv=${c.id.slice(0,8)} no_classification`);
      continue;
    }

    if (dryRun) {
      console.log(`[dry] conv=${c.id.slice(0,8)} pType=${personaType} → ${scenario_type}  (msg: ${userMsg.slice(0,60)}...)`);
    } else {
      await sb.from("conversations").update({ scenario_type }).eq("id", c.id);
      stats.applied++;
      console.log(`[ok ] conv=${c.id.slice(0,8)} pType=${personaType} → ${scenario_type}`);
    }
  }
  console.log("done:", stats);
}

main().catch((e) => { console.error(e); process.exit(1); });
