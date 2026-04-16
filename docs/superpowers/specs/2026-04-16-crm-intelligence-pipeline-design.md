# CRM Intelligence Pipeline — Design Spec

**Date:** 2026-04-16
**Goal:** Import ~390 CRM contacts with conversations, ICP analyses, and metadata into Thomas's clone intelligence system to double the knowledge base.

## Data Source

- **File:** `CRM-AVEC-ECHANGES.csv` (2.7 MB, 55K lines multiline)
- **Contacts:** ~390 rows, ~345 with conversations
- **Messages:** ~3,500 dated messages (2,273 Thomas + 1,233 prospects)
- **ICP Analyses:** ~1,417 scored profiles
- **Other columns:** Infos Cles, Besoins Detectes, Signals, Raison Classification

## Architecture

Single script: `scripts/ingest-crm-conversations.js`

Reuses existing libs directly:
- `lib/embeddings.js` — `chunkText()`, `embedAndStore()`, `embed()`
- `lib/graph-extraction.js` — `extractEntitiesFromContent()`
- `lib/supabase.js` — Supabase client
- `lib/knowledge-db.js` — `clearIntelligenceCache()`

No new dependencies. No new tables. No API changes.

## Phases

### Phase 1: Parse & Clean

Parse the multiline CSV properly. Each row may span dozens of lines because the Conversation column contains full message threads with newlines.

**Parsing strategy:** Use a proper CSV parser (csv-parse, already in Node ecosystem via npm) or manual state-machine parsing that tracks quote boundaries.

**Per contact, extract:**
```
{
  name: "Ann Solo",
  headline: "...",
  linkedinUrl: "...",
  icpAnalyse: "9/10 — ...",
  icpScore: 9,
  pipelineStage: "Replied",
  conversation: [
    { date: "2026-03-24", author: "Ann Solo", text: "Salut Thomas..." },
    { date: "2026-03-24", author: "Moi", text: "Salut Ann" },
    ...
  ],
  messageCount: 28,
  besoinsDetectes: "...",
  signals: "...",
  infosCles: "...",
  raisonClassification: "..."
}
```

**Cleaning rules:**
- Remove reaction lines ("X reacted 👍/😮/😊/etc")
- Normalize dates to ISO format
- Collapse multiple empty lines
- Trim whitespace

**Output:** `data/crm-parsed.json` — structured JSON for subsequent phases.

**Verification:** Log total contacts, contacts with conversations, total messages, contacts filtered (>5 messages).

### Phase 2: Style Enrichment

Analyze Thomas's messages across all substantial conversations (>5 messages) to extract conversation patterns.

**Claude analysis prompt** processes batches of 10-15 conversations and extracts:
- Opening patterns (first message formulations)
- Qualification patterns (how Thomas asks about business, offers, needs)
- Relance patterns (how Thomas follows up)
- Close patterns (how Thomas proposes next steps)
- Vocabulary frequency (signature expressions, common phrases)
- Message length patterns per conversation phase

**Output:** Knowledge file `topics/crm-style-patterns.md` with YAML frontmatter keywords.

**Injection:** Via direct Supabase insert into `knowledge_files` table (same as `api/knowledge.js` POST handler does), then `chunkText()` + `embedAndStore()` for RAG.

**Verification:** Query the persona's knowledge files, confirm the new file appears and has chunks.

### Phase 3: Prospect Intelligence

Synthesize ICP analyses, besoins, and conversation content into prospect intelligence.

**Claude analysis prompt** processes all contacts with ICP data and extracts:
- Prospect archetypes (recurring profiles that become clients)
- Common objections and how Thomas handles them
- Buying signals (phrases/behaviors that indicate purchase intent)
- Need patterns (what prospects actually want vs what they say)
- Anti-patterns (profiles that never convert)

**Also extracts from metadata columns:**
- ICP score distribution analysis
- Besoins frequency analysis
- Signal patterns

**Output:** Knowledge file `topics/crm-prospect-intelligence.md`

**Injection:** Same as Phase 2 — Supabase insert + embed.

### Phase 4: Knowledge Graph & RAG

Extract entities and relations from the new knowledge files + raw conversation data.

**Uses existing `extractEntitiesFromContent()`** from `lib/graph-extraction.js` on:
1. The style patterns file (Phase 2 output)
2. The prospect intelligence file (Phase 3 output)
3. Batches of raw conversations (for person/company/tool entities)

**Entity types expected:**
- `person` — prospects, partners, competitors mentioned
- `company` — businesses mentioned in conversations
- `tool` — platforms, software mentioned (Carrd, LinkedIn, etc.)
- `concept` — business concepts, methodologies
- `belief` — Thomas's convictions expressed in conversations
- `metric` — numbers, KPIs mentioned
- `framework` — sales frameworks, content strategies

**Embeddings:** All new entities get embedded via `embed()` for semantic matching.

**Verification:** Count entities before/after, test a RAG query that should return new content.

## Iterative Processing

Each phase processes data in batches to avoid token limits and allow progress tracking:

- **Phase 1:** All contacts in one pass (CSV parsing, no LLM needed)
- **Phase 2:** 10-15 conversations per Claude call, ~25 batches
- **Phase 3:** 50 ICP profiles per Claude call, ~28 batches
- **Phase 4:** Uses existing `extractEntitiesFromContent()` which handles its own batching

Progress logged after each batch: `[Phase 2] Batch 3/25 — 42 patterns extracted so far`

## CLI Interface

```
node scripts/ingest-crm-conversations.js --csv path/to/file.csv [options]

Options:
  --phase N        Run only phase N (1-4), default: all
  --dry-run        Parse and analyze without writing to DB
  --persona slug   Persona slug (default: thomas)
  --verbose        Show detailed extraction output
```

## Thomas Persona ID Resolution

Script looks up Thomas's persona in Supabase by slug, then uses `getIntelligenceId()` to resolve the intelligence source ID (handles shared intelligence pools).

## Error Handling

- CSV parse errors: skip malformed rows, log count
- Claude API errors: retry once with backoff, skip batch on second failure
- Supabase errors: log and continue (non-fatal for individual inserts)
- Voyage AI errors: graceful — file still stored, keyword search works without vectors

## Expected Impact

| Metric | Before | After |
|--------|--------|-------|
| Analyzed messages | ~2,468 | ~5,700+ |
| Knowledge files | 5 | 7 |
| Prospect archetypes | 0 | ~10-15 |
| Cataloged objections | 0 | ~20-30 |
| Graph entities | ~30-50 | ~100-150 |
| RAG chunks | ~50 | ~150+ |
