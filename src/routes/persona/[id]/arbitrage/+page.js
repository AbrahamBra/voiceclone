// Client-side route load — exposes the persona UUID param + optional ?focus=contras|props anchor.

export function load({ params, url }) {
  return {
    personaId: params.id,
    focus: url.searchParams.get("focus") || "contras",
  };
}
