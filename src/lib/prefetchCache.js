// Lightweight in-memory caches for chat switches.
// - fidelity: 5-min TTL, avoids refetching the whole batch on every /chat mount
// - conversation / feedback-events: keyed by id, cleared on persona switch,
//   populated by hover-prefetch so click→render is instant

import { authHeaders } from "./api.js";

const FIDELITY_TTL_MS = 5 * 60 * 1000;

/** @type {{ key: string, scores: any, ts: number } | null} */
let fidelityEntry = null;

export async function getFidelityBatch(personaIds) {
  const ids = [...personaIds].filter(Boolean).sort();
  if (ids.length === 0) return {};
  const key = ids.join(",");
  const now = Date.now();
  if (fidelityEntry && fidelityEntry.key === key && now - fidelityEntry.ts < FIDELITY_TTL_MS) {
    return fidelityEntry.scores;
  }
  const resp = await fetch(`/api/fidelity?personas=${key}`, { headers: authHeaders() });
  if (!resp.ok) throw new Error(`fidelity batch ${resp.status}`);
  const data = await resp.json();
  const scores = data?.scores || {};
  fidelityEntry = { key, scores, ts: now };
  return scores;
}

export function invalidateFidelity() {
  fidelityEntry = null;
}

// Prefetch caches : store the promise so concurrent callers share one in-flight
// request. Clearing is keyed to the persona the cache was warmed for — switching
// personas wipes everything to avoid stale cross-clone leaks.

/** @type {{ personaId: string | null, conv: Map<string, Promise<any>>, events: Map<string, Promise<any>> }} */
const switchCache = { personaId: null, conv: new Map(), events: new Map() };

function ensurePersona(personaId) {
  if (switchCache.personaId !== personaId) {
    switchCache.personaId = personaId;
    switchCache.conv.clear();
    switchCache.events.clear();
  }
}

export function prefetchConversation(personaId, convId) {
  if (!convId) return;
  ensurePersona(personaId);
  if (switchCache.conv.has(convId)) return;
  const p = fetch(`/api/conversations?id=${convId}`, { headers: authHeaders() })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  switchCache.conv.set(convId, p);
}

export function takeConversation(personaId, convId) {
  ensurePersona(personaId);
  const p = switchCache.conv.get(convId);
  switchCache.conv.delete(convId);
  return p || null;
}

export function prefetchFeedbackEvents(personaId, convId) {
  if (!convId) return;
  ensurePersona(personaId);
  if (switchCache.events.has(convId)) return;
  const p = fetch(`/api/feedback-events?conversation=${convId}`, { headers: authHeaders() })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d && Array.isArray(d.events) ? d.events : []))
    .catch(() => []);
  switchCache.events.set(convId, p);
}

export function takeFeedbackEvents(personaId, convId) {
  ensurePersona(personaId);
  const p = switchCache.events.get(convId);
  switchCache.events.delete(convId);
  return p || null;
}

// Clone-switch prefetch : warmed from dropdown hover. Cache key is the target
// personaId (not the switchCache.personaId context, which is the *current*
// clone). Stored as a tuple of promises mirroring init()'s parallel fetches.
/** @type {Map<string, { config: Promise<any>|null, convs: Promise<any>|null, ts: number }>} */
const personaPrefetch = new Map();
const PERSONA_PREFETCH_TTL_MS = 30 * 1000;

export function prefetchPersona(targetPersonaId) {
  if (!targetPersonaId) return;
  const entry = personaPrefetch.get(targetPersonaId);
  if (entry && Date.now() - entry.ts < PERSONA_PREFETCH_TTL_MS) return;
  const config = fetch(`/api/config?persona=${targetPersonaId}`, { headers: authHeaders() })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const convs = fetch(`/api/conversations?persona=${targetPersonaId}`, { headers: authHeaders() })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  personaPrefetch.set(targetPersonaId, { config, convs, ts: Date.now() });
}

export function takePersonaPrefetch(targetPersonaId) {
  const entry = personaPrefetch.get(targetPersonaId);
  if (!entry) return null;
  if (Date.now() - entry.ts >= PERSONA_PREFETCH_TTL_MS) {
    personaPrefetch.delete(targetPersonaId);
    return null;
  }
  personaPrefetch.delete(targetPersonaId);
  return entry;
}
