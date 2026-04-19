# Chat — Dossier prospect à 2 zones — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [docs/superpowers/specs/2026-04-19-chat-dossier-prospect-2-zones-design.md](../specs/2026-04-19-chat-dossier-prospect-2-zones-design.md)

**Goal:** Refondre `/chat/[persona]` en un workspace "dossier prospect" à 2 zones (thread + rail feedback) et déplacer connaissance/intelligence/réglages vers une nouvelle route `/brain/[persona]`, pour aligner l'UI sur le workflow réel d'une agence LinkedIn multi-clones.

**Architecture :**
- **Data layer** (migrations 028/029/030) : nouvelle colonne `messages.turn_kind` orthogonale à `role` et `message_type` ; nouvelle table `feedback_events` conversation-scoped ; colonnes prospect_name/stage/note sur `conversations`.
- **API layer** : nouvel endpoint `/api/feedback-events`, modifications de `api/chat.js` (taggage `clone_draft`) et `api/conversations.js` (champs dossier).
- **UI layer** : nouvelle route `/brain/[persona]` plein écran (3 onglets) ; nouveau layout `/chat/[persona]` à 2 colonnes avec composants dédiés (`ProspectDossierHeader`, `FeedbackRail`, `ChatComposer`, `ChatMessage` modifié).

**Tech Stack :** SvelteKit 2 + Svelte 5 (runes), Supabase Postgres, Vercel serverless, node:test runner.

**Sequencement de déploiement :**
1. Chunk 1 (data + API) — livré seul, pas de changement UI visible. Migrations réversibles, tests API.
2. Chunk 2 (route /brain) — livrable indépendamment, valeur UX standalone (drawer → route).
3. Chunk 3 (chat refonte) — dépend de 1+2. Flip-all avec fallback `turn_kind='legacy'`.

**Pre-merge gate (avant chaque chunk) :** lancer `scripts/critic-prod-check.js` pour vérifier que `/chat/[persona]` reçoit du trafic prod récent (cf. mémoire `feedback_critic_verify_prod_usage` — si zéro trafic sur le chemin, re-prioriser vers génération de trafic).

---

## File Structure

**Nouveaux fichiers :**
- `supabase/028_turn_kind.sql` — migration turn_kind + colonnes associées sur `messages`
- `supabase/029_feedback_events.sql` — nouvelle table `feedback_events`
- `supabase/030_prospect_dossier.sql` — colonnes sur `conversations`
- `api/feedback-events.js` — endpoint GET (liste) + POST (création)
- `test/api-feedback-events.test.js` — tests endpoint
- `src/routes/brain/[persona]/+page.svelte` — page plein écran 3 onglets
- `src/routes/brain/[persona]/+page.js` — auth guard load function
- `src/lib/components/ProspectDossierHeader.svelte` — header pinné du dossier (nom/stage/note/heat/switcher)
- `src/lib/components/FeedbackRail.svelte` — zone B (rail journal feedback + pill règles)
- `src/lib/components/ChatComposer.svelte` — composer hybride 2-boutons

**Fichiers modifiés :**
- `src/routes/chat/[persona]/+page.svelte` — layout 2-zones, suppression des vieux composants
- `src/lib/components/ChatCockpit.svelte` — allégé (identité + style-health + ⚙ brain)
- `src/lib/components/ChatMessage.svelte` — rendu par `turn_kind`, actions sur drafts
- `src/lib/components/FeedbackPanel.svelte` — submit → POST `/api/feedback-events`
- `src/lib/components/ScenarioSwitcher.svelte` — styles pour embed dans header
- `src/routes/hub/+page.svelte` — lien "⚙ cerveau" sur clone-cards
- `api/chat.js` — tag `turn_kind='clone_draft'` sur sortie assistant
- `api/conversations.js` — PATCH/GET supportent `prospect_name`/`stage`/`note`

**Fichiers supprimés :**
- `src/lib/components/LiveMetricsStrip.svelte` — doublon cockpit
- `src/lib/components/AuditStrip.svelte` — côté chat (hors scope `/admin` migration)
- `src/lib/components/MessageMarginalia.svelte` — contenu migré vers `/brain#intelligence` (Task 2.6)
- `src/lib/components/PersonaBrainDrawer.svelte` — remplacé par route `/brain/[persona]`
- `src/lib/components/HeatThermometer.svelte` — signal réutilisé en indicateur inline, composant supprimé (décision open-question #3 = suppression)

---

## Chunk 1 — Data layer + API

**Livrable :** migrations déployables, endpoint `/api/feedback-events` fonctionnel, `api/chat.js` tag les nouveaux messages, `api/conversations.js` expose les nouveaux champs. **Aucun changement UI visible** mais tous les tests API passent.

**Dépendances :** accès Supabase (env vars `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE`), npm test runner.

### Task 1.1: Migration 028 — `messages.turn_kind`

**Files:**
- Create: `supabase/028_turn_kind.sql`

- [ ] **Step 1: Écrire la migration**

```sql
-- 028_turn_kind.sql
-- Narrative-role axis for messages, orthogonal to role (user/assistant) and
-- message_type (chat/meta from 027). Resolves the historical overload where
-- role='user' designated BOTH operator prompts AND prospect DMs.
--
-- turn_kind values:
--   prospect        — inbound prospect DM (paste ou auto-import Breakcold)
--   clone_draft     — assistant output not yet validated by operator
--   toi             — assistant output validated (= sent to the prospect)
--   draft_rejected  — clone_draft replaced after correction (soft-delete, kept for audit)
--   legacy          — pre-migration rows; ChatMessage renders via compat path
--   meta            — mirror of message_type='meta' for filter symmetry

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS turn_kind text NOT NULL DEFAULT 'legacy'
  CHECK (turn_kind IN ('prospect','clone_draft','toi','draft_rejected','legacy','meta'));

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS draft_of_message_id uuid REFERENCES messages(id);

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS edited_before_send boolean NOT NULL DEFAULT false;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS draft_original text;

COMMENT ON COLUMN messages.turn_kind IS
  'Narrative role axis. Orthogonal to role and message_type (027). See spec 2026-04-19-chat-dossier-prospect-2-zones-design.';

-- Align turn_kind for meta messages so the index on turn_kind returns them too
-- without needing a separate check on message_type.
UPDATE messages SET turn_kind = 'meta' WHERE message_type = 'meta' AND turn_kind = 'legacy';

-- Index supports the very common "last active clone_draft per conversation"
-- lookup that the front will run on every conversation load.
CREATE INDEX IF NOT EXISTS idx_messages_conv_turn_kind
  ON messages(conversation_id, turn_kind, created_at);
```

- [ ] **Step 2: Appliquer la migration localement**

Le repo suit le workflow psql manuel (migrations `.sql` versionnées sans CLI supabase côté projet). `DATABASE_URL` = URL connexion directe pointant sur l'instance cible.

Run:
```bash
psql "$DATABASE_URL" -f supabase/028_turn_kind.sql
```

Expected: `ALTER TABLE` × 4, `UPDATE N` pour le backfill meta, `CREATE INDEX` × 1, pas d'erreur.

- [ ] **Step 3: Vérifier les colonnes et la contrainte**

Run:
```bash
psql "$DATABASE_URL" -c "\d messages" | grep -E "turn_kind|draft_of|edited_before|draft_original"
psql "$DATABASE_URL" -c "SELECT turn_kind, count(*) FROM messages GROUP BY 1 ORDER BY 2 DESC;"
```

Expected : les 4 colonnes présentes, la plupart des rows en `legacy`, les rows `message_type='meta'` en `turn_kind='meta'`.

- [ ] **Step 4: Commit**

```bash
git add supabase/028_turn_kind.sql
git commit -m "feat(db): migration 028 turn_kind orthogonal axis on messages"
```

### Task 1.2: Migration 029 — `feedback_events`

**Files:**
- Create: `supabase/029_feedback_events.sql`

- [ ] **Step 1: Écrire la migration**

```sql
-- 029_feedback_events.sql
-- Conversation-scoped feedback journal. Distinct from learning_events (persona-
-- scoped, payload-typed). Populates the FeedbackRail (zone B) of the new
-- /chat/[persona] layout. See spec 2026-04-19-chat-dossier-prospect-2-zones.

CREATE TABLE IF NOT EXISTS feedback_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  persona_id uuid NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('validated','validated_edited','corrected','saved_rule')),
  correction_text text,
  diff_before text,
  diff_after text,
  rules_fired jsonb NOT NULL DEFAULT '[]'::jsonb,
  learning_event_id uuid REFERENCES learning_events(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_events_conv_created
  ON feedback_events(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_events_persona_created
  ON feedback_events(persona_id, created_at DESC);

COMMENT ON TABLE feedback_events IS
  'Conversation-scoped feedback journal. Populates the FeedbackRail in /chat/[persona].';

-- RLS: follow the 019_rls_baseline pattern — service_role bypasses, explicit
-- policy for documentation. Anon/authenticated see nothing by default.
ALTER TABLE feedback_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all ON feedback_events;
CREATE POLICY service_role_all ON feedback_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Appliquer la migration**

Run: `psql "$DATABASE_URL" -f supabase/029_feedback_events.sql`
Expected: `CREATE TABLE`, 2× `CREATE INDEX`, `ALTER TABLE`, `CREATE POLICY`.

- [ ] **Step 3: Vérifier la table**

Run:
```bash
psql "$DATABASE_URL" -c "\d feedback_events"
psql "$DATABASE_URL" -c "SELECT count(*) FROM feedback_events;"
```

Expected : schema conforme, 0 rows au départ.

- [ ] **Step 4: Commit**

```bash
git add supabase/029_feedback_events.sql
git commit -m "feat(db): migration 029 feedback_events conversation-scoped journal"
```

### Task 1.3: Migration 030 — colonnes dossier sur `conversations`

**Files:**
- Create: `supabase/030_prospect_dossier.sql`

- [ ] **Step 1: Écrire la migration**

```sql
-- 030_prospect_dossier.sql
-- Per-conversation prospect dossier metadata — feeds ProspectDossierHeader.
-- Tous NULL au départ ; éditables inline depuis l'UI.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS prospect_name text,
  ADD COLUMN IF NOT EXISTS stage text,
  ADD COLUMN IF NOT EXISTS note text;

COMMENT ON COLUMN conversations.prospect_name IS 'Displayed in ProspectDossierHeader, editable inline.';
COMMENT ON COLUMN conversations.stage IS 'Freeform tag (e.g. "J+3 relance"). YAGNI: no enum.';
COMMENT ON COLUMN conversations.note IS 'One-line memo visible in header.';
```

- [ ] **Step 2: Appliquer + vérifier**

Run:
```bash
psql "$DATABASE_URL" -f supabase/030_prospect_dossier.sql
psql "$DATABASE_URL" -c "\d conversations" | grep -E "prospect_name|stage|note"
```

Expected : 3 colonnes nullable text présentes.

- [ ] **Step 3: Commit**

```bash
git add supabase/030_prospect_dossier.sql
git commit -m "feat(db): migration 030 prospect dossier fields on conversations"
```

### Task 1.4: Endpoint `/api/feedback-events` — test d'abord (TDD)

**Files:**
- Create: `test/api-feedback-events.test.js`

- [ ] **Step 1: Écrire les tests qui échouent**

```javascript
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

const HAS_DB = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE);

function makeRes() {
  let statusCode = 200, body;
  return {
    setHeader() { return this; },
    status(c) { statusCode = c; return this; },
    json(b) { body = b; return this; },
    end() { return this; },
    get statusCode() { return statusCode; },
    get body() { return body; },
  };
}

describe("GET /api/feedback-events", () => {
  it("returns 400 when conversation id missing", async () => {
    const handler = (await import("../api/feedback-events.js")).default;
    const req = { method: "GET", query: {}, headers: {} };
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /conversation/i);
  });

  it("returns 403 without auth", async () => {
    const handler = (await import("../api/feedback-events.js")).default;
    const req = { method: "GET", query: { conversation: "00000000-0000-0000-0000-000000000000" }, headers: {} };
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 403);
  });

  it("rejects unknown methods", async () => {
    const handler = (await import("../api/feedback-events.js")).default;
    const req = { method: "PUT", query: {}, headers: {} };
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 405);
  });
});

describe("POST /api/feedback-events", { skip: !HAS_DB && "no DB env vars" }, () => {
  it("rejects invalid event_type", async () => {
    const handler = (await import("../api/feedback-events.js")).default;
    const req = {
      method: "POST",
      query: {},
      headers: { "x-access-code": process.env.ADMIN_ACCESS_CODE || "admin" },
      body: { conversation_id: "00000000-0000-0000-0000-000000000000", message_id: "00000000-0000-0000-0000-000000000000", event_type: "nonsense" },
    };
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /event_type/i);
  });
});
```

- [ ] **Step 2: Run the tests — expect FAIL**

Run: `node --test test/api-feedback-events.test.js`
Expected: ERR_MODULE_NOT_FOUND sur `api/feedback-events.js` (cible à créer) ou toutes les assertions échouent.

- [ ] **Step 3: Implémenter l'endpoint**

Create: `api/feedback-events.js`

```javascript
import { authenticateRequest, supabase, setCors, hasPersonaAccess } from "../lib/supabase.js";

const VALID_TYPES = new Set(["validated", "validated_edited", "corrected", "saved_rule"]);

export default async function handler(req, res) {
  setCors(res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (!["GET", "POST"].includes(req.method)) {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Validate query param for GET before auth (cheaper error path)
  if (req.method === "GET" && !req.query?.conversation) {
    res.status(400).json({ error: "conversation query param required" });
    return;
  }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  if (req.method === "GET") {
    const conversationId = req.query.conversation;
    const limit = Math.min(parseInt(req.query?.limit, 10) || 100, 500);

    // Authorize via conversation's persona
    const { data: conv, error: convErr } = await supabase
      .from("conversations").select("id, persona_id, client_id").eq("id", conversationId).single();
    if (convErr || !conv) { res.status(404).json({ error: "Conversation not found" }); return; }

    if (!isAdmin) {
      if (!(await hasPersonaAccess(client?.id, conv.persona_id))) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }

    const { data, error } = await supabase
      .from("feedback_events")
      .select("id, message_id, event_type, correction_text, diff_before, diff_after, rules_fired, learning_event_id, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      res.status(500).json({ error: "Failed to fetch feedback events" });
      return;
    }
    res.json({ events: data || [] });
    return;
  }

  // POST
  const body = req.body || {};
  const { conversation_id, message_id, event_type, correction_text, diff_before, diff_after, rules_fired } = body;

  if (!conversation_id || !message_id || !event_type) {
    res.status(400).json({ error: "conversation_id, message_id, event_type required" });
    return;
  }
  if (!VALID_TYPES.has(event_type)) {
    res.status(400).json({ error: `invalid event_type; must be one of ${[...VALID_TYPES].join(",")}` });
    return;
  }

  const { data: conv, error: convErr } = await supabase
    .from("conversations").select("id, persona_id, client_id").eq("id", conversation_id).single();
  if (convErr || !conv) { res.status(404).json({ error: "Conversation not found" }); return; }

  if (!isAdmin) {
    if (!(await hasPersonaAccess(client?.id, conv.persona_id))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }

  const row = {
    conversation_id,
    message_id,
    persona_id: conv.persona_id,
    event_type,
    correction_text: correction_text || null,
    diff_before: diff_before || null,
    diff_after: diff_after || null,
    rules_fired: Array.isArray(rules_fired) ? rules_fired : [],
  };

  const { data, error } = await supabase
    .from("feedback_events").insert(row).select("id, created_at").single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json({ id: data.id, created_at: data.created_at });
}
```

- [ ] **Step 4: Run tests again — expect PASS**

Run: `node --test test/api-feedback-events.test.js`
Expected: 3 tests OK (non-DB suite), 1 test passes ou skip (selon `HAS_DB`).

- [ ] **Step 5: Commit**

```bash
git add api/feedback-events.js test/api-feedback-events.test.js
git commit -m "feat(api): /api/feedback-events GET+POST with auth + type validation"
```

### Task 1.5: Modifier `api/chat.js` — tag `clone_draft` en sortie SSE

**Files:**
- Modify: `api/chat.js` (insertion du message assistant + backfill)

- [ ] **Step 1: Localiser les insertions assistant dans `api/chat.js`**

Au moment de la rédaction, `api/chat.js` contient **3 insertions assistant** (les lignes peuvent avoir drift — utiliser le grep pour confirmer) :
- ~ligne 209 : insertion de la réponse principale assistant (chat normal)
- ~ligne 252 : insertion du raccourci NEGATIVE (`message_type: 'meta'`)
- ~ligne 303 : insertion du raccourci INSTRUCTION (`message_type: 'meta'`)

Run: `grep -n "role:\s*['\"]assistant['\"]" api/chat.js` pour confirmer les numéros exacts avant édition.

- [ ] **Step 2: Ajouter `turn_kind` aux 3 insertions**

Pour chacune des 3 insertions assistant identifiées en Step 1, ajouter explicitement le champ `turn_kind` au payload de l'insert :
- **Réponse principale (~l.209)** — ajouter `turn_kind: 'clone_draft'`
- **Raccourci NEGATIVE (~l.252)** — ajouter `turn_kind: 'meta'` (le message_type='meta' existant est préservé)
- **Raccourci INSTRUCTION (~l.303)** — ajouter `turn_kind: 'meta'`

**Ne pas modifier** les insertions `role: 'user'` pendant Chunk 1 : le composer actuel envoie encore des prompts opérateur, non des DM prospect. Le taggage user `prospect` arrive au Chunk 3 avec le nouveau composer.

- [ ] **Step 3: Ajouter un test smoke de régression**

Create ou update: `test/api-chat-turn-kind.test.js`

Test de garde **static (regex sur le source)** pour éviter de régresser plus tard. Robustesse du regex : suffisante tant que les insertions assistant restent sur une ligne logique ou sur un bloc compact (cas actuel). Si le code est reformaté en objets multi-lignes profondément imbriqués, ce test lancera un faux positif — c'est un signal acceptable car il force le rédacteur à vérifier manuellement.

```javascript
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import fs from "node:fs/promises";

describe("api/chat.js turn_kind tagging (static check)", () => {
  it("assistant insertions include turn_kind", async () => {
    const src = await fs.readFile(new URL("../api/chat.js", import.meta.url), "utf8");
    // Window of 300 chars after each `role: 'assistant'` to absorb multiline objects
    const matches = [...src.matchAll(/role:\s*['"]assistant['"]([^}]{0,300}|[\s\S]{0,300}?\})/g)];
    assert.ok(matches.length >= 3, `expected at least 3 assistant inserts in api/chat.js, got ${matches.length}`);
    for (const m of matches) {
      assert.match(m[0], /turn_kind/, `insert missing turn_kind: ${m[0].slice(0, 120).replace(/\s+/g, " ")}`);
    }
  });
});
```

- [ ] **Step 4: Run the static test**

Run: `node --test test/api-chat-turn-kind.test.js`
Expected: PASS après Step 2.

- [ ] **Step 5: Commit**

```bash
git add api/chat.js test/api-chat-turn-kind.test.js
git commit -m "feat(api): chat.js tags assistant inserts with turn_kind=clone_draft"
```

### Task 1.6: Modifier `api/conversations.js` — GET/PATCH prospect fields

**Files:**
- Modify: `api/conversations.js`

- [ ] **Step 1: Écrire les tests**

Create or append: `test/api-conversations-dossier.test.js`

```javascript
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

function makeRes() {
  let statusCode = 200, body;
  return {
    setHeader() { return this; },
    status(c) { statusCode = c; return this; },
    json(b) { body = b; return this; },
    end() { return this; },
    get statusCode() { return statusCode; },
    get body() { return body; },
  };
}

describe("PATCH /api/conversations — dossier fields", () => {
  it("rejects PATCH without id", async () => {
    const handler = (await import("../api/conversations.js")).default;
    const req = { method: "PATCH", query: {}, headers: {}, body: { prospect_name: "Marie" } };
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
  });

  it("accepts prospect_name/stage/note alongside title (shape check)", async () => {
    // Static shape check — doesn't hit DB
    const src = await (await import("node:fs/promises")).readFile(new URL("../api/conversations.js", import.meta.url), "utf8");
    assert.match(src, /prospect_name/, "handler should reference prospect_name");
    assert.match(src, /\bstage\b/, "handler should reference stage");
    assert.match(src, /\bnote\b/, "handler should reference note");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL on shape check**

Run: `node --test test/api-conversations-dossier.test.js`
Expected: le 2e test échoue (shape check).

- [ ] **Step 3: Étendre `api/conversations.js`**

**Conserver intouchés** : les imports en haut de fichier, le bloc `authenticateRequest` (lignes ~7-13), les blocs DELETE et GET. On remplace uniquement le bloc PATCH existant (lignes ~15-35) par la version étendue ci-dessous.

```javascript
// Remplacement du bloc PATCH existant (autour de la ligne 16-35)
if (req.method === "PATCH") {
  const { id } = req.query || {};
  const { title, prospect_name, stage, note } = req.body || {};

  if (!id) { res.status(400).json({ error: "id query param required" }); return; }

  // Build partial update — only fields actually provided are patched
  const patch = {};
  if (typeof title === "string") {
    if (!title.trim()) { res.status(400).json({ error: "title empty" }); return; }
    patch.title = title.trim().slice(0, 100);
  }
  if (typeof prospect_name === "string") patch.prospect_name = prospect_name.trim().slice(0, 120) || null;
  if (typeof stage === "string")         patch.stage = stage.trim().slice(0, 60) || null;
  if (typeof note === "string")          patch.note = note.trim().slice(0, 300) || null;

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "no updatable fields provided" });
    return;
  }

  const { data: conv, error: convErr } = await supabase
    .from("conversations").select("id, client_id").eq("id", id).single();
  if (convErr || !conv) { res.status(404).json({ error: "Not found" }); return; }
  if (!isAdmin && conv.client_id !== client.id) { res.status(403).json({ error: "Forbidden" }); return; }

  const { error: updateErr } = await supabase
    .from("conversations").update(patch).eq("id", id);
  if (updateErr) { res.status(500).json({ error: updateErr.message }); return; }

  res.json({ ok: true, patch });
  return;
}
```

Et dans le bloc GET (lecture single conversation, autour de la ligne 66), vérifier que le `select("*")` inclut déjà les nouveaux champs (c'est le cas avec `*`, donc rien à changer).

- [ ] **Step 4: Run tests — expect PASS**

Run: `node --test test/api-conversations-dossier.test.js`
Expected: 2/2 PASS.

- [ ] **Step 5: Commit**

```bash
git add api/conversations.js test/api-conversations-dossier.test.js
git commit -m "feat(api): conversations PATCH supports prospect_name/stage/note"
```

### Task 1.7: Vérifier l'ensemble du chunk 1

- [ ] **Step 1: Lancer la totalité des tests**

Run: `npm test`
Expected: toutes les suites passent (nouvelles + anciennes).

- [ ] **Step 2: Pre-merge gate**

Run:
```bash
node scripts/critic-prod-check.js
```

Attendu : message confirmant que `/chat/[persona]` a reçu au moins 1 message utilisateur dans les 7 derniers jours (cf. mémoire). Si zéro trafic, stopper et re-prioriser avant d'aller plus loin.

- [ ] **Step 3: Commit tag de fin de chunk**

```bash
git tag chunk-1-complete
git log --oneline -10
```

**Livrable Chunk 1 validé quand :**
- 3 migrations déployées et vérifiées
- `/api/feedback-events` répond correctement à GET+POST, avec validation et auth
- `api/chat.js` tag `turn_kind='clone_draft'` sur chaque insertion assistant
- `api/conversations.js` accepte `prospect_name/stage/note` en PATCH
- Toute la suite de tests passe
- Pre-merge gate OK

---

## Chunk 2 — Route `/brain/[persona]` + démantèlement du drawer

**Livrable :** nouvelle route plein écran avec 3 onglets (connaissance/intelligence/réglages), points d'entrée depuis hub et chat, `PersonaBrainDrawer.svelte` supprimé, toutes les références mises à jour. **Valeur UX indépendante** : peut être déployée avant Chunk 3.

**Dépendances :** aucune côté data (les panels embed utilisent déjà `personaId`). Le chunk 1 peut être déployé en amont ou pas — la route n'a pas besoin de `turn_kind`/`feedback_events`.

### Task 2.1: Créer la load function `+page.js` pour `/brain/[persona]`

**Files:**
- Create: `src/routes/brain/[persona]/+page.js`

- [ ] **Step 1: Écrire la load function**

```javascript
// Route load : retourne personaId pour la page. Le SvelteKit layout parent
// (`+layout.svelte`) gère déjà le redirect auth via accessCode/sessionToken.
// Pas de fetch côté serveur — les panels font leur propres fetch client.
export function load({ params }) {
  return {
    personaId: params.persona,
  };
}
```

- [ ] **Step 2: Commit (partiel — on valide en Step 2.2)**

Ne commit pas encore — la route sans page.svelte ne rend rien. Passe à Task 2.2 immédiatement.

### Task 2.2: Créer `+page.svelte` du shell 3-onglets

**Files:**
- Create: `src/routes/brain/[persona]/+page.svelte`

- [ ] **Step 1: Écrire le shell complet**

Le shell est un clone trimmé de `PersonaBrainDrawer.svelte` (lignes 52-80 pour le body, 82-126 pour les styles), sans la shell `SidePanel` et sans l'onglet `règles` (les règles vivent désormais dans le rail chat, cf. spec §5).

```svelte
<script>
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { accessCode, sessionToken } from "$lib/stores/auth.js";
  import { personaConfig } from "$lib/stores/persona.js";
  import KnowledgePanel from "$lib/components/KnowledgePanel.svelte";
  import IntelligencePanel from "$lib/components/IntelligencePanel.svelte";
  import SettingsPanel from "$lib/components/SettingsPanel.svelte";

  let { data } = $props();
  let personaId = $derived(data.personaId);

  const TABS = [
    { id: "connaissance", label: "connaissance" },
    { id: "intelligence", label: "intelligence" },
    { id: "reglages",     label: "réglages" },
  ];

  // Read the tab from the URL hash (#connaissance / #intelligence / #reglages),
  // default to connaissance. Keep the hash in sync as the user switches tabs
  // so deep-links from cockpit/hub land on the correct section.
  let activeTab = $state("connaissance");

  $effect(() => {
    const hash = ($page.url.hash || "").replace(/^#/, "");
    if (TABS.some(t => t.id === hash)) activeTab = hash;
  });

  function selectTab(id) {
    activeTab = id;
    if (typeof window !== "undefined") {
      history.replaceState(null, "", `#${id}`);
    }
  }

  let intelligenceExtracting = $state(false);
  function handleKnowledgeUpload() {
    intelligenceExtracting = true;
    setTimeout(() => { intelligenceExtracting = false; }, 15_000);
  }

  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      history.back();
    } else {
      goto(`/chat/${personaId}`);
    }
  }

  // Client-side auth guard (the parent +layout.svelte also guards but we
  // early-return if the user landed here directly without a session).
  $effect(() => {
    if (typeof window === "undefined") return;
    if (!$accessCode && !$sessionToken) goto("/");
  });
</script>

<svelte:head><title>Cerveau — {$personaConfig?.name || "Clone"}</title></svelte:head>

<div class="brain-page">
  <header class="brain-head">
    <button class="back-btn" onclick={goBack} aria-label="Retour">← retour</button>
    <div class="title">
      <span class="avatar">{$personaConfig?.avatar || "?"}</span>
      <h1>Cerveau — {$personaConfig?.name || "Clone"}</h1>
    </div>
  </header>

  <nav class="tabs" role="tablist">
    {#each TABS as tab}
      <button
        class="tab mono"
        class:active={activeTab === tab.id}
        role="tab"
        aria-selected={activeTab === tab.id}
        onclick={() => selectTab(tab.id)}
      >{tab.label}</button>
    {/each}
  </nav>

  <main class="tab-body" role="tabpanel">
    {#if activeTab === "connaissance"}
      <KnowledgePanel {personaId} onupload={handleKnowledgeUpload} />
    {:else if activeTab === "intelligence"}
      <IntelligencePanel {personaId} extracting={intelligenceExtracting} />
    {:else if activeTab === "reglages"}
      <SettingsPanel embedded={true} {personaId} onClose={goBack} />
    {/if}
  </main>
</div>

<style>
  .brain-page {
    max-width: 960px;
    margin: 0 auto;
    padding: 24px 24px 64px;
    min-height: 100dvh;
  }
  .brain-head {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 24px;
  }
  .back-btn {
    background: transparent;
    border: 1px solid var(--rule-strong);
    padding: 6px 10px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-60);
    cursor: pointer;
  }
  .back-btn:hover { color: var(--ink); }
  .title { display: flex; align-items: center; gap: 10px; }
  .title .avatar { font-size: 22px; }
  .title h1 { margin: 0; font-size: 18px; font-weight: 500; }

  .tabs {
    display: flex;
    border-bottom: 1px solid var(--rule-strong);
    margin-bottom: 16px;
  }
  .tab {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--ink-40);
    padding: 10px 14px;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: lowercase;
    cursor: pointer;
    transition: color 0.1s, border-color 0.1s;
  }
  .tab:hover { color: var(--ink); }
  .tab.active {
    color: var(--ink);
    border-bottom-color: var(--vermillon);
    font-weight: 600;
  }
  .tab-body {
    padding: 0;
  }
</style>
```

- [ ] **Step 2: Lancer le dev server et vérifier le rendu**

Run:
```bash
npm run dev
```
Ouvrir `http://localhost:5173/brain/<un_persona_id>` (depuis URL de chat existante).
Expected :
- Page rendue avec back-btn, titre, 3 onglets
- Onglet `connaissance` actif par défaut, contenu `KnowledgePanel` visible
- Clic onglet `intelligence` → URL hash passe à `#intelligence`, `IntelligencePanel` affiché
- Deep-link `/brain/<id>#intelligence` en nouvelle entrée → onglet intelligence actif direct

Stop dev server (Ctrl+C) après vérif.

- [ ] **Step 3: Commit**

```bash
git add src/routes/brain
git commit -m "feat(brain): new /brain/[persona] route with 3 tabs (connaissance/intelligence/réglages)"
```

### Task 2.3: Chat cockpit — remplacer ouverture drawer par `goto /brain`

**Files:**
- Modify: `src/routes/chat/[persona]/+page.svelte` (handler brainOpen + suppression du drawer)
- Modify: `src/lib/components/ChatCockpit.svelte` (callback du ⚙ trigger)

- [ ] **Step 1: Localiser le handler actuel**

Run:
```bash
grep -n "brainOpen\|onToggleBrain\|PersonaBrainDrawer" src/routes/chat/[persona]/+page.svelte src/lib/components/ChatCockpit.svelte
```

Noter les occurrences :
- Dans `+page.svelte` : déclaration `brainOpen`, `$effect` lazy-load, callback `onToggleBrain`, bloc `{#if PersonaBrainDrawer}` en bas
- Dans `ChatCockpit.svelte` : prop `brainOpen`, callback `onToggleBrain`, bouton ⚙

- [ ] **Step 2: Remplacer `onToggleBrain` par navigation**

Dans `src/routes/chat/[persona]/+page.svelte` :
- Supprimer les lignes `let brainOpen = $state(false);` et `let brainInitialTab = $state("règles");`
- Supprimer le `$effect` qui lazy-load `PersonaBrainDrawer`
- Supprimer la variable `let PersonaBrainDrawer = $state(null);`
- Supprimer l'import `import("$lib/components/PersonaBrainDrawer.svelte")` (déjà inclus dans le lazy-load)
- Supprimer le bloc `{#if PersonaBrainDrawer} <PersonaBrainDrawer ... /> {/if}` en bas
- Remplacer le callback `onToggleBrain={() => { … brainOpen = !brainOpen; }}` passé à `ChatCockpit` par `onOpenBrain={() => goto(\`/brain/\${personaId}\`)}`
- Ajouter l'import `import { goto } from "$app/navigation"` s'il n'y est pas déjà

Dans `src/lib/components/ChatCockpit.svelte` :
- Renommer la prop `onToggleBrain` en `onOpenBrain` (signature unchanged)
- Supprimer les props `brainOpen`, `journalOpen`, `sidebarOpen`, `leadOpen` si elles ne servent plus qu'à afficher l'état "actif" du bouton (à arbitrer — si le cockpit utilise la prop pour styler le bouton actif, on peut la garder mais elle ne sert plus à rien une fois le drawer supprimé)
- Dans le template, remplacer `onclick={onToggleBrain}` par `onclick={onOpenBrain}`

- [ ] **Step 3: Lancer dev server et vérifier le comportement**

Run: `npm run dev`
Ouvrir `/chat/<un_persona_id>`, cliquer sur ⚙ dans le cockpit.
Expected : navigation vers `/brain/<id>` (plus de drawer latéral).

- [ ] **Step 4: Commit**

```bash
git add src/routes/chat/[persona]/+page.svelte src/lib/components/ChatCockpit.svelte
git commit -m "refactor(chat): cockpit ⚙ navigates to /brain instead of opening drawer"
```

### Task 2.4: Hub — lien "⚙ cerveau" sur chaque clone-card

**Files:**
- Modify: `src/routes/hub/+page.svelte` (ajout du lien dans le template clone-card)

- [ ] **Step 1: Localiser le template `clone-card`**

Run: `grep -n "clone-card\|fidelity-chip" src/routes/hub/+page.svelte`

- [ ] **Step 2: Ajouter un lien discret "⚙ cerveau"**

Dans le template, après (ou à côté de) la `fidelity-chip`, ajouter un lien navigant vers `/brain/<persona.id>`. Exemple à adapter selon le markup exact :

```svelte
<a
  class="brain-link mono"
  href="/brain/{entry.persona.id}"
  onclick={(e) => e.stopPropagation()}
  aria-label="Cerveau du clone {entry.persona.name}"
>⚙ cerveau</a>
```

Le `stopPropagation` évite que le clic sur le lien déclenche aussi le clic parent (qui navigue vers `/chat/[id]`).

Styles minimaux à ajouter dans `<style>` :

```css
.brain-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  color: var(--ink-40);
  text-decoration: none;
  padding: 4px 8px;
  border: 1px solid var(--rule);
  border-radius: 2px;
}
.brain-link:hover {
  color: var(--ink);
  border-color: var(--rule-strong);
}
```

- [ ] **Step 3: Vérifier dans le dev server**

Run: `npm run dev`
Ouvrir `/hub`, vérifier qu'un petit bouton "⚙ cerveau" apparaît sur chaque clone-card, clic → navigation `/brain/[id]` sans déclencher la navigation vers le chat.

- [ ] **Step 4: Commit**

```bash
git add src/routes/hub/+page.svelte
git commit -m "feat(hub): discreet brain link on each clone-card"
```

### Task 2.5: Style-health badge → deep-link `/brain#intelligence`

**Files:**
- Modify: `src/lib/components/ChatCockpit.svelte` (click handler sur le badge)

- [ ] **Step 1: Localiser le badge**

Run: `grep -n "styleHealth\|style-health" src/lib/components/ChatCockpit.svelte`

- [ ] **Step 2: Rendre le badge cliquable**

Envelopper le markup du badge dans un `<button>` (ou `<a>`) qui navigue vers `/brain/<personaId>#intelligence`. Ajouter une prop `personaId` au cockpit si elle n'est pas déjà passée (elle l'est déjà côté `+page.svelte:690`).

Exemple :
```svelte
<button class="health-badge" type="button" onclick={() => goto(`/brain/${currentPersonaId}#intelligence`)} aria-label="Voir diagnostic style">
  <!-- markup existant du badge -->
</button>
```

Ajouter `import { goto } from "$app/navigation"` en haut du cockpit.

- [ ] **Step 3: Vérifier**

Dev server, ouvrir `/chat/<id>`, cliquer la pastille style-health → arrive sur `/brain/<id>` onglet Intelligence actif.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/ChatCockpit.svelte
git commit -m "feat(cockpit): style-health badge deep-links to /brain#intelligence"
```

### Task 2.6: Supprimer `PersonaBrainDrawer.svelte`

**Files:**
- Delete: `src/lib/components/PersonaBrainDrawer.svelte`

- [ ] **Step 1: Vérifier l'absence de référence restante**

Run:
```bash
grep -rn "PersonaBrainDrawer" src/ api/ test/ docs/
```

Expected : seulement des références dans `docs/superpowers/plans/` et `docs/superpowers/specs/` (historique), **aucune dans src/ ni api/**. Si Task 2.3 a bien été faite, ça devrait être clean.

Si des références persistent dans `src/`, les supprimer avant le delete.

- [ ] **Step 2: Supprimer le fichier**

Run:
```bash
rm src/lib/components/PersonaBrainDrawer.svelte
```

- [ ] **Step 3: Vérifier le build**

Run: `npm run build`
Expected : build OK, pas d'erreur module not found.

- [ ] **Step 4: Commit**

```bash
git add -A src/lib/components/PersonaBrainDrawer.svelte
git commit -m "chore(cleanup): remove PersonaBrainDrawer.svelte — replaced by /brain route"
```

### Task 2.7: Vérification fin de chunk 2

- [ ] **Step 1: Suite de tests**

Run: `npm test`
Expected : toutes les suites passent (le chunk 2 ne touche pas les API, donc aucune régression data attendue).

- [ ] **Step 2: Smoke test UI manuel**

Dev server, parcours :
1. `/hub` → clique "⚙ cerveau" sur une clone-card → `/brain/<id>` (connaissance actif)
2. Clique onglet `intelligence` → URL hash `#intelligence`, panel intelligence rendu
3. Clique onglet `réglages` → hash `#reglages`, SettingsPanel rendu
4. Back browser → retour au hub
5. Depuis `/chat/<id>` → clic ⚙ cockpit → `/brain/<id>`
6. Depuis `/chat/<id>` → clic badge style-health → `/brain/<id>#intelligence` direct

Expected : tous les parcours fonctionnent sans erreur console.

- [ ] **Step 3: Tag**

```bash
git tag chunk-2-complete
```

**Livrable Chunk 2 validé quand :**
- Route `/brain/[persona]` rendue avec 3 onglets fonctionnels
- Deep-link par hash OK (`#connaissance`, `#intelligence`, `#reglages`)
- 3 points d'entrée fonctionnels (hub clone-card, chat cockpit ⚙, chat style-health badge)
- `PersonaBrainDrawer.svelte` supprimé, aucune référence dans `src/`
- Build clean, tests passent

---

## Chunk 3 — `/chat/[persona]` refonte 2-zones

**Livrable :** nouveau layout complet à 2 zones (thread dossier prospect + rail feedback), 3 nouveaux composants, démantèlement des métriques éparpillées, wiring complet des actions ✓/✎/↻/📏. Dépend de Chunk 1 (data model `turn_kind`, table `feedback_events`) et Chunk 2 (route `/brain` existe, drawer supprimé).

**Dépendances :** Chunk 1 + Chunk 2 déployés.

### Task 3.1: `ProspectDossierHeader.svelte` — header pinné

**Files:**
- Create: `src/lib/components/ProspectDossierHeader.svelte`

- [ ] **Step 1: Écrire le composant**

```svelte
<script>
  import { api, authHeaders } from "$lib/api.js";
  import ScenarioSwitcher from "./ScenarioSwitcher.svelte";

  let {
    conversation = null,      // { id, prospect_name, stage, note, last_message_at, ... }
    feedbackCount = 0,        // dérivé du rail (passé par parent)
    heat = null,              // { state: 'cold'|'warm'|'hot', delta: number|null }
    persona = null,           // pour ScenarioSwitcher
    scenarioType = null,
    onScenarioChange,
    onUpdate,                 // (patch) => Promise — parent remonte vers /api/conversations PATCH
  } = $props();

  // Local editable state — synced on blur/enter.
  let localName = $state(conversation?.prospect_name || "");
  let localStage = $state(conversation?.stage || "");
  let localNote = $state(conversation?.note || "");
  let editingField = $state(null); // 'name' | 'stage' | 'note' | null

  $effect(() => {
    // Re-sync if conversation prop changes (selected another conv)
    localName = conversation?.prospect_name || "";
    localStage = conversation?.stage || "";
    localNote = conversation?.note || "";
  });

  async function commit(field, value) {
    editingField = null;
    const patch = { [field]: value.trim() };
    if (patch[field] === (conversation?.[field] || "")) return;
    await onUpdate?.(patch);
  }

  function fmtRelative(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "à l'instant";
    if (mins < 60) return `il y a ${mins} min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `il y a ${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `il y a ${days}j`;
  }

  let heatLabel = $derived.by(() => {
    if (!heat?.state) return null;
    if (heat.state === "cold") return { emoji: "❄", text: "froid" };
    if (heat.state === "warm") return { emoji: "◐", text: "tiède" };
    if (heat.state === "hot")  return { emoji: "●", text: "chaud" };
    return null;
  });
</script>

<header class="dossier-head mono">
  <div class="row-1">
    <!-- Name -->
    {#if editingField === "name"}
      <input
        class="field-input name"
        bind:value={localName}
        onblur={() => commit("prospect_name", localName)}
        onkeydown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { localName = conversation?.prospect_name || ""; editingField = null; } }}
        autofocus
      />
    {:else}
      <button class="field-display name" onclick={() => editingField = "name"}>
        {localName || "prospect sans nom"}
      </button>
    {/if}

    <span class="sep">·</span>

    <!-- Stage -->
    {#if editingField === "stage"}
      <input
        class="field-input stage"
        bind:value={localStage}
        onblur={() => commit("stage", localStage)}
        onkeydown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { localStage = conversation?.stage || ""; editingField = null; } }}
        placeholder="stage…"
        autofocus
      />
    {:else}
      <button class="field-display stage" onclick={() => editingField = "stage"}>
        {localStage || "+ stage"}
      </button>
    {/if}

    <span class="sep">·</span>

    <!-- Heat -->
    {#if heatLabel}
      <span class="heat heat-{heat.state}" aria-label="chaleur conversation">
        {heatLabel.emoji} {heatLabel.text}
      </span>
      <span class="sep">·</span>
    {/if}

    <!-- Last contact -->
    <span class="last">dernier : {fmtRelative(conversation?.last_message_at)}</span>

    <!-- Scenario (tout à droite) -->
    {#if persona}
      <div class="scenario-slot">
        <ScenarioSwitcher {persona} value={scenarioType} onchange={onScenarioChange} />
      </div>
    {/if}
  </div>

  <div class="row-2">
    <!-- Note -->
    {#if editingField === "note"}
      <input
        class="field-input note"
        bind:value={localNote}
        onblur={() => commit("note", localNote)}
        onkeydown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { localNote = conversation?.note || ""; editingField = null; } }}
        placeholder="note : ex: 'voit une démo lundi 17h'"
        autofocus
      />
    {:else}
      <button class="field-display note" onclick={() => editingField = "note"}>
        {localNote ? `note : ${localNote}` : "+ note"}
      </button>
    {/if}

    <!-- Feedback count -->
    <span class="fb-count">{feedbackCount} correction{feedbackCount === 1 ? "" : "s"}</span>
  </div>
</header>

<style>
  .dossier-head {
    position: sticky;
    top: 0;
    z-index: 3;
    background: var(--paper);
    border-bottom: 1px solid var(--rule);
    padding: 10px 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--ink-80);
  }
  .row-1 { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .row-2 { display: flex; align-items: center; gap: 8px; color: var(--ink-60); font-size: 11px; }
  .sep { color: var(--ink-40); }
  .field-display,
  .field-input {
    background: transparent;
    border: none;
    padding: 2px 4px;
    font: inherit;
    color: inherit;
    cursor: text;
    border-bottom: 1px dashed transparent;
  }
  .field-display:hover { border-bottom-color: var(--ink-40); }
  .field-input:focus {
    outline: none;
    border-bottom-color: var(--vermillon);
  }
  .name.field-display,
  .name.field-input { font-weight: 600; color: var(--ink); }
  .heat { font-weight: 500; }
  .heat-cold { color: #4a6fa5; }
  .heat-warm { color: #b37e3b; }
  .heat-hot  { color: var(--vermillon); }
  .scenario-slot { margin-left: auto; }
  .fb-count { margin-left: auto; font-weight: 500; }
</style>
```

- [ ] **Step 2: Commit (test d'intégration viendra via wiring parent)**

```bash
git add src/lib/components/ProspectDossierHeader.svelte
git commit -m "feat(chat): ProspectDossierHeader with inline-editable name/stage/note"
```

### Task 3.2: `ChatComposer.svelte` — composer hybride 2-boutons

**Files:**
- Create: `src/lib/components/ChatComposer.svelte`

- [ ] **Step 1: Écrire le composant**

```svelte
<script>
  let {
    disabled = false,
    scenarioType = null,
    onAddProspect,   // (text) => void
    onDraftNext,     // ({ consigne }) => void
  } = $props();

  let text = $state("");
  let textareaEl = $state(undefined);

  // Charcount target (POST/DM) — repris de ChatInput.svelte existant
  const POST_RANGE = { min: 1200, max: 1500 };
  const DM_RANGE = { min: 150, max: 280 };

  let target = $derived(
    !scenarioType ? null :
    scenarioType.startsWith("DM") ? DM_RANGE :
    scenarioType.startsWith("post") ? POST_RANGE :
    null
  );
  let chars = $derived(text.length);
  let countState = $derived(
    !target || chars === 0 ? "idle" :
    chars < target.min ? "under" :
    chars > target.max ? "over" : "ok"
  );

  $effect(() => { if (textareaEl) textareaEl.focus(); });

  function autoResize() {
    if (!textareaEl) return;
    textareaEl.style.height = "auto";
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, 180) + "px";
  }

  function addProspect() {
    const msg = text.trim();
    if (!msg || disabled) return;
    text = "";
    if (textareaEl) textareaEl.style.height = "auto";
    onAddProspect?.(msg);
  }

  function draftNext() {
    if (disabled) return;
    const consigne = text.trim() || null;
    text = "";
    if (textareaEl) textareaEl.style.height = "auto";
    onDraftNext?.({ consigne });
  }

  function handleKeydown(e) {
    // Cmd/Ctrl+Enter = draft la suite (action la plus fréquente quand on itère sur un draft)
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      draftNext();
    }
    // Shift+Enter = newline (comportement par défaut de la textarea)
  }
</script>

<div class="composer">
  {#if target}
    <div class="char-counter mono" data-state={countState} aria-live="polite">
      <span class="count">{chars}</span>
      <span class="sep"> · </span>
      <span class="target">cible {target.min}–{target.max}</span>
    </div>
  {/if}

  <textarea
    bind:this={textareaEl}
    bind:value={text}
    oninput={autoResize}
    onkeydown={handleKeydown}
    placeholder="Paste le prochain msg prospect, ou tape une consigne de draft (Cmd+Enter = draft)"
    rows="2"
    {disabled}
  ></textarea>

  <div class="actions">
    <button class="btn-ghost" type="button" onclick={addProspect} {disabled} title="Ajoute le texte comme message prospect (pas de draft auto)">
      📥 ajouter prospect
    </button>
    <button class="btn-primary" type="button" onclick={draftNext} {disabled} title="Génère un clone_draft (textarea = consigne optionnelle). Cmd+Enter">
      ✨ draft la suite
    </button>
  </div>
</div>

<style>
  .composer {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 16px 14px;
    border-top: 1px solid var(--rule);
    background: var(--paper);
  }
  .char-counter {
    font-size: 10.5px;
    color: var(--ink-40);
  }
  .char-counter[data-state="under"] { color: #b37e3b; }
  .char-counter[data-state="over"]  { color: var(--vermillon); }
  .char-counter[data-state="ok"]    { color: #3b8a5c; }

  textarea {
    width: 100%;
    resize: none;
    border: 1px solid var(--rule);
    background: var(--paper);
    color: var(--ink);
    font-family: var(--font-sans, system-ui);
    font-size: 13px;
    padding: 8px 10px;
    min-height: 46px;
  }
  textarea:focus { outline: none; border-color: var(--ink); }

  .actions { display: flex; gap: 8px; justify-content: flex-end; }
  .btn-ghost,
  .btn-primary {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 6px 12px;
    cursor: pointer;
    border: 1px solid var(--rule-strong);
    background: var(--paper);
    color: var(--ink);
  }
  .btn-primary {
    background: var(--vermillon);
    color: var(--paper);
    border-color: var(--vermillon);
  }
  .btn-ghost:hover { background: var(--paper-subtle); }
  .btn-primary:hover { opacity: 0.9; }
  .btn-ghost:disabled,
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/ChatComposer.svelte
git commit -m "feat(chat): ChatComposer 2-button (ajouter prospect / draft la suite)"
```

### Task 3.3: `FeedbackRail.svelte` — zone B journal + pill règles

**Files:**
- Create: `src/lib/components/FeedbackRail.svelte`

- [ ] **Step 1: Écrire le composant**

```svelte
<script>
  import { api, authHeaders } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";

  let {
    conversationId = null,
    activeRules = [],     // Array de { id, name, count } — règles actives cette conv
    onHighlightMessage,   // (msgId) => void — demande au parent de scroller+highlight
  } = $props();

  let events = $state([]);   // feedback_events DESC created_at
  let loading = $state(false);
  let rulesExpanded = $state(false);

  $effect(() => {
    if (!conversationId) { events = []; return; }
    loadEvents();
  });

  async function loadEvents() {
    if (!conversationId) return;
    loading = true;
    try {
      const data = await api(`/api/feedback-events?conversation=${conversationId}`);
      events = Array.isArray(data.events) ? data.events : [];
    } catch (err) {
      showToast?.("Chargement feedback échoué");
    } finally {
      loading = false;
    }
  }

  // Exposé via bind au parent pour append après POST success
  export function appendEvent(ev) {
    events = [ev, ...events];
  }

  function fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function truncate(s, n = 80) {
    if (!s) return "";
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function iconFor(type) {
    switch (type) {
      case "validated": return "✓";
      case "validated_edited": return "✓*";
      case "corrected": return "✎";
      case "saved_rule": return "📏";
      default: return "·";
    }
  }

  function labelFor(type) {
    switch (type) {
      case "validated": return "validé";
      case "validated_edited": return "validé (édité)";
      case "corrected": return "corrigé";
      case "saved_rule": return "règle enregistrée";
      default: return type;
    }
  }
</script>

<aside class="feedback-rail" aria-label="Journal feedback">
  <header class="rail-head mono">feedback</header>

  <!-- Pill règles actives -->
  <div class="rules-pill">
    <button
      class="pill-btn mono"
      aria-expanded={rulesExpanded}
      onclick={() => rulesExpanded = !rulesExpanded}
    >
      ● règles actives ({activeRules.length})
      <span class="caret">{rulesExpanded ? "▾" : "▸"}</span>
    </button>
    {#if rulesExpanded}
      <ul class="rules-list">
        {#each activeRules as rule (rule.id)}
          <li class="rule-item">
            <span class="rule-name">{rule.name}</span>
            {#if rule.count > 0}<span class="rule-count">{rule.count}×</span>{/if}
          </li>
        {:else}
          <li class="rule-empty">aucune règle activée</li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="rail-body">
    {#if loading && events.length === 0}
      <p class="rail-empty">chargement…</p>
    {:else if events.length === 0}
      <p class="rail-empty">aucune correction / validation encore</p>
    {:else}
      <ul class="event-list">
        {#each events as ev (ev.id)}
          <li class="event">
            <div class="event-head">
              <span class="event-icon">{iconFor(ev.event_type)}</span>
              <span class="event-time mono">{fmtTime(ev.created_at)}</span>
              <span class="event-label">{labelFor(ev.event_type)}</span>
            </div>
            {#if ev.correction_text}
              <div class="event-body">"{truncate(ev.correction_text)}"</div>
            {/if}
            {#if Array.isArray(ev.rules_fired) && ev.rules_fired.length > 0}
              <div class="event-rules mono">fired: {ev.rules_fired.join(", ")}</div>
            {/if}
            <button
              class="event-ref mono"
              type="button"
              onclick={() => onHighlightMessage?.(ev.message_id)}
              title="Voir le message dans le thread"
            >↖ msg</button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</aside>

<style>
  .feedback-rail {
    width: 280px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--rule);
    background: var(--paper-subtle);
    font-size: 12px;
    color: var(--ink-80);
    overflow: hidden;
  }
  .rail-head {
    padding: 10px 14px 6px;
    font-size: 10.5px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-60);
    border-bottom: 1px solid var(--rule);
  }
  .rules-pill {
    padding: 10px 14px;
    border-bottom: 1px dashed var(--rule);
  }
  .pill-btn {
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--ink);
    font-size: 11px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .rules-list {
    list-style: none;
    padding: 6px 0 0;
    margin: 0;
  }
  .rule-item {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
    font-size: 11px;
    color: var(--ink-60);
  }
  .rule-count { color: var(--ink-40); }
  .rule-empty {
    color: var(--ink-40);
    font-style: italic;
    padding: 3px 0;
  }

  .rail-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px 14px 16px;
  }
  .rail-empty {
    color: var(--ink-40);
    font-style: italic;
    font-size: 11px;
  }
  .event-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .event {
    border-left: 2px solid var(--rule);
    padding: 4px 8px;
  }
  .event-head {
    display: flex;
    gap: 6px;
    align-items: baseline;
    font-size: 11px;
  }
  .event-icon { font-weight: 600; color: var(--ink); }
  .event-time { color: var(--ink-40); font-size: 10px; }
  .event-label { color: var(--ink-60); }
  .event-body {
    margin-top: 3px;
    font-size: 11px;
    color: var(--ink-80);
  }
  .event-rules {
    margin-top: 3px;
    font-size: 10px;
    color: var(--ink-40);
  }
  .event-ref {
    margin-top: 4px;
    background: transparent;
    border: none;
    padding: 0;
    font-size: 10px;
    color: var(--ink-40);
    cursor: pointer;
    text-decoration: underline;
  }
  .event-ref:hover { color: var(--vermillon); }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/FeedbackRail.svelte
git commit -m "feat(chat): FeedbackRail with règles pill and event journal"
```

### Task 3.4: Modifier `ChatMessage.svelte` — rendu par `turn_kind` + actions drafts

**Files:**
- Modify: `src/lib/components/ChatMessage.svelte`

- [ ] **Step 1: Ajouter la détection `turn_kind` et le rendu conditionnel**

En haut du `<script>`, juste après les props, ajouter un helper :

```javascript
let kind = $derived(
  message.turn_kind
  || (message.role === "user" ? "legacy-user" : "legacy-assistant")
);
let isDraft = $derived(kind === "clone_draft");
let isProspect = $derived(kind === "prospect");
let isSent = $derived(kind === "toi");
let isLegacy = $derived(kind?.startsWith("legacy"));
```

Dans le template `<article>`, remplacer les classes conditionnelles `msg-row-user`/`msg-row-bot` par une classe dérivée de `kind` :

```svelte
<article
  class="msg-row"
  class:msg-row-inbound={isProspect || kind === "legacy-user"}
  class:msg-row-outbound={isDraft || isSent || kind === "legacy-assistant"}
  class:msg-row-draft={isDraft}
  class:msg-row-sent={isSent}
  transition:fly={{ y: 4, duration: 120 }}
>
```

Les classes `msg-row-user`/`msg-row-bot` existantes peuvent être conservées en alias pendant une transition (utiles si d'autres composants y font référence) — à arbitrer en fin de task en grep.

- [ ] **Step 2: Nouveaux props pour les actions draft**

Étendre les props :

```javascript
let {
  message,
  seq = null,
  prevFidelity = null,
  sourceStyle = null,
  onCorrect,
  onSaveRule,
  onCopyBlock,
  onValidate,    // NEW — clone_draft → toi
  onRegen,       // NEW — retry sans correction
} = $props();
```

- [ ] **Step 3: Ajouter les actions draft**

Dans le bloc `<div class="msg-actions">` actuel (qui ne s'affiche que pour `role === "bot"`), remplacer par un rendu conditionnel sur `isDraft` :

```svelte
{#if isDraft && !message.typing && message.content}
  <div class="msg-actions draft-actions">
    <button class="action-btn action-btn-primary" onclick={() => onValidate?.(message)} title="Valider et envoyer au prospect">✓ valider</button>
    <button class="action-btn" onclick={() => onCorrect?.(message)} title="Corriger">✎ corriger</button>
    <button class="action-btn" onclick={() => onRegen?.(message)} title="Regenerer sans correction">↻ regen</button>
    <button class="action-btn" onclick={copyDefault} title="Copier (LinkedIn)">{copiedLabel ? `${copiedLabel} ✓` : "📋 copier"}</button>
  </div>
{:else if isSent && !message.typing}
  <div class="msg-actions sent-actions">
    <button class="action-btn" onclick={copyDefault}>{copiedLabel ? `${copiedLabel} ✓` : "📋 copier"}</button>
  </div>
{:else if isLegacy && message.role === "assistant" && !message.typing}
  <!-- Legacy fallback : keep Copier + Corriger à minima -->
  <div class="msg-actions">
    <button class="action-btn" onclick={copyDefault}>{copiedLabel ? `${copiedLabel} ✓` : "Copier"}</button>
    <button class="action-btn action-btn-primary" onclick={() => onCorrect?.(message)}>Corriger</button>
  </div>
{/if}
```

Le bloc `user-actions` existant (save rule) doit être préservé UNIQUEMENT pour le legacy-user (sinon, les prospects ne doivent pas avoir de bouton save rule — ce sont des DMs pastés, pas des instructions opérateur).

```svelte
{#if kind === "legacy-user"}
  <!-- markup existant user-actions avec Save rule -->
{/if}
```

- [ ] **Step 4: Style teinté pour `msg-row-draft`**

Ajouter dans `<style>` :

```css
.msg-row-draft .msg {
  background: #f5efe4;           /* paper pâle teinté */
  border-left: 2px solid var(--ocre, #b37e3b);
}
.msg-row-sent .msg {
  /* neutre — comme un assistant classique */
  background: var(--paper);
}
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/ChatMessage.svelte
git commit -m "feat(chat): ChatMessage renders by turn_kind with draft-specific actions"
```

### Task 3.5: Refonte `/chat/[persona]/+page.svelte` — layout 2-zones

**Files:**
- Modify: `src/routes/chat/[persona]/+page.svelte` (réécriture du template + suppression des strips)

- [ ] **Step 1: Supprimer les imports et usages obsolètes**

Supprimer les imports et toute référence aux composants démantelés :
- `import AuditStrip from "$lib/components/AuditStrip.svelte";` → retirer
- `import HeatThermometer from "$lib/components/HeatThermometer.svelte";` → retirer
- `import LiveMetricsStrip from "$lib/components/LiveMetricsStrip.svelte";` → retirer
- Supprimer les refs `thermRef`, `sessionStart`, `sessionTotals`, `resetSessionTotals`, compteurs associés
- Supprimer les usages `<AuditStrip .../>`, `<LiveMetricsStrip .../>`, `<HeatThermometer .../>`

Ajouter les nouveaux imports :
- `import ProspectDossierHeader from "$lib/components/ProspectDossierHeader.svelte";`
- `import FeedbackRail from "$lib/components/FeedbackRail.svelte";`
- `import ChatComposer from "$lib/components/ChatComposer.svelte";`

Remplacer `ChatInput` par `ChatComposer` (l'import peut rester si on garde `ChatInput` comme fallback, sinon le supprimer).

- [ ] **Step 2: Nouveaux handlers**

Ajouter dans la section handlers :

```javascript
async function handleAddProspect(text) {
  // Insère un message prospect via un endpoint dédié ou via /api/messages si présent.
  // Option 1 : POST direct à une API messages (à créer dans /api/messages si absent)
  // Option 2 : déclencher un stream /api/chat avec un flag "prospect_only" (pas de génération)
  //
  // Choix retenu : appel léger à un nouvel endpoint /api/prospect-message si besoin,
  // SINON on réutilise /api/chat?mode=prospect_only. Au moment de la rédaction, ni
  // l'un ni l'autre n'existe — Step 3 crée /api/prospect-message.
  // Implementer vérifie l'état au grep avant rédaction.
}

async function handleDraftNext({ consigne }) {
  // Appelle streamChat (existant) en mode draft — la textarea consigne, si présente,
  // est passée comme message user courant (mais avec turn_kind='operator_instruction'
  // ou traitée comme system-like). Si vide, on envoie un prompt implicite
  // ("génère la réponse suivante") que api/chat sait traiter.
}

async function handleValidate(message) {
  // 1. PATCH messages: turn_kind='toi'
  // 2. POST /api/feedback-events { event_type: 'validated', message_id, conversation_id }
  // 3. FeedbackRail.appendEvent(result)
}

async function handleValidateEdited(message, newContent) {
  // 1. PATCH messages: turn_kind='toi', content=newContent, edited_before_send=true, draft_original=original
  // 2. POST feedback-events { event_type: 'validated_edited', diff_before, diff_after }
  // 3. rail append
}

async function handleRegen(message) {
  // PATCH messages: turn_kind='draft_rejected' sur l'ancien
  // relance streamChat() même message user qu'avant → nouveau clone_draft
  // PAS d'entrée feedback (retry neutre)
}

async function handleConversationUpdate(patch) {
  // PATCH /api/conversations?id=X avec les champs prospect_name/stage/note
  // Re-fetch conversation ou merge localement
}

function handleHighlightMessage(msgId) {
  const el = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("msg-highlight");
  setTimeout(() => el.classList.remove("msg-highlight"), 2000);
}
```

**Note pour l'implémenteur :** les handlers ci-dessus dépendent d'endpoints messages qui n'existent peut-être pas encore. Avant de les wire, grep :

```bash
grep -l "PATCH\|update.*messages\|turn_kind" api/
```

Si aucun endpoint `/api/messages` n'existe pour PATCH, **en créer un** (simple, suit le pattern `api/conversations.js` PATCH). Ajouter cette création en sub-task au plan si besoin.

- [ ] **Step 3: Créer `/api/messages.js` si absent (sub-task conditionnelle)**

Check: `ls api/messages.js` — si fichier absent, créer :

```javascript
import { authenticateRequest, supabase, setCors, hasPersonaAccess } from "../lib/supabase.js";

export default async function handler(req, res) {
  setCors(res, "PATCH, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "PATCH") { res.status(405).json({ error: "Method not allowed" }); return; }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  const { id } = req.query || {};
  if (!id) { res.status(400).json({ error: "id query param required" }); return; }
  const { turn_kind, content, edited_before_send, draft_original } = req.body || {};

  // Validate turn_kind if provided
  const VALID = new Set(["prospect", "clone_draft", "toi", "draft_rejected", "legacy", "meta"]);
  if (turn_kind !== undefined && !VALID.has(turn_kind)) {
    res.status(400).json({ error: "invalid turn_kind" });
    return;
  }

  // Authorize via conversation → persona
  const { data: msg, error: msgErr } = await supabase
    .from("messages").select("id, conversation_id").eq("id", id).single();
  if (msgErr || !msg) { res.status(404).json({ error: "Message not found" }); return; }

  const { data: conv, error: convErr } = await supabase
    .from("conversations").select("id, persona_id, client_id").eq("id", msg.conversation_id).single();
  if (convErr || !conv) { res.status(404).json({ error: "Conversation not found" }); return; }
  if (!isAdmin) {
    if (!(await hasPersonaAccess(client?.id, conv.persona_id))) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
  }

  const patch = {};
  if (turn_kind !== undefined)           patch.turn_kind = turn_kind;
  if (typeof content === "string")       patch.content = content;
  if (typeof edited_before_send === "boolean") patch.edited_before_send = edited_before_send;
  if (typeof draft_original === "string") patch.draft_original = draft_original;

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "no updatable fields" }); return;
  }

  const { error } = await supabase.from("messages").update(patch).eq("id", id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
}
```

Et un test minimal à ajouter dans `test/api-messages.test.js` (400/403/405 paths), sur le modèle de `test/api-feedback-events.test.js`.

- [ ] **Step 4: Réécrire le template 2-zones**

Dans `+page.svelte`, remplacer le bloc `<div class="chat-layout">...</div>` par :

```svelte
<div class="chat-layout">
  <ConversationSidebar
    {personaId}
    currentConvId={$currentConversationId}
    onselectconversation={handleSelectConversation}
    onnewconversation={handleNewConversation}
    onswitchclone={handleSwitchClone}
    open={sidebarOpen}
  />

  {#if sidebarOpen}
    <div class="sidebar-backdrop" onclick={() => (sidebarOpen = false)}></div>
  {/if}

  <div class="chat-main">
    <ChatCockpit
      personaName={$personaConfig?.name || "Clone"}
      personaAvatar={$personaConfig?.avatar || "?"}
      currentPersonaId={personaId}
      personasList={$personas}
      bind:switcherOpen
      onSwitchClone={handleSwitchToClone}
      onBack={handleBack}
      onOpenBrain={() => goto(`/brain/${personaId}`)}
      onToggleSidebar={() => sidebarOpen = !sidebarOpen}
      onToggleLead={() => leadOpen = !leadOpen}
    />

    <ProspectDossierHeader
      conversation={currentConversation}
      feedbackCount={feedbackCount}
      heat={heatSignal}
      persona={$personaConfig}
      scenarioType={$currentScenarioType}
      onScenarioChange={handleScenarioChange}
      onUpdate={handleConversationUpdate}
    />

    <div class="chat-body">
      <div class="chat-messages-col">
        <div class="chat-messages" bind:this={messagesEl}>
          {#each $messages as message (message.id)}
            <ChatMessage
              {message}
              seq={seqForMessage(message, $messages)}
              {sourceStyle}
              onCorrect={handleCorrect}
              onSaveRule={handleSaveRule}
              onCopyBlock={() => {}}
              onValidate={handleValidate}
              onRegen={handleRegen}
            />
          {/each}
          <div bind:this={scrollAnchor}></div>
        </div>

        <ChatComposer
          disabled={$sending}
          scenarioType={$currentScenarioType}
          onAddProspect={handleAddProspect}
          onDraftNext={handleDraftNext}
        />
      </div>

      <FeedbackRail
        bind:this={feedbackRailRef}
        conversationId={$currentConversationId}
        activeRules={activeRulesFromStats}
        onHighlightMessage={handleHighlightMessage}
      />
    </div>
  </div>
</div>
```

- [ ] **Step 5: Mettre à jour les styles**

Dans le `<style>` :
- Remplacer `grid-template-columns: 1fr 300px` (ex-HeatThermometer) par un flex row où `FeedbackRail` est à droite avec `width: 280px` fixe (déjà fait dans son propre style, donc le parent reste simple)
- Supprimer `.composer-toolbar` et classes associées à `ScenarioSwitcher` qui a bougé dans le header
- Ajouter `.msg-highlight` (2s flash) :

```css
.msg-highlight {
  animation: highlightPulse 2s ease-out;
}
@keyframes highlightPulse {
  0% { background-color: #fffbe6; }
  100% { background-color: transparent; }
}
```

Le `.chat-body` passe de `grid` à `display: flex; flex-direction: row;` :

```css
.chat-body {
  flex: 1;
  display: flex;
  flex-direction: row;
  min-height: 0;
  overflow: hidden;
}
.chat-messages-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

@media (max-width: 900px) {
  /* En mobile, FeedbackRail devient drawer ouvert via bouton "N corr" dans header */
  .chat-body :global(.feedback-rail) {
    display: none;
  }
  .chat-body.rail-open :global(.feedback-rail) {
    display: flex;
    position: fixed;
    right: 0; top: 0;
    height: 100dvh;
    z-index: 10;
    box-shadow: -4px 0 12px rgba(0,0,0,0.1);
  }
}
```

- [ ] **Step 6: Dev server + smoke test**

Run: `npm run dev`
Ouvrir `/chat/<id>` avec une conv existante (legacy) :
1. La conversation s'affiche en mode legacy (messages rendus via fallback)
2. Header dossier visible, éditable (nom/stage/note)
3. FeedbackRail à droite, vide (pas de feedback_events legacy)
4. Composer 2-boutons en bas

Créer une nouvelle conversation, paste un message prospect via "📥 ajouter prospect" → apparaît en message `prospect`.
Cliquer "✨ draft la suite" → clone drafte, apparaît comme `clone_draft` teinté.
Cliquer ✓ → devient `toi` (neutre), entrée ✓ dans le rail.
Cliquer ✎ sur un nouveau draft → FeedbackPanel ouvert, soumettre correction → entrée ✎ dans le rail.

- [ ] **Step 7: Commit**

```bash
git add src/routes/chat/[persona]/+page.svelte api/messages.js test/api-messages.test.js
git commit -m "feat(chat): /chat/[persona] 2-zone layout with dossier header and feedback rail"
```

### Task 3.6: Supprimer les composants obsolètes

**Files:**
- Delete: `src/lib/components/LiveMetricsStrip.svelte`
- Delete: `src/lib/components/AuditStrip.svelte`
- Delete: `src/lib/components/HeatThermometer.svelte`
- Delete: `src/lib/components/MessageMarginalia.svelte`
- Modify: `src/lib/components/ChatMessage.svelte` (retirer le toggle marginalia et l'import)

- [ ] **Step 1: Vérifier l'absence de références**

```bash
grep -rn "LiveMetricsStrip\|AuditStrip\|HeatThermometer\|MessageMarginalia" src/ api/ test/
```

Expected : références uniquement dans `docs/` et dans `ChatMessage.svelte` (pour MessageMarginalia, qui sera retiré ici).

- [ ] **Step 2: Retirer l'import et le toggle marginalia de `ChatMessage.svelte`**

Dans `ChatMessage.svelte` : supprimer `import MessageMarginalia from "./MessageMarginalia.svelte";`, la variable `margOpen`, le bouton `marg-toggle`, et le bloc `<MessageMarginalia ... />`.

- [ ] **Step 3: Delete des fichiers**

```bash
rm src/lib/components/LiveMetricsStrip.svelte
rm src/lib/components/AuditStrip.svelte
rm src/lib/components/HeatThermometer.svelte
rm src/lib/components/MessageMarginalia.svelte
```

- [ ] **Step 4: Build + tests**

```bash
npm run build
npm test
```

Expected : build clean, tests passent.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib/components/
git commit -m "chore(cleanup): remove LiveMetricsStrip, AuditStrip, HeatThermometer panel, MessageMarginalia"
```

### Task 3.7: `ChatCockpit.svelte` allégé

**Files:**
- Modify: `src/lib/components/ChatCockpit.svelte`

- [ ] **Step 1: Retirer les props/rendus non utilisés**

Supprimer les props :
- `collapseIdx`, `fidelity`, `breakdown`, `sourceStyle`
- `rulesActiveCount`, `scenario`
- `leadOpen`, `sidebarOpen`, `journalOpen`, `brainOpen` si elles ne servent plus qu'à styler l'état actif

Conserver :
- `personaName`, `personaAvatar`, `currentPersonaId`, `personasList`, `switcherOpen`
- Callbacks : `onBack`, `onOpenBrain`, `onToggleSidebar`, `onToggleLead`, `onSwitchClone`

Dans le template, retirer les jauges collapse/fidelity/règles et le scenario header (bougé dans ProspectDossierHeader).

Le style-health badge reste (cliquable → `/brain/<id>#intelligence` via Task 2.5). Il se calcule toujours avec `collapseIdx`/`fidelity`/`rulesActiveCount` — on peut garder la prop mais la calculer dans `+page.svelte` (ou laisser le cockpit fetcher lui-même). Pragmatique : on garde la prop `styleHealth` directement (état `ok`/`warn`/`drift`/`unknown`) et le parent la dérive.

- [ ] **Step 2: Smoke test + commit**

Run: `npm run dev` → ouvrir `/chat/<id>` → cockpit minimal (avatar + nom + ⚙ + pastille).

```bash
git add src/lib/components/ChatCockpit.svelte
git commit -m "refactor(cockpit): trim props, keep only identity + style-health badge + ⚙ brain"
```

### Task 3.8: Responsive + mobile drawer

**Files:**
- Modify: `src/routes/chat/[persona]/+page.svelte`, `src/lib/components/ProspectDossierHeader.svelte`

- [ ] **Step 1: Ajouter un bouton "ouvrir feedback" dans le header (mobile only)**

Dans `ProspectDossierHeader.svelte`, le span `.fb-count` devient cliquable :

```svelte
<button
  class="fb-count-btn mono"
  type="button"
  onclick={() => onToggleRail?.()}
  title="Voir journal feedback"
>
  {feedbackCount} correction{feedbackCount === 1 ? "" : "s"} ▸
</button>
```

Ajouter la prop `onToggleRail` au composant.

- [ ] **Step 2: Mobile drawer logic dans `+page.svelte`**

```javascript
let railOpen = $state(false);
```

Passer `onToggleRail={() => railOpen = !railOpen}` au header. Ajouter `class:rail-open={railOpen}` sur `.chat-body`. Le CSS media query (Task 3.5 Step 5) gère le reste.

- [ ] **Step 3: Vérifier à 800px**

Dev server, ouvrir devtools → device emulation 800px largeur :
- Rail feedback caché par défaut
- Clic sur bouton "N corrections ▸" dans header → rail s'ouvre en overlay
- Re-clic → rail se ferme

- [ ] **Step 4: Commit**

```bash
git add src/routes/chat/[persona]/+page.svelte src/lib/components/ProspectDossierHeader.svelte
git commit -m "feat(chat): mobile drawer for feedback rail below 900px breakpoint"
```

### Task 3.9: Tests E2E + critic prod gate

- [ ] **Step 1: Test de flow integré**

Create: `test/chat-flow-e2e.test.js` (ou ajouter à un fichier d'intégration existant si déjà en place).

Si Playwright/Cypress pas en place (à vérifier : `ls playwright.config* cypress* 2>/dev/null`), se contenter d'un test node-based qui vérifie les API en séquence :

```javascript
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

const HAS_DB = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE);

describe("E2E: chat 2-zones flow (requires DB)", { skip: !HAS_DB && "no DB env vars" }, () => {
  it("full lifecycle: add prospect → draft → validate → corrected → save rule", async () => {
    // Seed: créer une conv test, un persona test (fixture)
    // Call /api/chat stream pour déclencher un clone_draft
    // PATCH messages turn_kind='toi'
    // POST /api/feedback-events validated
    // Verify via GET /api/feedback-events?conversation=X
    // (tests détaillés à écrire par l'implémenteur selon fixtures disponibles)
  });
});
```

*L'implémenteur finalisera la forme exacte du test selon les fixtures/helpers existants dans `test/fixtures/`.*

- [ ] **Step 2: Critic prod gate (final)**

```bash
node scripts/critic-prod-check.js
```

Confirmer trafic récent sur `/chat/[persona]`.

- [ ] **Step 3: Suite complète**

```bash
npm test
npm run build
```

Expected : vert sur les deux.

- [ ] **Step 4: Tag de fin**

```bash
git tag chunk-3-complete
git log --oneline chunk-1-complete..HEAD
```

**Livrable Chunk 3 validé quand :**
- `/chat/[persona]` affiche le layout 2-zones avec header dossier, thread typé `turn_kind`, rail feedback
- Composer hybride fonctionne (ajouter prospect ne draft pas, draft la suite génère un `clone_draft`)
- Actions ✓/✎/↻/📏 créent les entrées correctes dans `feedback_events`
- Clic entrée rail → scroll + highlight message dans thread
- Mobile : rail caché + drawer ouvrable via bouton header
- Composants obsolètes supprimés (LiveMetricsStrip, AuditStrip, HeatThermometer, MessageMarginalia)
- Cockpit allégé (identité + ⚙ + style-health badge)
- Build clean, suite de tests passe, critic prod gate OK

---

## Execution checklist globale

- [x] Chunk 1 complet — tag `chunk-1-complete`, déployable indépendamment (pas de changement UI)
- [x] Chunk 2 complet — tag `chunk-2-complete`, route `/brain` live, drawer retiré
- [x] Chunk 3 core : composants + refonte page + /api/messages (commits 2166330, d4c4583)
- [x] Chunk 3 cleanup : suppression LiveMetricsStrip, AuditStrip, HeatThermometer, MessageMarginalia (commit d58f605)
- [x] Chunk 3 cockpit allégé (commit c962e91)
- [x] Chunk 3 responsive mobile drawer (commit 8c0c407)
- [x] Chunk 3 tag `chunk-3-complete` posé
- [ ] Merge vers master (cette PR) — E2E DB-gated skippé, couverture API layer existante
- [ ] Addendum section 4 (journal heat narratif + per-msg audit trail) — à planifier après merge

À chaque fin de chunk : `critic-prod-check.js` avant merge final (cf. pre-merge gate).

---

## Addendum — Critique post-impl (2026-04-19 23:00)

Revue de la vraie refonte contre les décisions des sections 4 et 5 de la spec. Identifie 2 pertes qualitatives non-reconnues dans la spec initiale et 1 réglage UX.

### Section 4 — pertes à corriger

**1. Heat journal narratif — perdu.** Le `HeatThermometer` original (master) portait un journal narratif par-message : citations du texte prospect, polarity pos/neg, delta numérique (ex : *"je regarde" +0.12* ou *"pas le budget" −0.18*). Notre refonte a fusionné le thermo en indicateur scalaire (froid/tiède/chaud) dans `ProspectDossierHeader`, **perdant le pourquoi**. En workflow agence, comprendre pourquoi un prospect refroidit = exactement ce qu'on regarde au retour sur un dossier.

- **Action** : restaurer le journal narratif heat **dans `FeedbackRail`** (section séparée ou entrées intercalées chrono). Composant `api/heat` existant à reconnecter ; composant ex-thermo supprimé, à ré-extraire partiellement depuis `git show master:src/lib/components/HeatThermometer.svelte`.

**2. Per-message audit trail (sources) — promesse non honorée.** La spec disait "`MessageMarginalia` migre dans `/brain#intelligence` comme timeline par-msg". Non fait — `/brain#intelligence` affiche l'`IntelligencePanel` existant (entités/relations persona-global), **pas de timeline par-msg**. L'info perdue : quelles knowledge pages / entités / combien de corrections ont influencé chaque réponse.

- **Action** : deux options non-exclusives :
  - **(a)** implémenter la timeline par-msg dans `/brain#intelligence` : nouvelle section sous IntelligencePanel qui liste les derniers `clone_draft` avec leurs sources (reuse des colonnes existantes `sources.knowledgePages` / `sources.entities` / `sources.correctionsCount` qui voyagent déjà dans les événements SSE).
  - **(b)** toggle inline "pourquoi ce draft ?" sous chaque `clone_draft` dans le thread, affichant les sources sans ouvrir une route. Plus léger, daily-friendly.
- Recommandation : (b) en priorité pour le daily, (a) comme complément panoramique.

### Section 5 — réglage UX

**3. Tab par défaut `/brain`.** Actuellement `#connaissance`. En usage quotidien, un opérateur ira plus souvent voir `#intelligence` (diagnostic) que `#connaissance` (setup ponctuel). Trivial à changer (`activeTab = "intelligence"` par défaut dans `src/routes/brain/[persona]/+page.svelte`).

### Status de la critique
- Findings ajoutés aux pendings : voir TodoWrite session.
- Les points (1) et (2) sont tracés post-merge — non-bloquants pour la release core.


