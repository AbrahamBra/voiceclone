import Anthropic from "@anthropic-ai/sdk";
import { authenticateRequest, supabase, getApiKey, logUsage, checkBudget, setCors } from "../lib/supabase.js";
import { isEmbeddingAvailable, chunkText, embedAndStore } from "../lib/embeddings.js";

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
    "default": { "label": "Discussion libre", "description": "Discutez avec {name}", "welcome": "Message d'accueil personnalise" },
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

Sois precis. Extrais 15-30 entites et 10-20 relations. Les entites doivent refleter les concepts UNIQUES de cette personne, pas des generalites.`;

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

  const { linkedin_text, posts, dms, documents, name, cloneType } = req.body || {};

  if (!linkedin_text || typeof linkedin_text !== "string" || linkedin_text.length < 50) {
    res.status(400).json({ error: "linkedin_text required (min 50 chars)" });
    return;
  }
  if (cloneType !== 'dm' && (!posts || !Array.isArray(posts) || posts.length < 3)) {
    res.status(400).json({ error: "posts required (array, min 3 posts)" });
    return;
  }

  const apiKey = getApiKey(client);
  const anthropic = new Anthropic({ apiKey });

  try {
    const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";

    const userContent = [
      "PROFIL LINKEDIN :",
      linkedin_text,
    ];

    const postsContentForStyle = posts?.length > 0
      ? posts.slice(0, 30).map((p, i) => `--- POST ${i + 1} ---\n${p}`).join("\n\n")
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

    const configPromise = anthropic.messages.create({
      model: MODEL, max_tokens: 2048,
      system: CLONE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent.join("\n") }],
    });

    const stylePromise = cloneType !== 'dm' && postsContentForStyle
      ? anthropic.messages.create({
          model: MODEL, max_tokens: 2048,
          system: STYLE_ANALYSIS_PROMPT,
          messages: [{ role: "user", content: postsContentForStyle }],
        })
      : Promise.resolve(null);

    const dmPromise = dmsContent
      ? anthropic.messages.create({
          model: MODEL, max_tokens: 2048,
          system: DM_ANALYSIS_PROMPT,
          messages: [{ role: "user", content: dmsContent }],
        })
      : Promise.resolve(null);

    const [configResult, styleResult, dmResult] = await Promise.all([configPromise, stylePromise, dmPromise]);

    const configRaw = configResult.content[0].text.trim();
    const jsonMatch = configRaw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Failed to parse persona config JSON");
    const personaConfig = JSON.parse(jsonMatch[0]);

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

      await supabase.from("knowledge_files").insert({
        persona_id: persona.id,
        path: "topics/style-posts-linkedin.md",
        keywords,
        content: styleBody,
        source_type: "auto",
      });
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
      await supabase.from("knowledge_files").insert({
        persona_id: persona.id,
        path: "topics/style-conversations.md",
        keywords: dmKeywords,
        content: dmBody,
        source_type: "auto",
      });
    }

    // Insert document knowledge file if provided
    if (documents && documents.length > 50) {
      await supabase.from("knowledge_files").insert({
        persona_id: persona.id,
        path: "documents/client-docs.md",
        keywords: ["document", "doc", "methode", "offre", "service", "client"],
        content: documents,
        source_type: "document",
      });
    }

    // Insert default scenario files
    const defaultScenario = `# Scenario : Discussion libre\n\nTu es ${personaConfig.name}.\n\n${personaConfig.voice.writingRules.map(r => `- ${r}`).join("\n")}\n`;
    const postScenario = `# Scenario : Creation de post LinkedIn\n\nTu es ${personaConfig.name}. L'utilisateur veut creer un post LinkedIn dans son style.\n\nRegles :\n${personaConfig.voice.writingRules.map(r => `- ${r}`).join("\n")}\n\nNe jamais faire :\n${personaConfig.voice.neverDoes.map(r => `- ${r}`).join("\n")}\n`;

    const scenarioRows = [
      { persona_id: persona.id, slug: "default", content: defaultScenario },
    ];
    if (cloneType !== 'dm') {
      scenarioRows.push({ persona_id: persona.id, slug: "post", content: postScenario });
    }
    await supabase.from("scenario_files").insert(scenarioRows);

    // Log usage
    const finalInput = (configResult.usage?.input_tokens || 0) + (styleResult?.usage?.input_tokens || 0) + (dmResult?.usage?.input_tokens || 0);
    const finalOutput = (configResult.usage?.output_tokens || 0) + (styleResult?.usage?.output_tokens || 0) + (dmResult?.usage?.output_tokens || 0);
    if (client) {
      await logUsage(client.id, persona.id, finalInput, finalOutput);
    }

    // Respond immediately — clone is usable
    res.json({
      ok: true,
      persona: { id: persona.id, slug: persona.slug, name: persona.name, title: persona.title, avatar: persona.avatar },
    });

    // Step 3: Extract ontology AFTER response (fire-and-forget, non-blocking)
    (async () => {
      try {
        const ontologyResult = await anthropic.messages.create({
          model: MODEL, max_tokens: 2048,
          system: ONTOLOGY_PROMPT,
          messages: [{ role: "user", content: userContent.join("\n") }],
        });
        const ontRaw = ontologyResult.content[0].text.trim();
        const ontJson = ontRaw.match(/\{[\s\S]*\}/);
        if (!ontJson) return;
        const ontology = JSON.parse(ontJson[0]);

        if (ontology.entities?.length > 0) {
          const entityRows = ontology.entities.map(e => ({
            persona_id: persona.id, name: e.name,
            type: e.type || "concept", description: e.description || "", confidence: 1.0,
          }));
          const { data: inserted } = await supabase
            .from("knowledge_entities")
            .upsert(entityRows, { onConflict: "persona_id,name" })
            .select("id, name");

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
              await supabase.from("knowledge_relations").insert(relationRows);
            }
          }
        }
        console.log(JSON.stringify({ event: "ontology_extracted", persona: persona.id, entities: ontology.entities?.length || 0 }));
      } catch (e) {
        console.log(JSON.stringify({ event: "ontology_error", persona: persona.id, error: e.message }));
      }

      // Embed knowledge files for RAG (also fire-and-forget)
      if (isEmbeddingAvailable()) {
        try {
          if (styleBody) {
            const styleChunks = chunkText(styleBody);
            await embedAndStore(supabase, styleChunks, persona.id, "knowledge_file", "topics/style-posts-linkedin.md");
          }
          if (documents && documents.length > 50) {
            const docChunks = chunkText(documents);
            await embedAndStore(supabase, docChunks, persona.id, "document", "documents/client-docs.md");
          }
          if (posts?.length > 0) {
            const postsTextForEmbed = posts.join("\n\n---\n\n");
            const postChunks = chunkText(postsTextForEmbed);
            await embedAndStore(supabase, postChunks, persona.id, "linkedin_post");
          }
          console.log(JSON.stringify({ event: "chunks_embedded", persona: persona.id }));
        } catch (e) {
          console.log(JSON.stringify({ event: "embed_error", persona: persona.id, error: e.message }));
        }
      }
    })();

  } catch (err) {
    console.log(JSON.stringify({ event: "clone_error", ts: new Date().toISOString(), error: err.message }));
    res.status(500).json({ error: "Erreur lors de la creation du clone: " + err.message });
  }
}
