// Routeur unique pour toutes les routes /api/* — le plan Vercel Hobby limite
// un déploiement à 12 fonctions serverless. Les handlers vivent dans
// api/_handlers/ (préfixe _ = ignoré par Vercel) et gardent leur signature
// (req, res). Import dynamique : seul le handler appelé est chargé.
//
// Ajouter une route = ajouter le fichier dans _handlers/ ET une entrée ici.

export const maxDuration = 300;

const routes = {
  "account/delete": () => import("./_handlers/account/delete.js"),
  "auto-critique": () => import("./_handlers/auto-critique.js"),
  calibrate: () => import("./_handlers/calibrate.js"),
  chat: () => import("./_handlers/chat.js"),
  clone: () => import("./_handlers/clone.js"),
  config: () => import("./_handlers/config.js"),
  contributors: () => import("./_handlers/contributors.js"),
  conversations: () => import("./_handlers/conversations.js"),
  "cron-auto-critique": () => import("./_handlers/cron-auto-critique.js"),
  "cron-consolidate": () => import("./_handlers/cron-consolidate.js"),
  "cron-fidelity": () => import("./_handlers/cron-fidelity.js"),
  "cron-protocol-v2-drain": () => import("./_handlers/cron-protocol-v2-drain.js"),
  "demo-draft": () => import("./_handlers/demo-draft.js"),
  eval: () => import("./_handlers/eval.js"),
  feedback: () => import("./_handlers/feedback.js"),
  "feedback-events": () => import("./_handlers/feedback-events.js"),
  "feedback-roi": () => import("./_handlers/feedback-roi.js"),
  fidelity: () => import("./_handlers/fidelity.js"),
  "fidelity-tuning": () => import("./_handlers/fidelity-tuning.js"),
  knowledge: () => import("./_handlers/knowledge.js"),
  "learning-events": () => import("./_handlers/learning-events.js"),
  messages: () => import("./_handlers/messages.js"),
  metrics: () => import("./_handlers/metrics.js"),
  personas: () => import("./_handlers/personas.js"),
  scrape: () => import("./_handlers/scrape.js"),
  settings: () => import("./_handlers/settings.js"),
  share: () => import("./_handlers/share.js"),
  usage: () => import("./_handlers/usage.js"),
  "v2/brain-status": () => import("./_handlers/v2/brain-status.js"),
  "v2/clone-outcomes": () => import("./_handlers/v2/clone-outcomes.js"),
  "v2/clone-trajectory": () => import("./_handlers/v2/clone-trajectory.js"),
  "v2/contradictions": () => import("./_handlers/v2/contradictions.js"),
  "v2/contradictions-resolve": () => import("./_handlers/v2/contradictions-resolve.js"),
  "v2/draft": () => import("./_handlers/v2/draft.js"),
  "v2/feedback": () => import("./_handlers/v2/feedback.js"),
  "v2/persona-api-keys": () => import("./_handlers/v2/persona-api-keys.js"),
  "v2/persona-settings": () => import("./_handlers/v2/persona-settings.js"),
  "v2/personas/share-token": () => import("./_handlers/v2/personas/share-token.js"),
  "v2/propositions": () => import("./_handlers/v2/propositions.js"),
  "v2/propositions-batch": () => import("./_handlers/v2/propositions-batch.js"),
  "v2/propositions-distribution": () => import("./_handlers/v2/propositions-distribution.js"),
  "v2/protocol": () => import("./_handlers/v2/protocol.js"),
  "v2/protocol/extract": () => import("./_handlers/v2/protocol/extract.js"),
  "v2/protocol/import-batches": () => import("./_handlers/v2/protocol/import-batches.js"),
  "v2/protocol/import-doc": () => import("./_handlers/v2/protocol/import-doc.js"),
  "v2/protocol/publish": () => import("./_handlers/v2/protocol/publish.js"),
  "v2/protocol/publish-active": () => import("./_handlers/v2/protocol/publish-active.js"),
  "v2/protocol/source-playbooks": () => import("./_handlers/v2/protocol/source-playbooks.js"),
  "v2/protocol/stream": () => import("./_handlers/v2/protocol/stream.js"),
  "v2/review-deck": () => import("./_handlers/v2/review-deck.js"),
  "v2/setter-activity": () => import("./_handlers/v2/setter-activity.js"),
  "v2/sources": () => import("./_handlers/v2/sources.js"),
};

// Clés de query injectées par le routage Vercel (rewrite vercel.json → __path,
// route générée pour [...path] → "...path" / "path"). Retirées avant d'appeler
// le handler pour qu'il voie exactement la query d'avant.
const ROUTING_KEYS = ["__path", "...path", "path"];

function resolveKey(req) {
  const q = req.query && typeof req.query === "object" ? req.query : {};
  let raw = null;
  for (const k of ROUTING_KEYS) {
    if (q[k] != null && q[k] !== "") {
      raw = Array.isArray(q[k]) ? q[k].join("/") : String(q[k]);
      break;
    }
  }
  if (raw == null) {
    const pathname = new URL(req.url || "/", "http://localhost").pathname;
    raw = pathname.replace(/^\/api\/?/, "");
  }
  for (const k of ROUTING_KEYS) delete q[k];
  return raw.replace(/^\/+|\/+$/g, "");
}

export default async function handler(req, res) {
  const key = resolveKey(req);
  const load = routes[key];
  if (!load) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const mod = await load();
  return mod.default(req, res);
}
