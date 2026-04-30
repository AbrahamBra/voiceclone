#!/usr/bin/env node
/**
 * Seed du playbook "visite_profil" — V1 vertical slice.
 *
 * Insère deux protocol_document avec source_core='visite_profil' :
 *   1. Template universel  — owner_kind='template', voix neutre,
 *      réutilisable comme parent par tous les personas.
 *   2. Fork Nicolas        — owner_kind='persona', voix Nicolas
 *      (signature, tutoiement, formules), parent_template_id pointant
 *      vers le template universel.
 *
 * Source : doc Notion Nicolas pour "visite de profil" (process complet
 * curiosité symétrique + cadence + question miroir par pattern + sortie).
 *
 * Idempotent : skip si le doc existe déjà pour le couple
 * (owner_kind, owner_id, source_core, status='active').
 *
 * À exécuter APRÈS application de migration 055.
 *
 * Usage :
 *   node scripts/seed-visite-profil-playbook.js [--dry-run]
 */

import "dotenv/config";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const SYSTEM_TEMPLATE_OWNER_ID = "00000000-0000-0000-0000-000000000001";
const SOURCE_CORE = "visite_profil";
const NICOLAS_SLUG = "nicolas-lavall-e";

// Stable hash for cross-version dedup (matches lib/protocol-v2-db.js convention).
function computeArtifactHash(text) {
  if (typeof text !== "string") return null;
  const norm = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim();
  if (!norm) return null;
  return crypto.createHash("sha256").update(norm).digest("hex");
}

// ── Universal template content (voice-neutral) ──────────────────────
// Extracted from Nicolas's Notion doc, voice signals stripped (no "saalut",
// no Nicolas signature, no specific emojis). Kept the strategy, cadence,
// structural rules, mirror questions, and dos/don'ts that apply to any
// setter operating on a "visite de profil" lead.
const TEMPLATE_ARTIFACTS = [
  // — Stratégie & process —
  {
    kind: "pattern",
    severity: "strong",
    text:
      "Stratégie de l'icebreaker visite_profil : 'curiosité symétrique'. " +
      "La personne a visité ton profil sans envoyer de demande de connexion. " +
      "On inverse la dynamique en faisant le premier pas, mais on pose la question " +
      "sincère : pourquoi es-tu venu ?",
  },
  {
    kind: "state_transition",
    severity: "strong",
    text:
      "L'icebreaker s'envoie automatiquement dès l'acceptation de la demande de connexion. " +
      "Pas d'attente, pas d'analyse préalable.",
  },
  {
    kind: "pattern",
    severity: "strong",
    text:
      "Avant toute relance, exécuter SWOT/TOWS sur le profil LinkedIn du prospect. " +
      "Le quadrant WT (Weaknesses × Threats) est TOUJOURS le levier de conversation : " +
      "c'est là que se situe la tension que le prospect ressent sans arriver à la formuler. " +
      "Spécifique visite_profil : si le prospect ne répond pas à l'icebreaker, le SWOT/TOWS " +
      "peut quand même être lancé à partir du profil seul, pour préparer une Relance 1 " +
      "ancrée sur une vraie observation business.",
  },

  // — Cadence —
  {
    kind: "hard_check",
    severity: "hard",
    text:
      "Cadence visite_profil : MAX 3 touches sur 5-7 jours par personne, hors demande " +
      "de connexion elle-même. Relance 1 à J+2 si pas de réponse à l'icebreaker. " +
      "Relance 2 à J+4 si toujours pas. Au-delà : sortie propre.",
  },
  {
    kind: "hard_check",
    severity: "hard",
    text:
      "Toujours envoyer en plusieurs messages courts plutôt qu'un bloc unique. " +
      "Fait plus humain, fait plus thread WhatsApp.",
  },

  // — Lecture du signal —
  {
    kind: "decision_row",
    severity: "strong",
    text:
      "Lecture du signal après réponse : SIGNAL FORT (problème concret cité, ouverture " +
      "sur les enjeux) → proposer un call de 15 min entre pairs. " +
      "SIGNAL FAIBLE (réponse polie de surface, 'je développais mon réseau', " +
      "'votre post était inspirant') → message de creusement avec question miroir " +
      "ancrée dans WT. SILENCE après 5-7 jours → relance unique puis sortie propre.",
  },

  // — Templates de message (skeletons, sans voix) —
  {
    kind: "template_skeleton",
    severity: "light",
    text:
      "ICEBREAKER (auto, à l'acceptation) : accroche courte signalant la visite + " +
      "question ouverte courte sur la motivation. 2-3 lignes max. Plusieurs messages " +
      "courts. Tutoiement OU vouvoiement selon la voix du setter.",
  },
  {
    kind: "template_skeleton",
    severity: "light",
    text:
      "RELANCE 1 (J+2) : NOUVELLE observation business issue du TOWS (1-2 phrases) + " +
      "question ouverte courte, différente de celle de l'icebreaker. " +
      "INTERDIT : reformuler l'icebreaker. Apporter un autre angle.",
  },
  {
    kind: "template_skeleton",
    severity: "light",
    text:
      "RELANCE 2 / SORTIE PROPRE (J+4) : message court et classe, porte ouverte pour " +
      "un retour futur. Pas de relance d'effort. Format type : 'pas de souci, je ne " +
      "veux pas encombrer ta messagerie / si un jour le timing est bon, tu sais où " +
      "me trouver / bonne continuation'.",
  },
  {
    kind: "template_skeleton",
    severity: "light",
    text:
      "CREUSEMENT (signal faible) : accroche sur ce que le prospect construit (1 phrase) + " +
      "2-3 éléments précis du TOWS (forces + frein WT) + UNE question miroir ancrée " +
      "dans le WT. Max 6 lignes. UNE seule question. Question fermée (oui/non suffit). " +
      "Citer son business par son nom. Pas de listes à puces.",
  },
  {
    kind: "template_skeleton",
    severity: "light",
    text:
      "PROPOSITION DE CALL (signal fort) : reformuler la douleur exprimée avec SES mots " +
      "(pas les nôtres) + proposer 15 min comme une conversation entre pairs (JAMAIS " +
      "30 min, JAMAIS 1h, JAMAIS démo, JAMAIS pitch d'offre à ce stade) + lien " +
      "calendrier.",
  },

  // — Questions miroir par pattern dominant —
  {
    kind: "pattern",
    severity: "strong",
    text:
      "Question miroir — pattern Founder-centric / CEO opérationnel : " +
      "« est-ce que ton business peut tourner si tu n'es pas là ? »",
  },
  {
    kind: "pattern",
    severity: "strong",
    text:
      "Question miroir — pattern Founder-centric scale : " +
      "« si tu arrêtes de vendre personnellement, les ventes continuent ? »",
  },
  {
    kind: "pattern",
    severity: "strong",
    text:
      "Question miroir — pattern Multi-activités / Portfolio complexity : " +
      "« sur laquelle des trois mises-tu vraiment cette année ? »",
  },
  {
    kind: "pattern",
    severity: "strong",
    text:
      "Question miroir — pattern Repreneur : " +
      "« à quel moment le dirigeant arrête de gérer la transformation pour commencer " +
      "à piloter le business ? »",
  },
  {
    kind: "pattern",
    severity: "strong",
    text:
      "Question miroir — pattern Holding en construction / Brand vs operating : " +
      "« est-ce que ton architecture de pilotage suit la même cadence que ta croissance ? »",
  },
  {
    kind: "pattern",
    severity: "strong",
    text:
      "Question miroir — pattern Vision-to-execution gap : " +
      "« tes équipes sauraient-elles décrire tes priorités pour les 6 prochains mois " +
      "sans te demander ? »",
  },

  // — Do-not (visite_profil-specific) —
  {
    kind: "hard_check",
    severity: "hard",
    text:
      "JAMAIS reformuler un message précédent dans une relance visite_profil. " +
      "Toujours apporter une NOUVELLE observation, un autre angle. " +
      "La relance n'est pas un rappel — c'est un autre angle de conversation.",
  },
  {
    kind: "hard_check",
    severity: "hard",
    text:
      "JAMAIS proposer de call avant le signal fort. Si le prospect n'a pas exprimé " +
      "de douleur ou ouvert sur ses enjeux, on creuse, on ne propose pas de call.",
  },
  {
    kind: "hard_check",
    severity: "hard",
    text:
      "JAMAIS sur-expliquer une question miroir — elle doit rester sèche. " +
      "Sur-expliquer la question la tue.",
  },
];

// ── Nicolas fork content (voice-specific overrides) ──────────────────
// Layered ON TOP of the universal template via parent_template_id. Only
// captures Nicolas-specific voice signals (signature, formules, emojis).
const NICOLAS_FORK_ARTIFACTS = [
  {
    kind: "template_skeleton",
    severity: "strong",
    text:
      "Voix Nicolas — icebreaker visite_profil exact : " +
      "« saalut PRÉNOM\nj'ai remarqué que tu étais passé par mon profil récemment\n" +
      "curieux de savoir ce qui t'a attiré 🙂\nNicolas »",
  },
  {
    kind: "template_skeleton",
    severity: "strong",
    text:
      "Voix Nicolas — sortie propre exacte : " +
      "« pas de souci PRÉNOM, je ne veux pas encombrer ta messagerie\n" +
      "si un jour le timing est bon, tu sais où me trouver\n" +
      "bonne continuation 🙂\nNicolas »",
  },
  {
    kind: "soft_check",
    severity: "strong",
    text:
      "Voix Nicolas — tutoiement par défaut sur visite_profil. " +
      "Adaptation au vouvoiement seulement si le prospect vouvoie en premier dans sa réponse.",
  },
  {
    kind: "soft_check",
    severity: "light",
    text:
      "Voix Nicolas — emojis stratégiquement placés pour adoucir sans perdre le fond : " +
      "🙂 et 😉 essentiellement. Pas de déluge d'emojis. Phrases courtes, ton pair à pair, " +
      "pas consultant.",
  },
  {
    kind: "pattern",
    severity: "strong",
    text:
      "Voix Nicolas — signature toujours « Nicolas » seule, jamais « Nicolas L. » ni " +
      "« Nicolas Lavallée ». Une ligne dédiée à la fin du dernier message du thread, " +
      "pas dans chaque message du thread.",
  },
  {
    kind: "hard_check",
    severity: "hard",
    text:
      "Voix Nicolas — proposition de call : 15 min, jamais 30 ni 1h. " +
      "Formule type : « ce que tu décris, c'est exactement le type de situation où " +
      "en 15 min je peux déjà te partager ce que je vois comme leviers dans ton cas / " +
      "tu serais partant(e) pour un échange rapide cette semaine ? »",
  },
];

// ── Section structure (one per doc, kind=custom for V1) ──────────────
const SECTION_HEADING_TEMPLATE = "Playbook visite_profil — universel";
const SECTION_HEADING_FORK = "Playbook visite_profil — fork Nicolas (voix)";

const SECTION_PROSE_TEMPLATE =
  "Process opérationnel pour les leads issus d'une visite de profil sans demande " +
  "de connexion. Stratégie 'curiosité symétrique' : on inverse la dynamique en " +
  "faisant le premier pas, mais on pose la question sincère 'pourquoi es-tu venu ?'. " +
  "Cadence : 5-7 jours, max 3 touches hors demande de connexion. Avant toute relance, " +
  "SWOT/TOWS sur le profil ; le quadrant WT est le levier. Lecture du signal : fort → " +
  "call ; faible → creusement avec question miroir ancrée WT ; silence → relance unique " +
  "puis sortie propre. Voir artifacts pour les templates de messages, les règles, et " +
  "les questions miroir par pattern dominant.";

const SECTION_PROSE_FORK =
  "Override de voix Nicolas par-dessus le template universel visite_profil. " +
  "Capture la signature, le tutoiement par défaut, les formules d'icebreaker et de " +
  "sortie propre, l'emoji palette (🙂 😉), et le format de proposition de call (15 min " +
  "entre pairs). Hérite du parent_template pour la stratégie, la cadence, et les " +
  "questions miroir.";

// ── Lookup helpers ───────────────────────────────────────────────────
async function findExistingDoc(sb, ownerKind, ownerId) {
  const { data, error } = await sb
    .from("protocol_document")
    .select("id, version, status")
    .eq("owner_kind", ownerKind)
    .eq("owner_id", ownerId)
    .eq("source_core", SOURCE_CORE)
    .eq("status", "active")
    .maybeSingle();
  if (error) return null;
  return data;
}

async function findExistingHashes(sb, documentId) {
  const { data, error } = await sb
    .from("protocol_artifact")
    .select("content_hash, protocol_section!inner(document_id)")
    .eq("protocol_section.document_id", documentId);
  if (error) return new Set();
  return new Set((data || []).map((r) => r.content_hash));
}

// ── Plan builder (pure) ──────────────────────────────────────────────
function buildPlan({ ownerKind, ownerId, parentTemplateId, sectionHeading, sectionProse, artifactSpecs, existingHashes }) {
  const documentId = crypto.randomUUID();
  const sectionId = crypto.randomUUID();

  const document = {
    id: documentId,
    owner_kind: ownerKind,
    owner_id: ownerId,
    version: 1,
    status: "active",
    source_core: SOURCE_CORE,
    parent_template_id: parentTemplateId || null,
    diverged_from_template_at: parentTemplateId ? new Date().toISOString() : null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const section = {
    id: sectionId,
    document_id: documentId,
    order: 0,
    kind: "custom",
    heading: sectionHeading,
    prose: sectionProse,
    structured: null,
    client_visible: ownerKind === "persona", // template = agency-only by default
    client_editable: false,
    author_kind: "user",
  };

  const artifacts = [];
  for (const spec of artifactSpecs) {
    const hash = computeArtifactHash(spec.text);
    if (!hash || existingHashes.has(hash)) continue;
    artifacts.push({
      id: crypto.randomUUID(),
      source_section_id: sectionId,
      source_quote: null,
      kind: spec.kind,
      content: { text: spec.text },
      severity: spec.severity,
      scenarios: null, // applies to all DM_* scenarios for this source
      is_active: true,
      is_manual_override: false,
      content_hash: hash,
      stats: { fires: 0, last_fired_at: null, accuracy: null },
    });
  }

  return { document, sections: [section], artifacts };
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const stats = {
    template_existing: false,
    template_inserted_artifacts: 0,
    nicolas_existing: false,
    nicolas_inserted_artifacts: 0,
  };

  // 1. Universal template
  let template = await findExistingDoc(sb, "template", SYSTEM_TEMPLATE_OWNER_ID);
  if (template) {
    stats.template_existing = true;
    console.log(`✓ Template universel déjà présent (id=${template.id})`);
  } else {
    const plan = buildPlan({
      ownerKind: "template",
      ownerId: SYSTEM_TEMPLATE_OWNER_ID,
      parentTemplateId: null,
      sectionHeading: SECTION_HEADING_TEMPLATE,
      sectionProse: SECTION_PROSE_TEMPLATE,
      artifactSpecs: TEMPLATE_ARTIFACTS,
      existingHashes: new Set(),
    });

    if (dryRun) {
      console.log(`[dry] template universel → +1 doc, +1 section, +${plan.artifacts.length} artifacts`);
      template = plan.document;
    } else {
      const { error: docErr } = await sb.from("protocol_document").insert(plan.document);
      if (docErr) throw new Error(`template doc insert: ${docErr.message}`);
      const { error: secErr } = await sb.from("protocol_section").insert(plan.sections);
      if (secErr) throw new Error(`template section insert: ${secErr.message}`);
      if (plan.artifacts.length > 0) {
        const { error: artErr } = await sb.from("protocol_artifact").insert(plan.artifacts);
        if (artErr) throw new Error(`template artifacts insert: ${artErr.message}`);
      }
      template = plan.document;
      stats.template_inserted_artifacts = plan.artifacts.length;
      console.log(`✓ Template universel créé (id=${template.id}, artifacts=${plan.artifacts.length})`);
    }
  }

  // 2. Nicolas fork
  const { data: nicolas, error: nicErr } = await sb
    .from("personas")
    .select("id, slug, name")
    .eq("slug", NICOLAS_SLUG)
    .maybeSingle();
  if (nicErr || !nicolas) {
    console.error(`✗ Persona Nicolas (slug=${NICOLAS_SLUG}) introuvable`);
    process.exit(1);
  }

  let nicolasDoc = await findExistingDoc(sb, "persona", nicolas.id);
  if (nicolasDoc) {
    stats.nicolas_existing = true;
    console.log(`✓ Fork Nicolas déjà présent (id=${nicolasDoc.id})`);

    // Even if the doc exists, top up artifacts that may have been added since.
    if (!dryRun) {
      const existingHashes = await findExistingHashes(sb, nicolasDoc.id);
      const { data: existingSection } = await sb
        .from("protocol_section")
        .select("id")
        .eq("document_id", nicolasDoc.id)
        .order('"order"')
        .maybeSingle();
      const newArtifacts = [];
      for (const spec of NICOLAS_FORK_ARTIFACTS) {
        const hash = computeArtifactHash(spec.text);
        if (!hash || existingHashes.has(hash)) continue;
        if (!existingSection) break;
        newArtifacts.push({
          id: crypto.randomUUID(),
          source_section_id: existingSection.id,
          source_quote: null,
          kind: spec.kind,
          content: { text: spec.text },
          severity: spec.severity,
          scenarios: null,
          is_active: true,
          is_manual_override: false,
          content_hash: hash,
          stats: { fires: 0, last_fired_at: null, accuracy: null },
        });
      }
      if (newArtifacts.length > 0) {
        const { error: artErr } = await sb.from("protocol_artifact").insert(newArtifacts);
        if (artErr) throw new Error(`nicolas fork top-up: ${artErr.message}`);
        stats.nicolas_inserted_artifacts = newArtifacts.length;
        console.log(`  + ${newArtifacts.length} artifact(s) ajoutés au fork existant`);
      }
    }
  } else {
    const plan = buildPlan({
      ownerKind: "persona",
      ownerId: nicolas.id,
      parentTemplateId: template.id,
      sectionHeading: SECTION_HEADING_FORK,
      sectionProse: SECTION_PROSE_FORK,
      artifactSpecs: NICOLAS_FORK_ARTIFACTS,
      existingHashes: new Set(),
    });

    if (dryRun) {
      console.log(`[dry] fork Nicolas → +1 doc, +1 section, +${plan.artifacts.length} artifacts`);
    } else {
      const { error: docErr } = await sb.from("protocol_document").insert(plan.document);
      if (docErr) throw new Error(`nicolas doc insert: ${docErr.message}`);
      const { error: secErr } = await sb.from("protocol_section").insert(plan.sections);
      if (secErr) throw new Error(`nicolas section insert: ${secErr.message}`);
      if (plan.artifacts.length > 0) {
        const { error: artErr } = await sb.from("protocol_artifact").insert(plan.artifacts);
        if (artErr) throw new Error(`nicolas artifacts insert: ${artErr.message}`);
      }
      stats.nicolas_inserted_artifacts = plan.artifacts.length;
      console.log(`✓ Fork Nicolas créé (id=${plan.document.id}, parent=${template.id}, artifacts=${plan.artifacts.length})`);
    }
  }

  console.log("\nSeed visite_profil :", stats);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { buildPlan, computeArtifactHash, TEMPLATE_ARTIFACTS, NICOLAS_FORK_ARTIFACTS };
