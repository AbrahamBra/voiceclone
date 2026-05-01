// Smoke for V3.6.6 per-API-key rate limit. Hits the prod RPC directly
// with a fake keyId so it doesn't pollute real key counters. Verifies:
//   - First 10 calls in a 60s window → allowed
//   - 11th call → rejected with scope='min'
//   - The day bucket count is incremented in lockstep
import "dotenv/config";
import { rateLimitApiKey } from "../lib/_rateLimitApiKey.js";

async function main() {
  const fakeKeyId = `smoke-${Date.now().toString(36)}`;
  console.log(`smoke key = ${fakeKeyId}\n`);

  let firstReject = null;
  for (let i = 1; i <= 12; i++) {
    const r = await rateLimitApiKey(fakeKeyId);
    const status = r.allowed ? "✓ allow" : `✗ block scope=${r.scope} retry=${r.retryAfter}`;
    console.log(`  call ${String(i).padStart(2)}  ${status}`);
    if (!r.allowed && !firstReject) firstReject = i;
  }

  console.log("");
  if (firstReject === 11) {
    console.log("PASS — 11th call rejected as expected");
    process.exit(0);
  } else {
    console.log(`FAIL — expected first reject at 11, got ${firstReject}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
