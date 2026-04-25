#!/usr/bin/env node
// One-shot drain with extended lookback (30 days) to process the 14 undrained
// feedback_events accumulated since 2026-04-18.
//
// The cron uses a 30min lookback by default, which can't catch backlog after a
// silent failure (no protocol_document → all events skipped).
//
// Usage : node -r dotenv/config scripts/drain-once-extended-lookback.js [--dry-run]

import { createClient } from "@supabase/supabase-js";
import {
  drainEventsToProposition,
  drainCorrectionsToProposition,
} from "./feedback-event-to-proposition.js";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const lookbackMs = 30 * 24 * 3600 * 1000;
  console.log(`drain-once-extended (lookback=30d, dryRun=${dryRun})`);

  const events = await drainEventsToProposition({
    supabase: sb,
    lookbackMs,
    limit: 100,
    dryRun,
  });
  console.log("# events");
  console.log(JSON.stringify(events, null, 2));

  const corrections = await drainCorrectionsToProposition({
    supabase: sb,
    lookbackMs,
    limit: 100,
    dryRun,
  });
  console.log("# corrections");
  console.log(JSON.stringify(corrections, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
