import Anthropic from "@anthropic-ai/sdk";
import { authenticateRequest, supabase, getApiKey, logUsage, checkBudget, setCors } from "../lib/supabase.js";
import { isEmbeddingAvailable, chunkText, embedAndStore } from "../lib/embeddings.js";
import { extractEntitiesFromContent } from "../lib/graph-extraction.js";

const CLONE_SYSTEM_PROMPT = `Tu es un expert en personal branding et analyse de style d'ecriture LinkedIn.
On te donne le profil LinkedIn d'une personne, ses posts, et optionnellement de la documentation.
Analyse son style et genere une configuration de clone IA au format JSON.

Le JSON doit avoir EXACTEMENT cette structure (rien d'autre, pas de texte avant/apres) :
{
  "name": "Prenom uniquement",
  "title": "Titre court",
  "avatar": "XX",
  "description": "Description courte de l'expertise",
  "voice": {
    "tone": ["3-5 adjectifs"],
    "personality": ["3-5 traits"],
    "signaturePhrases": ["5-8 phrases que la personne utilise souvent dans ses posts"],
    "forbiddenWords": ["mots que cette personne n'utiliserait jamais"],
    "neverDoes": ["5-8 anti-patterns observes"],
    "writingRules": ["8-12 regles d'ecriture extraites des posts"]
  },
  "scenarios": {
    "default": { "label": "Conversation", "description": "Discutez avec {name}", "welcome": "Message d'accueil personnalise" },
    "post": { "label": "Creer un post LinkedIn", "description": "{name} vous aide a ecrire un post LinkedIn", "welcome": "Message d'accueil pour la creation de post" }
  },
  "theme": { "accent": "#couleur adaptee au branding", "background": "#0a0a0a", "surface": "#141414", "text": "#e5e5e5" }
}

IMPORTANT : Le nom doit etre le PRENOM uniquement (pas le nom de famille). Analyse les posts en profondeur pour extraire les vrais patterns, pas du generique.`;

const STYLE_ANALYSIS_PROMPT = `Tu es un analyste de style d'ecriture LinkedIn.
Analyse les posts suivants et genere un document markdown detaille sur le style d'ecriture.
Inclus :
- Patterns d'accroche (avec exemples reels des posts)
- Structure type des posts
- Ton et registre
- Formules et expressions recurrentes
- Themes recurrents
- Ce que la personne ne fait JAMAIS
- Longueur moyenne des posts
- Type de CTAs utilises

Commence le document par un frontmatter YAML avec les keywords pertinents :
---
keywords: ["post", "poster", "ecrire", "rediger", "contenu", "publication", "linkedin"]
---

Ecris en francais. Sois precis et cite des exemples reels des posts.`;

const DM_ANALYSIS_PROMPT = `Tu es un analyste de style de communication LinkedIn.
Analyse les conversations DM (messages directs) suivantes et génère un document markdown détaillé sur le style de conversation 1:1.
Inclus :
- Style d'ouverture (comment cette personne initie ou répond au premier contact)
- Ton dans les échanges privés (vs posts publics)
- Longueur et rythme typiques des messages
- Formules et expressions récurrentes en DM
- Comment elle gère les objections ou questions
- Patterns de qualification (quelles questions elle pose, dans quel ordre)
- Style des CTAs et relances
- Ce qu'elle ne fait JAMAIS en DM

Commence par un frontmatter YAML :
---
keywords: ["dm", "message", "conversation", "qualification", "prospection", "réponse", "relance", "rdv", "appel"]
---

Écris en français. Cite des exemples réels tirés des conversations.`;

const ONTOLOGY_PROMPT = `Tu es un expert en extraction de connaissances et en ontologie.
Analyse le profil et les posts suivants. Extrais les ENTITES et RELATIONS cles qui definissent la pensee de cette personne.

Types d'entites : concept, framework, person, company, metric, belief, tool
Types de relations : equals (A = B), includes (A contient B), contradicts (A s'oppose a B), causes (A provoque B), uses (A utilise B), prerequisite (A necessite B)

Reponds UNIQUEMENT en JSON valide :
{
  "entities": [
    { "name": "nom de l'entite", "type": "concept|framework|...", "description": "description courte" }
  ],
  "relations": [
    { "from": "nom entite source", "to": "nom entite cible", "type": "equals|includes|...", "description": "explication de la relation" }
  ]
}

Sois EXHAUSTIF. Extrais TOUTES les entites et relations pertinentes — il n'y a pas de limite. Plus tu en extrais, mieux c'est. Chaque concept, croyance, outil, methode, personne, entreprise mentionnee doit etre capturee. Les entites doivent refleter les concepts UNIQUES de cette personne, pas des generalites.`;

export default async function handler(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  let client;
  try {
    const auth = await authenticateRequest(req);
    if (auth.isAdmin) {
      client = null; // admin can create freely
    } else {
      client = auth.client;
      // Check clone limit
      const { count } = await supabase
        .from("personas")
        .select("id", { count: "exact", head: true })
        .eq("client_id", client.id);
      if (count >= client.max_clones) {
        res.status(403).json({ error: "Limite de clones atteinte", max: client.max_clones });
        return;
      }
      // Check budget
      const budget = checkBudget(client);
      if (!budget.allowed) {
        res.status(402).json({ error: "Budget depasse", action: "add_api_key" });
        return;
      }
    }
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  let { linkedin_text, posts, dms, documents, name, cloneType } = req.body || {};

  const validTypes = ['posts', 'dm', 'both'];
  if (cloneType && !validTypes.includes(cloneType)) {
    res.status(400).json({ error: "cloneType must be 'posts', 'dm', or 'both'" });
    return;
  }

  if (!linkedin_text || typeof linkedin_text !== "string" || linkedin_text.length < 50) {
    res.status(400).json({ error: "linkedin_text required (min 50 chars)" });
    return;
  }
  if (cloneType !== 'dm' && (!posts || !Array.isArray(posts) || posts.length < 3)) {
    res.status(400).json({ error: "posts required (array, min 3 posts)" });
    return;
  }

  // Keep originals for embedding, cap for Claude calls
  const allPosts = posts || [];
  const allDms = dms || [];
  const allDocuments = documents || "";
  linkedin_text = linkedin_text.slice(0, 8000);
  if (posts) posts = posts.slice(0, 30).map(p => p.slice(0, 3000));
  if (dms) dms = dms.slice(0, 15).map(d => d.slice(0, 4000));
  if (documents) documents = documents.slice(0, 20000);

  const apiKey = getApiKey(client);
  const anthropic = new Anthropic({ apiKey });
  const CLONE_TIMEOUT = 45000; // 45s per Claude call

  try {
    const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";

    const userContent = [
      "PROFIL LINKEDIN :",
      linkedin_text,
    ];

    const postsContentForStyle = posts?.length > 0
      ? posts.map((p, i) => `--- POST ${i + 1} ---\n${p}`).join("\n\n")
      : null;

    if (postsContentForStyle) {
      userContent.push("", "POSTS LINKEDIN (" + posts.length + " posts) :", postsContentForStyle);
    }

    const dmsContent = dms?.length > 0
      ? dms.map((d, i) => `--- CONVERSATION ${i + 1} ---\n${d}`).join("\n\n")
      : null;

    if (dmsContent) {
      userContent.push("", "DMs LINKEDIN :", dmsContent);
    }
    if (documents) {
      userContent.push("", "DOCUMENTATION CLIENT :", documents);
    }

    const withTimeout = (promise) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), CLONE_TIMEOUT)),
    ]);

    const configPromise = withTimeout(anthropic.messages.create({
      model: MODEL, max_tokens: 2048,
      system: CLONE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent.join("\n") }],
    }));

    const stylePromise = cloneType !== 'dm' && postsContentForStyle
      ? withTimeout(anthropic.messages.create({
          model: MODEL, max_tokens: 2048,
          system: STYLE_ANALYSIS_PROMPT,
          messages: [{ role: "user", content: postsContentForStyle }],
        }))
      : Promise.resolve(null);

    const dmPromise = dmsContent
      ? withTimeout(anthropic.messages.create({
          model: MODEL, max_tokens: 2048,
          system: DM_ANALYSIS_PROMPT,
          messages: [{ role: "user", content: dmsContent }],
        }))
      : Promise.resolve(null);

    const [configResult, styleResult, dmResult] = await Promise.all([configPromise, stylePromise, dmPromise]);

    const configRaw = configResult.content[0].text.trim();
    const jsonMatch = configRaw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Failed to parse persona config JSON");
    let personaConfig;
    try {
      personaConfig = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.log(JSON.stringify({ event: "config_parse_error", raw: configRaw.slice(0, 300) }));
      throw new Error("Invalid persona config JSON from Claude");
    }

    if (name) personaConfig.name = name;

    // styleBody declared here so the post-response fire-and-forget can reference it
    let styleBody = null;

    // Step 4: Save to Supabase
    const slug = personaConfig.name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");

    const { data: persona, error: insertErr } = await supabase
      .from("personas")
      .insert({
        slug,
        client_id: client?.id || null,
        type: cloneType || 'both',
        name: personaConfig.name,
        title: personaConfig.title || "",
        avatar: personaConfig.avatar || personaConfig.name.slice(0, 2).toUpperCase(),
        description: personaConfig.description || "",
        voice: personaConfig.voice,
        scenarios: personaConfig.scenarios,
        theme: personaConfig.theme || { accent: "#2563eb", background: "#0a0a0a", surface: "#141414", text: "#e5e5e5" },
      })
      .select()
      .single();

    if (insertErr) throw new Error("Failed to save persona: " + insertErr.message);

    if (styleResult) {
      const styleContent = styleResult.content[0].text.trim();
      const fmMatch = styleContent.match(/^---\n([\s\S]*?)\n---/);
      let keywords = ["post", "poster", "ecrire", "rediger", "contenu", "linkedin"];
      if (fmMatch) {
        const kwMatch = fmMatch[1].match(/keywords:\s*\[(.*?)\]/);
        if (kwMatch) {
          keywords = kwMatch[1].split(",").map(k => k.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
        }
      }
      styleBody = fmMatch ? styleContent.slice(fmMatch[0].length).trim() : styleContent;

      const { error: styleInsertErr } = await supabase.from("knowledge_files").insert({
        persona_id: persona.id,
        path: "topics/style-posts-linkedin.md",
        keywords,
        content: styleBody,
        source_type: "auto",
      });
      if (styleInsertErr) console.log(JSON.stringify({ event: "style_knowledge_insert_error", persona: persona.id, error: styleInsertErr.message }));
    }

    // Insert DM style knowledge file if DMs were provided
    if (dmResult) {
      const dmContent = dmResult.content[0].text.trim();
      const dmFmMatch = dmContent.match(/^---\n([\s\S]*?)\n---/);
      let dmKeywords = ["dm", "message", "conversation", "qualification", "prospection", "relance", "rdv"];
      if (dmFmMatch) {
        const kwMatch = dmFmMatch[1].match(/keywords:\s*\[(.*?)\]/);
        if (kwMatch) {
          dmKeywords = kwMatch[1].split(",").map(k => k.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
        }
      }
      const dmBody = dmFmMatch ? dmContent.slice(dmFmMatch[0].length).trim() : dmContent;
      const { error: dmInsertErr } = await supabase.from("knowledge_files").insert({
        persona_id: persona.id,
        path: "topics/style-conversations.md",
        keywords: dmKeywords,
        content: dmBody,
        source_type: "auto",
      });
      if (dmInsertErr) console.log(JSON.stringify({ event: "dm_knowledge_insert_error", persona: persona.id, error: dmInsertErr.message }));
    }

    // Insert document knowledge file if provided
    if (documents && documents.length > 50) {
      const { error: docInsertErr } = await supabase.from("knowledge_files").insert({
        persona_id: persona.id,
        path: "documents/client-docs.md",
        keywords: ["document", "doc", "methode", "offre", "service", "client"],
        content: documents,
        source_type: "document",
      });
      if (docInsertErr) console.log(JSON.stringify({ event: "doc_knowledge_insert_error", persona: persona.id, error: docInsertErr.message }));
    }

    // Insert default scenario files
    const defaultScenario = `# Scenario : Conversation\n\nTu es ${personaConfig.name}.\n\n${personaConfig.voice.writingRules.map(r => `- ${r}`).join("\n")}\n`;
    const writingRules = personaConfig.voice.writingRules.map(r => `- ${r}`).join("\n");
    const neverDoes = personaConfig.voice.neverDoes.map(r => `- ${r}`).join("\n");
    const postScenario = `# Scenario : Creation de post LinkedIn

Tu es ${personaConfig.name}. L'utilisateur veut creer un post LinkedIn dans son style.

## Process

1. **Comprends le sujet** — Demande de quoi le post doit parler. UNE question.
2. **Identifie l'angle** — Propose le format adapte :
   - Recit personnel (histoire + lecon)
   - Framework (methode en etapes)
   - Contrarian (contre-pied d'un conseil populaire)
   - Cas client (resultats concrets)
3. **Ecris le post** — Dans le style du persona, avec :
   - Accroche qui arrete le scroll (1ere ligne decisive)
   - Corps court, paragraphes de 1-2 lignes
   - Pas de hashtags sauf si demande
   - CTA naturel en fin

## Regles d'ecriture du post

- **Accroche** : Affirmation forte OU chiffre precis OU situation concrete. JAMAIS de question generique.
- **Structure** : Phrases courtes. Sauts de ligne frequents. Facile a scanner. 800-1500 caracteres.
- **Ton** : Celui du persona — direct, sans jargon.
- **Pas de** : Emojis a chaque ligne, hashtags en masse, "Qu'en pensez-vous ?" generique en CTA.
${writingRules}

## Ne jamais faire

${neverDoes}

## Format de reponse

Presente le post ainsi :

---
**Format :** [Recit / Framework / Contrarian / Cas client]
**Cible :** [Audience visee]

[LE POST PRET A COPIER/COLLER]

---
**Variante accroche :** [Une alternative d'accroche]
`;

    const scenarioRows = [
      { persona_id: persona.id, slug: "default", content: defaultScenario },
    ];
    if (cloneType !== 'dm') {
      scenarioRows.push({ persona_id: persona.id, slug: "post", content: postScenario });
    }
    const { error: scenarioErr } = await supabase.from("scenario_files").insert(scenarioRows);
    if (scenarioErr) console.log(JSON.stringify({ event: "scenario_insert_error", persona: persona.id, error: scenarioErr.message }));

    // Log usage
    const finalInput = (configResult.usage?.input_tokens || 0) + (styleResult?.usage?.input_tokens || 0) + (dmResult?.usage?.input_tokens || 0);
    const finalOutput = (configResult.usage?.output_tokens || 0) + (styleResult?.usage?.output_tokens || 0) + (dmResult?.usage?.output_tokens || 0);
    if (client) {
      await logUsage(client.id, persona.id, finalInput, finalOutput);
    }

    // Step 3: Extract ontology BEFORE response — retry once on failure
    let ontologyCount = 0;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const ontologyResult = await Promise.race([
          anthropic.messages.create({
            model: "claude-haiku-4-5-20251001", max_tokens: 4096,
            system: ONTOLOGY_PROMPT,
            messages: [{ role: "user", content: userContent.join("\n") }],
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 50000)),
        ]);
        const ontRaw = ontologyResult.content[0].text.trim();
        let depth = 0, start = -1, end = -1;
        for (let i = 0; i < ontRaw.length; i++) {
          if (ontRaw[i] === "{") { if (depth === 0) start = i; depth++; }
          if (ontRaw[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
        }
        if (start === -1) throw new Error("no_json");
        const ontology = JSON.parse(ontRaw.slice(start, end));
        if (ontology.entities?.length > 0) {
          const entityRows = ontology.entities.map(e => ({
            persona_id: persona.id, name: e.name,
            type: e.type || "concept", description: e.description || "", confidence: 1.0,
          }));
          const { data: inserted } = await supabase
            .from("knowledge_entities")
            .upsert(entityRows, { onConflict: "persona_id,name" })
            .select("id, name");

          ontologyCount = inserted?.length || 0;

          if (inserted && ontology.relations?.length > 0) {
            const entityMap = {};
            for (const e of inserted) entityMap[e.name] = e.id;
            const relationRows = ontology.relations
              .filter(r => entityMap[r.from] && entityMap[r.to])
              .map(r => ({
                persona_id: persona.id, from_entity_id: entityMap[r.from],
                to_entity_id: entityMap[r.to], relation_type: r.type || "uses",
                description: r.description || "", confidence: 1.0,
              }));
            if (relationRows.length > 0) {
              const { error: relErr } = await supabase.from("knowledge_relations").insert(relationRows);
              if (relErr) console.log(JSON.stringify({ event: "ontology_relation_insert_error", persona: persona.id, error: relErr.message }));
            }
          }
        }
        console.log(JSON.stringify({ event: "ontology_extracted", persona: persona.id, entities: ontologyCount, attempt }));
        break; // success — exit retry loop
      } catch (e) {
        console.log(JSON.stringify({ event: "ontology_error", persona: persona.id, error: e.message, attempt }));
        if (attempt === 2) break; // last attempt, give up gracefully
      }
    }

    // Embed knowledge files for RAG (best-effort before response)
    if (isEmbeddingAvailable()) {
      try {
        if (styleBody) {
          const styleChunks = chunkText(styleBody);
          await embedAndStore(supabase, styleChunks, persona.id, "knowledge_file", "topics/style-posts-linkedin.md");
        }
        if (allDocuments && allDocuments.length > 50) {
          const docChunks = chunkText(allDocuments);
          await embedAndStore(supabase, docChunks, persona.id, "document", "documents/client-docs.md");
        }
        if (allPosts.length > 0) {
          const postsTextForEmbed = allPosts.map(p => p.slice(0, 3000)).join("\n\n---\n\n");
          const postChunks = chunkText(postsTextForEmbed);
          await embedAndStore(supabase, postChunks, persona.id, "linkedin_post");
        }
        console.log(JSON.stringify({ event: "chunks_embedded", persona: persona.id }));
      } catch (e) {
        console.log(JSON.stringify({ event: "embed_error", persona: persona.id, error: e.message }));
      }
    }

    // Auto-extract entities from knowledge files (best-effort, non-blocking timeout)
    try {
      const extractionPromises = [];
      if (styleBody) {
        extractionPromises.push(
          extractEntitiesFromContent(persona.id, styleBody, "topics/style-posts-linkedin.md", client)
        );
      }
      if (dmResult) {
        const dmBody = dmResult.content[0].text.trim().replace(/^---\n[\s\S]*?\n---\n?/, "");
        extractionPromises.push(
          extractEntitiesFromContent(persona.id, dmBody, "topics/style-conversations.md", client)
        );
      }
      if (documents && documents.length > 50) {
        extractionPromises.push(
          extractEntitiesFromContent(persona.id, documents, "documents/client-docs.md", client)
        );
      }
      if (extractionPromises.length > 0) {
        await Promise.race([
          Promise.all(extractionPromises),
          new Promise((_, reject) => setTimeout(() => reject(new Error("extraction_timeout")), 25000)),
        ]);
      }
    } catch (e) {
      console.log(JSON.stringify({ event: "auto_extraction_error", persona: persona.id, error: e.message }));
    }

    res.json({
      ok: true,
      persona: { id: persona.id, slug: persona.slug, name: persona.name, title: persona.title, avatar: persona.avatar },
      entities_extracted: ontologyCount,
    });

  } catch (err) {
    console.log(JSON.stringify({ event: "clone_error", ts: new Date().toISOString(), error: err.message }));
    res.status(500).json({ error: "Erreur lors de la creation du clone: " + err.message });
  }
}
