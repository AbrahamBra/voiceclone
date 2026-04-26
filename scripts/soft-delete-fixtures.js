// Soft-deactivate test fixtures Alex revops + Sim Clone Alpha.
// User-confirmed (Q1): "desactivation pour question 1".
// Soft = is_active=false (réversible, préserve usage_logs FK sans CASCADE).
import "dotenv/config";
import { supabase } from "../lib/supabase.js";

const TARGETS = [
  { id: "00000000-0000-0000-0000-00000000d002", expected_slug: "alex-revops",      label: "Alex (alex-revops)" },
  { id: "1db10069-3a1f-43e2-aa8b-70c3fd8cef0d", expected_slug: "sim_clone_alpha",  label: "Sim Clone Alpha"     },
];

for (const t of TARGETS) {
  const { data, error } = await supabase
    .from("personas")
    .update({ is_active: false })
    .eq("id", t.id)
    .eq("slug", t.expected_slug)
    .select("id, slug, name, is_active")
    .single();

  if (error) {
    console.error(`❌ ${t.label} : ${error.message}`);
    process.exit(1);
  }
  console.log(`✅ ${t.label} → is_active=${data.is_active}`);
}
