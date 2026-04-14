import Anthropic from "@anthropic-ai/sdk";
import { authenticateRequest, supabase, getApiKey, logUsage, checkBudget, setCors } from "../lib/supabase.js";

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

  const { linkedin_text, posts, documents, name } = req.body || {};

  if (!linkedin_text || typeof linkedin_text !== "string" || linkedin_text.length < 50) {
    res.status(400).json({ error: "linkedin_text required (min 50 chars)" });
    return;
  }
  if (!posts || !Array.isArray(posts) || posts.length < 3) {
    res.status(400).json({ error: "posts required (array, min 3 posts)" });
    return;
  }

  const apiKey = getApiKey(client);
  const anthropic = new Anthropic({ apiKey });

  try {
    // Step 1: Generate persona config
    const userContent = [
      "PROFIL LINKEDIN :",
      linkedin_text,
      "",
      "POSTS LINKEDIN (" + posts.length + " posts) :",
      posts.map((p, i) => `--- POST ${i + 1} ---\n${p}`).join("\n\n"),
    ];
    if (documents) {
      userContent.push("", "DOCUMENTATION CLIENT :", documents);
    }

    const configResult = await anthropic.messages.create({
      model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: CLONE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent.join("\n") }],
    });

    const configRaw = configResult.content[0].text.trim();
    const jsonMatch = configRaw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Failed to parse persona config JSON");
    const personaConfig = JSON.parse(jsonMatch[0]);

    // Override name if provided
    if (name) personaConfig.name = name;

    // Step 2: Generate style analysis
    const styleResult = await anthropic.messages.create({
      model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: STYLE_ANALYSIS_PROMPT,
      messages: [{ role: "user", content: posts.map((p, i) => `--- POST ${i + 1} ---\n${p}`).join("\n\n") }],
    });

    const styleContent = styleResult.content[0].text.trim();

    // Extract keywords from style analysis frontmatter
    const fmMatch = styleContent.match(/^---\n([\s\S]*?)\n---/);
    let keywords = ["post", "poster", "ecrire", "rediger", "contenu", "linkedin"];
    if (fmMatch) {
      const kwMatch = fmMatch[1].match(/keywords:\s*\[(.*?)\]/);
      if (kwMatch) {
        keywords = kwMatch[1].split(",").map(k => k.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      }
    }
    const styleBody = fmMatch ? styleContent.slice(fmMatch[0].length).trim() : styleContent;

    // Step 3: Save to Supabase
    const slug = personaConfig.name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");

    const { data: persona, error: insertErr } = await supabase
      .from("personas")
      .insert({
        slug,
        client_id: client?.id || null,
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

    // Insert style knowledge file
    await supabase.from("knowledge_files").insert({
      persona_id: persona.id,
      path: "topics/style-posts-linkedin.md",
      keywords,
      content: styleBody,
      source_type: "auto",
    });

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

    await supabase.from("scenario_files").insert([
      { persona_id: persona.id, slug: "default", content: defaultScenario },
      { persona_id: persona.id, slug: "post", content: postScenario },
    ]);

    // Log usage
    const totalInput = (configResult.usage?.input_tokens || 0) + (styleResult.usage?.input_tokens || 0);
    const totalOutput = (configResult.usage?.output_tokens || 0) + (styleResult.usage?.output_tokens || 0);
    if (client) {
      await logUsage(client.id, persona.id, totalInput, totalOutput);
    }

    res.json({
      ok: true,
      persona: { id: persona.id, slug: persona.slug, name: persona.name, title: persona.title, avatar: persona.avatar },
    });
  } catch (err) {
    console.log(JSON.stringify({ event: "clone_error", ts: new Date().toISOString(), error: err.message }));
    res.status(500).json({ error: "Erreur lors de la creation du clone: " + err.message });
  }
}
