import { authenticateRequest, createSession, supabase, setCors } from "../lib/supabase.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const { client, isAdmin } = await authenticateRequest(req);

    let personas = [];
    let canCreateClone = false;

    if (isAdmin) {
      // Admin sees all personas and can always create
      const { data } = await supabase
        .from("personas")
        .select("id, slug, client_id, name, title, avatar")
        .eq("is_active", true)
        .order("created_at", { ascending: true });
      personas = data || [];
      canCreateClone = true;
    } else {
      // Client sees only their own personas
      const { data } = await supabase
        .from("personas")
        .select("id, slug, client_id, name, title, avatar")
        .eq("client_id", client.id)
        .eq("is_active", true)
        .order("created_at", { ascending: true });
      personas = data || [];

      // Check if client can create more clones
      canCreateClone = personas.length < client.max_clones;
    }

    // Issue session token on login (if client)
    let session = null;
    if (client) {
      session = await createSession(client.id);
    }

    res.json({ personas, isAdmin, canCreateClone, session });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.error || "Server error" });
  }
}
