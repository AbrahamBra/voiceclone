// ============================================================
// SSE HELPERS — Server-Sent Events utilities
// ============================================================
import { log } from "./log.js";

// Attach SSE headers + return a { send, signal } pair.
// - send(type, data): writes an SSE event; silently drops after disconnect.
// - signal: an AbortSignal that fires when the client disconnects, so callers
//   can abort upstream work (Claude streams, DB queries) instead of burning
//   tokens past the browser close. Opt-in: forward signal into fetch/SDK calls.
export function initSSE(res, req) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const ac = new AbortController();
  if (req) {
    const onClose = () => {
      if (!ac.signal.aborted) {
        ac.abort();
        log("sse_client_disconnect", {});
      }
    };
    req.on("close", onClose);
    res.on("close", onClose);
  }

  const send = (type, data = {}) => {
    if (res.writableEnded || res.destroyed) return;
    try {
      res.write("data: " + JSON.stringify({ type, ...data }) + "\n\n");
    } catch (err) {
      log("sse_write_error", { error: err?.message });
    }
  };

  // Back-compat: existing callers use `const sse = initSSE(res)` then `sse("delta", ...)`.
  // New callers can destructure: `const { send, signal } = initSSE(res, req)`.
  send.send = send;
  send.signal = ac.signal;
  return send;
}
