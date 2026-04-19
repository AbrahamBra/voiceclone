// Route load : retourne personaId pour la page. Le SvelteKit layout parent
// (`+layout.svelte`) gère déjà le redirect auth via accessCode/sessionToken.
// Pas de fetch côté serveur — les panels font leur propres fetch client.
export function load({ params }) {
  return {
    personaId: params.persona,
  };
}
