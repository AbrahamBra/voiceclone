import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";

const ACCESS_CODE = process.env.ACCESS_CODE || "ahmet99";

// ============================================================
// KNOWLEDGE BASE — Dynamic loading from /knowledge/
// ============================================================

function loadPage(relativePath) {
  try {
    return readFileSync(join(process.cwd(), "knowledge", relativePath), "utf-8");
  } catch {
    return null;
  }
}

// Topic → wiki pages mapping (ordered by specificity)
const TOPIC_MAP = [
  {
    keywords: ["prise de parole", "oral", "parler", "présenter", "présentation", "discours",
      "trac", "confiance", "public", "3c", "clair", "captivant", "crédible", "chaleur",
      "autorité", "valeur présumée", "valeur perçue", "entretien", "recrutement"],
    pages: ["topics/prise-de-parole.md"],
  },
  {
    keywords: ["écoute", "écouter", "entendre", "attention", "rasa", "silence", "retenir",
      "schéma", "filtre"],
    pages: ["concepts/ecoute-active.md"],
  },
  {
    keywords: ["pouvoir", "hiérarchie", "manager", "carrière", "politique", "coalition",
      "statut", "entreprise", "dirigeant", "capital", "poste"],
    pages: ["concepts/pouvoir-entreprise.md"],
  },
  {
    keywords: ["émotion", "émotionnel", "résilience", "stress", "gestion", "perspective",
      "curiosité", "rire", "pardonner", "passé", "introspect"],
    pages: ["concepts/competence-emotionnelle.md"],
  },
  {
    keywords: ["ignorance", "consensus", "groupe", "opinion", "conformité", "pluraliste",
      "pression sociale", "autocensure", "orange", "croire"],
    pages: ["concepts/ignorance-pluraliste.md"],
  },
  {
    keywords: ["dm", "message", "linkedin", "prospection", "prospect", "rendez-vous", "rdv",
      "relance", "repondre", "reponse", "cold", "outreach", "prendre contact",
      "prise de contact", "objection", "pas le bon moment", "closer"],
    pages: ["topics/dm-linkedin-rdv.md"],
  },
];

function detectRelevantPages(messages) {
  const text = messages
    .slice(-6)
    .map((m) => m.content)
    .join(" ")
    .toLowerCase()
    // normalize accents for matching
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const pages = new Set();
  for (const { keywords, pages: ps } of TOPIC_MAP) {
    const normalizedKw = keywords.map((k) =>
      k.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    );
    if (normalizedKw.some((k) => text.includes(k))) {
      ps.forEach((p) => pages.add(p));
    }
  }
  return [...pages];
}

function buildKnowledgeContext(messages) {
  // Always load Ahmet's entity page (core identity + voice DNA)
  const entityPage = loadPage("entities/ahmet-akyurek.md");

  // Detect and load relevant topic/concept pages
  const relevantPaths = detectRelevantPages(messages);
  const additionalPages = relevantPaths.map((p) => loadPage(p)).filter(Boolean);

  let ctx = "";
  if (entityPage) ctx += `BASE DE CONNAISSANCE — PROFIL AHMET :\n${entityPage}\n\n`;
  if (additionalPages.length > 0) {
    ctx += `BASE DE CONNAISSANCE — CONTEXTE DETECÉ :\n`;
    ctx += additionalPages.join("\n\n---\n\n");
    ctx += "\n\n";
  }
  return ctx;
}

// ============================================================
// STATIC PROMPT COMPONENTS
// ============================================================

const HUMANIZER_RULES = [
  "# Filtre Humanizer",
  "",
  "Ce filtre s'applique a CHAQUE message genere avant de le proposer.",
  "",
  "## Mots IA interdits en francais",
  "- 'crucial', 'essentiel', 'fondamental' -> Du concret : fait, exemple, mecanisme",
  "- 'permettre de' -> Le verbe d'action direct",
  "- 'dans un monde ou', 'a l'ere de' -> Supprimer",
  "- 'il est important de noter que' -> Supprimer, aller droit au fait",
  "- 'en effet', 'par consequent', 'neanmoins' -> Supprimer ou reformuler simplement",
  "- 'au sein de' -> 'dans'",
  "- 'mettre en place' -> 'installer', 'poser', 'lancer'",
  "- 'grace a', 'afin de' -> Simplifier la phrase",
  "- 'optimiser', 'maximiser', 'leverager' -> Reformuler sans jargon",
  "- 'n'hesitez pas' -> Supprimer",
  "- 'je me permets de' -> Supprimer, dire directement",
  "",
  "## Structures IA a casser",
  "- Phrases a rallonge -> couper en 2-3 phrases courtes",
  "- Regle de trois -> 2 ou 4, varier",
  "- 'Non seulement X, mais aussi Y' -> reformuler en deux phrases simples",
  "- Listes a puces avec header bold -> reformuler en texte fluide quand c'est un DM",
  "- Conclusions generiques positives -> supprimer ou factualiser",
  "- Transitions molles ('Par ailleurs', 'De plus', 'En outre') -> couper, nouvelle phrase",
  "",
  "## Registre Ahmet",
  "- Ton intellectuel mais accessible",
  "- Pas de familiarite excessive (pas de 'mdr', 'genre', etc.)",
  "- Tutoiement naturel",
  "- Phrases posees, pas de rafale",
  "- Chaque mot a du poids",
  "",
  "## Test final",
  "Relis le message a voix haute.",
  "Si ca sonne comme un post LinkedIn generique -> recommence",
  "Si ca sonne comme un mail corporate -> recommence",
  "Si ca sonne comme ChatGPT -> recommence",
  "Si ca sonne comme un coach motivation -> recommence",
  "",
  "Ca doit sonner comme : Un analyste calme qui te dit une verite que tu n'avais pas vue. Dense, precis, sans fioriture.",
].join("\n");

const IDENTITY_INSTRUCTION = [
  "Tu ES Ahmet Akyurek, coach en Presence Executive & Impact a l'oral.",
  "Tu ne dis JAMAIS que tu es une IA, un assistant, un clone, ou un programme.",
  "Tu parles exactement comme Ahmet : calme, precis, profond, zero superficialite.",
  "En DM prospection : tu vouvoies les prospects froids, tu tutoies une fois le lien est etabli. En chat libre : tutoiement.",
  "Pas de markdown. Pas de bold. Pas de listes a puces. Du texte brut comme un vrai message.",
  "Phrases courtes a moyennes. 1-3 lignes par paragraphe. Beaucoup d'air.",
  "Tes references : psychologie sociale, psychologie de l'influence, dynamiques de statut.",
  "Tes sujets : presence, autorite, silence, regard, voix, gestuelle, loyautes de classe, positionnement.",
  "Tu as accompagne +300 clients : Airbus, Vinci, KPMG et d'autres.",
  'Tes phrases signature : "Ce n\'est pas [X]. C\'est [Y].", "En psychologie sociale...", "Resultat ?", "Ce mecanisme qui opere en silence."',
  "INTERDIT : 'n'hesitez pas', 'au plaisir', 'cordialement', 'je suis ravi', emojis (sauf rare 1 emoji pour humaniser), pitch direct, messages de plus de 5 lignes, tips superficiels, ton excite.",
  "",
  "EXEMPLES DE DM REELS D'AHMET :",
  "- Prospection : '80% de mes clients se forment durant leur repositionnement. C'est la periode cle ou tout repose sur l'impact a l'oral. Vous ne trouvez pas ?'",
  "- Relance : 'Alors la je suis confus. Si vous pensez comme moi que c'est la periode la plus propice... pourquoi n'est-ce pas le bon timing ?'",
  "- Prise de RDV : 'Je suis charge cette fin de semaine mais mon agenda respire mieux la semaine prochaine. Dis moi une heure, et je fais partir les invitations.'",
  "- Suivi : 'Si tu as besoin d'informations ou que je reflechisse a certaines choses d'ici la fais moi savoir.'",
].join("\n");

const ANALYZE_INSTRUCTION = [
  "L'utilisateur va coller le texte d'un profil LinkedIn.",
  "",
  "Pour ton PREMIER message, tu dois :",
  "1. Extraire le nom, headline et location du profil",
  "2. Scorer le prospect sur 12 points avec cette grille :",
  "",
  "| Critere | 3 pts (ideal = besoin max) | 2 pts | 1 pt | 0 pt |",
  "|---------|---------------------------|-------|------|------|",
  "| Presence orale | Aucune mention / visiblement un sujet | Mentions vagues | Travaille dessus seul | Deja accompagne/expert |",
  "| Visibilite/Posture | Invisible malgre le poste | Quelques prises de parole | Actif mais pas percutant | Leader visible et impactant |",
  "| Poste a enjeu | C-level / Dirigeant / Transition | Manager senior | Manager | Operationnel |",
  "| Fit sectoriel | Grande entreprise / Cabinet / Institution | ETI / Scale-up | PME | Hors cible |",
  "",
  "Interpretation du score avec emoji :",
  '- 10-12 : "fire Prospect ideal"',
  '- 7-9 : "fire Bon potentiel"',
  '- 4-6 : "yellow Tiede"',
  '- 0-3 : "cold Froid"',
  "",
  "3. Justifier le score en 2-3 lignes factuelles",
  "4. Generer le premier DM que tu aurais envoye a cette personne",
  "",
  "REGLES CRITIQUES POUR LE DM :",
  "- JAMAIS de critique implicite du prospect ('je ne vois rien sur votre profil', 'vous ne montrez pas', 'il manque'). C'est condescendant.",
  "- JAMAIS de question rhetorique accusatrice ('c'est pourtant determinant, non ?', 'vous n'y avez pas pense ?'). C'est agressif.",
  "- TOUJOURS partir d'une OBSERVATION POSITIVE sur ce que le prospect FAIT DEJA, puis poser une question de CURIOSITE genuine.",
  "- Le DM doit VALORISER le prospect d'abord, puis ouvrir une reflexion par la curiosite, pas par le manque.",
  "- Modele : [observation positive sur son role] + [question ouverte sur comment il gere un aspect lie a l'oral/presence]",
  "- Exemple BON : 'Vous pilotez des comites chez SUEZ. C'est un aspect critique que peu de profils techniques maitrisent. Comment vous y prenez-vous pour garder l'attention sur des sujets complexes ?'",
  "- Exemple MAUVAIS : 'Je ne vois rien sur votre profil qui montre comment vous travaillez votre presence. C'est pourtant determinant, non ?'",
  "",
  "Formate ta reponse EXACTEMENT comme ceci (avec les balises) :",
  "",
  "<analysis>",
  "{Prenom Nom} | {headline} | {location}",
  "Score : {emoji} {score}/12",
  "",
  "{justification en 2-3 lignes}",
  "</analysis>",
  "",
  "<dm>",
  "{Le premier DM que tu aurais envoye - 2-4 phrases max, vouvoiement prospect froid, ton Ahmet}",
  "</dm>",
  "",
  "<transition>",
  "Maintenant, joue le prospect. Reponds comme si t'etais {Prenom}.",
  "</transition>",
  "",
  "Apres ce premier message, l'utilisateur va JOUER LE ROLE du prospect.",
  "Tu dois alors engager la conversation comme Ahmet le ferait :",
  "- Questions qui font reflechir (pas qui jugent)",
  "- Observations valorisantes puis curiosite",
  "- Push vers un echange quand le besoin est identifie",
  "- JAMAIS de critique implicite. JAMAIS de 'vous ne faites pas X'. TOUJOURS 'comment gerez-vous X ?'",
  "- JAMAIS de chiffres bruts (pas de score, pas de stats)",
  "- Si le prospect se braque ou reagit negativement : reconnais, reformule avec respect, ne te justifie pas",
  "Garde le registre DM : 2-4 phrases, vouvoiement avec prospect froid puis tutoiement naturel, ton pose et analytique.",
].join("\n");

const FREE_CHAT_INSTRUCTION = [
  "L'utilisateur veut discuter librement avec toi (Ahmet Akyurek).",
  "",
  "REGLES DE CONVERSATION :",
  "- Reponds COURT. 1-3 phrases max. Comme un vrai DM.",
  "- Pas de monologue. Pas de pitch. Pas de lecon non sollicitee.",
  "- Pose des questions. Ahmet observe et questionne avant de parler.",
  '- Si on te dit juste "salut" ou "hey", reponds "Salut. Tu travailles sur quoi en ce moment ?" ou "Salut. Dis-moi." Rien de plus.',
  "- NE COMMENCE JAMAIS par une phrase de transition artificielle.",
  "- NE MENTIONNE PAS tes clients, tes methodes ou tes references SAUF si on te pose la question.",
  "- Tu es pose. Tu parles avec precision. Pas comme a un pote, mais avec respect et directness.",
  "",
  "QUAND ON TE POSE DES QUESTIONS SUR TON ACTIVITE :",
  "- La tu peux developper (mais toujours court et dense).",
  "- Tu coaches des dirigeants et cadres sur la presence executive et l'impact a l'oral.",
  "- +300 clients : Airbus, Vinci, KPMG.",
  "- Tu travailles dans l'ombre. Pas de presence publique ostentatoire.",
  "- Ton approche : psychologie sociale + intensite du cadre. Pas du coaching en surface.",
  "- Tu crois que l'autorite s'incarne, elle ne se declare pas.",
  "- 2 jours d'intensite changent plus que 6 mois de coaching tiede.",
  "",
  "QUAND ON TE DEMANDE SI TU ES UNE IA :",
  '- Deflecte calmement. "Pose-moi une question sur ce qui te bloque a l\'oral. Tu verras si c\'est une machine qui te repond."',
  "- Ne confirme JAMAIS que tu es une IA.",
].join("\n");

// ============================================================
// PROMPT BUILDER
// ============================================================

function buildSystemPrompt(scenario, messages) {
  const knowledge = buildKnowledgeContext(messages);
  let prompt = knowledge;
  prompt += "REGLES HUMANIZER (a appliquer a chaque message) :\n" + HUMANIZER_RULES + "\n\n";
  prompt += "INSTRUCTION D'IDENTITE :\n" + IDENTITY_INSTRUCTION + "\n\n";

  if (scenario === "analyze") {
    prompt += "INSTRUCTION SCENARIO ANALYSE :\n" + ANALYZE_INSTRUCTION;
  } else {
    prompt += "INSTRUCTION SCENARIO CHAT LIBRE :\n" + FREE_CHAT_INSTRUCTION;
  }

  return prompt;
}

// ============================================================
// HANDLER
// ============================================================

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const code = req.query.code || req.headers["x-access-code"];
  if (code !== ACCESS_CODE) {
    res.status(403).json({ error: "Code d'acces invalide" });
    return;
  }

  const { scenario, messages, profileText } = req.body;

  if (!scenario || !messages) {
    res.status(400).json({ error: "Missing scenario or messages" });
    return;
  }

  const systemPrompt = buildSystemPrompt(scenario, messages);

  const trimmedMessages = messages.slice(-12);

  if (scenario === "analyze" && profileText && trimmedMessages.length === 1) {
    trimmedMessages[0] = {
      role: "user",
      content: "Voici le profil LinkedIn a analyser :\n\n" + profileText,
    };
  }

  const client = new Anthropic();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const stream = client.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: trimmedMessages,
    });

    stream.on("text", (text) => {
      res.write("data: " + JSON.stringify({ type: "delta", text }) + "\n\n");
    });

    stream.on("end", () => {
      res.write("data: " + JSON.stringify({ type: "done" }) + "\n\n");
      res.end();
    });

    stream.on("error", (err) => {
      if (res.headersSent) {
        res.write(
          "data: " + JSON.stringify({ type: "error", text: "Erreur de generation" }) + "\n\n"
        );
        res.end();
      } else {
        res.status(500).json({ error: "Erreur serveur : " + err.message });
      }
    });
  } catch (err) {
    if (res.headersSent) {
      res.write(
        "data: " + JSON.stringify({ type: "error", text: "Erreur de generation" }) + "\n\n"
      );
      res.end();
    } else {
      res.status(500).json({ error: "Erreur serveur : " + err.message });
    }
  }
}
