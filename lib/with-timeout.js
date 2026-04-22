// Run an async operation with a hard timeout, aborting it cleanly on expiry.
// Callers pass `fn(signal)` so fetch / Anthropic SDK / etc. can be cancelled
// instead of leaving an orphan promise that still burns tokens after timeout.
//
// Usage:
//   await withTimeout(
//     (signal) => anthropic.messages.create({ ... }, { signal }),
//     30_000,
//     "clone-config"
//   );
export async function withTimeout(fn, ms, label = "operation") {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await fn(ac.signal);
  } catch (err) {
    if (ac.signal.aborted) {
      const e = new Error(`${label} timed out after ${ms}ms`);
      e.code = "TIMEOUT";
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
