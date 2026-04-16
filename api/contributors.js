import { authenticateRequest, supabase, hasPersonaAccess, setCors } from "../lib/supabase.js";
import { getIntelligenceId } from "../lib/knowledge-db.js";

export default async function handler(req, res) {
  setCors(res, "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  const personaId = req.query?.persona;
  if (!personaId) { res.status(400).json({ error: "persona is required" }); return; }

  if (!isAdmin) {
    const hasAccess = await hasPersonaAccess(client?.id, personaId);
    if (!hasAccess) { res.status(403).json({ error: "Forbidden" }); return; }
  }

  // Load persona to resolve intelligence source
  const { data: persona } = await supabase
    .from("personas").select("id, name, intelligence_source_id").eq("id", personaId).single();
  if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }

  const intellId = getIntelligenceId(persona);
  const isShared = intellId !== persona.id;

  // Get source persona name if shared
  let sourcePersonaName = null;
  if (isShared) {
    const { data: source } = await supabase
      .from("personas").select("name").eq("id", intellId).single();
    sourcePersonaName = source?.name || null;
  }

  // Count contributions per client
  const { data: corrCounts } = await supabase
    .from("corrections")
    .select("contributed_by")
    .eq("persona_id", intellId)
    .not("contributed_by", "is", null);

  const { data: knowledgeCounts } = await supabase
    .from("knowledge_files")
    .select("contributed_by")
    .eq("persona_id", intellId)
    .not("contributed_by", "is", null);

  // Aggregate by client
  const stats = {};
  for (const row of (corrCounts || [])) {
    if (!row.contributed_by) continue;
    if (!stats[row.contributed_by]) stats[row.contributed_by] = { corrections: 0, knowledge: 0 };
    stats[row.contributed_by].corrections++;
  }
  for (const row of (knowledgeCounts || [])) {
    if (!row.contributed_by) continue;
    if (!stats[row.contributed_by]) stats[row.contributed_by] = { corrections: 0, knowledge: 0 };
    stats[row.contributed_by].knowledge++;
  }

  // Fetch client names
  const clientIds = Object.keys(stats);
  if (clientIds.length === 0) {
    res.json({ contributors: [], is_shared: isShared, source_persona_name: sourcePersonaName });
    return;
  }

  const { data: clients } = await supabase
    .from("clients").select("id, name").in("id", clientIds);

  const nameMap = {};
  for (const c of (clients || [])) nameMap[c.id] = c.name;

  const contributors = clientIds.map(id => ({
    client_id: id,
    name: nameMap[id] || "Inconnu",
    corrections_count: stats[id].corrections,
    knowledge_count: stats[id].knowledge,
  })).sort((a, b) => (b.corrections_count + b.knowledge_count) - (a.corrections_count + a.knowledge_count));

  res.json({ contributors, is_shared: isShared, source_persona_name: sourcePersonaName });
}
