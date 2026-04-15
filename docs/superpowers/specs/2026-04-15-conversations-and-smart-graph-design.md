# Design: Conversation Persistence + Smart Knowledge Graph

**Date**: 2026-04-15
**Status**: Draft
**Scope**: 2 chantiers — persistence des conversations + knowledge graph intelligent (graph-boosted retrieval)

---

## Context

VoiceClone is a multi-tenant SaaS that clones writing voices from LinkedIn profiles. Two critical gaps block progression from MVP to production tool:

1. **No conversation persistence** — history lives in frontend JS array, lost on refresh. Dealbreaker for agencies managing 5-10 personas daily.
2. **Knowledge graph is a gadget** — entities extracted but dumped as top-10 arbitrary list in prompt. Confidence scores stored but never used. Graph and RAG are parallel silos that don't inform each other.

### Design principles (from LLM Wiki v2 + Karpathy skills)
- **Confidence decay**: entities lose relevance without reinforcement
- **Hybrid search fusion**: keyword + vector + graph combined by ranking, not sequential fallback
- **Consolidation tiers**: repeated corrections become permanent rules
- **Simplicity first**: minimum code that solves the problem, no speculative abstractions
- **Surgical changes**: touch only what's needed, don't refactor unrelated code

### Constraints
- User profile: 1 user manages multiple personas, switches between them
- Conversation features: list + resume + search across history
- Graph scope: graph informs RAG retrieval (not just prompt enrichment)
- Latency budget: < 1s for retrieval (keyword + graph + RAG) before first token
- Auth: out of scope (stays as access_code for now)

---

## Chantier 1: Conversation Persistence

### 1.1 Database Schema

```sql
-- Migration: 004_conversations.sql

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  persona_id uuid REFERENCES personas(id) ON DELETE CASCADE NOT NULL,
  scenario text NOT NULL DEFAULT 'default',
  title text,
  message_count int DEFAULT 0,
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

-- Indexes
CREATE INDEX idx_conversations_client_persona ON conversations(client_id, persona_id);
CREATE INDEX idx_conversations_last_message ON conversations(last_message_at DESC);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);

-- Trigram index for search (requires pg_trgm extension)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_messages_content_trgm ON messages USING gin(content gin_trgm_ops);
```

### 1.2 API: `/api/conversations.js`

Single endpoint handling 3 operations via method + query params:

**GET /api/conversations?persona={id}**
- Auth required (client or admin)
- Returns: `{ conversations: [{ id, title, scenario, message_count, last_message_at, created_at }] }`
- Sorted by `last_message_at DESC`
- Limit 50 per persona

**GET /api/conversations?id={conv_id}**
- Auth required + ownership check (conversation.client_id matches client)
- Returns: `{ conversation: { id, title, scenario }, messages: [{ role, content, created_at }] }`
- Messages: last 50, ordered by `created_at ASC`
- Supports pagination: `?id={conv_id}&before={timestamp}` for loading older messages

**GET /api/conversations?search={query}&persona={id}**
- Auth required
- Uses `ilike` with trigram index: `WHERE content ILIKE '%query%'`
- Returns: `{ results: [{ conversation_id, conversation_title, message_content_snippet, created_at }] }`
- Limit 20 results

### 1.3 Changes to `api/chat.js`

Current body: `{ message, history, scenario, persona }`
New body: `{ message, scenario, persona, conversation_id? }`

Logic:
1. If `conversation_id` provided:
   - Load conversation (verify ownership)
   - Load last 19 messages from `messages` table as history
   - `history` field in body is **ignored** (server is source of truth)
2. If no `conversation_id`:
   - Create new conversation: `{ client_id, persona_id, scenario, title: null }`
   - Return `conversation_id` in SSE `done` event
3. After pipeline completes:
   - Insert user message + assistant message into `messages`
   - Update conversation: `message_count += 2`, `last_message_at = now()`
   - If `title` is null and this is the first exchange: set title = first 50 chars of user message
4. The `history` array param is **removed from the API contract** — the server builds it from DB

### 1.4 Frontend Changes (`public/app.js`)

**New UI elements:**
- Conversation sidebar (left panel on chat screen):
  - List of conversations for current persona, most recent first
  - Each item: title (or "Sans titre"), relative time ("il y a 2h"), message count
  - Click to load conversation
  - "Nouvelle conversation" button at top
- Search input above conversation list
- Active conversation highlighted

**State changes:**
- Remove: `let history = []` global
- Add: `let currentConversationId = null`
- `sendMessage()`: sends `conversation_id` instead of `history`
- On SSE `done` event: if `conversation_id` returned, store it
- On conversation click: fetch messages, populate chat, set `currentConversationId`
- On "Nouvelle conversation": clear chat, set `currentConversationId = null`

**What stays the same:**
- SSE streaming parsing (unchanged)
- Feedback modal flow (unchanged)
- Calibration flow (unchanged)
- Settings modal (unchanged)
- Theme application (unchanged)

### 1.5 Migration path

- `history` field in chat body becomes optional/ignored (backwards compatible)
- Frontend stops sending `history`, sends `conversation_id` instead
- Old clients without update still work (server creates conversation silently)

---

## Chantier 2: Smart Knowledge Graph (Graph-Boosted Retrieval)

### 2.1 Database Changes

```sql
-- Migration: 005_smart_graph.sql

-- Add last_matched_at for confidence decay calculation
ALTER TABLE knowledge_entities
  ADD COLUMN IF NOT EXISTS last_matched_at timestamptz DEFAULT now();

-- Index for efficient decay queries
CREATE INDEX IF NOT EXISTS idx_entities_last_matched
  ON knowledge_entities(persona_id, last_matched_at);
```

### 2.2 Entity Matching: `findRelevantEntities()` rewrite

Current behavior: string match all entities → 1-hop walk → return all matches (no ranking).

New behavior:

```
Input: personaId, messages (last 6)
Output: { entities: [...], relations: [...], boostTerms: string[] }

1. FILTER: exclude entities with confidence < 0.6
2. MATCH: normalize message text, string-match entity names (existing logic)
3. SCORE each matched entity:
     score = confidence × recency_factor
     recency_factor = max(0.5, 1.0 - (days_since_last_match / 60))
   where days_since_last_match uses entity.last_matched_at
4. SORT by score DESC
5. EXPAND: 1-hop graph walk from top 8 entities (existing logic)
6. COLLECT relations: only those connecting entities in the result set, top 6
7. UPDATE: set last_matched_at = now() for all directly matched entities (async, non-blocking)
8. RETURN:
   - entities: top 8, sorted by score
   - relations: top 6 between those entities
   - boostTerms: names of top 5 directly matched entities (for RAG query enrichment)
```

### 2.3 Knowledge Retrieval: `findRelevantKnowledgeFromDb()` rewrite

Current behavior: keyword match → if zero matches, fallback to RAG.

New behavior — **fusion, not fallback**:

```
Input: personaId, messages, boostTerms (from entity matching)
Output: top 3 knowledge matches

1. PHASE 1 (Keyword scoring):
   - For each knowledge file, count how many keywords match the message text
   - Score = matchedKeywords / totalKeywords (proportional, not binary)
   - Keep files with score > 0

2. PHASE 2 (RAG — always runs if embeddings available):
   - Build enriched query: last 3 messages + boostTerms joined by space
   - Call retrieveChunks() with enriched query
   - Each chunk gets its similarity score

3. FUSION (Reciprocal Rank Fusion):
   - Assign ranks in each result set (keyword-matched files, RAG chunks)
   - RRF score = sum(1 / (k + rank)) across lists where item appears
   - k = 60 (standard RRF constant)
   - Items found by BOTH methods get boosted naturally

4. RETURN top 3 results by RRF score
   - Each result: { path, content, source: 'keyword'|'rag'|'hybrid' }
```

**Important**: RAG results are chunks, keyword results are full files. For fusion, a chunk matches a file if it was chunked from that file's content. If a chunk doesn't map to a file, it's treated as its own result.

### 2.4 Prompt Builder: `buildSystemPrompt()` changes

Current: dumps all entities/relations without budget.

New:
- Entities arrive **pre-sorted by score** from `findRelevantEntities()`
- **Token budget**: ontology block capped at ~400 tokens (~200 words)
  - Estimate: each entity line ~15 tokens, each relation line ~12 tokens
  - If 8 entities + 6 relations > 400 tokens: cut relations first, then lowest-scored entities
- **Correction consolidation**: if 3+ corrections contain similar phrasing (>60% overlap via simple word intersection), group them under "REGLE PERMANENTE" label instead of listing each one

### 2.5 Execution Order in `api/chat.js`

Current: entities and knowledge fetched independently in sequence.

New: entities fetched first, their `boostTerms` passed to knowledge retrieval.

```javascript
// 1. Entity matching (with scoring + decay)
const ontology = await findRelevantEntities(personaId, messages);

// 2. Knowledge retrieval (boosted by graph)
const knowledgeMatches = await findRelevantKnowledgeFromDb(
  personaId, messages, ontology.boostTerms
);

// 3. Corrections (unchanged)
const corrections = await getCorrectionsFromDb(personaId);

// 4. Build prompt (with token budget)
const { prompt } = buildSystemPrompt({ persona, knowledgeMatches, scenarioContent, corrections, ontology });
```

This adds ~100-200ms vs current (entity matching must complete before knowledge retrieval starts), well within the 1s budget.

### 2.6 What does NOT change

- `knowledge_entities` and `knowledge_relations` table schemas (only adding `last_matched_at` column)
- `feedback.js` graph extraction logic (unchanged)
- `embeddings.js` chunking and embedding logic (unchanged)
- `rag.js` `retrieveChunks()` function (unchanged — only its caller changes)
- `checks.js` programmatic quality checks (unchanged)
- `pipeline.js` generate → check → rewrite flow (unchanged)
- Clone creation flow in `api/clone.js` (unchanged)
- Calibration flow (unchanged)

---

## File Impact Summary

| File | Change Type | Scope |
|------|------------|-------|
| `supabase/004_conversations.sql` | **NEW** | conversations + messages tables |
| `supabase/005_smart_graph.sql` | **NEW** | last_matched_at column |
| `api/conversations.js` | **NEW** | list, load, search conversations |
| `api/chat.js` | **MODIFY** | conversation_id support, message persistence, entity→knowledge ordering |
| `lib/knowledge-db.js` | **MODIFY** | rewrite findRelevantEntities() + findRelevantKnowledgeFromDb() |
| `lib/prompt.js` | **MODIFY** | token budget, correction consolidation |
| `public/app.js` | **MODIFY** | conversation sidebar, remove history array, search UI |
| `public/index.html` | **MODIFY** | sidebar HTML structure |
| `public/style.css` | **MODIFY** | sidebar styling |

---

## Success Criteria

### Chantier 1 (Conversations)
- [ ] User can see list of past conversations per persona
- [ ] User can resume a conversation and see full history
- [ ] User can search across all conversations for a persona
- [ ] New conversations are created automatically on first message
- [ ] Page refresh preserves conversation state (via URL or localStorage of conversation_id)
- [ ] Old frontend without update still works (backwards compatible)

### Chantier 2 (Smart Graph)
- [ ] Entities with confidence < 0.6 are excluded from matching
- [ ] Entities are ranked by confidence × recency_factor (not arbitrary order)
- [ ] Entity names are passed as boost terms to RAG query
- [ ] Keyword + RAG results are fused (not sequential fallback)
- [ ] Ontology block in prompt stays under ~400 tokens
- [ ] Repeated corrections are consolidated as "REGLE PERMANENTE"
- [ ] Total retrieval time (entities + knowledge) stays under 1s
- [ ] last_matched_at is updated for matched entities
