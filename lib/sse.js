// ============================================================
// SSE HELPERS — Server-Sent Events utilities
// ============================================================

export function initSSE(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  return (type, data = {}) => {
    res.write("data: " + JSON.stringify({ type, ...data }) + "\n\n");
  };
}
