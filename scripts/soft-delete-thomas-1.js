// Soft-delete Thomas #1 (slug: thomas, owner client: Thomas, dormant).
// Soft (is_active=false) because usage_logs.persona_id has no ON DELETE CASCADE.
import "dotenv/config";
import { supabase } from "../lib/supabase.js";

const TARGET_ID = "dd26c9a6-0f0a-4d01-9ae0-d942f71f81cb";

const { data, error } = await supabase
  .from("personas")
  .update({ is_active: false })
  .eq("id", TARGET_ID)
  .eq("name", "Thomas")
  .select("id, slug, name, client_id, is_active")
  .single();

if (error) { console.error(error); process.exit(1); }
console.log("soft-deleted:", data);
