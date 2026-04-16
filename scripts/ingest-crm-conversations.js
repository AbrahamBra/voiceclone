#!/usr/bin/env node
/**
 * CRM Intelligence Pipeline — Ingest conversations, ICP analyses, and metadata
 * into Thomas's clone knowledge system.
 *
 * Usage:
 *   node scripts/ingest-crm-conversations.js --csv path/to/file.csv [options]
 *
 * Options:
 *   --phase N        Run only phase N (1-4), default: all
 *   --dry-run        Parse and analyze without writing to DB
 *   --persona slug   Persona slug (default: thomas)
 *   --verbose        Show detailed output
 */

import { config } from "dotenv";
config();

import { readFileSync, writeFileSync, existsSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { chunkText, embedAndStore, embed } from "../lib/embeddings.js";
import { clearIntelligenceCache, getIntelligenceId } from "../lib/knowledge-db.js";

// ── Config ──
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const envContent = readFileSync(".env", "utf-8");
const apiKeyMatch = envContent.match(/^ANTHROPIC_API_KEY=(.+)$/m);
const ANTHROPIC_KEY = apiKeyMatch ? apiKeyMatch[1].trim() : process.env.ANTHROPIC_API_KEY;
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

const args = process.argv.slice(2);
const getArg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const CSV_PATH = getArg("--csv");
const PHASE = getArg("--phase") ? parseInt(getArg("--phase")) : null;
const DRY_RUN = args.includes("--dry-run");
const PERSONA_SLUG = getArg("--persona") || "thomas";
const VERBOSE = args.includes("--verbose");

const PARSED_PATH = "data/crm-parsed.json";
const CHECKPOINT_PATH = "data/crm-checkpoint.json";

if (!CSV_PATH && (!PHASE || PHASE === 1)) {
  console.error("Usage: node scripts/ingest-crm-conversations.js --csv path/to/file.csv");
  process.exit(1);
}

// ── CSV Parser (handles multiline quoted fields) ──

function parseCSV(text) {
  const rows = [];
  let current = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  // Remove BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        current.push(field);
        field = "";
        i++;
      } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        current.push(field);
        field = "";
        rows.push(current);
        current = [];
        i += ch === '\r' ? 2 : 1;
      } else if (ch === '\r') {
        current.push(field);
        field = "";
        rows.push(current);
        current = [];
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Last field/row
  if (field || current.length > 0) {
    current.push(field);
    rows.push(current);
  }

  return rows;
}

function parseContacts(csvText) {
  const rows = parseCSV(csvText);
  if (rows.length < 2) return [];

  const headers = rows[0].map(h => h.trim());
  const colIdx = {};
  headers.forEach((h, i) => { colIdx[h] = i; });

  const contacts = [];
  let skippedRows = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length < 5) { skippedRows++; continue; }

    const get = (col) => (row[colIdx[col]] || "").trim();
    const rawConv = get("Conversation");

    // Parse conversation messages
    const messages = [];
    if (rawConv) {
      const msgPattern = /\[(\d{2}\/\d{2}\/\d{4})\]\s+([^:]+):\s*([\s\S]*?)(?=\[\d{2}\/\d{2}\/\d{4}\]|$)/g;
      let match;
      while ((match = msgPattern.exec(rawConv)) !== null) {
        const text = match[3].trim();
        // Skip reaction lines
        if (/reacted\s+[👍😮😊🎉❤️🔥💯👏😂😢😡💡🙌✅👀🤝💪🎯🚀⭐️💥😎🤩🥳]/.test(text)) continue;
        if (!text) continue;

        const [day, month, year] = match[1].split("/");
        messages.push({
          date: `${year}-${month}-${day}`,
          author: match[2].trim() === "Moi" ? "Thomas" : match[2].trim(),
          text,
        });
      }
    }

    // Parse ICP score (handles "9/10", "9.5/10", etc.)
    const icpRaw = get("ICP Analyse");
    const scoreMatch = icpRaw.match(/^(\d+(?:\.\d+)?)\/10/);
    const icpScore = scoreMatch ? Math.round(parseFloat(scoreMatch[1])) : null;

    contacts.push({
      name: `${get("First Name")} ${get("Last Name")}`.trim(),
      headline: get("Headline"),
      linkedinUrl: get("LinkedIn URL"),
      source: get("Source"),
      icpAnalyse: icpRaw,
      icpScore,
      pipelineStage: get("Pipeline Stage"),
      messages,
      messageCount: messages.length,
      besoinsDetectes: get("Besoins Detectes"),
      signals: get("Signals"),
      infosCles: get("Infos Clés") || get("Infos Cles"),
      raisonClassification: get("Raison Classification"),
      tier: get("Tier"),
      leadRank: get("Lead Rank"),
    });
  }

  if (skippedRows > 0) console.log(`  ⚠ Skipped ${skippedRows} malformed rows`);
  return contacts;
}

// ── Helpers ──

function estimateTokens(text) {
  return Math.ceil(text.split(/\s+/).length * 1.3);
}

function sanitizeText(text) {
  // Remove unpaired surrogates that cause JSON serialization errors
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

async function callClaude(system, userContent, maxTokens = 4096) {
  const result = await Promise.race([
    anthropic.messages.create({
      model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      system: sanitizeText(system),
      messages: [{ role: "user", content: sanitizeText(userContent) }],
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 120000)),
  ]);

  return result.content[0].text.trim();
}

function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function loadCheckpoint() {
  if (existsSync(CHECKPOINT_PATH)) {
    return JSON.parse(readFileSync(CHECKPOINT_PATH, "utf-8"));
  }
  return { phase1: false, phase2: false, phase3: false, phase4: false };
}

function saveCheckpoint(phase) {
  const cp = loadCheckpoint();
  cp[`phase${phase}`] = true;
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(cp, null, 2));
}

// ── Phase 1: Parse & Clean ──

async function phase1(csvPath) {
  console.log("\n══════════════════════════════════════");
  console.log("  PHASE 1 — Parse & Clean");
  console.log("══════════════════════════════════════\n");

  const csvText = readFileSync(csvPath, "utf-8");
  console.log(`  CSV size: ${(csvText.length / 1024 / 1024).toFixed(1)} MB`);

  const contacts = parseContacts(csvText);

  const withConversations = contacts.filter(c => c.messageCount > 0);
  const substantialConvs = contacts.filter(c => c.messageCount > 5);
  const withICP = contacts.filter(c => c.icpScore !== null);
  const totalMessages = contacts.reduce((sum, c) => sum + c.messageCount, 0);
  const thomasMessages = contacts.reduce((sum, c) =>
    sum + c.messages.filter(m => m.author === "Thomas").length, 0);
  const prospectMessages = totalMessages - thomasMessages;

  console.log(`  ✓ ${contacts.length} contacts parsed`);
  console.log(`  ✓ ${withConversations.length} with conversations`);
  console.log(`  ✓ ${substantialConvs.length} substantial (>5 messages)`);
  console.log(`  ✓ ${totalMessages} total messages (${thomasMessages} Thomas, ${prospectMessages} prospects)`);
  console.log(`  ✓ ${withICP.length} with ICP score`);

  // Ensure data/ directory exists
  if (!existsSync("data")) {
    const { mkdirSync } = await import("fs");
    mkdirSync("data", { recursive: true });
  }

  writeFileSync(PARSED_PATH, JSON.stringify(contacts, null, 2));
  console.log(`\n  → Saved to ${PARSED_PATH}`);

  saveCheckpoint(1);
  return contacts;
}

// ── Phase 2: Style Enrichment ──

const STYLE_ANALYSIS_PROMPT = `Tu es un analyste expert en communication LinkedIn.
Analyse les conversations DM de Thomas ci-dessous et extrais des patterns PRECIS et ACTIONABLES.

Pour chaque pattern, donne :
- La catégorie (ouverture, qualification, relance, close, tonalite)
- La formulation exacte ou le template
- La fréquence (si visible)
- Le contexte d'usage

Concentre-toi sur :
1. OUVERTURES — Comment Thomas ouvre une conversation (premiers messages)
2. QUALIFICATION — Comment il pose des questions pour comprendre le prospect
3. RELANCES — Comment il relance quand le prospect ne répond pas
4. CLOSES — Comment il propose un next step (appel, ressource, offre)
5. TONALITE — Longueur des messages, ponctuation, emojis, tutoiement/vouvoiement, style

Reponds en JSON :
{
  "patterns": [
    {
      "category": "ouverture|qualification|relance|close|tonalite",
      "pattern": "description du pattern",
      "examples": ["exemple 1", "exemple 2"],
      "frequency": "frequent|occasionnel|rare",
      "context": "dans quel cas ce pattern est utilisé"
    }
  ],
  "vocabulary": {
    "signature_expressions": ["expression 1", "..."],
    "common_questions": ["question 1", "..."],
    "transition_phrases": ["phrase 1", "..."]
  },
  "stats": {
    "avg_message_length_words": 0,
    "questions_per_conversation": 0,
    "messages_before_qualification": 0
  }
}`;

async function phase2(contacts) {
  console.log("\n══════════════════════════════════════");
  console.log("  PHASE 2 — Style Enrichment");
  console.log("══════════════════════════════════════\n");

  // Filter substantial conversations for style analysis
  const substantial = contacts.filter(c => c.messageCount > 5);
  console.log(`  Processing ${substantial.length} substantial conversations`);

  const allPatterns = [];
  const allVocabulary = { signature_expressions: [], common_questions: [], transition_phrases: [] };
  const allStats = [];

  // Batch by token budget (~15K tokens per batch)
  const TOKEN_BUDGET = 15000;
  let batch = [];
  let batchTokens = 0;
  let batchNum = 0;
  const totalBatches = [];

  // Pre-compute batches
  for (const contact of substantial) {
    const convText = contact.messages.map(m =>
      `[${m.date}] ${m.author}: ${m.text}`
    ).join("\n");
    const tokens = estimateTokens(convText);

    if (batchTokens + tokens > TOKEN_BUDGET && batch.length > 0) {
      totalBatches.push([...batch]);
      batch = [];
      batchTokens = 0;
    }

    batch.push({ name: contact.name, convText, tokens });
    batchTokens += tokens;
  }
  if (batch.length > 0) totalBatches.push(batch);

  console.log(`  Split into ${totalBatches.length} batches\n`);

  for (const batchItems of totalBatches) {
    batchNum++;
    const batchContent = batchItems.map(item =>
      `--- Conversation avec ${item.name} ---\n${item.convText}`
    ).join("\n\n");

    console.log(`  [Phase 2] Batch ${batchNum}/${totalBatches.length} — ${batchItems.length} conversations, ~${estimateTokens(batchContent)} tokens`);

    if (DRY_RUN) continue;

    try {
      const raw = await callClaude(STYLE_ANALYSIS_PROMPT, batchContent, 4096);
      const data = extractJSON(raw);
      if (data) {
        if (data.patterns) allPatterns.push(...data.patterns);
        if (data.vocabulary) {
          for (const key of Object.keys(allVocabulary)) {
            if (data.vocabulary[key]) allVocabulary[key].push(...data.vocabulary[key]);
          }
        }
        if (data.stats) allStats.push(data.stats);
        console.log(`    ✓ ${data.patterns?.length || 0} patterns extracted`);
      } else {
        console.log(`    ⚠ No JSON extracted from response`);
      }
    } catch (err) {
      console.log(`    ✗ Error: ${err.message}`);
      // Retry once
      try {
        await new Promise(r => setTimeout(r, 2000));
        const raw = await callClaude(STYLE_ANALYSIS_PROMPT, batchContent, 4096);
        const data = extractJSON(raw);
        if (data?.patterns) {
          allPatterns.push(...data.patterns);
          console.log(`    ✓ Retry succeeded: ${data.patterns.length} patterns`);
        }
      } catch (retryErr) {
        console.log(`    ✗ Retry failed: ${retryErr.message} — skipping batch`);
      }
    }
  }

  if (DRY_RUN) {
    console.log(`\n  [DRY RUN] Would generate style knowledge file from ${totalBatches.length} batches`);
    saveCheckpoint(2);
    return;
  }

  // Deduplicate vocabulary
  for (const key of Object.keys(allVocabulary)) {
    allVocabulary[key] = [...new Set(allVocabulary[key])];
  }

  // Aggregate stats
  const avgStats = allStats.length > 0 ? {
    avg_message_length_words: Math.round(allStats.reduce((s, x) => s + (x.avg_message_length_words || 0), 0) / allStats.length),
    questions_per_conversation: Math.round(allStats.reduce((s, x) => s + (x.questions_per_conversation || 0), 0) / allStats.length * 10) / 10,
    messages_before_qualification: Math.round(allStats.reduce((s, x) => s + (x.messages_before_qualification || 0), 0) / allStats.length * 10) / 10,
  } : {};

  // Deduplicate patterns by merging similar ones
  const patternMap = new Map();
  for (const p of allPatterns) {
    const key = `${p.category}:${p.pattern?.slice(0, 50)}`;
    if (!patternMap.has(key)) {
      patternMap.set(key, p);
    } else {
      const existing = patternMap.get(key);
      existing.examples = [...new Set([...(existing.examples || []), ...(p.examples || [])])].slice(0, 5);
    }
  }

  // Generate knowledge file content
  const patterns = [...patternMap.values()];
  const categories = ["ouverture", "qualification", "relance", "close", "tonalite"];

  let markdown = `---
keywords: ["conversation", "dm", "message", "style", "ouverture", "qualification", "relance", "close", "pattern", "crm", "prospect", "echange"]
---

# Patterns conversationnels CRM — Analyse de ${substantial.length} conversations

> Analyse automatique de ${contacts.reduce((s, c) => s + c.messageCount, 0)} messages issus du CRM.

## Stats globales

- Longueur moyenne d'un message Thomas : ~${avgStats.avg_message_length_words || "?"} mots
- Questions par conversation : ~${avgStats.questions_per_conversation || "?"}
- Messages avant qualification : ~${avgStats.messages_before_qualification || "?"}

`;

  for (const cat of categories) {
    const catPatterns = patterns.filter(p => p.category === cat);
    if (catPatterns.length === 0) continue;

    markdown += `## ${cat.charAt(0).toUpperCase() + cat.slice(1)}\n\n`;
    for (const p of catPatterns) {
      markdown += `### ${p.pattern}\n`;
      if (p.context) markdown += `> ${p.context}\n\n`;
      if (p.examples?.length > 0) {
        markdown += p.examples.map(e => `- "${e}"`).join("\n") + "\n";
      }
      markdown += `Frequence : ${p.frequency || "non determinee"}\n\n`;
    }
  }

  if (allVocabulary.signature_expressions.length > 0) {
    markdown += `## Vocabulaire signature\n\n`;
    markdown += `### Expressions recurrentes\n${allVocabulary.signature_expressions.map(e => `- "${e}"`).join("\n")}\n\n`;
    if (allVocabulary.common_questions.length > 0) {
      markdown += `### Questions types\n${allVocabulary.common_questions.map(q => `- "${q}"`).join("\n")}\n\n`;
    }
    if (allVocabulary.transition_phrases.length > 0) {
      markdown += `### Phrases de transition\n${allVocabulary.transition_phrases.map(p => `- "${p}"`).join("\n")}\n\n`;
    }
  }

  console.log(`\n  ✓ Generated style file: ${markdown.length} chars, ${patterns.length} unique patterns`);

  // Inject into knowledge system
  await injectKnowledgeFile("topics/crm-style-patterns.md", markdown, "Style patterns from CRM conversations");

  saveCheckpoint(2);
  console.log("  ✓ Phase 2 complete");
}

// ── Phase 3: Prospect Intelligence ──

const PROSPECT_ANALYSIS_PROMPT = `Tu es un expert en intelligence commerciale B2B.
Analyse ces profils prospects et conversations du CRM de Thomas et extrais de l'intelligence actionable.

Extrais :
1. ARCHETYPES DE PROSPECTS — Profils types recurrents (qui achete, qui n'achete pas)
2. OBJECTIONS FREQUENTES — Ce que les prospects disent quand ils hesitent
3. SIGNAUX D'ACHAT — Phrases ou comportements qui indiquent un interet fort
4. BESOINS REELS — Ce que les prospects veulent vraiment (vs ce qu'ils disent)
5. ANTI-PATTERNS — Profils qui ne convertissent jamais

Reponds en JSON :
{
  "archetypes": [
    {
      "name": "nom court du profil type",
      "description": "description detaillee",
      "icp_score_range": "7-10",
      "typical_headline": "exemple de headline LinkedIn",
      "conversion_likelihood": "haute|moyenne|faible",
      "best_approach": "comment Thomas devrait les aborder"
    }
  ],
  "objections": [
    {
      "objection": "la formulation type de l'objection",
      "frequency": "frequente|occasionnelle|rare",
      "response_pattern": "comment Thomas y repond habituellement",
      "underlying_need": "le vrai besoin derriere l'objection"
    }
  ],
  "buying_signals": [
    {
      "signal": "description du signal",
      "examples": ["exemple 1"],
      "strength": "fort|moyen|faible"
    }
  ],
  "needs": [
    {
      "need": "le besoin reel",
      "how_expressed": "comment le prospect l'exprime",
      "frequency": "frequente|occasionnelle|rare"
    }
  ],
  "anti_patterns": [
    {
      "profile": "description du profil",
      "why_no_conversion": "raison",
      "signs": ["signe 1"]
    }
  ]
}`;

async function phase3(contacts) {
  console.log("\n══════════════════════════════════════");
  console.log("  PHASE 3 — Prospect Intelligence");
  console.log("══════════════════════════════════════\n");

  // Build prospect profiles with all metadata
  const profiles = contacts
    .filter(c => c.icpScore !== null || c.messageCount > 0)
    .map(c => {
      let profile = `## ${c.name}`;
      if (c.headline) profile += `\nHeadline: ${c.headline}`;
      if (c.icpAnalyse) profile += `\nICP: ${c.icpAnalyse.slice(0, 200)}`;
      if (c.pipelineStage) profile += `\nStage: ${c.pipelineStage}`;
      if (c.besoinsDetectes) profile += `\nBesoins: ${c.besoinsDetectes}`;
      if (c.signals) profile += `\nSignals: ${c.signals}`;
      if (c.raisonClassification) profile += `\nClassification: ${c.raisonClassification}`;
      if (c.infosCles) profile += `\nInfos: ${c.infosCles}`;
      // Include conversation summary (first and last 3 messages to keep tokens manageable)
      if (c.messages.length > 0) {
        const firstMsgs = c.messages.slice(0, 3).map(m => `  ${m.author}: ${m.text.slice(0, 100)}`).join("\n");
        const lastMsgs = c.messages.length > 6
          ? c.messages.slice(-3).map(m => `  ${m.author}: ${m.text.slice(0, 100)}`).join("\n")
          : "";
        profile += `\nConversation (${c.messageCount} msgs):\n${firstMsgs}`;
        if (lastMsgs) profile += `\n  ...\n${lastMsgs}`;
      }
      return profile;
    });

  console.log(`  Processing ${profiles.length} prospect profiles`);

  // Batch by token budget
  const TOKEN_BUDGET = 20000;
  const batches = [];
  let batch = [];
  let batchTokens = 0;

  for (const profile of profiles) {
    const tokens = estimateTokens(profile);
    if (batchTokens + tokens > TOKEN_BUDGET && batch.length > 0) {
      batches.push([...batch]);
      batch = [];
      batchTokens = 0;
    }
    batch.push(profile);
    batchTokens += tokens;
  }
  if (batch.length > 0) batches.push(batch);

  console.log(`  Split into ${batches.length} batches\n`);

  const allArchetypes = [];
  const allObjections = [];
  const allBuyingSignals = [];
  const allNeeds = [];
  const allAntiPatterns = [];

  for (let i = 0; i < batches.length; i++) {
    const batchContent = batches[i].join("\n\n");
    console.log(`  [Phase 3] Batch ${i + 1}/${batches.length} — ${batches[i].length} profiles, ~${estimateTokens(batchContent)} tokens`);

    if (DRY_RUN) continue;

    try {
      const raw = await callClaude(PROSPECT_ANALYSIS_PROMPT, batchContent, 4096);
      const data = extractJSON(raw);
      if (data) {
        if (data.archetypes) allArchetypes.push(...data.archetypes);
        if (data.objections) allObjections.push(...data.objections);
        if (data.buying_signals) allBuyingSignals.push(...data.buying_signals);
        if (data.needs) allNeeds.push(...data.needs);
        if (data.anti_patterns) allAntiPatterns.push(...data.anti_patterns);
        console.log(`    ✓ ${data.archetypes?.length || 0} archetypes, ${data.objections?.length || 0} objections`);
      } else {
        console.log(`    ⚠ No JSON extracted`);
      }
    } catch (err) {
      console.log(`    ✗ Error: ${err.message}`);
      try {
        await new Promise(r => setTimeout(r, 2000));
        const raw = await callClaude(PROSPECT_ANALYSIS_PROMPT, batchContent, 4096);
        const data = extractJSON(raw);
        if (data) {
          if (data.archetypes) allArchetypes.push(...data.archetypes);
          if (data.objections) allObjections.push(...data.objections);
          console.log(`    ✓ Retry succeeded`);
        }
      } catch (retryErr) {
        console.log(`    ✗ Retry failed — skipping batch`);
      }
    }
  }

  if (DRY_RUN) {
    console.log(`\n  [DRY RUN] Would generate prospect intelligence from ${batches.length} batches`);
    saveCheckpoint(3);
    return;
  }

  // Deduplicate archetypes by name
  const archetypeMap = new Map();
  for (const a of allArchetypes) {
    const key = a.name?.toLowerCase();
    if (key && !archetypeMap.has(key)) archetypeMap.set(key, a);
  }

  // Deduplicate objections
  const objectionMap = new Map();
  for (const o of allObjections) {
    const key = o.objection?.slice(0, 40)?.toLowerCase();
    if (key && !objectionMap.has(key)) objectionMap.set(key, o);
  }

  // Generate knowledge file
  let markdown = `---
keywords: ["prospect", "icp", "objection", "besoin", "signal", "archetype", "qualification", "conversion", "client", "lead", "pipeline", "crm"]
---

# Intelligence Prospect CRM — Analyse de ${profiles.length} profils

> Patterns extraits automatiquement des conversations et analyses ICP du CRM.

## Archetypes de prospects

`;

  for (const a of archetypeMap.values()) {
    markdown += `### ${a.name}\n`;
    markdown += `${a.description}\n`;
    if (a.icp_score_range) markdown += `- ICP Score : ${a.icp_score_range}\n`;
    if (a.conversion_likelihood) markdown += `- Conversion : ${a.conversion_likelihood}\n`;
    if (a.best_approach) markdown += `- Approche : ${a.best_approach}\n`;
    markdown += "\n";
  }

  if (objectionMap.size > 0) {
    markdown += `## Objections frequentes\n\n`;
    for (const o of objectionMap.values()) {
      markdown += `### "${o.objection}"\n`;
      if (o.response_pattern) markdown += `- Reponse type : ${o.response_pattern}\n`;
      if (o.underlying_need) markdown += `- Besoin reel : ${o.underlying_need}\n`;
      markdown += `- Frequence : ${o.frequency || "?"}\n\n`;
    }
  }

  if (allBuyingSignals.length > 0) {
    markdown += `## Signaux d'achat\n\n`;
    const uniqueSignals = [...new Map(allBuyingSignals.map(s => [s.signal?.slice(0, 40), s])).values()];
    for (const s of uniqueSignals) {
      markdown += `- **${s.signal}** (${s.strength || "?"})`;
      if (s.examples?.length > 0) markdown += ` — ex: "${s.examples[0]}"`;
      markdown += "\n";
    }
    markdown += "\n";
  }

  if (allNeeds.length > 0) {
    markdown += `## Besoins reels des prospects\n\n`;
    const uniqueNeeds = [...new Map(allNeeds.map(n => [n.need?.slice(0, 40), n])).values()];
    for (const n of uniqueNeeds) {
      markdown += `- **${n.need}** — exprime comme : "${n.how_expressed || "?"}"\n`;
    }
    markdown += "\n";
  }

  if (allAntiPatterns.length > 0) {
    markdown += `## Anti-patterns (profils qui ne convertissent pas)\n\n`;
    const uniqueAP = [...new Map(allAntiPatterns.map(a => [a.profile?.slice(0, 40), a])).values()];
    for (const a of uniqueAP) {
      markdown += `### ${a.profile}\n`;
      markdown += `Raison : ${a.why_no_conversion || "?"}\n`;
      if (a.signs?.length > 0) markdown += `Signes : ${a.signs.join(", ")}\n`;
      markdown += "\n";
    }
  }

  console.log(`\n  ✓ Generated prospect intelligence: ${markdown.length} chars`);
  console.log(`    ${archetypeMap.size} archetypes, ${objectionMap.size} objections, ${allBuyingSignals.length} signals`);

  await injectKnowledgeFile("topics/crm-prospect-intelligence.md", markdown, "Prospect intelligence from CRM");

  saveCheckpoint(3);
  console.log("  ✓ Phase 3 complete");
}

// ── Phase 4: Knowledge Graph & RAG ──

async function phase4(contacts) {
  console.log("\n══════════════════════════════════════");
  console.log("  PHASE 4 — Knowledge Graph & RAG");
  console.log("══════════════════════════════════════\n");

  const personaId = await resolvePersonaId();
  const intellId = await resolveIntelligenceId();

  // Count entities before
  const { count: entitiesBefore } = await supabase
    .from("knowledge_entities")
    .select("*", { count: "exact", head: true })
    .eq("persona_id", intellId);

  const { count: chunksBefore } = await supabase
    .from("chunks")
    .select("*", { count: "exact", head: true })
    .eq("persona_id", intellId);

  console.log(`  Before: ${entitiesBefore || 0} entities, ${chunksBefore || 0} chunks`);

  if (DRY_RUN) {
    console.log("\n  [DRY RUN] Would extract entities from knowledge files and conversations");
    saveCheckpoint(4);
    return;
  }

  // Direct entity extraction using our own Claude client (avoids getApiKey(client) auth issue)
  const ENTITY_PROMPT = `Tu es un expert en extraction de connaissances pour un clone de voix IA.
Analyse ce contenu et extrais TOUTES les entites et relations utiles.

Types d'entites : concept, framework, person, company, metric, belief, tool, style_rule
Types de relations : equals, includes, contradicts, causes, uses, prerequisite, enforces

Extrais au minimum 10 entites de tout document non-trivial.
Reponds en JSON :
{
  "entities": [{ "name": "...", "type": "...", "description": "..." }],
  "relations": [{ "from": "...", "to": "...", "type": "...", "description": "..." }]
}`;

  const VALID_ENTITY_TYPES = new Set(["concept", "framework", "person", "company", "metric", "belief", "tool", "style_rule"]);
  const VALID_RELATION_TYPES = new Set(["equals", "includes", "contradicts", "causes", "uses", "prerequisite", "enforces"]);

  async function extractAndInsert(content, sourceName) {
    try {
      const raw = await callClaude(ENTITY_PROMPT, `Source: ${sourceName}\n\n${content.slice(0, 8000)}`, 4096);
      const data = extractJSON(raw);
      if (!data?.entities?.length) return 0;

      const entityRows = data.entities.map(e => ({
        persona_id: intellId,
        name: e.name,
        type: VALID_ENTITY_TYPES.has(e.type) ? e.type : "concept",
        description: e.description || "",
        confidence: 0.75,
      }));

      const { data: inserted, error } = await supabase
        .from("knowledge_entities")
        .upsert(entityRows, { onConflict: "persona_id,name" })
        .select("id, name");

      if (error) { console.log(`    ⚠ Entity upsert error: ${error.message}`); return 0; }
      const insertedCount = inserted?.length || 0;

      // Insert relations
      if (insertedCount > 0 && data.relations?.length > 0) {
        const { data: allEntities } = await supabase
          .from("knowledge_entities").select("id, name").eq("persona_id", intellId);
        const entityMap = {};
        for (const e of (allEntities || [])) entityMap[e.name] = e.id;

        const relationRows = data.relations
          .filter(r => entityMap[r.from] && entityMap[r.to])
          .map(r => ({
            persona_id: intellId,
            from_entity_id: entityMap[r.from],
            to_entity_id: entityMap[r.to],
            relation_type: VALID_RELATION_TYPES.has(r.type) ? r.type : "uses",
            description: r.description || "",
            confidence: 0.75,
          }));
        if (relationRows.length > 0) {
          await supabase.from("knowledge_relations").insert(relationRows);
        }
      }

      // Embed new entities
      if (insertedCount > 0) {
        try {
          const texts = inserted.map(e => {
            const full = entityRows.find(r => r.name === e.name);
            return `${e.name}: ${full?.description || e.name}`;
          });
          const embeddings = await embed(texts);
          if (embeddings) {
            for (let j = 0; j < inserted.length; j++) {
              await supabase.from("knowledge_entities")
                .update({ embedding: JSON.stringify(embeddings[j]) })
                .eq("id", inserted[j].id);
            }
          }
        } catch { /* embedding optional */ }
      }

      return insertedCount;
    } catch (err) {
      console.log(`    ⚠ Extraction error: ${err.message}`);
      return 0;
    }
  }

  // 1. Extract entities from Phase 2 & 3 knowledge files
  const { data: knowledgeFiles } = await supabase
    .from("knowledge_files")
    .select("path, content")
    .eq("persona_id", intellId)
    .in("path", ["topics/crm-style-patterns.md", "topics/crm-prospect-intelligence.md"]);

  for (const file of (knowledgeFiles || [])) {
    console.log(`\n  → Extracting entities from ${file.path}...`);
    const count = await extractAndInsert(file.content, file.path);
    console.log(`    ✓ ${count} entities extracted`);
  }

  // 2. Extract entities from raw conversations (batches of high-value contacts)
  const highValue = contacts.filter(c => c.messageCount > 5 && c.icpScore >= 7);
  console.log(`\n  → Extracting from ${highValue.length} high-value conversations...`);

  const CONV_TOKEN_BUDGET = 12000;
  let convBatch = [];
  let convBatchTokens = 0;
  let convBatchNum = 0;

  for (const contact of highValue) {
    const text = [
      `Contact: ${contact.name} — ${contact.headline}`,
      contact.icpAnalyse ? `ICP: ${contact.icpAnalyse.slice(0, 150)}` : "",
      contact.besoinsDetectes ? `Besoins: ${contact.besoinsDetectes}` : "",
      ...contact.messages.map(m => `${m.author}: ${m.text}`),
    ].filter(Boolean).join("\n");

    const tokens = estimateTokens(text);
    if (convBatchTokens + tokens > CONV_TOKEN_BUDGET && convBatch.length > 0) {
      convBatchNum++;
      const batchText = convBatch.join("\n\n---\n\n");
      console.log(`    Batch ${convBatchNum} — ${convBatch.length} contacts, ~${estimateTokens(batchText)} tokens`);
      const count = await extractAndInsert(batchText, `crm-conversations-batch-${convBatchNum}`);
      console.log(`    ✓ ${count} entities`);

      convBatch = [];
      convBatchTokens = 0;
    }

    convBatch.push(text);
    convBatchTokens += tokens;
  }

  // Final batch
  if (convBatch.length > 0) {
    convBatchNum++;
    const batchText = convBatch.join("\n\n---\n\n");
    console.log(`    Batch ${convBatchNum} — ${convBatch.length} contacts`);
    const count = await extractAndInsert(batchText, `crm-conversations-batch-${convBatchNum}`);
    console.log(`    ✓ ${count} entities`);
  }

  // Count after
  const { count: entitiesAfter } = await supabase
    .from("knowledge_entities")
    .select("*", { count: "exact", head: true })
    .eq("persona_id", intellId);

  const { count: chunksAfter } = await supabase
    .from("chunks")
    .select("*", { count: "exact", head: true })
    .eq("persona_id", intellId);

  clearIntelligenceCache(intellId);

  console.log(`\n  ═══ Phase 4 Results ═══`);
  console.log(`  Entities: ${entitiesBefore || 0} → ${entitiesAfter || 0} (+${(entitiesAfter || 0) - (entitiesBefore || 0)})`);
  console.log(`  Chunks: ${chunksBefore || 0} → ${chunksAfter || 0} (+${(chunksAfter || 0) - (chunksBefore || 0)})`);

  saveCheckpoint(4);
  console.log("  ✓ Phase 4 complete");
}

// ── Knowledge Injection Helper ──

let _personaId = null;
let _intellId = null;

async function resolvePersonaId() {
  if (_personaId) return _personaId;
  const { data } = await supabase
    .from("personas").select("id").eq("slug", PERSONA_SLUG).single();
  if (!data) throw new Error(`Persona "${PERSONA_SLUG}" not found in DB`);
  _personaId = data.id;
  return _personaId;
}

async function resolveIntelligenceId() {
  if (_intellId) return _intellId;
  const personaId = await resolvePersonaId();
  const { data } = await supabase
    .from("personas").select("id, intelligence_source_id").eq("id", personaId).single();
  _intellId = getIntelligenceId(data);
  return _intellId;
}

async function injectKnowledgeFile(path, content, description) {
  const intellId = await resolveIntelligenceId();

  console.log(`\n  → Injecting ${path} into knowledge system...`);

  // Idempotent: delete existing file + chunks with same path
  await supabase.from("chunks").delete().eq("persona_id", intellId).eq("source_path", path);
  await supabase.from("knowledge_files").delete().eq("persona_id", intellId).eq("path", path);

  // Extract keywords from frontmatter
  const fmMatch = content.match(/^---\nkeywords:\s*\[([^\]]+)\]\n---/);
  const keywords = fmMatch
    ? fmMatch[1].replace(/"/g, "").split(",").map(k => k.trim())
    : [];

  // Insert knowledge file
  const { error: insertError } = await supabase.from("knowledge_files").insert({
    persona_id: intellId,
    path,
    keywords,
    content,
  });

  if (insertError) {
    console.log(`    ✗ Insert error: ${insertError.message}`);
    return;
  }
  console.log(`    ✓ Knowledge file inserted (${keywords.length} keywords)`);

  // Chunk + embed for RAG
  const chunks = chunkText(content);
  try {
    const stored = await embedAndStore(supabase, chunks, intellId, "knowledge_file", path);
    console.log(`    ✓ ${stored} chunks embedded`);
  } catch (err) {
    console.log(`    ⚠ Embedding failed (keyword search still works): ${err.message}`);
  }

  clearIntelligenceCache(intellId);
}

// ── Main ──

async function main() {
  console.log("🧠 CRM Intelligence Pipeline");
  console.log(`  Persona: ${PERSONA_SLUG}`);
  console.log(`  Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  if (PHASE) console.log(`  Phase: ${PHASE} only`);
  console.log("");

  let contacts;

  // Phase 1
  if (!PHASE || PHASE === 1) {
    contacts = await phase1(CSV_PATH);
  }

  // Load parsed data for phases 2-4
  if (PHASE && PHASE > 1) {
    if (!existsSync(PARSED_PATH)) {
      console.error(`✗ ${PARSED_PATH} not found — run phase 1 first`);
      process.exit(1);
    }
    contacts = JSON.parse(readFileSync(PARSED_PATH, "utf-8"));
    console.log(`  Loaded ${contacts.length} contacts from ${PARSED_PATH}`);
  }

  // Phase 2
  if (!PHASE || PHASE === 2) {
    await phase2(contacts);
  }

  // Phase 3
  if (!PHASE || PHASE === 3) {
    await phase3(contacts);
  }

  // Phase 4
  if (!PHASE || PHASE === 4) {
    await phase4(contacts);
  }

  console.log("\n══════════════════════════════════════");
  console.log("  ✅ Pipeline complete!");
  console.log("══════════════════════════════════════");
}

main().catch(e => { console.error("\n✗ Fatal:", e.message); if (VERBOSE) console.error(e); process.exit(1); });
