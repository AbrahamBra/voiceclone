// Noop-safe wrapper around window.plausible.
// - SSR-safe: bails out when window is undefined.
// - Adblock-safe: bails out when plausible is not injected.
// - Error-safe: swallows any exception thrown by the plausible call.

export function track(event, props = {}) {
  if (typeof window === 'undefined') return;
  if (typeof window.plausible !== 'function') return;
  try {
    window.plausible(event, { props });
  } catch {
    // Silent — tracking never breaks UX.
  }
}
