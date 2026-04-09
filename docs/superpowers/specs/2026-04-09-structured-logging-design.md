# Structured Logging for AI Voice Clone

**Date:** 2026-04-09
**Status:** Approved
**Scope:** `api/chat.js` only — no new files, no new dependencies

## Problem

Zero observability in production. We don't know:
- Whether the critic loop catches violations or burns API budget for nothing
- Which violations are most frequent
- How much latency the 3-pass pipeline adds
- Which knowledge topics are triggered vs. dead weight

## Decision

Single structured JSON `console.log` at the end of each request. Visible in Vercel Logs dashboard. No external service, no new module.

## Log Schema

### Success log (`chat_complete`)

```json
{
  "event": "chat_complete",
  "ts": "2026-04-09T12:00:00.000Z",
  "scenario": "free|analyze",
  "totalMs": 4260,
  "pass1": { "ms": 1820 },
  "critic": {
    "ms": 340,
    "pass": false,
    "violations": ["implicit_criticism", "accusatory_question"],
    "error": false
  },
  "pass3": { "triggered": true, "ms": 2100 },
  "knowledge": {
    "detected": ["topics/dm-linkedin-rdv.md"],
    "count": 1
  }
}
```

### Error log (`chat_error`)

```json
{
  "event": "chat_error",
  "ts": "2026-04-09T12:00:00.000Z",
  "scenario": "analyze",
  "error": "API timeout",
  "failedAt": "pass1|critic|pass3",
  "elapsedMs": 2100
}
```

### Field definitions

| Field | Type | Description |
|-------|------|-------------|
| `event` | string | `chat_complete` or `chat_error` |
| `ts` | string | ISO 8601 timestamp |
| `scenario` | string | `free` or `analyze` |
| `totalMs` | number | Total request duration in ms |
| `pass1.ms` | number | Pass 1 generation latency |
| `critic.ms` | number | Critic check latency |
| `critic.pass` | boolean | Whether Pass 1 passed the critic |
| `critic.violations` | string[] | Violation descriptions (empty if pass=true) |
| `critic.error` | boolean | True if critic crashed (silent fallback) |
| `pass3.triggered` | boolean | Whether regeneration was needed |
| `pass3.ms` | number | Pass 3 streaming duration (0 if not triggered) |
| `knowledge.detected` | string[] | Knowledge pages matched by keyword detection |
| `knowledge.count` | number | Number of pages detected |

## Implementation Plan

All changes in `api/chat.js`:

1. Add `const t0 = Date.now()` at start of handler (after validation). Note: `totalMs` excludes cold start time by design — module loading and knowledge file reads happen before the handler runs.
2. Add `const t1 = Date.now()` after Pass 1 completes
3. Modify `criticCheck`:
   - Return `{ pass: true, error: true }` on catch instead of just `{ pass: true }` — surfaces silent failures
   - Add defensive validation of parsed JSON shape: ensure `pass` is boolean, `violations` is array (default to `[]` if missing). This prevents crashes when Haiku returns malformed JSON (e.g., `{"pass": false}` without violations array, or `violations` as string instead of array).
4. Add `const t2 = Date.now()` after critic check
5. Refactor `buildKnowledgeContext` to return `{ context, detectedPages }` instead of just the context string. Currently `detectRelevantPages` is called inside `buildKnowledgeContext` and the result is consumed internally. The handler needs the detected pages for the log.
6. Capture `t3 = Date.now()` at each exit point. There are **4 exit points** — each one MUST emit a log:
   - **Exit A:** `verdict.pass` branch (line ~225) — direct pass1 streaming, emit `chat_complete`
   - **Exit B:** `stream.on("end")` (line ~262) — after pass3 streaming, emit `chat_complete`
   - **Exit C:** `stream.on("error")` (line ~267) — pass3 streaming failure, emit `chat_error` with `failedAt: "pass3"`
   - **Exit D:** outer `catch` block (line ~277) — pass1 or critic failure, emit `chat_error` with best-guess `failedAt`
7. When pass3 is not triggered, explicitly set `pass3: { triggered: false, ms: 0 }` to keep JSON shape consistent for log queries.
8. Thread `knowledge.detected` from refactored `buildKnowledgeContext` result through to the log.

## What We Don't Do

- No new files or modules
- No requestId (one log line = one request, no correlation needed)
- No intermediate logs (one final log per request)
- No external dependencies
- No changes to the SSE contract (frontend unchanged)
- No stats endpoint (Vercel Logs is sufficient for now)

## Querying the Logs

In Vercel Logs dashboard, filter by:
- `"event":"chat_complete"` — all successful requests
- `"critic.pass":false` — requests where critic caught violations
- `"critic.error":true` — requests where critic silently failed
- `"pass3.triggered":true` — requests that required regeneration
- `"event":"chat_error"` — crashes

## Known Limitations

- **Violation strings are LLM-generated free text.** There is no controlled vocabulary. The same violation may be described differently across requests (e.g., "critique implicite" vs "implicit_criticism"). "Top 3 violation types" analysis requires manual clustering in a spreadsheet. Future improvement: ask the critic to return codes from a fixed enum.
- **Dead weight analysis requires comparing logs against TOPIC_MAP.** The log records which topics were detected, but to find which are *never* triggered, you need the full list of topics. Currently 6 entries in TOPIC_MAP. Note: `knowledge/topics/non-verbal.md` exists but is not wired into TOPIC_MAP — separate follow-up item.
- **Vercel log line size limit.** Hobby plan: 4KB, Pro: 16KB. Unlikely to hit with current schema, but if topics or violations grow significantly, consider truncation.

## Success Criteria

After deploying, we should be able to answer:
1. What % of messages get rejected by the critic?
2. What are the top 3 violation types? (with manual clustering caveat above)
3. How much latency does the critic loop add on average?
4. Which knowledge topics are never triggered (dead weight)?
5. How often does the critic silently crash?
