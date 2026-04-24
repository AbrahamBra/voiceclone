// ============================================================
// Protocol dry-run endpoint
//
// POST /api/protocol-test?id=<protocolId>&persona=<personaId>
//   body: { limit?: number }  — default 50, max 200
//
// Replays a parsed (not necessarily active) protocol's rules against
// the clone's last N outbound messages so the operator can see what
// would have been rewritten / flagged before clicking ACTIVER.
//
// Auth + access check mirror api/protocol.js.
// ============================================================

export const maxDuration = 30;

import { authenticateRequest, supabase, hasPersonaAccess, setCors } from "../lib/supabase.js";
import { checkProtocolRules } from "../lib/protocolChecks.js";
import { getPersonaOutgoingMessages } from "../lib/messages-db.js";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const MAX_SAMPLES = 10;
const EXCERPT_CHARS = 220;

const SEVERITY_RANK = { hard: 0, strong: 1, light: 2 };

async function assertPersonaAccess(isAdmin, client, personaId) {
  if (isAdmin) return true;
  return hasPersonaAccess(client?.id, personaId);
}

export default async function handler(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  const protocolId = req.query?.id;
  const personaId = req.query?.persona;
  if (!protocolId || !personaId) {
    res.status(400).json({ error: "id and persona are required" }); return;
  }

  const rawLimit = Number(req.body?.limit ?? DEFAULT_LIMIT);
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(rawLimit) ? rawLimit : DEFAULT_LIMIT));

  // Access guard — same pattern as api/protocol.js.
  const { data: proto } = await supabase
    .from("operating_protocols")
    .select("id, persona_id, status")
    .eq("id", protocolId)
    .single();
  if (!proto) { res.status(404).json({ error: "Protocol not found" }); return; }
  if (!(await assertPersonaAccess(isAdmin, client, proto.persona_id))) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  if (!(await assertPersonaAccess(isAdmin, client, personaId))) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  if (proto.status !== "parsed") {
    res.status(400).json({ error: "Protocol is not parsed yet" }); return;
  }

  // Load this specific protocol's rules directly (bypass the active-only cache).
  const { data: rules, error: rulesErr } = await supabase
    .from("protocol_hard_rules")
    .select("rule_id, description, check_kind, check_params, applies_to_scenarios, severity, source_quote")
    .eq("protocol_id", protocolId);
  if (rulesErr) { res.status(500).json({ error: rulesErr.message }); return; }
  if (!rules || rules.length === 0) {
    res.json({
      total_messages: 0,
      rules_count: 0,
      scenarios_seen: [],
      counts: { hard: 0, strong: 0, light: 0, clean: 0 },
      samples: [],
    });
    return;
  }

  const messages = await getPersonaOutgoingMessages(personaId, limit);
  if (messages.length === 0) {
    res.json({
      total_messages: 0,
      rules_count: rules.length,
      scenarios_seen: [],
      counts: { hard: 0, strong: 0, light: 0, clean: 0 },
      samples: [],
    });
    return;
  }

  const counts = { hard: 0, strong: 0, light: 0, clean: 0 };
  const scenariosSeen = new Set();
  const perMessage = [];

  for (const m of messages) {
    if (m.scenario) scenariosSeen.add(m.scenario);
    const { violations } = checkProtocolRules(m.content || "", rules, { scenario: m.scenario });

    if (violations.length === 0) {
      counts.clean += 1;
      continue;
    }

    // A message can trigger rules at multiple severities; bucket it at its
    // worst severity for the top-line counter, but keep all violations in
    // the sample payload.
    const worst = violations.reduce((acc, v) => {
      const r = SEVERITY_RANK[v.severity] ?? 99;
      return r < acc ? r : acc;
    }, 99);
    if (worst === 0) counts.hard += 1;
    else if (worst === 1) counts.strong += 1;
    else counts.light += 1;

    perMessage.push({
      message_id: m.id,
      created_at: m.created_at,
      scenario: m.scenario,
      worst_rank: worst,
      excerpt: (m.content || "").slice(0, EXCERPT_CHARS) + ((m.content || "").length > EXCERPT_CHARS ? "…" : ""),
      violations: violations.map(v => ({
        rule_id: v.rule_id,
        severity: v.severity,
        detail: v.detail,
      })),
    });
  }

  // Sort samples hard → strong → light, then most recent first.
  perMessage.sort((a, b) => a.worst_rank - b.worst_rank || (a.created_at < b.created_at ? 1 : -1));
  const samples = perMessage.slice(0, MAX_SAMPLES).map(({ worst_rank, ...rest }) => rest);

  res.json({
    total_messages: messages.length,
    rules_count: rules.length,
    scenarios_seen: Array.from(scenariosSeen),
    counts,
    samples,
  });
}
