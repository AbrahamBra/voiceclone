// Server-side route load.
// Replaces the previous +page.js so we can read env vars (NEW_PROTOCOL_UI_PERSONAS)
// without exposing them to the client bundle.
//
// The SvelteKit layout parent handles auth via accessCode/sessionToken.

import { isNewProtocolUiEnabled } from "$lib/protocol-v2-feature-flag.js";

export function load({ params }) {
  const personaId = params.persona;
  return {
    personaId,
    useNewProtocolUi: isNewProtocolUiEnabled(personaId),
  };
}
