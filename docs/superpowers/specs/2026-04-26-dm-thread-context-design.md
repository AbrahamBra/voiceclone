# DM thread context — design

**Status**: spec à valider · **Author**: claude (audit session, 2026-04-26) · **Source bombe**: audit complet, item 5 (« DM thread context absent »)

## Problème

VoiceClone a aujourd'hui deux couches mémoire bien câblées et une qui manque :

| Couche | État | Échelle | Persisté où |
|---|---|---|---|
| **Long terme** : voix du clone, règles, protocole | OK | Persona-scoped | `personas.voice`, `corrections`, `protocol_artifact`, `knowledge_*` |
| **Très court** : turn N+1 voit turn N | OK (par défaut SSE) | Single message | mémoire JS du composer + dernier `messages` row |
| **Court terme conversationnel** : continuité d'une DM thread | **manquant** | Conversation-scoped (5–30 turns) | rien |

**Conséquence concrète** :
- Quand le setter ouvre une DM en cours et drafte un nouveau turn, le clone voit l'historique brut des messages mais n'a aucune **synthèse de l'état du fil** (« où on en est », « ce qu'on a déjà dit », « le ton qu'on a installé »).
- Les patterns de relance / reformulation ne tiennent pas naturellement : le clone redémarre à zéro à chaque turn, à la lecture du raw history.
- Le « sujet » de la conversation (au sens lacanien) n'est porté nulle part — c'est le user qui le tient mentalement.

Le seul truc proche aujourd'hui c'est la colonne `conversations.note` (300 char manuels, jamais auto-générée) et le `dossier` prospect (`prospect_name`, `stage`, `note`). C'est de l'état **du dossier**, pas **du fil**.

## Cas d'usage qui exigent cette couche

1. **DM en plusieurs messages** : prospect + setter alternent 3–5× avant un RDV. À chaque draft, le clone doit savoir « on a déjà parlé du budget mais pas de la deadline ».
2. **Reprise après pause** : le setter rouvre une conv 3 jours après. Le clone doit retrouver le rythme + le ton + ce qui restait en suspens.
3. **Triage agence multi-clients** : l'agence parcourt 50 conversations actives. Un résumé court par fil = elle décide où prioriser sans relire.
4. **Continuité voix** : la voix doit être stable **sur le fil**, pas seulement sur le turn. Le clone doit éviter de se contredire d'un turn à l'autre dans la même conv.

## Modèle de données proposé

### Table : `dm_thread_state`

Une ligne par conversation, mise à jour à chaque turn assistant émis. Pas de versioning — l'historique des turns reste dans `messages`, on ne stocke ici que la **synthèse vivante**.

```sql
CREATE TABLE IF NOT EXISTS dm_thread_state (
  conversation_id uuid PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  persona_id      uuid NOT NULL REFERENCES personas(id) ON DELETE CASCADE,

  -- Synthèse libre (Haiku résume après chaque assistant turn).
  -- ~200-400 char, en FR, factuelle. Format : 1-3 phrases.
  summary         text,

  -- État dérivé exploitable côté retrieval / scoring.
  topics          text[],          -- ["budget", "deadline", "deuxième relance"]
  open_loops      text[],          -- ["attente confirmation RDV mardi", "demande tarif premium"]
  last_user_intent text,            -- "pousse-le doucement vers RDV", "reformule plus court"
  tone_signature  jsonb,           -- { tutoiement: true, emoji_density: 0.0, sentence_avg: 12 }

  -- Métriques de fraîcheur — savoir si la synthèse est à jour.
  turns_synthesized int NOT NULL DEFAULT 0,  -- nombre de turns inclus dans summary
  last_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,

  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dm_thread_state_persona ON dm_thread_state(persona_id);
ALTER TABLE dm_thread_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all ON dm_thread_state FOR ALL TO service_role USING (true) WITH CHECK (true);
```

**Pourquoi PRIMARY KEY = conversation_id ?** une seule synthèse vivante par fil. L'historique est dans `messages`. Si on veut versionner, on logue dans `learning_events` (event_type = `thread_state_change`).

### Pas de migration data ancienne

Les DM antérieures gardent `dm_thread_state` à NULL. Le summary se reconstruit lazy au premier turn assistant après merge.

## API surface

### 1. Refresh (write) — `POST /api/dm-thread-state`

Appelé en arrière-plan par le pipeline `api/chat.js` après chaque assistant turn émis (fire-and-forget). Pas un endpoint user-facing.

```js
// Body: { conversationId }
// 1. Charge derniers N turns (default 10) via messages table
// 2. Si turns_synthesized déjà à jour → no-op
// 3. Sinon, appelle Haiku avec prompt « résume / liste topics / open_loops / tone »
// 4. UPSERT dm_thread_state avec summary + topics + open_loops + tone_signature
```

Cap dur : maxDuration 20s, skip silencieusement si Haiku rate.

### 2. Read — `GET /api/dm-thread-state?conversation=<id>`

Pour la sidebar agence (use case 3) et pour le composer côté setter (preview du fil).

```js
// Body response: { state: { summary, topics, open_loops, last_user_intent, ... } | null }
```

### 3. Injection prompt — `lib/build-prompt.js` (nouveau)

Le pipeline `api/chat.js` charge le `dm_thread_state.summary` + `open_loops` au moment de construire le prompt assistant et les inject avant le raw history. Format :

```
[Contexte du fil — synthèse Haiku]
Résumé: {summary}
Sujets en cours: {topics.join(", ")}
Boucles ouvertes: {open_loops.join(" · ")}
Dernier signal user: {last_user_intent}

[Historique brut — derniers 10 turns]
{messages...}
```

C'est ça, le « cerveau de la conv » que le clone voit au prochain turn.

## UI integration

Trois points d'accroche, du moins coûteux au plus :

1. **MVP — pas de UI explicite**. Le summary est invisible côté user. La conv s'améliore *naturellement*. Sortie binaire : ça marche / ça marche pas.
2. **V2 — un encart « état du fil » dans le LeadPanel** (déjà existant). Texte gris, 3 lignes max, bouton « regénérer ».
3. **V3 — agence : colonne « résumé fil » dans la sidebar conversations**. Permet au superviseur agence de scanner l'activité sans cliquer.

Aller seulement à V1 pour le MVP. V2 et V3 sont des additions non-bloquantes.

## Phasing

### Phase 1 — schéma + write path (1 PR, ~150 LOC)
- Migration `051_dm_thread_state.sql`
- `api/dm-thread-state.js` (POST refresh, GET read)
- `lib/dm-thread-summarize.js` (prompt Haiku, parse, retry x1)
- Test unitaire : refresh idempotent, parse error → no-op

### Phase 2 — câblage prompt (1 PR, ~50 LOC)
- `lib/build-prompt.js` : injecte le bloc contexte avant l'historique
- `api/chat.js` : appelle `POST /api/dm-thread-state` en arrière-plan après émission assistant
- Smoke test : ouvrir une DM, envoyer 3 turns, vérifier que la 4e contient une référence au turn 1

### Phase 3 — UI v2 (optionnel, 1 PR, ~80 LOC)
- LeadPanel : encart « état du fil »
- ConversationSidebar : tooltip summary au hover

## Acceptance criteria

- [ ] Une nouvelle DM crée `dm_thread_state` après le 1er assistant turn (vérifiable : `SELECT * FROM dm_thread_state WHERE conversation_id = X`).
- [ ] Le summary contient le sujet principal de la conv (qualité acceptée si > 6/10 au eyeball test sur 5 conversations réelles).
- [ ] La 4e+ assistant turn d'un fil utilise effectivement `summary`/`open_loops` dans son prompt (vérifiable via debug log du prompt construit).
- [ ] Si Haiku rate (timeout, parse error), le pipeline assistant continue sans bloquer le draft.
- [ ] RLS = pas d'accès anon/authenticated, seul service-role peut lire/écrire.

## Anti-objectifs (clarification du scope)

- **Pas un mémoire « long terme conversation »** — la voix et les règles restent dans `personas.voice`/`corrections`. `dm_thread_state` est strictement éphémère, scope conversation.
- **Pas un graph d'entités** — les topics sont du texte libre. Si on veut des entités structurées, on a déjà `knowledge_entities`.
- **Pas un workflow agence** — V3 est explicitement V3, pas V1.

## Risques & questions ouvertes

1. **Coût Haiku** — 1 résumé par turn assistant × 100 conversations actives = ~100-300 calls/jour. À ~0.001$ chacun = $0.30/jour. Acceptable. À surveiller si on monte à 1000+ DMs actives.
2. **Latence** — `POST /api/dm-thread-state` doit être fire-and-forget côté `api/chat.js`. Sinon ça ajoute 2-5s au draft user-facing.
3. **Quand resynthétiser ?** — proposition : seulement si `turns_synthesized < message_count` (idempotent et économe). À valider après une semaine de prod.
4. **L1 vs L2 vs L3 personas** — un L1 (Adrien) avec 0 historique ne génère pas un summary utile au turn 1. Faut-il un seuil minimum (ex: 4 turns) avant de commencer à synthétiser ? Probablement oui — à valider.
5. **Quoi faire des `tone_signature` ?** — pas exploités au MVP. Posés pour servir plus tard à un audit drift de voix au sein du fil.

## Décision attendue (avant Phase 1)

- ☐ Valider que le scope (conversation-scoped uniquement) est OK pour la verticale DM agence (use case 3).
- ☐ Choisir l'ordre : Phase 1+2 d'abord (backend + câblage silent), ou Phase 1+3 (visible UI agence d'abord) ?
- ☐ Définir le seuil minimum de turns avant 1ère synthèse (proposition : 3).
