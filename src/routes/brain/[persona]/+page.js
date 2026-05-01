// Client-side route load — just exposes the persona param. The previous
// +page.server.js was needed to read the NEW_PROTOCOL_UI_PERSONAS env var,
// but the v1 → v2 protocol UI rollout is complete : v2 is now always-on.

export function load({ params }) {
  return { personaId: params.persona };
}
