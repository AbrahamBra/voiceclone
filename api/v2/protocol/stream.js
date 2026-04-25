// Protocol v2 — SSE activity feed.
//
// GET /api/v2/protocol/stream?document=<uuid>
//   Emits Server-Sent Events:
//     init                  { recent: [...] }   — snapshot des 20 derniers events
//     artifact_fired        { artifact_id, section_id, fired_at }
//     proposition_created   { id, target_kind, count }
//     proposition_resolved  { id, status }
//     ping                  { t }                — toutes les 25s (keep-alive Vercel)
//
// Source des events : Supabase realtime channel sur protocol_artifact (UPDATE
// stats.last_fired_at) et proposition (INSERT / UPDATE WHERE status changes).
//
// Auth : authenticateRequest + hasPersonaAccess sur la persona du document.
// Pattern dependency-injection identique aux autres api/v2/* (3e arg `deps`).

export const maxDuration = 300;

import {
  authenticateRequest as _authenticateRequest,
  hasPersonaAccess as _hasPersonaAccess,
  supabase as _supabase,
  setCors as _setCors,
} from "../../../lib/supabase.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_PING_MS = 25000;
const SNAPSHOT_LIMIT = 20;

export default async function handler(req, res, deps) {
  const {
    authenticateRequest = _authenticateRequest,
    hasPersonaAccess = _hasPersonaAccess,
    supabase = _supabase,
    setCors = _setCors,
    getDocumentPersonaId = _getDocumentPersonaId,
    listSectionIds = _listSectionIds,
    fetchInitialSnapshot = _fetchInitialSnapshot,
    realtimeFactory = _defaultRealtimeFactory,
    pingIntervalMs = DEFAULT_PING_MS,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
  } = deps || {};

  setCors(res, "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const documentId = req.query?.document;
  if (!documentId || typeof documentId !== "string" || !UUID_RE.test(documentId)) {
    res.status(400).json({ error: "document is required (uuid)" });
    return;
  }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  const personaId = await getDocumentPersonaId(supabase, documentId);
  if (!personaId) {
    res.status(404).json({ error: "document not found" });
    return;
  }
  if (!isAdmin && !(await hasPersonaAccess(client?.id, personaId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const sectionIds = await listSectionIds(supabase, documentId);
  const snapshot = await fetchInitialSnapshot(supabase, documentId, sectionIds);
  const state = { eventCount: 0 };
  sseWrite(res, "init", { recent: snapshot }, state);

  const channel = realtimeFactory(supabase, {
    documentId,
    sectionIds,
    onArtifactFired: (payload) => {
      const artifact = payload?.new || {};
      if (!sectionIds.includes(artifact.source_section_id)) return;
      const firedAt = artifact.stats?.last_fired_at;
      if (!firedAt) return;
      sseWrite(res, "artifact_fired", {
        artifact_id: artifact.id,
        section_id: artifact.source_section_id,
        fired_at: firedAt,
      }, state);
    },
    onPropositionCreated: (payload) => {
      const prop = payload?.new || {};
      if (prop.document_id !== documentId) return;
      sseWrite(res, "proposition_created", {
        id: prop.id,
        target_kind: prop.target_kind,
        count: prop.count ?? null,
      }, state);
    },
    onPropositionResolved: (payload) => {
      const next = payload?.new || {};
      const prev = payload?.old || {};
      if (next.document_id !== documentId) return;
      if (next.status === prev.status) return;
      sseWrite(res, "proposition_resolved", {
        id: next.id,
        status: next.status,
      }, state);
    },
  });

  const ping = setIntervalFn(() => {
    sseWrite(res, "ping", { t: Date.now() }, state);
  }, pingIntervalMs);

  return new Promise((resolve) => {
    let resolved = false;
    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      clearIntervalFn(ping);
      try { channel?.close?.(); } catch { /* noop */ }
      resolve({ eventCount: state.eventCount });
    };
    req.on?.("close", cleanup);
    res.on?.("close", cleanup);
  });
}

function sseWrite(res, event, data, state) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  if (state) state.eventCount += 1;
}

async function _getDocumentPersonaId(sb, documentId) {
  const { data, error } = await sb
    .from("protocol_document")
    .select("owner_id, owner_kind")
    .eq("id", documentId)
    .single();
  if (error || !data || data.owner_kind !== "persona") return null;
  return data.owner_id;
}

async function _listSectionIds(sb, documentId) {
  const { data } = await sb
    .from("protocol_section")
    .select("id")
    .eq("document_id", documentId);
  return (data || []).map((r) => r.id);
}

async function _fetchInitialSnapshot(sb, documentId, sectionIds) {
  const fires = sectionIds.length ? await _fetchRecentFires(sb, sectionIds) : [];
  const props = await _fetchRecentPropositions(sb, documentId);

  const merged = [
    ...fires.map((a) => ({
      kind: "artifact_fired",
      occurred_at: a.stats?.last_fired_at,
      artifact_id: a.id,
      section_id: a.source_section_id,
    })),
    ...props.map((p) => ({
      kind: p.resolved_at ? "proposition_resolved" : "proposition_created",
      occurred_at: p.resolved_at || p.created_at,
      id: p.id,
      target_kind: p.target_kind,
      status: p.status,
      count: p.count ?? null,
    })),
  ];
  merged.sort((a, b) => (b.occurred_at || "").localeCompare(a.occurred_at || ""));
  return merged.slice(0, SNAPSHOT_LIMIT);
}

async function _fetchRecentFires(sb, sectionIds) {
  const { data } = await sb
    .from("protocol_artifact")
    .select("id, source_section_id, stats")
    .in("source_section_id", sectionIds)
    .not("stats->>last_fired_at", "is", null)
    .order("stats->>last_fired_at", { ascending: false })
    .limit(SNAPSHOT_LIMIT);
  return data || [];
}

async function _fetchRecentPropositions(sb, documentId) {
  const { data } = await sb
    .from("proposition")
    .select("id, document_id, target_kind, status, count, created_at, resolved_at")
    .eq("document_id", documentId)
    .order("created_at", { ascending: false })
    .limit(SNAPSHOT_LIMIT);
  return data || [];
}

function _defaultRealtimeFactory(sb, { documentId, onArtifactFired, onPropositionCreated, onPropositionResolved }) {
  if (!sb?.channel) return { close: () => {} };
  const ch = sb.channel(`protocol-stream-${documentId}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "protocol_artifact" },
      onArtifactFired,
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "proposition", filter: `document_id=eq.${documentId}` },
      onPropositionCreated,
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "proposition", filter: `document_id=eq.${documentId}` },
      onPropositionResolved,
    )
    .subscribe();
  return {
    close: () => {
      try { sb.removeChannel?.(ch); } catch { /* noop */ }
    },
  };
}
