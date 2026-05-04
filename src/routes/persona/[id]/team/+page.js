// Client-side route load — exposes the persona UUID param.

export function load({ params }) {
  return { personaId: params.id };
}
