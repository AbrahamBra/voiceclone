import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: personas, error } = await sb.from("personas")
  .select("id, slug, name, voice, scenarios")
  .eq("is_active", true);
if (error) { console.error("ERROR:", error.message); process.exit(1); }

for (const p of personas || []) {
  // operating_protocols (legacy v1) raw_document
  const { data: op } = await sb
    .from("operating_protocols")
    .select("raw_document, is_active")
    .eq("persona_id", p.id)
    .eq("is_active", true)
    .maybeSingle();

  // protocol_document (v2) sections
  const { data: doc } = await sb
    .from("protocol_document")
    .select("id")
    .eq("owner_kind", "persona")
    .eq("owner_id", p.id)
    .eq("status","active")
    .maybeSingle();
  let secInfo = "no doc";
  if (doc) {
    const { data: secs } = await sb
      .from("protocol_section")
      .select("kind, prose")
      .eq("document_id", doc.id);
    secInfo = (secs || []).map(s => `${s.kind}=${(s.prose||"").length}`).join(" ");
  }

  const rawLen = op?.raw_document?.length || 0;
  const voiceLen = JSON.stringify(p.voice || {}).length;
  console.log(`${p.slug.padEnd(28)} ${p.name.padEnd(20)} raw_op=${rawLen.toString().padStart(6)} voice=${voiceLen.toString().padStart(4)} | ${secInfo}`);
}
