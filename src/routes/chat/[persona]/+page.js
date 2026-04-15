export function load({ params, url }) {
  return {
    personaId: params.persona,
    scenario: url.searchParams.get("scenario") || "default",
  };
}
