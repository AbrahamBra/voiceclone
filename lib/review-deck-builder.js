// Review Deck v0 — pure assembly DB → Markdown.
//
// Spec : docs/superpowers/specs/2026-04-25-review-deck-v0-design.md
// Aucun appel LLM. Idempotent. Toutes les fonctions prennent un Supabase
// client en 1er argument (pattern lib/protocol-v2-db.js) pour test stubs.
//
// Public surface :
//   - buildReviewDeck(sb, personaId, opts?) → { markdown, flavor }
//   - REVIEW_DECK_ERRORS (NOT_FOUND_PERSONA, NOT_FOUND_PROTOCOL)
//   - mapping intent → symbole exporté pour tests

export const REVIEW_DECK_ERRORS = {
  NOT_FOUND_PERSONA: "persona not found",
  NOT_FOUND_PROTOCOL: "persona has no protocol",
};

// Mapping intent → [symbol, libellé]. Fallback "•" / "Modifié" pour tout
// intent inconnu (l'enum proposition.intent peut s'étendre — voir spec
// §Mapping intent → symbole, fallback robustness).
const INTENT_TO_SYMBOL = {
  add_paragraph: ["+", "Ajouté"],
  add_rule: ["+", "Ajouté"],
  amend_paragraph: ["↻", "Modifié"],
  refine_pattern: ["↻", "Modifié"],
  remove_rule: ["−", "Retiré"],
};
const INTENT_FALLBACK = ["•", "Modifié"];

export function symbolForIntent(intent) {
  return INTENT_TO_SYMBOL[intent] || INTENT_FALLBACK;
}

export function relativeDateFr(when, now) {
  const ms = now.getTime() - new Date(when).getTime();
  const days = Math.max(0, Math.floor(ms / 86400000));
  if (days === 0) return "aujourd'hui";
  if (days === 1) return "hier";
  return `il y a ${days} jours`;
}

/**
 * Builds the Review Deck Markdown for a persona.
 *
 * @param sb            Supabase client.
 * @param personaId     Persona UUID.
 * @param opts.now      Date used for relative date rendering (default: new Date()).
 * @param opts.logger   { warn(event, payload) } — optional, used for unknown intents.
 * @returns { markdown, flavor } | throws { code: 'NOT_FOUND_PERSONA' | 'NOT_FOUND_PROTOCOL' }
 */
export async function buildReviewDeck(sb, personaId, opts = {}) {
  const now = opts.now || new Date();
  const logger = opts.logger || { warn: () => {} };

  const persona = await fetchPersona(sb, personaId);
  if (!persona) throw makeErr("NOT_FOUND_PERSONA");

  const docs = await fetchProtocolDocuments(sb, personaId);
  const active = docs.find((d) => d.status === "active");
  const draft = docs.find((d) => d.status === "draft");
  if (!active && !draft) throw makeErr("NOT_FOUND_PROTOCOL");

  const flavor = active && !draft ? "stable" : draft ? (active ? "ongoing" : "kickoff") : "ongoing";
  const headDoc = draft || active;
  const sections = await fetchSections(sb, headDoc.id);
  const visibleSections = sections.filter((s) => (s.prose || "").trim().length > 0);

  const personaName = persona.client_label?.trim() || persona.name;

  if (flavor === "kickoff") {
    return { flavor: "kickoff", markdown: renderKickoff(personaName, visibleSections) };
  }

  // ongoing / stable : changelog from accepted propositions on the head doc
  const accepted = draft ? await fetchAcceptedPropositions(sb, draft.id) : [];
  if (accepted.length > 100) {
    logger.warn("review_deck_high_volume", { persona_id: personaId, count: accepted.length });
  }
  for (const p of accepted) {
    if (!INTENT_TO_SYMBOL[p.intent]) {
      logger.warn("review_deck_unknown_intent", {
        persona_id: personaId,
        proposition_id: p.id,
        intent: p.intent,
      });
    }
  }

  const targetVersion = draft ? draft.version : active.version;
  const fromVersion = active ? active.version : null;

  return {
    flavor: "ongoing",
    markdown: renderOngoing({
      personaName,
      targetVersion,
      fromVersion,
      now,
      sections: visibleSections,
      accepted,
    }),
  };
}

// ── DB helpers ───────────────────────────────────────────────

async function fetchPersona(sb, personaId) {
  const { data, error } = await sb
    .from("personas")
    .select("id, name, client_label")
    .eq("id", personaId)
    .single();
  if (error || !data) return null;
  return data;
}

async function fetchProtocolDocuments(sb, personaId) {
  const { data, error } = await sb
    .from("protocol_document")
    .select("id, version, status")
    .eq("owner_kind", "persona")
    .eq("owner_id", personaId)
    .in("status", ["active", "draft"]);
  if (error) return [];
  return data || [];
}

async function fetchSections(sb, documentId) {
  const { data, error } = await sb
    .from("protocol_section")
    .select('id, "order", kind, heading, prose')
    .eq("document_id", documentId)
    .order('"order"', { ascending: true });
  if (error) return [];
  return data || [];
}

async function fetchAcceptedPropositions(sb, documentId) {
  const { data, error } = await sb
    .from("proposition")
    .select("id, intent, target_kind, source_quote, proposed_text, rationale, resolved_at")
    .eq("document_id", documentId)
    .eq("status", "accepted")
    .order("resolved_at", { ascending: false });
  if (error) return [];
  return data || [];
}

// ── Markdown renderers ───────────────────────────────────────

function renderKickoff(personaName, sections) {
  const lines = [];
  lines.push(`# Protocole ${personaName} — première version`);
  lines.push("*Extraite de votre playbook · Pour validation*");
  lines.push("");
  lines.push("## Comment votre clone va « penser »");
  lines.push("");
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    lines.push(`### §${i + 1}. ${s.heading || s.kind}`);
    lines.push(s.prose.trim());
    lines.push("");
  }
  lines.push("---");
  lines.push(
    "*C'est la fondation. Chaque correction qu'on fera ensuite enrichira cette doctrine, et vous reverrez chaque évolution dans le prochain Review Deck.*",
  );
  return lines.join("\n") + "\n";
}

function renderOngoing({ personaName, targetVersion, fromVersion, now, sections, accepted }) {
  const lines = [];
  const isoDate = now.toISOString().slice(0, 10);
  const nbChanges = accepted.length;
  const versionSuffix = fromVersion
    ? `${nbChanges} modifications vs v${fromVersion}`
    : `première version proposée`;
  lines.push(`# Protocole ${personaName} — proposition v${targetVersion}`);
  lines.push(`*Présenté le ${isoDate} · Pour validation · ${versionSuffix}*`);
  lines.push("");
  lines.push("## Ce qui change");
  lines.push("");

  if (accepted.length === 0) {
    lines.push(
      `Aucune modification depuis v${fromVersion ?? targetVersion} — votre doctrine est stable.`,
    );
    lines.push("");
  } else {
    // Group by target_kind in section order
    const sectionsByKind = new Map();
    for (const s of sections) {
      if (!sectionsByKind.has(s.kind)) sectionsByKind.set(s.kind, s);
    }
    const groups = new Map();
    for (const p of accepted) {
      if (!groups.has(p.target_kind)) groups.set(p.target_kind, []);
      groups.get(p.target_kind).push(p);
    }
    // Render groups in section.order, then any orphan group at the end
    const orderedKinds = sections.map((s) => s.kind).filter((k) => groups.has(k));
    const orphanKinds = [...groups.keys()].filter((k) => !orderedKinds.includes(k));
    for (const kind of [...orderedKinds, ...orphanKinds]) {
      const sec = sectionsByKind.get(kind);
      const heading = sec?.heading || kind;
      lines.push(`### §${kind} — « ${heading} »`);
      lines.push("");
      for (const p of groups.get(kind)) {
        const [sym, libelle] = symbolForIntent(p.intent);
        lines.push(`**${sym} ${libelle}** — ${relativeDateFr(p.resolved_at, now)}`);
        if (p.source_quote && p.source_quote.trim()) {
          lines.push(`> Avant : « ${p.source_quote.trim()} »`);
        }
        lines.push(`> Après : « ${p.proposed_text.trim()} »`);
        lines.push(`> *Pourquoi :* ${p.rationale?.trim() || "—"}`);
        lines.push("");
      }
    }
  }

  lines.push("---");
  lines.push("");
  lines.push("## Le protocole tel que proposé");
  lines.push("");
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    lines.push(`### §${i + 1}. ${s.heading || s.kind}`);
    lines.push(s.prose.trim());
    lines.push("");
  }
  lines.push("---");
  lines.push("*Validez en répondant à ce mail, ou commentez section par section.*");
  return lines.join("\n") + "\n";
}

function makeErr(code) {
  const err = new Error(REVIEW_DECK_ERRORS[code]);
  err.code = code;
  return err;
}
