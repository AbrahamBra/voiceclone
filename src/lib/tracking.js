// Noop-safe wrapper around window.plausible.
// - SSR-safe: bails out when window is undefined.
// - Adblock-safe: bails out when plausible is not injected.
// - Dev-safe: bails out when only the queue stub exists (data-domain unset, real script
//   loaded but Plausible itself sends nothing — avoids a queue that grows forever).
// - Error-safe: swallows any exception thrown by the plausible call.

export function track(event, props = {}) {
  if (typeof window === 'undefined') return;
  if (typeof window.plausible !== 'function') return;
  // The HTML stub assigns `window.plausible.q = []` and uses .push as a queue.
  // The real Plausible script replaces the function and removes `.q` once loaded.
  // If `.q` is still present, no real tracking is happening — skip to avoid a leak.
  if (window.plausible.q) return;
  try {
    window.plausible(event, { props });
  } catch {
    // Silent — tracking never breaks UX.
  }
}
