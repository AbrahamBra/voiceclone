#!/usr/bin/env node
/**
 * Seed des 4 playbooks source-specific manquants chez Nicolas, à partir
 * des docs Notion partagés par Abraham :
 *   - dr_recue         (1 section)
 *   - interaction_contenu (1 section)
 *   - premier_degre    (1 section)
 *   - spyer            (1 doc + 5 sections : shared common + Alec/Nina/Margo/Franck/Max)
 *
 * NE TOUCHE PAS visite_profil (déjà seedé via scripts/seed-visite-profil-playbook.js
 * en universal template + Nicolas fork avec parent_template_id).
 *
 * Pattern de chaque playbook : 1 protocol_document (owner_kind='persona',
 * owner_id=Nicolas, source_core=X, status='active') + sections + artifacts
 * hand-crafted depuis le matériau Notion. Pas de template universel pour
 * ces 4 sources (V3+ pourra extraire des templates a posteriori si besoin).
 *
 * Idempotent : skip si un doc actif existe déjà pour la source. Pour
 * re-seeder une source : archiver l'ancien doc d'abord (V2.1 DELETE) ou
 * passer --force.
 *
 * Usage :
 *   node --env-file=<...>/.env scripts/seed-nicolas-source-playbooks.js [--dry-run]
 */

import "dotenv/config";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const NICOLAS_SLUG = "nicolas-lavall-e";

function hashText(text) {
  if (typeof text !== "string") return null;
  const norm = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim();
  if (!norm) return null;
  return crypto.createHash("sha256").update(norm).digest("hex");
}

// Common 10 règles d'or that apply across all Nicolas's source playbooks.
// Inserted in each doc's first section so they're injected regardless of
// which source playbook is loaded. Some duplication with global protocol
// is acceptable for V1 — V3+ will dedupe via cross-doc hash if needed.
const COMMON_RULES = [
  { kind: "hard_check", severity: "hard", text: "JAMAIS pitcher l'offre avant que le prospect ait exprimé une douleur." },
  { kind: "hard_check", severity: "hard", text: "Max 6 lignes par message." },
  { kind: "hard_check", severity: "hard", text: "Ton pair à pair, jamais consultant." },
  { kind: "hard_check", severity: "hard", text: "JAMAIS plus de 3 touches sur une même personne." },
  { kind: "hard_check", severity: "hard", text: "Propose 15 min, jamais 30 ni 1h. C'est un échange entre pairs, pas une démo." },
  { kind: "hard_check", severity: "hard", text: "JAMAIS reformuler un message précédent dans une relance — apporter une NOUVELLE observation." },
  { kind: "hard_check", severity: "hard", text: "Pas de templates génériques (« quels sont vos enjeux pour 2026 ? »)." },
  { kind: "hard_check", severity: "hard", text: "Questions miroir sèches. Sur-expliquer la question la tue." },
];

// ── 1. dr_recue (Demande de connexion reçue) ─────────────────────
const DR_RECUE = {
  source_core: "dr_recue",
  heading: "Playbook DR reçue — curiosité inversée",
  prose: `Source du lead : le prospect a envoyé une demande de connexion. Priorité absolue.
Séquence : 5-7 jours, max 3 touches.

ICEBREAKER — « curiosité inversée » : c'est le prospect qui s'est connecté, pas Nicolas. On lui retourne la question, courte, humaine, sans pitch.
Message 1 (auto à l'acceptation) :
"merxi pour la connexion PRÉNOM
je suis curieux de savoir ce qui t'a amené à faire la demande 🙂
Nicolas"

Cadence : Relance 1 à J+2 (nouvelle observation TOWS + question ouverte différente de l'icebreaker).
Relance 2 à J+4 si toujours rien : sortie propre.

Lecture du signal post-réponse :
- Signal fort (problème concret cité) → proposition call 15 min
- Signal faible (réponse polie surface) → message creusement avec question miroir WT
- Silence après 5-7 jours → relance unique puis sortie propre

CREUSEMENT (signal faible) : accroche sur ce qu'il construit + 2-3 éléments TOWS + UNE question miroir ancrée WT. Max 6 lignes, citer son business par son nom, pas de listes à puces.

PROPOSITION DE CALL (signal fort) : reformuler avec SES mots + 15 min entre pairs. JAMAIS parler de l'offre à ce stade.

SORTIE PROPRE (texte fixe) :
"pas de souci PRÉNOM, je ne veux pas encombrer ta messagerie
si un jour le timing est bon, tu sais où me trouver
bonne continuation 🙂
Nicolas"`,
  artifacts: [
    { kind: "pattern", severity: "strong", text: "Stratégie icebreaker dr_recue : 'curiosité inversée'. Le prospect s'est connecté de lui-même, pas Nicolas. On lui retourne la question : pourquoi t'es venu ? Court, humain, sans pitch." },
    { kind: "state_transition", severity: "strong", text: "Cadence dr_recue : 5-7 jours, max 3 touches. Relance 1 à J+2 si pas de réponse à l'icebreaker. Relance 2 à J+4 → sortie propre." },
    { kind: "template_skeleton", severity: "strong", text: "Voix Nicolas — icebreaker dr_recue exact :\n« merxi pour la connexion PRÉNOM\nje suis curieux de savoir ce qui t'a amené à faire la demande 🙂\nNicolas »" },
    { kind: "template_skeleton", severity: "light", text: "Relance 1 dr_recue (J+2) : nouvelle observation business issue du TOWS (1-2 phrases) + question ouverte courte différente de l'icebreaker. Pas de répétition. Plusieurs messages courts." },
    { kind: "template_skeleton", severity: "light", text: "Sortie propre dr_recue : message fixe court et classe. « pas de souci PRÉNOM, je ne veux pas encombrer ta messagerie / si un jour le timing est bon, tu sais où me trouver / bonne continuation 🙂 / Nicolas »" },
    { kind: "decision_row", severity: "strong", text: "Lecture signal après réponse dr_recue : SIGNAL FORT (douleur citée) → proposition call 15 min. SIGNAL FAIBLE (réponse polie surface) → creusement avec question miroir WT. SILENCE 5-7j → relance unique puis sortie propre." },
    { kind: "pattern", severity: "strong", text: "Avant tout message de creusement dr_recue : exécuter SWOT/TOWS sur le profil LinkedIn. Le quadrant WT est TOUJOURS le levier de conversation." },
    ...COMMON_RULES,
  ],
};

// ── 2. interaction_contenu (Like / commentaire sur post Nicolas) ──
const INTERACTION_CONTENU = {
  source_core: "interaction_contenu",
  heading: "Playbook interaction de contenu — rebond sur le post",
  prose: `Source du lead : quelqu'un a liké un post de Nicolas. Le contenu du post est le levier d'entrée — on rebondit dessus.
Séquence : 7-10 jours, max 3 touches (hors note de connexion si nécessaire).

Étape préalable : si pas encore connectés, demande de connexion sans message (meilleur acceptance rate).

ICEBREAKER — « rebond sur le post » : identifier précisément le post liké. JAMAIS « merci pour ton like » sans citer le sujet — sinon ça sent le template.
Message 1 :
"saluyt PRÉNOM merci pour ton appui sur mon post SUJET DU POST
curieux de savoir ce qui t'a parlé dedans 🙂
à te lire,
Nicolas"

Cadence : Relance 1 à J+2 (nouvelle observation, ouvre un autre angle). Relance 2 à J+4 si silence : sortie propre.

Spécifique interaction_contenu : le post qui a déclenché l'interaction est un bon indicateur du pattern dominant. Like sur post « plafond de verre » = probablement Founder-centric. Like sur post « 3 offres en parallèle » = Portfolio complexity. À intégrer dans l'analyse.

CREUSEMENT (signal faible) : si possible, lier le creusement au post qui a déclenché. « Tu as liké mon post sur X — c'est un sujet que tu vis aujourd'hui ? »`,
  artifacts: [
    { kind: "pattern", severity: "strong", text: "Stratégie icebreaker interaction_contenu : rebond sur LE post précis qui a déclenché l'interaction. JAMAIS un message générique 'merci pour ton like'. Toujours ancré sur le sujet du post." },
    { kind: "state_transition", severity: "strong", text: "Cadence interaction_contenu : 7-10 jours, max 3 touches (hors note de connexion). Relance 1 à J+2, Relance 2 à J+4 → sortie propre." },
    { kind: "state_transition", severity: "light", text: "Étape préalable interaction_contenu : si pas encore connectés, demande de connexion sans message (meilleur acceptance rate)." },
    { kind: "template_skeleton", severity: "strong", text: "Voix Nicolas — icebreaker interaction_contenu exact :\n« saluyt PRÉNOM merci pour ton appui sur mon post SUJET DU POST\ncurieux de savoir ce qui t'a parlé dedans 🙂\nà te lire,\nNicolas »" },
    { kind: "pattern", severity: "strong", text: "Spécifique interaction_contenu : le post qui a déclenché l'interaction est un indicateur du pattern dominant. Like sur 'plafond de verre' → probablement Founder-centric. Like sur '3 offres en parallèle' → Portfolio complexity. À intégrer dans l'analyse Claude." },
    { kind: "pattern", severity: "strong", text: "Creusement interaction_contenu : si possible lier la question miroir au post déclencheur. « Tu as liké mon post sur X — c'est un sujet que tu vis aujourd'hui ? »" },
    { kind: "hard_check", severity: "hard", text: "JAMAIS dire 'merci pour ton like' sans citer le sujet du post. C'est le marqueur principal du template générique." },
    ...COMMON_RULES,
  ],
};

// ── 3. premier_degre (Réseau 1er degré) ───────────────────────────
const PREMIER_DEGRE = {
  source_core: "premier_degre",
  heading: "Playbook réseau 1er degré — demande de mise en relation",
  prose: `Source du lead : 1ère relation LinkedIn déjà connectée, jamais (ou peu) échangé en privé. On prend l'initiative à froid sur son propre réseau.

Spécificité : pas de demande de connexion à envoyer, mais aucun trigger préalable côté prospect. Donc le 1er message annonce directement l'objectif sous forme de demande de mise en relation (pas de prospection frontale), avec un asset offert (le diagnostic) pour poser la valeur sans pression.

ICEBREAKER — « demande de mise en relation + diagnostic » :
"helko PRÉNOM, j'active mon réseau et je tente ma chance avec toi 🙂
par hasard tu connais dans ton entourage des infopreneurs qui ont une activité qui marche et qui veulent structurer la suite ?
on a aidé Mohamed Boclet (Boclet Academy) à passer de chef d'entreprise à dirigeant, en débloquant ce qui l'empêchait d'aller plus loin
on les accompagne en 30 jours pour reprendre la main sur leur stratégie et sortir du quotidien opérationnel, si quelqu'un te vient en tête je suis preneur, sinon pas de souci.
Et si t'as 30 secondes, je te partage aussi le diagnostic qu'on fait passer à tous nos clients en démarrage, ça met en lumière ce qui bloque et par où commencer pour débloquer
Nicolas"

Règles strictes :
- Tutoiement par défaut (1er degré).
- 5 lignes pile.
- Toujours citer Mohamed Boclet (Boclet Academy) qualitatif (jamais de chiffre x2 non vérifiable).
- Toujours finir par « sinon pas de souci » : désamorce, augmente le taux de réponse.
- JAMAIS demander un call ou pitcher l'offre dans ce M1.
- Diagnostic flou : on dit « le diagnostic », jamais « le quiz ».
- Diagnostic NE S'ENVOIE JAMAIS dans le M1. On attend le « oui » explicite.

Cadence :
- Relance 1 sur M1 à J+3 : soft bump, pas de reformulation. « PRÉNOM, je rebondis sur mon dernier message, aucune pression, je voulais juste m'assurer que t'avais bien vu passer 🙂 / Nicolas »
- Relance 2 finale à J+7 → sortie propre.

4 scénarios de réponse :
1. Reco donnée → Toggle 7 (Traitement reco)
2. Auto-positionnement (« moi-même je… ») → Creusement
3. Diagnostic accepté → envoi du lien + relance J+5 si silence
4. Silence → soft bump puis sortie propre

Toggle 7 — Traitement d'une reco :
- Étape 1 (immédiat) : « top, merci PRÉNOM ! je vais le contacter de mon côté / je peux me recommander de toi ou tu préfères pas ? / Nicolas »
- Étape 2 : outreach vers le contact (DR avec note recommandée), accélération possible vers call dès le M1 grâce à la reco
- Étape 3 (J+7 à J+14) : boucler la boucle avec le recommandeur. C'est ce qui fait revenir les recos.`,
  artifacts: [
    { kind: "pattern", severity: "strong", text: "Stratégie icebreaker premier_degre : demande de mise en relation, PAS prospection frontale. On demande son réseau (avec preuve sociale Mohamed Boclet + asset diagnostic), jamais son chéquier." },
    { kind: "state_transition", severity: "strong", text: "Cadence premier_degre : Relance 1 soft bump à J+3 (pas de reformulation). Relance 2 finale à J+7 → sortie propre." },
    { kind: "template_skeleton", severity: "strong", text: "Voix Nicolas — icebreaker premier_degre (5 lignes pile) : 'helko PRÉNOM, j'active mon réseau et je tente ma chance avec toi 🙂 / par hasard tu connais dans ton entourage des infopreneurs… / on a aidé Mohamed Boclet (Boclet Academy) à passer de chef d'entreprise à dirigeant… / on les accompagne en 30 jours… / Et si t'as 30 secondes, je te partage aussi le diagnostic… / Nicolas'" },
    { kind: "hard_check", severity: "hard", text: "JAMAIS envoyer le lien du diagnostic dans le M1 premier_degre. Attendre le 'oui' explicite — c'est ce micro-engagement qui débloque la suite." },
    { kind: "hard_check", severity: "hard", text: "JAMAIS appeler le diagnostic 'quiz' ou 'questionnaire' dans les messages — on dit toujours 'le diagnostic'." },
    { kind: "hard_check", severity: "hard", text: "Citer Mohamed Boclet uniquement sur le qualitatif ('passer de chef d'entreprise à dirigeant') — jamais de chiffre x2 ou x3 non vérifiable." },
    { kind: "hard_check", severity: "hard", text: "Toujours finir l'icebreaker premier_degre par 'sinon pas de souci' — désamorce la pression, augmente le taux de réponse." },
    { kind: "decision_row", severity: "strong", text: "4 scénarios de réponse premier_degre : 1) Reco donnée → Toggle 7 (traitement reco). 2) Auto-positionnement ('moi-même je…') → Creusement. 3) Diagnostic accepté → envoi lien + relance J+5. 4) Silence → relance soft à J+3 puis sortie propre J+7." },
    { kind: "template_skeleton", severity: "strong", text: "Soft bump premier_degre (J+3, auto) : 'PRÉNOM, je rebondis sur mon dernier message, aucune pression, je voulais juste m'assurer que t'avais bien vu passer 🙂 / Nicolas'. Pas de reformulation de la demande." },
    { kind: "state_transition", severity: "strong", text: "Toggle 7 — traitement d'une reco premier_degre : 1) Remerciement immédiat + question 'je peux me recommander de toi ?'. 2) Outreach vers le contact recommandé (DR avec note citant le recommandeur). 3) Boucler la boucle avec le recommandeur à J+7-14 — feedback sur l'échange. C'est ce qui fait revenir les recos." },
    { kind: "pattern", severity: "strong", text: "Sur reco premier_degre, on peut accélérer vers le call dès le M1 du contact recommandé : la recommandation joue le rôle de la preuve sociale + déclencheur. Pas besoin de la phase 'curiosité'." },
    { kind: "pattern", severity: "strong", text: "Cas spécifique premier_degre 'hors cible mais réseau pertinent' : si la personne n'est pas elle-même infopreneur mais évolue dans cet écosystème (consultant marketing, agence, freelance qui bosse pour des infopreneurs), c'est un excellent profil pour générer des recos sans être prospectable." },
    ...COMMON_RULES,
  ],
};

// ── 4. spyer (multi-section : 1 shared + 5 instances) ────────────
//
// V2.2 multi-section : 1 doc spyer avec :
//   - Section 0 (order=0)  : "Règles communes spyer" — anti-voyeur, etc.
//   - Sections 1-5         : Spyer Alec / Nina / Margo / Franck / Max — instance-specific
const SPYER_COMMON = {
  source_core: "spyer",
  heading: "Spyer — règles communes (toutes instances)",
  prose: `Spécificités de l'engagement audience concurrent : la personne ne nous connaît pas, n'a pas pris l'initiative du contact, vient juste d'accepter la demande de connexion. L'icebreaker doit paraître 100% naturel et non-voyeur.

Cadence : 7-10 jours, max 3 touches après acceptation de la demande de connexion.

INTERDITS dans le M1 spyer (toutes instances) :
- Dire « j'ai vu que tu commentais des posts sur SUJET »
- Dire « j'ai vu que tu étais actif sur LinkedIn »
- Dire « j'ai vu que tu suivais [concurrent] »
- Citer le concurrent par son nom
- Pitcher l'offre HOM

À FAIRE : rebondir sur un élément volontairement public du profil (boîte, rôle, produit, dernier post). C'est ce que regarde 100% des visiteurs d'un profil → aucun effet voyeur.

Test simple avant d'envoyer : « est-ce que j'aurais pu écrire ce M1 sans avoir ouvert son profil ? » → si oui, message trop générique, recommencer.

Si profil creux (pas de post récent, pas de produit, pas de signal exploitable) → ne pas envoyer. Sauter le profil plutôt qu'un message générique. Garder le fallback générique sous 10% des envois.

ICEBREAKER skeleton (manuel) :
"Helllo PRÉNOM, [REMARQUE — 1 phrase ≤ 120 caractères, ancrée sur UN élément concret du profil]
[QUESTION OUVERTE — UNE seule question, ancrée sur une douleur infopreneur, formulée comme une vraie curiosité de pair à pair]
Nicolas"

Si prospect mentionne explicitement le concurrent : ne JAMAIS critiquer. Reconnaître positivement (« cool, c'est un bon écosystème »). Pivoter vers le complément : « nous on bosse sur un angle un peu différent, plus individuel, sur l'architecture profonde du business — c'est complémentaire ».`,
  artifacts: [
    { kind: "hard_check", severity: "hard", text: "JAMAIS dire 'j'ai vu que tu commentais / suivais / étais actif sur' dans un message spyer. C'est ce qui sent le voyeur et fait braquer." },
    { kind: "hard_check", severity: "hard", text: "JAMAIS citer le concurrent par son nom dans un message spyer (Alec Henry / Nina Ramen / Margo Cunego / Franck Nicolas / Max Piccinini, ni Entrepreneurs.com)." },
    { kind: "hard_check", severity: "hard", text: "JAMAIS critiquer le concurrent quand il est mentionné par le prospect. Reconnaître positivement, puis pivoter vers le complément ('plus individuel, plus stratégique, architecture profonde')." },
    { kind: "pattern", severity: "strong", text: "Toujours rebondir sur un élément public du profil de la personne (boîte, rôle, produit, dernier post) — jamais sur ses interactions sociales. Test : 'j'aurais pu écrire ce M1 sans avoir ouvert son profil ?' → si oui, recommencer." },
    { kind: "hard_check", severity: "hard", text: "Si profil spyer creux (pas de post récent, pas de produit visible, pas de signal exploitable) → ne pas envoyer. Sauter le profil plutôt qu'envoyer du générique. Garder le fallback générique sous 10% des envois." },
    { kind: "state_transition", severity: "strong", text: "Cadence spyer : 7-10 jours, max 3 touches après acceptation de la demande de connexion. Relance 1 à J+2 (nouvelle observation), Relance 2 à J+7 → sortie propre." },
    { kind: "template_skeleton", severity: "strong", text: "Voix Nicolas — icebreaker spyer skeleton :\n'Helllo PRÉNOM, [REMARQUE — 1 phrase ≤ 120 chars, ancrée sur UN élément concret du profil]\n[QUESTION OUVERTE — UNE seule question, ancrée sur une douleur infopreneur, comme une vraie curiosité de pair à pair]\nNicolas'\nINTERDIT : pas d'emoji dans le M1.a (vendrait l'effort)." },
    { kind: "pattern", severity: "strong", text: "Si prospect mentionne explicitement le concurrent dans la conv spyer : reconnaître positivement ('cool, c'est un bon écosystème'). Pivoter complément : 'nous on bosse sur un angle un peu différent, plus individuel, sur l'architecture profonde du business — c'est complémentaire'. Ne pas insister." },
    ...COMMON_RULES,
  ],
};

// Instance-specific sections — most are minimal (just instance label).
// Alec is more elaborate because user gave specific HOM-vs-Entrepreneurs.com positioning.
const SPYER_INSTANCES = [
  {
    heading: "Instance — Spyer Alec Henry",
    prose: `Source : profil scrapé depuis l'audience d'Alec Henry / Entrepreneurs.com (95k followers). Personne ayant commenté, liké ou reposté son contenu.

Faille à exploiter : Entrepreneurs.com est fort en volume / communauté / structuration générale. HOM se positionne en complément premium : plus individuel, plus stratégique, centré sur l'architecture profonde du business.

JAMAIS critiquer Entrepreneurs.com. JAMAIS citer Alec Henry.`,
    artifacts: [
      { kind: "pattern", severity: "strong", text: "Spyer Alec Henry — positionnement HOM vs Entrepreneurs.com : Entrepreneurs.com fort en volume/communauté/structuration générale. HOM = complément premium, plus individuel, plus stratégique, architecture profonde du business. JAMAIS critiquer Entrepreneurs.com." },
    ],
  },
  {
    heading: "Instance — Spyer Nina Ramen",
    prose: "Source : profil scrapé depuis l'audience de Nina Ramen. Personne ayant commenté, liké ou reposté son contenu. JAMAIS critiquer ou citer Nina Ramen.",
    artifacts: [
      { kind: "pattern", severity: "light", text: "Spyer Nina Ramen — lead issu de son audience. JAMAIS la citer. Beaucoup de profils dans son audience sont eux-mêmes coachs/consultants — traiter en pair à pair si concerné." },
    ],
  },
  {
    heading: "Instance — Spyer Margo Cunego",
    prose: "Source : profil scrapé depuis l'audience de Margo Cunego. Personne ayant commenté, liké ou reposté son contenu. JAMAIS critiquer ou citer Margo Cunego.",
    artifacts: [
      { kind: "pattern", severity: "light", text: "Spyer Margo Cunego — lead issu de son audience. JAMAIS la citer. Profils audience souvent coachs/consultants — pair à pair si concerné." },
    ],
  },
  {
    heading: "Instance — Spyer Franck Nicolas",
    prose: "Source : profil scrapé depuis l'audience de Franck Nicolas. Personne ayant commenté, liké ou reposté son contenu. JAMAIS critiquer ou citer Franck Nicolas.",
    artifacts: [
      { kind: "pattern", severity: "light", text: "Spyer Franck Nicolas — lead issu de son audience. JAMAIS le citer. Profils audience souvent coachs/consultants — pair à pair si concerné." },
    ],
  },
  {
    heading: "Instance — Spyer Max Piccinini",
    prose: "Source : profil scrapé depuis l'audience de Max Piccinini. Personne ayant commenté, liké ou reposté son contenu. JAMAIS critiquer ou citer Max Piccinini.",
    artifacts: [
      { kind: "pattern", severity: "light", text: "Spyer Max Piccinini — lead issu de son audience. JAMAIS le citer. Profils audience souvent coachs/consultants — pair à pair si concerné." },
    ],
  },
];

// ── Idempotent insert helpers ────────────────────────────────────
async function findActiveDoc(sb, personaId, sourceCore) {
  const { data } = await sb
    .from("protocol_document")
    .select("id")
    .eq("owner_kind", "persona")
    .eq("owner_id", personaId)
    .eq("status", "active")
    .eq("source_core", sourceCore)
    .maybeSingle();
  return data || null;
}

async function insertPlaybook(sb, personaId, spec, dryRun) {
  const documentId = crypto.randomUUID();
  const sectionId = crypto.randomUUID();
  const now = new Date().toISOString();

  const docRow = {
    id: documentId,
    owner_kind: "persona",
    owner_id: personaId,
    version: 1,
    status: "active",
    source_core: spec.source_core,
    created_at: now,
    updated_at: now,
  };
  const sectionRow = {
    id: sectionId,
    document_id: documentId,
    order: 0,
    kind: "custom",
    heading: spec.heading,
    prose: spec.prose,
    structured: null,
    client_visible: false,
    client_editable: false,
    author_kind: "user",
  };

  // Build artifacts with dedup against this section's own list (in case
  // COMMON_RULES gets duplicated by accident in source-specific list).
  const seen = new Set();
  const artifactRows = [];
  for (const a of spec.artifacts) {
    const hash = hashText(a.text);
    if (!hash || seen.has(hash)) continue;
    seen.add(hash);
    artifactRows.push({
      source_section_id: sectionId,
      source_quote: null,
      kind: a.kind,
      content: { text: a.text },
      severity: a.severity,
      content_hash: hash,
      is_active: true,
      is_manual_override: false,
      stats: { fires: 0, last_fired_at: null, accuracy: null },
      scenarios: null,
    });
  }

  if (dryRun) {
    return { docRow, sectionRow, artifactRows, dry: true };
  }

  const { error: docErr } = await sb.from("protocol_document").insert(docRow);
  if (docErr) throw new Error(`doc insert (${spec.source_core}): ${docErr.message}`);
  const { error: secErr } = await sb.from("protocol_section").insert(sectionRow);
  if (secErr) throw new Error(`section insert (${spec.source_core}): ${secErr.message}`);
  if (artifactRows.length > 0) {
    const { error: artErr } = await sb.from("protocol_artifact").insert(artifactRows);
    if (artErr) throw new Error(`artifacts insert (${spec.source_core}): ${artErr.message}`);
  }

  return { document_id: documentId, section_id: sectionId, artifacts_count: artifactRows.length };
}

// For spyer multi-section : after the common doc is created, append the
// 5 instance sections to it. Dedup against ALL prior artifacts of the doc
// to avoid duplicating common rules into instance sections.
async function appendInstanceSection(sb, documentId, instance, order, dryRun) {
  const sectionId = crypto.randomUUID();
  const sectionRow = {
    id: sectionId,
    document_id: documentId,
    order,
    kind: "custom",
    heading: instance.heading,
    prose: instance.prose,
    structured: null,
    client_visible: false,
    client_editable: false,
    author_kind: "user",
  };

  // Existing hashes across all sections of this doc, for dedup.
  let existingHashes = new Set();
  if (!dryRun) {
    const { data: docSections } = await sb
      .from("protocol_section").select("id").eq("document_id", documentId);
    const sectionIds = (docSections || []).map((s) => s.id);
    if (sectionIds.length > 0) {
      const { data: arts } = await sb
        .from("protocol_artifact").select("content_hash").in("source_section_id", sectionIds);
      existingHashes = new Set((arts || []).map((a) => a.content_hash).filter(Boolean));
    }
  }

  const artifactRows = [];
  for (const a of instance.artifacts) {
    const hash = hashText(a.text);
    if (!hash || existingHashes.has(hash)) continue;
    existingHashes.add(hash);
    artifactRows.push({
      source_section_id: sectionId,
      source_quote: null,
      kind: a.kind,
      content: { text: a.text },
      severity: a.severity,
      content_hash: hash,
      is_active: true,
      is_manual_override: false,
      stats: { fires: 0, last_fired_at: null, accuracy: null },
      scenarios: null,
    });
  }

  if (dryRun) {
    return { sectionRow, artifactRows, dry: true };
  }

  const { error: secErr } = await sb.from("protocol_section").insert(sectionRow);
  if (secErr) throw new Error(`spyer section insert (${instance.heading}): ${secErr.message}`);
  if (artifactRows.length > 0) {
    const { error: artErr } = await sb.from("protocol_artifact").insert(artifactRows);
    if (artErr) throw new Error(`spyer artifacts (${instance.heading}): ${artErr.message}`);
  }
  return { section_id: sectionId, order, artifacts_count: artifactRows.length };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: nicolas, error: nErr } = await sb
    .from("personas").select("id, slug, name").eq("slug", NICOLAS_SLUG).maybeSingle();
  if (nErr || !nicolas) {
    console.error(`Nicolas (slug=${NICOLAS_SLUG}) introuvable`);
    process.exit(1);
  }
  console.log(`Persona: ${nicolas.name} (${nicolas.id})`);

  const stats = { skipped: [], inserted: [] };

  // 4 single-section playbooks.
  for (const spec of [DR_RECUE, INTERACTION_CONTENU, PREMIER_DEGRE]) {
    const existing = await findActiveDoc(sb, nicolas.id, spec.source_core);
    if (existing && !force) {
      stats.skipped.push(`${spec.source_core} (active doc id=${existing.id})`);
      console.log(`✓ ${spec.source_core} déjà actif → skip`);
      continue;
    }
    const out = await insertPlaybook(sb, nicolas.id, spec, dryRun);
    stats.inserted.push(`${spec.source_core}: ${dryRun ? `[dry] +1 doc, +1 section, +${out.artifactRows.length} artifacts` : `id=${out.document_id}, ${out.artifacts_count} artifacts`}`);
    console.log(`✓ ${spec.source_core} ${dryRun ? "[dry]" : "inséré"}`);
  }

  // Spyer : 1 doc + 5 instance sections.
  const existingSpyer = await findActiveDoc(sb, nicolas.id, "spyer");
  if (existingSpyer && !force) {
    stats.skipped.push(`spyer (active doc id=${existingSpyer.id})`);
    console.log(`✓ spyer déjà actif → skip`);
  } else {
    // First : the common section (order=0).
    const commonOut = await insertPlaybook(sb, nicolas.id, SPYER_COMMON, dryRun);
    const docId = dryRun ? commonOut.docRow.id : commonOut.document_id;
    console.log(`✓ spyer ${dryRun ? "[dry]" : "inséré"} (doc id=${docId})`);
    // Then : 5 instance sections (orders 1..5).
    for (let i = 0; i < SPYER_INSTANCES.length; i++) {
      const instance = SPYER_INSTANCES[i];
      const out = await appendInstanceSection(sb, docId, instance, i + 1, dryRun);
      console.log(`  + ${instance.heading} ${dryRun ? `[dry] +${out.artifactRows.length} artifacts` : `(${out.artifacts_count} artifacts)`}`);
    }
    stats.inserted.push(`spyer: 1 doc + ${1 + SPYER_INSTANCES.length} sections`);
  }

  console.log("\n── Résumé ──");
  console.log("Skip :", stats.skipped.length === 0 ? "aucun" : stats.skipped);
  console.log("Inséré :", stats.inserted.length === 0 ? "aucun" : stats.inserted);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { DR_RECUE, INTERACTION_CONTENU, PREMIER_DEGRE, SPYER_COMMON, SPYER_INSTANCES };
