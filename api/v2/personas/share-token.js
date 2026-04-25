// Persona share-token v2 — generate / preview / claim / revoke a client share-token.
//
// The share-token (UUID stored on personas.client_share_token, migration 039)
// lets an agency invite a client to a `/train/{token}` flow. When the client
// authenticates after clicking the link, personas.client_user_id is set.
//
// Endpoints (single-file handler, method-discriminated):
//   GET    /api/v2/personas/share-token?token=<uuid>
//     → { persona: {id, name, title, avatar}, already_claimed: bool }
//     Public — used by the train page to render a preview before signup.
//
//   POST   /api/v2/personas/share-token
//     body: { persona_id }
//     → { token, train_url }
//     Owner-only (persona.client_id === client.id) or admin.
//     Generates a fresh token, replacing any previous one (regen semantics).
//
//   PUT    /api/v2/personas/share-token?token=<uuid>
//     → { ok: true, persona_id }
//     Authenticated client. Sets personas.client_user_id = current user.
//     Idempotent if already claimed by the same client; 409 if claimed by
//     another client.
//
//   DELETE /api/v2/personas/share-token?persona_id=<uuid>
//     → { ok: true }
//     Owner-only. Revokes the token (sets to NULL). client_user_id is
//     preserved for historical audit (per migration 039 comment).
//
// Auth: authenticateRequest (POST/PUT/DELETE). GET is public to support the
// pre-signup preview flow on /train/{token}.
//
// Handler accepts an optional `deps` 3rd argument for test injection.

import { randomUUID } from "node:crypto";
import {
  authenticateRequest as _authenticateRequest,
  supabase as _supabase,
  setCors as _setCors,
} from "../../../lib/supabase.js";

const TRAIN_URL_BASE = process.env.TRAIN_URL_BASE || "https://voiceclone.app/train";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res, deps) {
  const {
    authenticateRequest = _authenticateRequest,
    supabase = _supabase,
    setCors = _setCors,
    randomUUID: uuid = randomUUID,
  } = deps || {};

  setCors(res, "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  // ── GET: public preview by token ─────────────────────────────
  if (req.method === "GET") {
    const token = req.query?.token;
    if (!token || !UUID_RE.test(token)) {
      res.status(400).json({ error: "valid token required" });
      return;
    }

    const { data: persona } = await supabase
      .from("personas")
      .select("id, name, title, avatar, client_user_id")
      .eq("client_share_token", token)
      .single();

    if (!persona) {
      res.status(404).json({ error: "Token invalide ou révoqué" });
      return;
    }

    res.json({
      persona: {
        id: persona.id,
        name: persona.name,
        title: persona.title,
        avatar: persona.avatar,
      },
      already_claimed: !!persona.client_user_id,
    });
    return;
  }

  // POST/PUT/DELETE require auth.
  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  // ── POST: generate / regenerate token (owner) ────────────────
  if (req.method === "POST") {
    const personaId = req.body?.persona_id;
    if (!personaId || !UUID_RE.test(personaId)) {
      res.status(400).json({ error: "valid persona_id required" });
      return;
    }

    const { data: persona } = await supabase
      .from("personas")
      .select("id, client_id")
      .eq("id", personaId)
      .single();

    if (!persona) {
      res.status(404).json({ error: "Persona not found" });
      return;
    }
    if (!isAdmin && persona.client_id !== client?.id) {
      res.status(403).json({ error: "Only the owner can generate a share-token" });
      return;
    }

    const token = uuid();
    const { error } = await supabase
      .from("personas")
      .update({ client_share_token: token })
      .eq("id", personaId);

    if (error) {
      res.status(500).json({ error: "Failed to set share-token" });
      return;
    }

    res.json({ token, train_url: `${TRAIN_URL_BASE}/${token}` });
    return;
  }

  // ── PUT: claim token (any authenticated client) ──────────────
  if (req.method === "PUT") {
    const token = req.query?.token;
    if (!token || !UUID_RE.test(token)) {
      res.status(400).json({ error: "valid token required" });
      return;
    }
    if (!client) {
      res.status(401).json({ error: "Login required" });
      return;
    }

    const { data: persona } = await supabase
      .from("personas")
      .select("id, client_user_id")
      .eq("client_share_token", token)
      .single();

    if (!persona) {
      res.status(404).json({ error: "Token invalide ou révoqué" });
      return;
    }

    if (persona.client_user_id && persona.client_user_id !== client.id) {
      res.status(409).json({ error: "Cette persona a déjà été réclamée par un autre client" });
      return;
    }

    if (persona.client_user_id !== client.id) {
      const { error } = await supabase
        .from("personas")
        .update({ client_user_id: client.id })
        .eq("id", persona.id);

      if (error) {
        res.status(500).json({ error: "Failed to claim" });
        return;
      }
    }

    res.json({ ok: true, persona_id: persona.id });
    return;
  }

  // ── DELETE: revoke token (owner) ─────────────────────────────
  if (req.method === "DELETE") {
    const personaId = req.query?.persona_id || req.body?.persona_id;
    if (!personaId || !UUID_RE.test(personaId)) {
      res.status(400).json({ error: "valid persona_id required" });
      return;
    }

    const { data: persona } = await supabase
      .from("personas")
      .select("id, client_id")
      .eq("id", personaId)
      .single();

    if (!persona) {
      res.status(404).json({ error: "Persona not found" });
      return;
    }
    if (!isAdmin && persona.client_id !== client?.id) {
      res.status(403).json({ error: "Only the owner can revoke" });
      return;
    }

    // Revoke token but preserve client_user_id for audit (migration 039 invariant).
    const { error } = await supabase
      .from("personas")
      .update({ client_share_token: null })
      .eq("id", personaId);

    if (error) {
      res.status(500).json({ error: "Failed to revoke" });
      return;
    }

    res.json({ ok: true });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
