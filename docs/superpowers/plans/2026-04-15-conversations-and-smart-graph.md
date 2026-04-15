# Conversations + Smart Knowledge Graph — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent conversations (list/resume/search) and make the knowledge graph intelligent (confidence scoring, graph-boosted RAG retrieval with RRF fusion).

**Architecture:** Two independent chantiers sharing one codebase. Chantier 1 (conversations) adds a persistence layer above the existing pipeline — new tables, new endpoint, modified chat.js and frontend. Chantier 2 (smart graph) rewrites the retrieval logic in knowledge-db.js so the entity graph informs RAG queries via boost terms and reciprocal rank fusion, with confidence decay on entities.

**Tech Stack:** Node.js (ES modules), Supabase (PostgreSQL + pgvector), Vercel serverless, Voyage AI embeddings. No test framework — verification via manual API calls and `eval/` runner.

**Spec:** `docs/superpowers/specs/2026-04-15-conversations-and-smart-graph-design.md`

---

## Chunk 1: Database Migrations + Validation

### Task 1: Conversations migration

**Files:**
- Create: `supabase/004_conversations.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 004_conversations.sql
-- Persistent conversation storage

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  persona_id uuid REFERENCES personas(id) ON DELETE CASCADE NOT NULL,
  scenario text NOT NULL DEFAULT 'default',
  title text,
  last_message_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_client_persona ON conversations(client_id, persona_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_messages_content_trgm ON messages USING gin(content gin_trgm_ops);
```

- [ ] **Step 2: Run migration in Supabase SQL Editor**

Execute the SQL in the Supabase dashboard. Verify tables exist:
```sql
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('conversations', 'messages');
```
Expected: 2 rows returned.

- [ ] **Step 3: Commit**

```bash
git add supabase/004_conversations.sql
git commit -m "feat: add conversations + messages tables migration"
```

---

### Task 2: Smart graph migration

**Files:**
- Create: `supabase/005_smart_graph.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 005_smart_graph.sql
-- Smart graph: confidence decay + chunk provenance for RRF fusion

ALTER TABLE knowledge_entities
  ADD COLUMN IF NOT EXISTS last_matched_at timestamptz DEFAULT now();

ALTER TABLE chunks
  ADD COLUMN IF NOT EXISTS source_path text;

CREATE INDEX IF NOT EXISTS idx_entities_last_matched
  ON knowledge_entities(persona_id, last_matched_at);
CREATE INDEX IF NOT EXISTS idx_chunks_source_path
  ON chunks(persona_id, source_path);
```

- [ ] **Step 2: Run migration in Supabase SQL Editor**

Execute in Supabase dashboard. Verify columns exist:
```sql
SELECT column_name FROM information_schema.columns WHERE table_name = 'knowledge_entities' AND column_name = 'last_matched_at';
SELECT column_name FROM information_schema.columns WHERE table_name = 'chunks' AND column_name = 'source_path';
```
Expected: 1 row each.

- [ ] **Step 3: Commit**

```bash
git add supabase/005_smart_graph.sql
git commit -m "feat: add last_matched_at + source_path columns for smart graph"
```

---

### Task 3: Update validation to support conversation_id

**Files:**
- Modify: `lib/validate.js`

- [ ] **Step 1: Read current file**

Current `lib/validate.js` requires `history` as an array. Must make it optional when `conversation_id` is present.

- [ ] **Step 2: Rewrite validateInput()**

```javascript
export function validateInput(body) {
  const { message, history, scenario, conversation_id } = body || {};

  if (typeof message !== "string" || message.length === 0 || message.length > 10000) {
    return "message must be a non-empty string under 10000 chars";
  }

  if (typeof scenario !== "string" || scenario.length === 0) {
    return "scenario is required";
  }

  // conversation_id present: skip history validation (server loads from DB)
  if (conversation_id) {
    if (typeof conversation_id !== "string" || conversation_id.length === 0) {
      return "conversation_id must be a non-empty string";
    }
    return null;
  }

  // No conversation_id: history is optional (new conversation with empty history)
  if (history !== undefined) {
    if (!Array.isArray(history)) {
      return "history must be an array";
    }
    if (history.length > 20) {
      return "history must contain at most 20 messages";
    }
    for (const msg of history) {
      if (!msg.role || !["user", "assistant"].includes(msg.role)) {
        return "Each history message must have role 'user' or 'assistant'";
      }
      if (typeof msg.content !== "string" || msg.content.length === 0 || msg.content.length > 10000) {
        return "Each history message content must be a non-empty string under 10000 chars";
      }
    }
  }

  return null;
}
```

- [ ] **Step 3: Verify manually**

Quick sanity check — the function is pure, so verify in Node REPL:
```bash
node -e "
import { validateInput } from './lib/validate.js';
console.log(validateInput({ message: 'hi', scenario: 'default', conversation_id: 'abc' })); // null
console.log(validateInput({ message: 'hi', scenario: 'default' })); // null (no history, no conv_id = ok)
console.log(validateInput({ message: 'hi', scenario: 'default', history: [] })); // null
console.log(validateInput({ message: 'hi', scenario: 'default', conversation_id: '' })); // error
"
```

- [ ] **Step 4: Commit**

```bash
git add lib/validate.js
git commit -m "feat: make history optional in validation when conversation_id present"
```

---

## Chunk 2: Conversations API + Chat Integration

### Task 4: Create conversations endpoint

**Files:**
- Create: `api/conversations.js`

- [ ] **Step 1: Implement the endpoint**

```javascript
import { authenticateRequest, supabase, setCors } from "../lib/supabase.js";

export default async function handler(req, res) {
  setCors(res, "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  let client, isAdmin;
  try {
    const auth = await authenticateRequest(req);
    client = auth.client;
    isAdmin = auth.isAdmin;
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  const { persona, id, search, before } = req.query;

  // --- Load single conversation + messages ---
  if (id) {
    const { data: conv, error: convErr } = await supabase
      .from("conversations").select("id, title, scenario, client_id, persona_id")
      .eq("id", id).single();

    if (convErr || !conv) { res.status(404).json({ error: "Conversation not found" }); return; }

    // Ownership check
    if (!isAdmin && client && conv.client_id !== client.id) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    let query = supabase
      .from("messages").select("role, content, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(50);

    if (before) {
      query = query.lt("created_at", before);
    }

    const { data: messages } = await query;

    res.json({
      conversation: { id: conv.id, title: conv.title, scenario: conv.scenario },
      messages: messages || [],
    });
    return;
  }

  if (!persona) { res.status(400).json({ error: "persona query param required" }); return; }

  // --- Search messages ---
  if (search && search.length >= 2) {
    const clientFilter = isAdmin ? {} : { client_id: client.id };

    const { data: results } = await supabase
      .from("messages")
      .select("id, conversation_id, content, created_at, conversations!inner(title, client_id, persona_id)")
      .eq("conversations.persona_id", persona)
      .ilike("content", `%${search}%`)
      .order("created_at", { ascending: false })
      .limit(20);

    // Filter by client ownership (if not admin)
    const filtered = isAdmin ? (results || []) : (results || []).filter(
      r => r.conversations?.client_id === client.id
    );

    res.json({
      results: filtered.map(r => ({
        conversation_id: r.conversation_id,
        conversation_title: r.conversations?.title || null,
        message_content_snippet: r.content.slice(0, 150),
        created_at: r.created_at,
      })),
    });
    return;
  }

  // --- List conversations for persona ---
  const clientId = isAdmin ? undefined : client.id;

  let query = supabase
    .from("conversations")
    .select("id, title, scenario, last_message_at, created_at")
    .eq("persona_id", persona)
    .order("last_message_at", { ascending: false })
    .limit(50);

  if (clientId) {
    query = query.eq("client_id", clientId);
  }

  const { data: conversations } = await query;

  // Get message counts in a single query
  const convIds = (conversations || []).map(c => c.id);
  let counts = {};
  if (convIds.length > 0) {
    const { data: countData } = await supabase
      .rpc("count_messages_by_conversation", { conv_ids: convIds });
    if (countData) {
      for (const row of countData) counts[row.conversation_id] = row.count;
    }
  }

  res.json({
    conversations: (conversations || []).map(c => ({
      ...c,
      message_count: counts[c.id] || 0,
    })),
  });
}
```

- [ ] **Step 2: Create the count RPC in Supabase**

Add to `004_conversations.sql` (or run directly):
```sql
CREATE OR REPLACE FUNCTION count_messages_by_conversation(conv_ids uuid[])
RETURNS TABLE (conversation_id uuid, count bigint)
LANGUAGE SQL STABLE
AS $$
  SELECT m.conversation_id, COUNT(*)
  FROM messages m
  WHERE m.conversation_id = ANY(conv_ids)
  GROUP BY m.conversation_id;
$$;
```

- [ ] **Step 3: Verify with curl**

```bash
# List conversations (should be empty initially)
curl -s -H "x-access-code: YOUR_CODE" "http://localhost:3000/api/conversations?persona=PERSONA_ID" | jq
```
Expected: `{ "conversations": [] }`

- [ ] **Step 4: Commit**

```bash
git add api/conversations.js
git commit -m "feat: add conversations API (list, load, search)"
```

---

### Task 5: Integrate conversations into chat.js

**Files:**
- Modify: `api/chat.js`

- [ ] **Step 1: Add conversation support to chat handler**

Changes to `api/chat.js`:

After validation (line 37), add conversation loading logic. Before the pipeline call, add message persistence after pipeline completes.

Key changes:
1. Extract `conversation_id` from body
2. If `conversation_id`: load conv + verify ownership + load messages as history
3. If no `conversation_id`: create new conv
4. After pipeline: insert messages + update conv
5. Return `conversation_id` in SSE `done` event

```javascript
// After validation block and personaId check, REPLACE the messages construction:

const { message, history: bodyHistory, scenario, persona: personaId, conversation_id } = req.body;
if (!personaId) { res.status(400).json({ error: "persona is required" }); return; }

// Load persona data from DB
const persona = await getPersonaFromDb(personaId);
if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }

// Resolve conversation
let convId = conversation_id || null;
let messages;

if (convId) {
  // Load existing conversation
  const { data: conv, error: convErr } = await supabase
    .from("conversations").select("id, client_id, scenario")
    .eq("id", convId).single();

  if (convErr || !conv) { res.status(404).json({ error: "Conversation not found" }); return; }

  // Ownership check
  if (client && conv.client_id !== client.id) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  // Load last 19 messages from DB
  const { data: dbMessages } = await supabase
    .from("messages").select("role, content")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: false })
    .limit(19);

  const history = (dbMessages || []).reverse();
  messages = [...history, { role: "user", content: message }];
} else {
  // Create new conversation
  const clientId = client?.id || null;
  const { data: newConv } = await supabase
    .from("conversations").insert({
      client_id: clientId,
      persona_id: personaId,
      scenario: scenario || "default",
    }).select("id").single();

  convId = newConv?.id || null;

  // Use body history (deprecated path) or empty
  const history = Array.isArray(bodyHistory) ? bodyHistory.slice(-19) : [];
  messages = [...history, { role: "user", content: message }];
}
```

Then after `const result = await runPipeline(...)`, before `res.end()`:

```javascript
// Persist messages + update conversation (async, non-blocking)
if (convId && supabase) {
  const botText = result.text || "";
  Promise.all([
    supabase.from("messages").insert([
      { conversation_id: convId, role: "user", content: message },
      { conversation_id: convId, role: "assistant", content: botText },
    ]),
    supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", convId),
    // Set title on first message
    supabase.from("conversations")
      .update({ title: message.slice(0, 50).replace(/\s+\S*$/, "") })
      .eq("id", convId).is("title", null),
  ]).catch(() => {});
}
```

And in the SSE `done` event, add `conversation_id`:

```javascript
sse("done", {
  violations: nonLight.length > 0 ? nonLight : undefined,
  rewritten: check.shouldRewrite,
  conversation_id: convId,
});
```

**Important**: `runPipeline` currently doesn't return the generated text. We need to capture it. Modify `pipeline.js` to return `{ usage, text }` — add `return { usage: { ... }, text: currentText }` at the end.

- [ ] **Step 2: Update pipeline.js to return text**

In `lib/pipeline.js`, change the final return:
```javascript
return { usage: { input_tokens: totalInput, output_tokens: totalOutput }, text: currentText };
```

- [ ] **Step 3: Add supabase import to chat.js**

Add at the top of `api/chat.js`:
```javascript
import { supabase } from "../lib/supabase.js";
```
(It's already imported indirectly through other modules, but we need direct access for conversation queries.)

- [ ] **Step 4: Verify end-to-end**

```bash
# Send a chat without conversation_id — should create one
curl -s -X POST -H "Content-Type: application/json" -H "x-access-code: YOUR_CODE" \
  -d '{"message":"Salut","scenario":"default","persona":"PERSONA_ID"}' \
  http://localhost:3000/api/chat

# Check the SSE done event contains conversation_id
# Then list conversations
curl -s -H "x-access-code: YOUR_CODE" "http://localhost:3000/api/conversations?persona=PERSONA_ID" | jq
```
Expected: 1 conversation in the list with title from first message.

- [ ] **Step 5: Commit**

```bash
git add api/chat.js lib/pipeline.js
git commit -m "feat: integrate conversation persistence into chat endpoint"
```

---

## Chunk 3: Smart Entity Matching + Knowledge Fusion

### Task 6: Rewrite findRelevantEntities() with scoring + decay

**Files:**
- Modify: `lib/knowledge-db.js`

- [ ] **Step 1: Update entity SELECT to include last_matched_at**

In `loadPersonaData()`, change the entity select (around line 38):
```javascript
const { data: ent } = await supabase
  .from("knowledge_entities").select("id, name, type, description, confidence, last_matched_at")
  .eq("persona_id", personaId);
```

- [ ] **Step 2: Rewrite findRelevantEntities()**

Replace the entire `findRelevantEntities` function:

```javascript
export async function findRelevantEntities(personaId, messages) {
  const data = await loadPersonaData(personaId);
  if (!data || data.entities.length === 0) return { entities: [], relations: [], boostTerms: [] };

  const text = normalize(messages.slice(-6).map((m) => m.content).join(" "));
  const now = Date.now();

  // 1. Filter by confidence threshold
  const eligible = data.entities.filter(e => (e.confidence || 1.0) >= 0.6);

  // 2. Match entity names against message text
  const directMatches = [];
  for (const entity of eligible) {
    if (text.includes(normalize(entity.name))) {
      // 3. Score: confidence × recency_factor
      const lastMatched = entity.last_matched_at ? new Date(entity.last_matched_at).getTime() : now;
      const daysSince = (now - lastMatched) / (1000 * 60 * 60 * 24);
      const recencyFactor = Math.max(0.1, 1.0 - (daysSince / 90));
      const score = (entity.confidence || 1.0) * recencyFactor;
      directMatches.push({ ...entity, score });
    }
  }

  // 4. Sort by score DESC, take top 8
  directMatches.sort((a, b) => b.score - a.score);
  const topDirect = directMatches.slice(0, 8);
  const directIds = new Set(topDirect.map(e => e.id));

  // 5. Graph walk: 1-hop from top entities
  const relatedIds = new Set();
  for (const rel of data.relations) {
    if (directIds.has(rel.from_entity_id)) relatedIds.add(rel.to_entity_id);
    if (directIds.has(rel.to_entity_id)) relatedIds.add(rel.from_entity_id);
  }

  // Combine: direct + 1-hop
  const allIds = new Set([...directIds, ...relatedIds]);
  const matchedEntities = topDirect.concat(
    eligible.filter(e => relatedIds.has(e.id) && !directIds.has(e.id))
  );

  // 6. Collect relations between matched entities, top 6
  const matchedRelations = data.relations
    .filter(r => allIds.has(r.from_entity_id) && allIds.has(r.to_entity_id))
    .slice(0, 6);

  // 7. Update last_matched_at for directly matched entities (async, non-blocking)
  if (directIds.size > 0) {
    const ids = [...directIds];
    supabase.from("knowledge_entities")
      .update({ last_matched_at: new Date().toISOString() })
      .in("id", ids)
      .then(() => {
        // Also update cache in-memory
        for (const e of data.entities) {
          if (directIds.has(e.id)) e.last_matched_at = new Date().toISOString();
        }
      })
      .catch(() => {});
  }

  // 8. Return with boostTerms for RAG enrichment
  return {
    entities: matchedEntities,
    relations: matchedRelations,
    boostTerms: topDirect.slice(0, 5).map(e => e.name),
    directCount: directIds.size,
    graphCount: relatedIds.size,
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/knowledge-db.js
git commit -m "feat: entity matching with confidence scoring, decay, and boost terms"
```

---

### Task 7: Rewrite findRelevantKnowledgeFromDb() with RRF fusion

**Files:**
- Modify: `lib/knowledge-db.js`

- [ ] **Step 1: Replace findRelevantKnowledgeFromDb()**

```javascript
export async function findRelevantKnowledgeFromDb(personaId, messages, boostTerms = []) {
  const data = await loadPersonaData(personaId);
  if (!data) return [];

  const text = normalize(messages.slice(-6).map((m) => m.content).join(" "));

  // Phase 1: Keyword scoring (proportional, not binary)
  const keywordResults = [];
  for (const entry of data.knowledge) {
    if (entry.keywords.length === 0) continue;
    const matchCount = entry.keywords.filter(kw => text.includes(kw)).length;
    if (matchCount > 0) {
      const score = matchCount / entry.keywords.length;
      keywordResults.push({ path: entry.path, content: entry.content, score, source: "keyword" });
    }
  }
  // Sort by score DESC for ranking
  keywordResults.sort((a, b) => b.score - a.score);

  // Phase 2: RAG (always runs if available)
  let ragResults = [];
  if (isEmbeddingAvailable()) {
    try {
      const queryParts = messages.slice(-3).map(m => m.content);
      if (boostTerms.length > 0) queryParts.push(boostTerms.join(" "));
      const enrichedQuery = queryParts.join(" ").slice(0, 1000); // cap for Voyage input

      const chunks = await retrieveChunks(supabase, personaId, enrichedQuery);
      ragResults = chunks.map((c, i) => ({
        path: c.source_path || `rag-chunk-${i}`,
        content: c.content,
        score: c.score,
        source: "rag",
        sourcePath: c.source_path || null,
      }));
    } catch (err) {
      console.log(JSON.stringify({ event: "rag_error", error: err.message }));
    }
  }

  // Phase 3: Reciprocal Rank Fusion
  const K = 60;
  const rrfScores = {};
  const contentMap = {};

  // Score keyword results
  keywordResults.forEach((item, rank) => {
    const key = item.path;
    rrfScores[key] = (rrfScores[key] || 0) + 1 / (K + rank + 1);
    if (!contentMap[key]) contentMap[key] = { path: item.path, content: item.content, sources: new Set() };
    contentMap[key].sources.add("keyword");
  });

  // Score RAG results — link to keyword files via source_path
  ragResults.forEach((item, rank) => {
    const key = item.sourcePath && contentMap[item.sourcePath] ? item.sourcePath : `rag:${item.path}`;
    rrfScores[key] = (rrfScores[key] || 0) + 1 / (K + rank + 1);
    if (!contentMap[key]) contentMap[key] = { path: item.path, content: item.content, sources: new Set() };
    contentMap[key].sources.add("rag");
  });

  // Sort by RRF score, take top 3
  const fused = Object.entries(rrfScores)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([key]) => {
      const item = contentMap[key];
      const sourceLabel = item.sources.size > 1 ? "hybrid" : [...item.sources][0];
      return { path: item.path, content: item.content, source: sourceLabel };
    });

  return fused;
}
```

- [ ] **Step 2: Update retrieveChunks to return source_path**

In `lib/rag.js`, the `match_chunks` RPC doesn't return `source_path`. Update the RPC or add it to the select. Simplest: update `match_chunks` SQL to return it:

```sql
-- Run in Supabase SQL Editor (update the existing function)
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(1024),
  match_persona_id uuid,
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 5
)
RETURNS TABLE (id uuid, content text, similarity float, source_path text)
LANGUAGE SQL STABLE
AS $$
  SELECT
    c.id,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity,
    c.source_path
  FROM chunks c
  WHERE c.persona_id = match_persona_id
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;
```

Then update `lib/rag.js` to pass through source_path:
```javascript
return (data || []).map((row) => ({
  content: row.content,
  score: row.similarity,
  source_path: row.source_path || null,
}));
```

- [ ] **Step 3: Update embedAndStore to pass source_path**

In `lib/embeddings.js`, modify `embedAndStore()` to accept and store `sourcePath`:

```javascript
export async function embedAndStore(supabase, chunks, personaId, sourceType = "knowledge_file", sourcePath = null) {
  // ... existing code ...
  const rows = batch.map((content, j) => ({
    persona_id: personaId,
    content,
    embedding: JSON.stringify(embeddings[j]),
    source_type: sourceType,
    source_path: sourcePath,
    metadata: { index: i + j },
  }));
  // ... rest unchanged ...
}
```

Then update the caller in `api/clone.js` to pass the path when embedding knowledge files (search for `embedAndStore` calls and add the path parameter).

- [ ] **Step 4: Add Voyage timeout**

In `lib/embeddings.js`, add an AbortController timeout to `embedQuery()`:

```javascript
export async function embedQuery(text) {
  if (!VOYAGE_API_KEY || !text) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);

  try {
    const res = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${VOYAGE_API_KEY}` },
      body: JSON.stringify({ model: MODEL, input: [text], input_type: "query" }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`Voyage query embed failed: ${res.status}`);
    const data = await res.json();
    return data.data[0].embedding;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      console.log(JSON.stringify({ event: "voyage_timeout", text_length: text.length }));
      return null; // Graceful degradation: keyword-only results
    }
    throw err;
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add lib/knowledge-db.js lib/rag.js lib/embeddings.js
git commit -m "feat: RRF fusion retrieval with graph boost terms and Voyage timeout"
```

---

## Chunk 4: Prompt Builder + Chat Wiring

### Task 8: Update buildSystemPrompt() with token budget + correction consolidation

**Files:**
- Modify: `lib/prompt.js`

- [ ] **Step 1: Add token estimation + budget logic**

Replace the ontology section in `buildSystemPrompt()`:

```javascript
// Ontology — knowledge graph context (token-budgeted)
if (ontology && ontology.entities?.length > 0) {
  const TOKEN_BUDGET = 400;
  let tokenEstimate = 0;
  const entityLines = [];
  const relationLines = [];

  // Entities are pre-sorted by score from findRelevantEntities
  for (const e of ontology.entities) {
    const line = `- ${e.name} : ${e.description || ""}`;
    const lineTokens = Math.ceil(line.split(/\s+/).length * 1.3);
    if (tokenEstimate + lineTokens > TOKEN_BUDGET) break;
    entityLines.push(line);
    tokenEstimate += lineTokens;
  }

  // Relations (cut first if budget tight)
  if (ontology.relations?.length > 0) {
    const labels = { equals: "=", includes: "contient", contradicts: "≠", causes: "→", uses: "utilise", prerequisite: "necessite" };
    for (const r of ontology.relations) {
      const line = `- ${r.from_name || "?"} ${labels[r.relation_type] || "→"} ${r.to_name || "?"}`;
      const lineTokens = Math.ceil(line.split(/\s+/).length * 1.3);
      if (tokenEstimate + lineTokens > TOKEN_BUDGET) break;
      relationLines.push(line);
      tokenEstimate += lineTokens;
    }
  }

  if (entityLines.length > 0) {
    prompt += "CONCEPTS CLES (utilise-les naturellement) :\n";
    prompt += entityLines.join("\n") + "\n";
    if (relationLines.length > 0) prompt += relationLines.join("\n") + "\n";
    prompt += "\n";
  }
}
```

- [ ] **Step 2: Add correction consolidation**

Replace the corrections section:

```javascript
// Corrections apprises (feedback loop — PRIORITE HAUTE)
if (corrections && corrections.trim().split("\n").length > 3) {
  // Consolidate repeated corrections into permanent rules
  const lines = corrections.split("\n").filter(l => l.startsWith("- **"));
  const consolidated = consolidateCorrections(lines);
  prompt += consolidated + "\n\n";
}
```

Add helper function at the top of the file:

```javascript
function consolidateCorrections(lines) {
  // Group corrections by word overlap (>60% shared words = same rule)
  const groups = [];
  for (const line of lines) {
    const words = new Set(line.toLowerCase().replace(/[^a-zàâéèêëïîôùûüç\s]/g, "").split(/\s+/).filter(w => w.length > 3));
    let merged = false;
    for (const group of groups) {
      const overlap = [...words].filter(w => group.words.has(w)).length;
      const ratio = overlap / Math.max(words.size, group.words.size);
      if (ratio > 0.6) {
        group.lines.push(line);
        for (const w of words) group.words.add(w);
        merged = true;
        break;
      }
    }
    if (!merged) groups.push({ lines: [line], words });
  }

  let result = "";
  for (const group of groups) {
    if (group.lines.length >= 3) {
      // Permanent rule — use most recent correction as representative
      result += `REGLE PERMANENTE (${group.lines.length}x) : ${group.lines[group.lines.length - 1].replace(/^- \*\*\d{4}-\d{2}-\d{2}\*\* — /, "")}\n`;
    } else {
      result += group.lines.join("\n") + "\n";
    }
  }

  return "CORRECTIONS & APPRENTISSAGES (PRIORITE HAUTE) :\n" + result;
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/prompt.js
git commit -m "feat: token-budgeted ontology + correction consolidation in prompt builder"
```

---

### Task 9: Update chat.js execution order (entities → knowledge)

**Files:**
- Modify: `api/chat.js`

- [ ] **Step 1: Change retrieval order**

In `api/chat.js`, replace the parallel knowledge + entity loading with sequential (entities first, then knowledge with boostTerms):

```javascript
// OLD (lines ~54-56):
// const knowledgeMatches = await findRelevantKnowledgeFromDb(personaId, messages);
// const corrections = await getCorrectionsFromDb(personaId);
// const ontology = await findRelevantEntities(personaId, messages);

// NEW: entities first (provides boostTerms), then knowledge (uses boostTerms)
const ontology = await findRelevantEntities(personaId, messages);
const [knowledgeMatches, corrections] = await Promise.all([
  findRelevantKnowledgeFromDb(personaId, messages, ontology.boostTerms),
  getCorrectionsFromDb(personaId),
]);
```

Note: `findRelevantKnowledgeFromDb` now takes a third parameter `boostTerms`. Update the import if needed (it's already exported).

- [ ] **Step 2: Commit**

```bash
git add api/chat.js
git commit -m "feat: sequential entity→knowledge retrieval with boost terms"
```

---

## Chunk 5: Frontend — Conversation Sidebar + State

### Task 10: Add sidebar HTML structure

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add sidebar to chat screen**

In `public/index.html`, find the chat screen div and wrap the chat area in a flex layout with a sidebar:

```html
<!-- Inside screen-chat, BEFORE the existing chat-header -->
<div class="chat-layout">
  <aside class="conv-sidebar" id="conv-sidebar">
    <div class="conv-sidebar-header">
      <button class="conv-new-btn" id="conv-new-btn">+ Nouvelle conversation</button>
      <input type="text" class="conv-search" id="conv-search" placeholder="Rechercher...">
    </div>
    <div class="conv-list" id="conv-list"></div>
  </aside>
  <div class="chat-main">
    <!-- existing chat-header, chat-messages, chat-input-row go here -->
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat: add conversation sidebar HTML structure"
```

---

### Task 11: Style the sidebar

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: Add sidebar styles**

```css
.chat-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.conv-sidebar {
  width: 280px;
  min-width: 280px;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.conv-sidebar-header {
  padding: 1rem;
  border-bottom: 1px solid var(--border);
}

.conv-new-btn {
  width: 100%;
  padding: 0.5rem;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.85rem;
  margin-bottom: 0.5rem;
}

.conv-search {
  width: 100%;
  padding: 0.5rem;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-size: 0.8rem;
}

.conv-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
}

.conv-item {
  padding: 0.75rem;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 2px;
  transition: background 0.15s;
}

.conv-item:hover { background: var(--bg); }
.conv-item.active { background: var(--bg); border-left: 2px solid var(--accent); }

.conv-item-title {
  font-size: 0.85rem;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.conv-item-meta {
  font-size: 0.7rem;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* Mobile: hide sidebar */
@media (max-width: 768px) {
  .conv-sidebar { display: none; }
}
```

- [ ] **Step 2: Commit**

```bash
git add public/style.css
git commit -m "feat: conversation sidebar styling"
```

---

### Task 12: Wire up frontend conversation logic

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Replace history with conversation state**

At the top of `app.js`, replace:
```javascript
let history = [];
```
with:
```javascript
let currentConversationId = null;
```

- [ ] **Step 2: Add conversation list loading**

Add new functions after the existing `selectPersona()`:

```javascript
async function loadConversations(personaId) {
  try {
    const resp = await fetch(`/api/conversations?persona=${personaId}`, {
      headers: { "x-access-code": accessCode },
    });
    if (!resp.ok) return;
    const data = await resp.json();
    renderConversationList(data.conversations);
  } catch {}
}

function renderConversationList(conversations) {
  const list = $("conv-list");
  list.innerHTML = "";
  for (const conv of conversations) {
    const item = document.createElement("div");
    item.className = "conv-item" + (conv.id === currentConversationId ? " active" : "");
    const timeAgo = getRelativeTime(conv.last_message_at);
    item.innerHTML = `<div class="conv-item-title">${conv.title || "Sans titre"}</div>
      <div class="conv-item-meta">${timeAgo} · ${conv.message_count} msg</div>`;
    item.addEventListener("click", () => loadConversation(conv.id));
    list.appendChild(item);
  }
}

function getRelativeTime(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `il y a ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days}j`;
}

async function loadConversation(convId) {
  currentConversationId = convId;
  localStorage.setItem(`conv_${currentPersonaId}`, convId);

  try {
    const resp = await fetch(`/api/conversations?id=${convId}`, {
      headers: { "x-access-code": accessCode },
    });
    if (!resp.ok) return;
    const data = await resp.json();

    // Clear and rebuild chat
    $("chat-messages").innerHTML = "";
    const sc = config.scenarios[currentScenario];
    addMessage("bot", sc?.welcome || `Bonjour, je suis ${config.name}.`);

    for (const msg of data.messages) {
      addMessage(msg.role === "user" ? "user" : "bot", msg.content);
    }

    // Highlight active conversation
    document.querySelectorAll(".conv-item").forEach(el => el.classList.remove("active"));
    // Refresh the list to show active state
    loadConversations(currentPersonaId);
  } catch {}
}
```

- [ ] **Step 3: Update startChat() to load conversations and check localStorage**

```javascript
function startChat(scenario) {
  currentScenario = scenario;
  currentConversationId = null;
  $("chat-avatar").textContent = config.avatar;
  $("chat-name").textContent = config.name;
  $("chat-messages").innerHTML = "";
  const sc = config.scenarios[scenario];
  addMessage("bot", sc?.welcome || `Bonjour, je suis ${config.name}. Comment puis-je vous aider ?`);
  showScreen("screen-chat");
  $("chat-input").focus();

  // Load conversation list
  loadConversations(currentPersonaId);

  // Resume last conversation from localStorage
  const savedConvId = localStorage.getItem(`conv_${currentPersonaId}`);
  if (savedConvId) loadConversation(savedConvId);
}
```

- [ ] **Step 4: Update sendMessage() to use conversation_id**

In `sendMessage()`, replace the fetch body:
```javascript
body: JSON.stringify({
  message: text,
  scenario: currentScenario,
  persona: currentPersonaId,
  conversation_id: currentConversationId || undefined,
}),
```

Remove the history push at the end of sendMessage (after the streaming loop):
```javascript
// REMOVE these lines:
// history.push({ role: "user", content: text });
// history.push({ role: "assistant", content: botText });
// if (history.length > 20) history = history.slice(history.length - 20);
```

In the SSE `done` handler, capture conversation_id:
```javascript
case "done": {
  if (statusEl) statusEl.remove(); statusEl = null;
  if (evt.conversation_id && !currentConversationId) {
    currentConversationId = evt.conversation_id;
    localStorage.setItem(`conv_${currentPersonaId}`, evt.conversation_id);
    loadConversations(currentPersonaId); // Refresh sidebar
  }
  if (evt.rewritten) {
    botDiv.insertAdjacentHTML("beforeend", `<div class="rewrite-badge">Corrige automatiquement</div>`);
  }
  break;
}
```

- [ ] **Step 5: Wire up sidebar buttons**

```javascript
// New conversation button
$("conv-new-btn").addEventListener("click", () => {
  currentConversationId = null;
  localStorage.removeItem(`conv_${currentPersonaId}`);
  $("chat-messages").innerHTML = "";
  const sc = config.scenarios[currentScenario];
  addMessage("bot", sc?.welcome || `Bonjour, je suis ${config.name}.`);
  $("chat-input").focus();
  document.querySelectorAll(".conv-item").forEach(el => el.classList.remove("active"));
});

// Search
let searchTimeout;
$("conv-search").addEventListener("input", (e) => {
  clearTimeout(searchTimeout);
  const query = e.target.value.trim();
  if (query.length < 2) { loadConversations(currentPersonaId); return; }
  searchTimeout = setTimeout(async () => {
    try {
      const resp = await fetch(`/api/conversations?search=${encodeURIComponent(query)}&persona=${currentPersonaId}`, {
        headers: { "x-access-code": accessCode },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      const list = $("conv-list");
      list.innerHTML = "";
      for (const r of data.results) {
        const item = document.createElement("div");
        item.className = "conv-item";
        item.innerHTML = `<div class="conv-item-title">${r.conversation_title || "Sans titre"}</div>
          <div class="conv-item-meta">${r.message_content_snippet.slice(0, 80)}...</div>`;
        item.addEventListener("click", () => loadConversation(r.conversation_id));
        list.appendChild(item);
      }
    } catch {}
  }, 300);
});
```

- [ ] **Step 6: Verify in browser**

Open the app, create a persona or select existing one, send messages. Verify:
1. Sidebar shows conversations
2. New messages create a conversation
3. Refresh preserves state
4. Click on old conversation loads messages
5. Search works

- [ ] **Step 7: Commit**

```bash
git add public/app.js public/index.html
git commit -m "feat: conversation sidebar with list, resume, search, localStorage persistence"
```

---

## Chunk 6: Update clone.js + Final Integration

### Task 13: Pass source_path in clone.js when embedding

**Files:**
- Modify: `api/clone.js`

- [ ] **Step 1: Find embedAndStore calls and add source_path**

Search for `embedAndStore` in `api/clone.js` and add the file path parameter. The call should look like:

```javascript
// When embedding knowledge file chunks, pass the knowledge file path:
embedAndStore(supabase, chunks, personaId, "knowledge_file", knowledgeFilePath)
```

Exact location depends on the current clone.js structure — find the `embedAndStore` call in the async fire-and-forget section and add the 5th parameter.

- [ ] **Step 2: Commit**

```bash
git add api/clone.js lib/embeddings.js
git commit -m "feat: pass source_path when embedding chunks for RRF provenance"
```

---

### Task 14: End-to-end verification

- [ ] **Step 1: Run the updated match_chunks RPC in Supabase**

Execute the updated `match_chunks` function (from Task 7 Step 2) in Supabase SQL Editor.

- [ ] **Step 2: Test conversation flow**

```bash
# 1. Create a new conversation via chat
curl -s -X POST -H "Content-Type: application/json" -H "x-access-code: CODE" \
  -d '{"message":"Salut Thomas","scenario":"default","persona":"PERSONA_ID"}' \
  http://localhost:3000/api/chat

# 2. List conversations
curl -s -H "x-access-code: CODE" "http://localhost:3000/api/conversations?persona=PERSONA_ID" | jq

# 3. Resume conversation (use the id from step 2)
curl -s -X POST -H "Content-Type: application/json" -H "x-access-code: CODE" \
  -d '{"message":"Comment ca va?","scenario":"default","persona":"PERSONA_ID","conversation_id":"CONV_ID"}' \
  http://localhost:3000/api/chat

# 4. Search
curl -s -H "x-access-code: CODE" "http://localhost:3000/api/conversations?search=Salut&persona=PERSONA_ID" | jq
```

- [ ] **Step 3: Test smart graph retrieval**

Look at the server logs for:
- `directCount` and `graphCount` in entity matching
- `boostTerms` being passed to knowledge retrieval
- Any `voyage_timeout` events (should be none normally)

- [ ] **Step 4: Test in browser**

Open the app, verify:
1. Conversations appear in sidebar
2. Messages persist across refresh
3. Search returns results
4. New conversation clears state

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: conversation persistence + smart knowledge graph — complete"
```
