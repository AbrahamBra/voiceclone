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

1. Add `const t0 = Date.now()` at start of handler (after validation)
2. Add `const t1 = Date.now()` after Pass 1 completes
3. Modify `criticCheck` to return `{ pass: true, error: true }` on catch instead of just `{ pass: true }` — surfaces silent failures
4. Add `const t2 = Date.now()` after critic check
5. Capture `t3 = Date.now()` at each exit point:
   - In the `verdict.pass` branch (direct pass1 streaming)
   - In `stream.on("end")` (after pass3 streaming)
6. Emit `console.log(JSON.stringify(logEntry))` at each exit point
7. In both catch blocks: emit `chat_error` log with `failedAt` and `elapsedMs`
8. Thread `knowledge.detected` from `detectRelevantPages` result through to the log (currently discarded after use)

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

## Success Criteria

After deploying, we should be able to answer:
1. What % of messages get rejected by the critic?
2. What are the top 3 violation types?
3. How much latency does the critic loop add on average?
4. Which knowledge topics are never triggered (dead weight)?
5. How often does the critic silently crash?
