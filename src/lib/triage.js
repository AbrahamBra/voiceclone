// Triage des clones — logique partagée par la page /clones.
// Priorité : (0) drift > (1) inactif / jamais utilisé > (2) alerte > (3) actif.
// Le modèle mental de l'opérateur est « la dette », pas « le portefeuille » :
// on fait remonter ce qui pourrit, pas ce qui est vert.

const DAY_MS = 86_400_000;

/**
 * @param {{ last_message_at?: string|null }} persona
 * @param {{ score_global?: number }|null|undefined} fidelity
 * @param {number} [now]
 */
export function triageOf(persona, fidelity, now = Date.now()) {
  const scoreGlobal = fidelity?.score_global;
  const lastAt = persona?.last_message_at;
  const daysSince = lastAt ? Math.floor((now - new Date(lastAt).getTime()) / DAY_MS) : null;

  if (typeof scoreGlobal === "number" && scoreGlobal < 50) {
    return { kind: "drift", priority: 0, label: "en dérive" };
  }
  if (daysSince === null) {
    return { kind: "never", priority: 1, label: "jamais utilisé" };
  }
  if (daysSince >= 3) {
    return { kind: "stale", priority: 1, label: `${daysSince}j d'absence` };
  }
  if (typeof scoreGlobal === "number" && scoreGlobal < 75) {
    return { kind: "warn", priority: 2, label: "alerte" };
  }
  return { kind: "ok", priority: 3, label: "actif" };
}

/**
 * Comparateur : dette d'abord, puis activité la plus ancienne en premier.
 * @param {Record<string, any>} scores  map persona.id → fidelity
 * @param {number} [now]
 */
export function byTriage(scores, now = Date.now()) {
  const key = (p) => {
    const t = triageOf(p, scores?.[p.id], now);
    const lastAtMs = p.last_message_at ? new Date(p.last_message_at).getTime() : 0;
    return [t.priority, lastAtMs];
  };
  return (a, b) => {
    const [pa, la] = key(a);
    const [pb, lb] = key(b);
    if (pa !== pb) return pa - pb;
    return la - lb;
  };
}

/** @param {string|null|undefined} iso @param {number} [now] */
export function relTime(iso, now = Date.now()) {
  if (!iso) return "jamais";
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)}m`;
  if (s < 86_400) return `il y a ${Math.floor(s / 3600)}h`;
  const d = Math.floor(s / 86_400);
  if (d === 1) return "hier";
  return `il y a ${d}j`;
}
