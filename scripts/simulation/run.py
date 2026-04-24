#!/usr/bin/env python3
"""
VoiceClone simulation harness — master CLI.

Usage:
  python run.py seed             # Create sim persona + chunks + embeddings + rhythm baseline
  python run.py chat [N]         # Run N conversations (default 10) via /api/chat
  python run.py feedback         # Post coherent corrections
  python run.py feedback --bad   # Post contradictory corrections (should trigger auto-revert)
  python run.py stress           # Submit drifted drafts, verify critic flags them
  python run.py consolidate      # Trigger /api/cron-consolidate manually
  python run.py fidelity         # Force fidelity calc on sim persona
  python run.py verdict          # Read all 4 tables, print markdown report
  python run.py cleanup          # Delete ALL sim_* data (confirms first)
  python run.py status           # Quick health check (rows per table)

Safety:
  All writes are guarded by a slug prefix check. Any attempt to touch a non-sim
  persona is refused at the script level, no matter what the CLI arg says.
"""

import os
import sys
import json
import time
import argparse
import uuid
from pathlib import Path

from dotenv import load_dotenv
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from supabase import create_client, Client
import requests
import voyageai

# Import fixtures from the same directory
sys.path.insert(0, str(Path(__file__).parent))
from fixtures import (
    SIM_SLUG_PREFIX,
    SIM_PERSONA_NAME,
    SIM_PERSONA_SLUG,
    SIM_CLIENT_NAME,
    SIM_CLIENT_ACCESS_CODE,
    VOICE_RULES,
    POSTS,
    CHAT_SCENARIOS,
    CORRECTIONS_COHERENT,
    CORRECTIONS_CONTRADICTORY,
    DRIFTED_DRAFTS,
)

# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------

load_dotenv(Path(__file__).parent / ".env")
console = Console()


def getenv(key, required=True):
    val = os.getenv(key)
    if required and not val:
        console.print(f"[red]Missing env var: {key}[/red] — copy .env.example to .env and fill it")
        sys.exit(1)
    return val


def db() -> Client:
    return create_client(getenv("SUPABASE_URL"), getenv("SUPABASE_SERVICE_ROLE_KEY"))


def voyage():
    return voyageai.Client(api_key=getenv("VOYAGE_API_KEY"))


def api_url(path: str) -> str:
    base = getenv("API_BASE_URL").rstrip("/")
    return f"{base}{path}"


# ---------------------------------------------------------------------------
# Safety guards
# ---------------------------------------------------------------------------

def assert_sim_persona(persona_row: dict):
    """Refuse to touch anything that isn't clearly a simulation persona."""
    slug = (persona_row or {}).get("slug", "")
    if not slug.startswith(SIM_SLUG_PREFIX):
        raise RuntimeError(
            f"SAFETY: refusing to operate on non-sim persona (slug={slug!r}). "
            f"All sim personas must have slug starting with {SIM_SLUG_PREFIX!r}."
        )


def get_sim_client(client: Client) -> dict:
    """Fetch or create the sim harness client row."""
    rows = client.table("clients").select("*").eq("name", SIM_CLIENT_NAME).execute().data
    if rows:
        return rows[0]
    res = client.table("clients").insert({
        "name": SIM_CLIENT_NAME,
        "access_code": SIM_CLIENT_ACCESS_CODE,
        "tier": "free",
        "max_clones": 5,
        "is_active": True,
    }).execute()
    console.print(f"[green]Created sim client: {res.data[0]['id']}[/green]")
    return res.data[0]


def get_sim_persona(client: Client) -> dict | None:
    rows = client.table("personas").select("*").eq("slug", SIM_PERSONA_SLUG).execute().data
    return rows[0] if rows else None


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_seed(args):
    """Create sim persona + 15 posts + embeddings + rhythm baseline."""
    client = db()
    vo = voyage()

    sim_client = get_sim_client(client)

    existing = get_sim_persona(client)
    if existing:
        assert_sim_persona(existing)
        console.print(f"[yellow]Sim persona exists ({existing['id']}). Use `cleanup` to start fresh.[/yellow]")
        persona = existing
    else:
        persona_payload = {
            "slug": SIM_PERSONA_SLUG,
            "client_id": sim_client["id"],
            "name": SIM_PERSONA_NAME,
            "title": "Growth operator B2B SaaS FR (simulation)",
            "description": "Simulation harness clone — do not use in prod flows",
            "voice": VOICE_RULES,
            "scenarios": {"default": "Conversation opérationnelle, tone direct."},
        }
        persona = client.table("personas").insert(persona_payload).execute().data[0]
        console.print(f"[green]Created sim persona: {persona['id']}[/green]")

    assert_sim_persona(persona)

    # --- Chunks + embeddings ---
    existing_chunks = client.table("chunks").select("id").eq("persona_id", persona["id"]).eq("source_type", "linkedin_post").execute().data
    if existing_chunks and len(existing_chunks) >= len(POSTS):
        console.print(f"[yellow]{len(existing_chunks)} chunks already present, skipping embed.[/yellow]")
    else:
        console.print(f"Embedding {len(POSTS)} posts via Voyage...")
        result = vo.embed(POSTS, model="voyage-3", input_type="document")
        embeddings = result.embeddings
        rows = [{
            "persona_id": persona["id"],
            "source_type": "linkedin_post",
            "content": post,
            "embedding": emb,
            "metadata": {"sim": True, "idx": i},
        } for i, (post, emb) in enumerate(zip(POSTS, embeddings))]
        client.table("chunks").insert(rows).execute()
        console.print(f"[green]Inserted {len(rows)} chunks with embeddings.[/green]")

    # --- Rhythm baseline (simple diagonal, server will recompute on prod use) ---
    # We skip baseline here — pipeline.js uses rhythm_baselines if present,
    # falls back gracefully if not. The critic still runs (score may be null).
    # A full baseline seed would duplicate logic from scripts/seed-rhythm-gold.js;
    # keep this Python harness lean and let the server lazily compute.

    console.print(Panel.fit(
        f"Persona ID: [cyan]{persona['id']}[/cyan]\n"
        f"Client access code: [cyan]{SIM_CLIENT_ACCESS_CODE}[/cyan]\n"
        f"Chunks: {len(POSTS)}\n"
        f"Next: [bold]python run.py chat[/bold]",
        title="Seed done",
    ))


def cmd_chat(args):
    """Send N conversations through /api/chat. Default N=10.

    Payload matches api/chat.js L69: { message, persona, scenario, conversation_id? }.
    Each call creates or continues a conversation; we keep one conv per run
    so messages accumulate (realistic DM flow).
    """
    client = db()
    persona = get_sim_persona(client)
    if not persona:
        console.print("[red]No sim persona. Run `python run.py seed` first.[/red]")
        sys.exit(1)
    assert_sim_persona(persona)

    n = args.n or 10
    sent, ok, failed = 0, 0, 0
    errors_sample = []
    conv_id = None  # will be set by server on first message, returned via X-Conversation-Id header? Actually no — we'd need to look it up.

    for i in range(n):
        scenario = CHAT_SCENARIOS[i % len(CHAT_SCENARIOS)]
        user_msg, _cue = scenario

        payload = {
            "message": user_msg,
            "persona": persona["id"],
            "scenario": "default",
        }
        if conv_id:
            payload["conversation_id"] = conv_id

        headers = {
            "Content-Type": "application/json",
            "x-access-code": SIM_CLIENT_ACCESS_CODE,
        }
        status = None
        try:
            r = requests.post(api_url("/api/chat"), json=payload, headers=headers, timeout=60, stream=True)
            status = r.status_code
            if r.status_code == 200:
                for line in r.iter_lines():
                    if line and line.startswith(b"data:"):
                        try:
                            data = json.loads(line[5:].strip())
                            if isinstance(data, dict) and data.get("conversation_id") and not conv_id:
                                conv_id = data["conversation_id"]
                        except Exception:
                            pass
                ok += 1
            else:
                failed += 1
                if len(errors_sample) < 3:
                    errors_sample.append(f"HTTP {r.status_code}: {r.text[:200]}")
        except Exception as e:
            failed += 1
            if len(errors_sample) < 3:
                errors_sample.append(f"EXC: {type(e).__name__}: {str(e)[:180]}")
        sent += 1
        mark = "[green]ok[/green]" if status == 200 else "[red]fail[/red]"
        console.print(f"  [{sent}/{n}] {mark} — {user_msg[:60]}")

    # If SSE didn't surface conv_id, look it up by persona
    if not conv_id:
        rows = client.table("conversations").select("id").eq("persona_id", persona["id"]).order("last_message_at", desc=True).limit(1).execute().data
        if rows:
            conv_id = rows[0]["id"]

    console.print(Panel.fit(
        f"Sent: {sent}  ok: [green]{ok}[/green]  failed: [red]{failed}[/red]\n"
        f"Conversation: [cyan]{conv_id or '?'}[/cyan]\n" +
        ("\n".join(f"  • {e}" for e in errors_sample) if errors_sample else ""),
        title="Chat done",
    ))


def cmd_feedback(args):
    """Post corrections via /api/feedback using type='save_rule'.

    Payload matches api/feedback.js L156 + L393: { type, persona, userMessage }.
    `save_rule` pipes userMessage through Haiku → `corrections` table (status='active')
    → consolidation fodder. Use --bad for contradictory set (expected to trigger
    auto-revert when consolidation runs).
    """
    client = db()
    persona = get_sim_persona(client)
    if not persona:
        console.print("[red]No sim persona. Run `python run.py seed` first.[/red]")
        sys.exit(1)
    assert_sim_persona(persona)

    dataset = CORRECTIONS_CONTRADICTORY if args.bad else CORRECTIONS_COHERENT
    label = "contradictory" if args.bad else "coherent"

    headers = {
        "Content-Type": "application/json",
        "x-access-code": SIM_CLIENT_ACCESS_CODE,
    }
    for i, c in enumerate(dataset, 1):
        payload = {
            "type": "save_rule",
            "persona": persona["id"],
            # The server extracts the rule from userMessage via Haiku; we pass
            # the full context so extraction has something meaningful to work on.
            "userMessage": f"Contexte: {c['user_message']}\n"
                           f"Réponse bot: {c['bot_message']}\n"
                           f"Règle à retenir: {c['correction']}",
        }
        try:
            r = requests.post(api_url("/api/feedback"), json=payload, headers=headers, timeout=30)
            status = "[green]ok[/green]" if r.status_code == 200 else f"[red]FAIL {r.status_code}: {r.text[:100]}[/red]"
        except Exception as e:
            status = f"[red]err: {e}[/red]"
        console.print(f"  [{i}/{len(dataset)}] {status} — {c['correction'][:70]}")

    console.print(f"[green]Posted {len(dataset)} {label} rules.[/green]")


def cmd_validate(args):
    """Hit /api/feedback with validate/client_validate/excellent to populate feedback_events.

    Finds recent assistant messages for the sim persona and posts positive
    validation events against them. This is what the FeedbackRail UI triggers
    when a user clicks ✓ / ✓✓ / ★ on a generated message.
    """
    client = db()
    persona = get_sim_persona(client)
    if not persona:
        console.print("[red]No sim persona.[/red]")
        sys.exit(1)
    assert_sim_persona(persona)

    # Find recent assistant messages to validate. Many conversations may be
    # empty shells from previously-failing chat attempts — order by last
    # activity so we reach the ones that actually have messages.
    convs = client.table("conversations").select("id").eq("persona_id", persona["id"]).order("last_message_at", desc=True).limit(20).execute().data
    if not convs:
        console.print("[yellow]No conversations yet. Run `python run.py chat` first.[/yellow]")
        return
    conv_ids = [c["id"] for c in convs]

    msgs = client.table("messages").select("id, content, conversation_id").in_("conversation_id", conv_ids).eq("role", "assistant").order("created_at", desc=True).limit(6).execute().data
    if not msgs:
        console.print("[yellow]No assistant messages to validate.[/yellow]")
        return

    # Spread: 2 validate, 2 client_validate, 2 excellent
    # UI fires BOTH endpoints per click (see src/routes/chat/[persona]/+page.svelte
    # handleValidate/handleClientValidate/handleExcellent) — /api/feedback for
    # legacy positive-feedback signal, /api/feedback-events for the persistent
    # feedback_events row. Harness replicates both.
    types = ["validate", "validate", "client_validate", "client_validate", "excellent", "excellent"]
    # Map legacy type → feedback_events event_type
    event_type_map = {
        "validate": "validated",
        "client_validate": "client_validated",
        "excellent": "excellent",
    }
    headers = {
        "Content-Type": "application/json",
        "x-access-code": SIM_CLIENT_ACCESS_CODE,
    }
    for i, (msg, t) in enumerate(zip(msgs, types), 1):
        # Legacy signal (best-effort like the UI)
        try:
            requests.post(api_url("/api/feedback"), json={
                "type": t,
                "persona": persona["id"],
                "botMessage": msg["content"],
                "userMessage": "[simulated click]",
            }, headers=headers, timeout=30)
        except Exception:
            pass
        # Primary: the feedback_events row
        try:
            r = requests.post(api_url("/api/feedback-events"), json={
                "conversation_id": msg["conversation_id"],
                "message_id": msg["id"],
                "event_type": event_type_map[t],
            }, headers=headers, timeout=30)
            status = "[green]ok[/green]" if r.status_code in (200, 201) else f"[red]{r.status_code}: {r.text[:80]}[/red]"
        except Exception as e:
            status = f"[red]{type(e).__name__}: {str(e)[:80]}[/red]"
        console.print(f"  [{i}/{len(types)}] {t:>17s} {status} — {msg['content'][:50]}")


def cmd_stress(args):
    """Insert drifted drafts directly and observe what the rhythm_shadow table records."""
    client = db()
    persona = get_sim_persona(client)
    if not persona:
        console.print("[red]No sim persona. Run `python run.py seed` first.[/red]")
        sys.exit(1)
    assert_sim_persona(persona)

    # The stress test goes through /api/chat with prefabricated user prompts
    # that historically elicit drift. We don't directly write to rhythm_shadow
    # because that bypasses the critic evaluation — we want the real code path.
    # Instead, we send the drifted texts as the LAST user message with a cue
    # "réponds exactement dans ce style:" so the clone mimics it (worst case).
    # This is a weaker stress than we'd ideally want; a proper stress would
    # require a backdoor to the critic. Note this tradeoff in the verdict.
    headers = {
        "Content-Type": "application/json",
        "x-access-code": SIM_CLIENT_ACCESS_CODE,
    }
    for i, draft in enumerate(DRIFTED_DRAFTS, 1):
        user_msg = (
            f"Réponds en copiant EXACTEMENT ce style, même vocabulaire, même longueur:\n\n"
            f"---\n{draft}\n---"
        )
        payload = {
            "message": user_msg,
            "persona": persona["id"],
            "scenario": "default",
        }
        try:
            r = requests.post(api_url("/api/chat"), json=payload, headers=headers, timeout=60, stream=True)
            for _ in r.iter_lines():
                pass
            console.print(f"  [{i}/{len(DRIFTED_DRAFTS)}] drifted draft injected (len={len(draft)})")
        except Exception as e:
            console.print(f"  [{i}/{len(DRIFTED_DRAFTS)}] [red]error: {e}[/red]")

    console.print("[green]Stress batch sent. Check verdict for flag rate.[/green]")


def cmd_consolidate(args):
    """Hit /api/cron-consolidate with the CRON_SECRET bearer token."""
    cron_secret = getenv("CRON_SECRET")
    headers = {"Authorization": f"Bearer {cron_secret}"}
    r = requests.get(api_url("/api/cron-consolidate"), headers=headers, timeout=300)
    console.print(f"Status: {r.status_code}")
    try:
        console.print(json.dumps(r.json(), indent=2, ensure_ascii=False))
    except Exception:
        console.print(r.text[:1000])


def cmd_fidelity(args):
    """POST /api/fidelity to force fidelity calc on sim persona."""
    client = db()
    persona = get_sim_persona(client)
    if not persona:
        console.print("[red]No sim persona.[/red]")
        sys.exit(1)
    assert_sim_persona(persona)

    headers = {
        "Content-Type": "application/json",
        "x-access-code": SIM_CLIENT_ACCESS_CODE,
    }
    r = requests.post(api_url("/api/fidelity"), json={"personaId": persona["id"]}, headers=headers, timeout=120)
    console.print(f"Status: {r.status_code}")
    try:
        console.print(json.dumps(r.json(), indent=2, ensure_ascii=False))
    except Exception:
        console.print(r.text[:1000])


def cmd_verdict(args):
    """Read all diagnostic tables for the sim persona and print a markdown report."""
    client = db()
    persona = get_sim_persona(client)
    if not persona:
        console.print("[red]No sim persona.[/red]")
        sys.exit(1)
    assert_sim_persona(persona)

    pid = persona["id"]

    # rhythm_shadow
    rs = client.table("rhythm_shadow").select("score, would_flag, created_at").eq("persona_id", pid).order("created_at", desc=True).limit(200).execute().data
    # fidelity_scores
    fs = client.table("fidelity_scores").select("score_global, collapse_index, calculated_at").eq("persona_id", pid).order("calculated_at", desc=True).limit(20).execute().data
    # feedback_events
    fe = client.table("feedback_events").select("event_type, created_at").eq("persona_id", pid).order("created_at", desc=True).limit(200).execute().data
    # learning_events
    le = client.table("learning_events").select("event_type, payload, created_at").eq("persona_id", pid).order("created_at", desc=True).limit(200).execute().data
    # corrections
    corr = client.table("corrections").select("id, status").eq("persona_id", pid).execute().data

    def summarize(rows, key):
        from collections import Counter
        return Counter(r[key] for r in rows)

    # Render tables
    t_overview = Table(title="Overview (sim persona)")
    t_overview.add_column("Metric")
    t_overview.add_column("Value", style="cyan")
    t_overview.add_row("persona_id", pid)
    t_overview.add_row("rhythm_shadow rows", str(len(rs)))
    if rs:
        avg = sum(float(r["score"]) for r in rs) / len(rs)
        flags = sum(1 for r in rs if r["would_flag"])
        t_overview.add_row("  avg score", f"{avg:.3f}")
        t_overview.add_row("  flag rate", f"{flags}/{len(rs)} ({100*flags/len(rs):.0f}%)")
    t_overview.add_row("fidelity_scores rows", str(len(fs)))
    if fs:
        latest = fs[0]
        t_overview.add_row("  latest score_global", str(latest["score_global"]))
        t_overview.add_row("  latest collapse_index", str(latest["collapse_index"]))
    t_overview.add_row("feedback_events", str(len(fe)))
    for k, v in summarize(fe, "event_type").items():
        t_overview.add_row(f"  {k}", str(v))
    t_overview.add_row("learning_events", str(len(le)))
    for k, v in summarize(le, "event_type").items():
        t_overview.add_row(f"  {k}", str(v))
    t_overview.add_row("corrections (all status)", str(len(corr)))
    for k, v in summarize(corr, "status").items():
        t_overview.add_row(f"  {k}", str(v))
    console.print(t_overview)

    # Verdict heuristics
    verdict_lines = []
    if len(rs) == 0:
        verdict_lines.append("[red][FAIL] Aucun event critic — /api/chat ne passe pas par le pipeline attendu[/red]")
    else:
        verdict_lines.append(f"[green][OK] Pipeline critic actif — {len(rs)} evaluations[/green]")
    if len(fs) == 0:
        verdict_lines.append("[red][FAIL] Aucune fidelity calculee — bug bloquant confirme[/red]")
    else:
        verdict_lines.append(f"[green][OK] Fidelity calculee — score {fs[0]['score_global']}[/green]")
    if len(fe) == 0:
        verdict_lines.append("[red][FAIL] Aucun feedback_event — le clic FeedbackRail ne remonte pas[/red]")
    else:
        verdict_lines.append(f"[green][OK] Feedback remonte — {len(fe)} events[/green]")
    revert = sum(1 for e in le if e["event_type"] == "consolidation_reverted")
    if revert > 0:
        verdict_lines.append(f"[green][OK] Auto-revert a fonctionne — {revert} reverts[/green]")

    console.print(Panel.fit("\n".join(verdict_lines), title="Verdict"))


def cmd_status(args):
    """Quick health check — row counts per table for the sim persona."""
    client = db()
    persona = get_sim_persona(client)
    if not persona:
        console.print("[yellow]No sim persona yet. Run `seed` to start.[/yellow]")
        return
    assert_sim_persona(persona)
    pid = persona["id"]

    tables = ["chunks", "rhythm_shadow", "fidelity_scores", "feedback_events", "learning_events", "corrections"]
    t = Table(title="Sim persona table counts")
    t.add_column("Table")
    t.add_column("Rows", style="cyan")
    for tbl in tables:
        try:
            res = client.table(tbl).select("id", count="exact").eq("persona_id", pid).execute()
            t.add_row(tbl, str(res.count))
        except Exception as e:
            t.add_row(tbl, f"[red]err: {e}[/red]")
    console.print(t)


def cmd_cleanup(args):
    """Delete ALL sim_* personas + cascading rows. Asks confirmation."""
    client = db()
    sim_personas = client.table("personas").select("id, slug, name").like("slug", f"{SIM_SLUG_PREFIX}%").execute().data

    if not sim_personas:
        console.print("[yellow]No sim personas found.[/yellow]")
        return

    console.print("[bold red]Will delete:[/bold red]")
    for p in sim_personas:
        console.print(f"  • {p['slug']} ({p['name']}) — {p['id']}")

    if not args.yes:
        ans = input("\nType 'yes' to confirm: ").strip().lower()
        if ans != "yes":
            console.print("Aborted.")
            return

    for p in sim_personas:
        assert_sim_persona(p)
        # CASCADE should handle chunks, conversations, messages, rhythm_shadow, etc.
        client.table("personas").delete().eq("id", p["id"]).execute()
        console.print(f"[green]Deleted {p['slug']}[/green]")

    # Clean sim client too if empty
    sim_clients = client.table("clients").select("id").eq("name", SIM_CLIENT_NAME).execute().data
    for c in sim_clients:
        rem = client.table("personas").select("id").eq("client_id", c["id"]).execute().data
        if not rem:
            client.table("clients").delete().eq("id", c["id"]).execute()
            console.print(f"[green]Deleted sim client[/green]")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="VoiceClone simulation harness")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("seed", help="Create sim persona + chunks + embeddings")

    p_chat = sub.add_parser("chat", help="Run N conversations")
    p_chat.add_argument("n", nargs="?", type=int, default=10)

    p_fb = sub.add_parser("feedback", help="Post corrections (save_rule)")
    p_fb.add_argument("--bad", action="store_true", help="Use contradictory set")

    sub.add_parser("validate", help="Post validate/client_validate/excellent on recent messages")
    sub.add_parser("stress", help="Send drifted drafts")
    sub.add_parser("consolidate", help="Trigger cron-consolidate")
    sub.add_parser("fidelity", help="Force fidelity calc")
    sub.add_parser("verdict", help="Generate diagnostic report")
    sub.add_parser("status", help="Quick row count check")

    p_cleanup = sub.add_parser("cleanup", help="Delete all sim_* data")
    p_cleanup.add_argument("--yes", action="store_true", help="Skip confirmation")

    args = parser.parse_args()

    commands = {
        "seed": cmd_seed,
        "chat": cmd_chat,
        "feedback": cmd_feedback,
        "validate": cmd_validate,
        "stress": cmd_stress,
        "consolidate": cmd_consolidate,
        "fidelity": cmd_fidelity,
        "verdict": cmd_verdict,
        "status": cmd_status,
        "cleanup": cmd_cleanup,
    }
    commands[args.cmd](args)


if __name__ == "__main__":
    main()
