// Propositions v2 — CRUD + acceptance flow on the `proposition` table.
//
// Endpoints:
//   GET  /api/v2/propositions?document=<uuid>&status=pending|accepted|...
//     → { propositions: [...] }
//   POST /api/v2/propositions
//     body: { action: 'accept'|'reject'|'revise', id: <uuid>,
//             user_note?: string, proposed_text?: string (required for revise) }
//     → { proposition: {...}, section?: {...}, training_example_id?: <uuid> }
//
// Single-file handler with body-level `action` discriminator (decision locked
// during Chunk 2 — see docs/superpowers/chunk-2-progress.md).
//
// Action semantics (post-Task 4.3) :
//   - accept  → patch target section.prose (append/amend), log extractor_training_example
//               outcome='accepted', set status='accepted', resolved_at=now()
//   - reject  → log extractor_training_example outcome='rejected', status='rejected'
//   - revise  → log extractor_training_example outcome='revised' with revised_text,
//               status='revised', proposed_text replaced. No prose patch (user keeps it
//               for manual application or a future re-accept).
//
// Atomicity : the proposition status is the canonical state. If the side-effects
// (section patch, training example) fail, they are logged but don't fail the request.
// Partial state is acceptable here — at worst the corpus is missing a row.
//
// Auth: authenticateRequest + hasPersonaAccess.
// The `supabase` singleton uses the service-role key (per lib/supabase.js).
//
// Handler accepts an optional `deps` 3rd argument for test injection.

export const maxDuration = 15;

import {
  authenticateRequest as _authenticateRequest,
  hasPersonaAccess as _hasPersonaAccess,
  supabase as _supabase,
  setCors as _setCors,
} from "../../lib/supabase.js";
import { computeArtifactHash } from "../../lib/protocol-v2-db.js";
import { deriveCheckParams as _deriveCheckParams } from "../../lib/protocol-v2-check-derivation.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_VALUES = new Set(["pending", "accepted", "rejected", "revised", "merged"]);
const ACTIONS = new Set(["accept", "reject", "revise"]);

// Chantier 2 — accept materializes an artifact for new content.
// add_rule  → hard_check (severity=hard) — atomic constraint.
// add_paragraph → pattern (severity=light) — soft template/state.
// Other intents (amend_paragraph, refine_pattern, remove_rule) modify
// existing structure and do NOT create a new artifact in this iteration —
// artifact-level diff/replace lives in a future Chantier 2bis.
const INTENT_TO_ARTIFACT_KIND = {
  add_rule: "hard_check",
  add_paragraph: "pattern",
};
const ARTIFACT_KIND_TO_SEVERITY = {
  hard_check: "hard",
  pattern: "light",
};

const PROPOSITION_COLUMNS =
  "id, document_id, source, source_ref, source_refs, count, intent, " +
  "target_kind, target_section_id, proposed_text, rationale, confidence, " +
  "status, user_note, created_at, resolved_at";

// Columns we need internally for accept/reject/revise side-effects.
const FULL_PROPOSITION_COLUMNS =
  PROPOSITION_COLUMNS;

// Intent → suffix when amending an existing paragraph. Pure append for new
// content. Real diff/replace UX will arrive in Task 4.4 (versioning UI).
const AMEND_INTENTS = new Set(["amend_paragraph", "refine_pattern", "remove_rule"]);

export default async function handler(req, res, deps) {
  const {
    authenticateRequest = _authenticateRequest,
    hasPersonaAccess = _hasPersonaAccess,
    supabase = _supabase,
    setCors = _setCors,
  } = deps || {};

  setCors(res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  const ctx = { supabase, hasPersonaAccess, client, isAdmin };
  if (req.method === "GET") return handleList(req, res, ctx);
  return handleMutate(req, res, ctx);
}

async function handleList(req, res, { supabase, hasPersonaAccess, client, isAdmin }) {
  const documentId = req.query?.document;
  const status = req.query?.status;

  if (!documentId || !UUID_RE.test(documentId)) {
    res.status(400).json({ error: "document is required (uuid)" });
    return;
  }
  if (status && !STATUS_VALUES.has(status)) {
    res.status(400).json({ error: "invalid status" });
    return;
  }

  const personaId = await documentPersonaId(supabase, documentId);
  if (!personaId) {
    res.status(404).json({ error: "document not found" });
    return;
  }
  if (!isAdmin && !(await hasPersonaAccess(client?.id, personaId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  let q = supabase
    .from("proposition")
    .select(PROPOSITION_COLUMNS)
    .eq("document_id", documentId)
    .order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);

  const { data, error } = await q;
  if (error) {
    res.status(500).json({ error: "db error" });
    return;
  }
  res.status(200).json({ propositions: data || [] });
}

async function handleMutate(req, res, { supabase, hasPersonaAccess, client, isAdmin }) {
  const body = req.body || {};
  const { action, id, user_note, proposed_text } = body;

  if (!ACTIONS.has(action)) {
    res.status(400).json({ error: "action must be accept|reject|revise" });
    return;
  }
  if (!id || typeof id !== "string" || !UUID_RE.test(id)) {
    res.status(400).json({ error: "id is required (uuid)" });
    return;
  }
  if (action === "revise") {
    if (typeof proposed_text !== "string" || !proposed_text.trim()) {
      res.status(400).json({ error: "proposed_text is required for revise" });
      return;
    }
  }
  if (user_note !== undefined && typeof user_note !== "string") {
    res.status(400).json({ error: "user_note must be a string" });
    return;
  }

  // Fetch full proposition row up-front — needed by accept/revise side-effects.
  const { data: prop, error: propErr } = await supabase
    .from("proposition")
    .select(FULL_PROPOSITION_COLUMNS)
    .eq("id", id)
    .single();
  if (propErr || !prop) {
    res.status(404).json({ error: "proposition not found" });
    return;
  }

  const personaId = await documentPersonaId(supabase, prop.document_id);
  if (!personaId) {
    res.status(404).json({ error: "document not found" });
    return;
  }
  if (!isAdmin && !(await hasPersonaAccess(client?.id, personaId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // ── ACCEPT path ───────────────────────────────────────────────
  if (action === "accept") {
    // 1. Resolve target section for the prose patch.
    const targetSection = await resolveTargetSection(supabase, prop);
    if (!targetSection) {
      res.status(422).json({
        error: "no target section found for this target_kind on the document",
      });
      return;
    }

    // 2. Patch prose.
    const newProse = patchProse(targetSection.prose || "", prop);
    const { error: sectionErr } = await supabase
      .from("protocol_section")
      .update({ prose: newProse, author_kind: "proposition_accepted" })
      .eq("id", targetSection.id);

    if (sectionErr) {
      res.status(500).json({ error: "section patch failed" });
      return;
    }

    // 3. Update proposition (status + target_section_id if it was missing).
    const update = {
      status: "accepted",
      resolved_at: new Date().toISOString(),
      target_section_id: prop.target_section_id || targetSection.id,
    };
    if (user_note !== undefined) update.user_note = user_note;

    const { data, error } = await supabase
      .from("proposition")
      .update(update)
      .eq("id", id)
      .select(PROPOSITION_COLUMNS)
      .single();
    if (error) {
      res.status(500).json({ error: "db error" });
      return;
    }

    // 4. Log positive training example (best-effort — don't fail request).
    const trainingExampleId = await logTrainingExample(supabase, {
      personaId,
      proposition: prop,
      outcome: "accepted",
      userNote: user_note,
    });

    // 5. Materialize a structured artifact for the accepted proposition
    //    (Chantier 2 — best-effort, don't fail request). Only fires for
    //    add_rule / add_paragraph intents — see INTENT_TO_ARTIFACT_KIND.
    const artifactId = await materializeArtifact(supabase, {
      proposition: prop,
      sectionId: targetSection.id,
    });

    res.status(200).json({
      proposition: data,
      section: { id: targetSection.id, prose: newProse },
      training_example_id: trainingExampleId,
      artifact_id: artifactId,
    });
    return;
  }

  // ── REJECT path ───────────────────────────────────────────────
  if (action === "reject") {
    const update = {
      status: "rejected",
      resolved_at: new Date().toISOString(),
    };
    if (user_note !== undefined) update.user_note = user_note;

    const { data, error } = await supabase
      .from("proposition")
      .update(update)
      .eq("id", id)
      .select(PROPOSITION_COLUMNS)
      .single();
    if (error) {
      res.status(500).json({ error: "db error" });
      return;
    }

    const trainingExampleId = await logTrainingExample(supabase, {
      personaId,
      proposition: prop,
      outcome: "rejected",
      userNote: user_note,
    });

    res.status(200).json({ proposition: data, training_example_id: trainingExampleId });
    return;
  }

  // ── REVISE path ───────────────────────────────────────────────
  // proposed_text is replaced ; status='revised'. No prose patch — user can
  // re-accept later or the cron may pick it up via a new signal.
  const revisedText = proposed_text.trim();
  const update = {
    status: "revised",
    resolved_at: new Date().toISOString(),
    proposed_text: revisedText,
  };
  if (user_note !== undefined) update.user_note = user_note;

  const { data, error } = await supabase
    .from("proposition")
    .update(update)
    .eq("id", id)
    .select(PROPOSITION_COLUMNS)
    .single();
  if (error) {
    res.status(500).json({ error: "db error" });
    return;
  }

  const trainingExampleId = await logTrainingExample(supabase, {
    personaId,
    proposition: prop,
    outcome: "revised",
    revisedText,
    userNote: user_note,
  });

  res.status(200).json({ proposition: data, training_example_id: trainingExampleId });
}

// ─── helpers ───────────────────────────────────────────────────────────────

async function documentPersonaId(sb, documentId) {
  const { data, error } = await sb
    .from("protocol_document")
    .select("owner_id, owner_kind")
    .eq("id", documentId)
    .single();
  if (error || !data || data.owner_kind !== "persona") return null;
  return data.owner_id;
}

async function resolveTargetSection(supabase, prop) {
  // Direct hit by id (router/cron usually fills this in).
  if (prop.target_section_id && UUID_RE.test(prop.target_section_id)) {
    const { data } = await supabase
      .from("protocol_section")
      .select("id, document_id, kind, prose")
      .eq("id", prop.target_section_id)
      .single();
    if (data && data.document_id === prop.document_id) return data;
  }
  // Fallback : find section in this document with matching kind.
  const { data } = await supabase
    .from("protocol_section")
    .select("id, document_id, kind, prose")
    .eq("document_id", prop.document_id)
    .eq("kind", prop.target_kind)
    .order("order", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data || null;
}

/**
 * Append the proposed_text to the section's prose. For amend_paragraph /
 * refine_pattern / remove_rule, prefix with a tag so the user can see
 * which paragraphs were proposition-driven (Task 4.4 will add a real diff
 * UI ; for now we just append with a marker).
 *
 * Pure function — exported for tests.
 */
export function patchProse(currentProse, prop) {
  const text = (prop?.proposed_text || "").trim();
  if (!text) return currentProse;

  const sep = currentProse && !currentProse.endsWith("\n") ? "\n\n" : "";
  if (AMEND_INTENTS.has(prop?.intent)) {
    return `${currentProse}${sep}[${prop.intent}] ${text}`;
  }
  return `${currentProse}${sep}${text}`;
}

/**
 * Insert a `protocol_artifact` row mirroring an accepted proposition's
 * structured intent. Best-effort: returns artifact id or null on any error.
 *
 * The artifact lives alongside the prose patch — prose is the human-readable
 * doctrine view, the artifact is the queryable + future-firable form (RAG,
 * rule firing telemetry, cross-clone similarity match).
 */
async function materializeArtifact(supabase, { proposition, sectionId, deriveCheckParams = _deriveCheckParams }) {
  const kind = INTENT_TO_ARTIFACT_KIND[proposition.intent];
  if (!kind) return null;
  const text = (proposition.proposed_text || "").trim();
  if (!text) return null;
  const hash = computeArtifactHash(text);
  if (!hash) return null;

  // For hard_check artifacts, derive a runtime-testable shape from the
  // rule prose so lib/protocolChecks.js can actually fire on chat
  // messages. Without this, the artifact is stored with empty params
  // and 0 violations are ever emitted (audit 2026-05-01 §2 — Nicolas
  // had 6 active hard_checks, 0 firings on 7 conversations).
  // Heuristic first (fast, deterministic) then Haiku LLM fallback.
  let derivation = null;
  if (kind === "hard_check") {
    derivation = await deriveCheckParams(text).catch(() => null);
  }

  try {
    const row = {
      source_section_id: sectionId,
      source_quote: proposition.rationale || null,
      kind,
      content: {
        text,
        intent: proposition.intent,
        source_proposition_id: proposition.id,
        source_kind: proposition.target_kind,
        confidence: proposition.confidence,
        // The runtime checker keys on these. Absent fields = checker skips.
        ...(derivation ? {
          check_kind: derivation.check_kind,
          check_params: derivation.check_params,
        } : {}),
      },
      severity: ARTIFACT_KIND_TO_SEVERITY[kind],
      content_hash: hash,
    };
    const { data, error } = await supabase
      .from("protocol_artifact")
      .insert(row)
      .select("id")
      .single();
    if (error) return null;
    return data?.id || null;
  } catch {
    return null;
  }
}

async function logTrainingExample(supabase, args) {
  const { personaId, proposition, outcome, revisedText, userNote } = args;
  try {
    const row = {
      scope: "persona",
      scope_id: personaId,
      extractor_kind: proposition.target_kind,
      input_signal: {
        proposition_id: proposition.id,
        source: proposition.source,
        source_ref: proposition.source_ref,
        rationale: proposition.rationale || null,
      },
      proposed: {
        intent: proposition.intent,
        target_kind: proposition.target_kind,
        proposed_text: proposition.proposed_text,
        confidence: proposition.confidence,
      },
      outcome,
      revised_text: revisedText || null,
      user_note: userNote || null,
    };
    const { data, error } = await supabase
      .from("extractor_training_example")
      .insert(row)
      .select("id")
      .single();
    if (error) return null;
    return data?.id || null;
  } catch {
    return null;
  }
}
