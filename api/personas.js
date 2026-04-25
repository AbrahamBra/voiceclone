import { authenticateRequest, createSession, supabase, setCors } from "../lib/supabase.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (!["GET", "DELETE"].includes(req.method)) { res.status(405).json({ error: "Method not allowed" }); return; }

  // DELETE /api/personas?id=<personaId> — soft delete (is_active = false)
  if (req.method === "DELETE") {
    const { id } = req.query;
    if (!id) { res.status(400).json({ error: "id required" }); return; }

    try {
      const { client, isAdmin } = await authenticateRequest(req);

      const { data: persona } = await supabase
        .from("personas").select("id, client_id").eq("id", id).single();

      if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }

      if (!isAdmin && persona.client_id !== client.id) {
        res.status(403).json({ error: "Access denied" }); return;
      }

      const { error } = await supabase
        .from("personas").update({ is_active: false }).eq("id", id);

      if (error) { res.status(500).json({ error: "Failed to delete" }); return; }

      res.json({ deleted: true });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.error || "Server error" });
    }
    return;
  }

  try {
    const { client, isAdmin } = await authenticateRequest(req);

    let personas = [];
    let canCreateClone = false;

    if (isAdmin) {
      // Admin sees all personas and can always create
      const { data } = await supabase
        .from("personas")
        .select("id, slug, client_id, name, title, avatar, client_label")
        .eq("is_active", true)
        .order("created_at", { ascending: true });
      personas = data || [];
      canCreateClone = true;
    } else {
      // Client sees only their own personas
      const { data } = await supabase
        .from("personas")
        .select("id, slug, client_id, name, title, avatar, client_label")
        .eq("client_id", client.id)
        .eq("is_active", true)
        .order("created_at", { ascending: true });
      personas = data || [];

      // Check if client can create more clones (only owned count)
      canCreateClone = personas.length < client.max_clones;

      // Also fetch shared personas
      const { data: shared } = await supabase
        .from("persona_shares")
        .select("persona_id, personas!inner(id, slug, client_id, name, title, avatar, client_label)")
        .eq("client_id", client.id)
        .eq("personas.is_active", true);

      if (shared?.length > 0) {
        const ownerIds = [...new Set(shared.map(s => s.personas.client_id))];
        const { data: owners } = await supabase
          .from("clients").select("id, name").in("id", ownerIds);
        const ownerMap = Object.fromEntries((owners || []).map(o => [o.id, o.name]));

        for (const s of shared) {
          personas.push({
            ...s.personas,
            _shared: true,
            _shared_by: ownerMap[s.personas.client_id] || "?",
          });
        }
      }
    }

    // Optional triage signals for the hub agency view: last_message_at per
    // persona (so the hub can sort by activity debt and surface inactive
    // clones). Opt-in with ?triage=true — base call stays cheap.
    if (personas.length > 0 && req.query?.triage === "true") {
      const ids = personas.map(p => p.id);
      const { data: convs } = await supabase
        .from("conversations")
        .select("persona_id, last_message_at")
        .in("persona_id", ids)
        .order("last_message_at", { ascending: false, nullsLast: true });

      // Take the first (most recent) row per persona. Since we ordered DESC,
      // a simple Map-first-seen pattern picks the newest per group.
      const lastByPersona = new Map();
      for (const c of convs || []) {
        if (!lastByPersona.has(c.persona_id) && c.last_message_at) {
          lastByPersona.set(c.persona_id, c.last_message_at);
        }
      }
      for (const p of personas) {
        p.last_message_at = lastByPersona.get(p.id) || null;
      }
    }

    // Issue session token on login (if client)
    let session = null;
    if (client) {
      session = await createSession(client.id);
    }

    res.json({ personas, isAdmin, canCreateClone, session, clientName: client?.name || null });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.error || "Server error" });
  }
}
