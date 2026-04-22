// ============================================================
// PUBLIC DEMO — stateless DM draft endpoint
//
// Accepts : { posts: string[3], brief: string }
// Returns : SSE stream of Anthropic Haiku tokens
//
// No auth. No DB write. No Supabase read of personas or corrections.
// Rate-limited to 3 calls / IP / 24h via rate_limit_check() with a
// "demo:" prefix so it doesn't collide with /api/chat's 60s bucket.
//
// Cost ceiling per call : ~400 out tokens Haiku + ~1.5k in tokens.
// Served from landing "essaie en 5 min" CTA.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { supabase, setCors } from "../lib/supabase.js";
import { initSSE } from "../lib/sse.js";
import { getClientIp } from "./_rateLimit.js";
import { buildDemoPersona, buildDemoSystemPrompt } from "../lib/demo-baseline-rules.js";
import { log } from "../lib/log.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEMO_MAX_PER_DAY = 3;

// Hard input caps to block cost abuse. A typical LinkedIn post is ~300-1500
// chars; we accept up to 3000 to fit long-form. Brief is expected to stay
// short (prospect one-liner + context) — 1500 chars is generous.
const MAX_POST_CHARS = 3000;
const MAX_BRIEF_CHARS = 1500;
const MIN_POST_CHARS = 60; // reject empty or trivial pastes
const MIN_BRIEF_CHARS = 20;

async function demoRateLimit(ip) {
  if (!supabase) return { allowed: true }; // fail open if DB down

  try {
    const { data, error } = await supabase.rpc("rate_limit_check", {
      p_ip: `demo:${ip}`,
      p_window_ms: DAY_MS,
      p_max: DEMO_MAX_PER_DAY,
    });

    if (error) {
      log("demo_rate_limit_error", { error: error.message });
      return { allowed: true }; // fail open
    }

    if (data && data.allowed === false) {
      return { allowed: false, retryAfter: data.retry_after || 3600 };
    }
    return { allowed: true, count: data?.count ?? null };
  } catch (err) {
    log("demo_rate_limit_exception", { error: err.message });
    return { allowed: true }; // fail open
  }
}

function validate(body) {
  if (!body || typeof body !== "object") return "Corps invalide";
  const posts = body.posts;
  const brief = body.brief;

  if (!Array.isArray(posts) || posts.length !== 3) {
    return "posts doit contenir exactement 3 posts";
  }
  for (let i = 0; i < 3; i++) {
    const p = posts[i];
    if (typeof p !== "string") return `Post ${i + 1} invalide`;
    const trimmed = p.trim();
    if (trimmed.length < MIN_POST_CHARS) {
      return `Post ${i + 1} trop court (min ${MIN_POST_CHARS} caractères)`;
    }
    if (trimmed.length > MAX_POST_CHARS) {
      return `Post ${i + 1} trop long (max ${MAX_POST_CHARS} caractères)`;
    }
  }
  if (typeof brief !== "string" || brief.trim().length < MIN_BRIEF_CHARS) {
    return `Brief prospect trop court (min ${MIN_BRIEF_CHARS} caractères)`;
  }
  if (brief.trim().length > MAX_BRIEF_CHARS) {
    return `Brief prospect trop long (max ${MAX_BRIEF_CHARS} caractères)`;
  }
  return null;
}

export default async function handler(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  // Rate limit : 3 drafts / IP / 24h
  const ip = getClientIp(req);
  const rl = await demoRateLimit(ip);
  if (!rl.allowed) {
    res.status(429).json({
      error: "Limite démo atteinte (3 essais / 24h). Crée un compte pour continuer.",
      retryAfter: rl.retryAfter,
    });
    return;
  }

  // Validate
  const validationError = validate(req.body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const { posts, brief } = req.body;

  // Build ephemeral persona + prompt
  const persona = buildDemoPersona({ posts: posts.map((p) => p.trim()) });
  const systemPrompt = buildDemoSystemPrompt(persona, brief);

  // Env key only — demo never uses client BYOK
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    log("demo_no_api_key", { ip });
    res.status(503).json({ error: "Démo indisponible. Réessaie plus tard." });
    return;
  }

  // SSE setup
  const send = initSSE(res, req);
  send("start", {});

  let tokenCount = 0;
  let firstTokenMs = null;
  const startedAt = Date.now();

  try {
    const anthropic = new Anthropic({ apiKey });
    const stream = await anthropic.messages.stream({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: systemPrompt,
      messages: [{ role: "user", content: brief.trim() }],
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        if (firstTokenMs === null) firstTokenMs = Date.now() - startedAt;
        tokenCount++;
        send("token", { text: event.delta.text });
      }
    }

    const final = await stream.finalMessage();
    send("done", {
      usage: final.usage,
      ms_first_token: firstTokenMs,
      ms_total: Date.now() - startedAt,
    });

    log("demo_draft_completed", {
      ip,
      tokens_in: final.usage?.input_tokens,
      tokens_out: final.usage?.output_tokens,
      ms_first_token: firstTokenMs,
      ms_total: Date.now() - startedAt,
      draft_count_today: rl.count,
    });
  } catch (err) {
    log("demo_draft_error", { ip, error: err.message });
    send("error", { error: "Génération impossible. Réessaie dans un instant." });
  } finally {
    if (!res.writableEnded) res.end();
  }
}
