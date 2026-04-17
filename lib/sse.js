// ============================================================
// SSE HELPERS — Server-Sent Events utilities
// ============================================================

export function initSSE(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  return (type, data = {}) => {
    // Guard against writes after the response is closed (client disconnected,
    // or res.end() already called). Silently drop instead of crashing.
    if (res.writableEnded || res.destroyed) return;
    try {
      res.write("data: " + JSON.stringify({ type, ...data }) + "\n\n");
    } catch (err) {
      // Broken pipe / client gone — don't propagate
      console.log(JSON.stringify({ event: "sse_write_error", error: err?.message }));
    }
  };
}
