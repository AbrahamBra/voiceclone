# Chat monolith refacto — plan

**Status**: plan à valider · **Author**: claude (audit session, 2026-04-26) · **Source bombe**: audit complet, dette 4.2 (« chat/[persona]/+page.svelte = 1609 LOC »)

## Diagnostic

`src/routes/chat/[persona]/+page.svelte` = **1609 lignes** (audit santé code). Il porte simultanément :

| Responsabilité | Lignes (env.) |
|---|---|
| Imports + chargement initial (fidelity, personas, conversations) | ~200 |
| State : conversation courante, fidélité, ruleStats, panels | ~150 |
| Handlers feedback : validate, client_validate, excellent, correct, regen, saveRule | ~320 |
| Pipeline streaming (sse, draft, ingestPreview) | ~200 |
| Sidebar/dossier patch handlers | ~80 |
| Command palette wiring | ~50 |
| Markup + slots panels | ~280 |
| CSS scoped | ~330 |

**Conséquences** :
- Compile time long, hot reload lent.
- Difficile de tester unitairement chacune des handlers.
- Premier endroit où collisions se produisent en sessions parallèles (incident PR #69 historique).
- Onboarding développeur impossible — il faut tout lire pour bouger une ligne.

Composants déjà extraits qui marchent bien : `ChatTopBar`, `ChatMessage`, `ChatComposer`, `FeedbackRail`, `ConversationSidebar`, `LeadPanel`, `IngestPreviewBubble`, `CommandPalette`. Le reste vit dans la page.

## Pourquoi maintenant

1. La bombe data/learning loop (PR #141 N3 cron) va générer **plus de signals à orchestrer** dans la page → la dette compose.
2. Les bombes UI (PR #144 styleHealth + FeedbackRail) ont déjà touché la page → on a une fenêtre où la mémoire de la page est fraîche.
3. La verticale DM thread context (spec 2026-04-26) va injecter encore plus de logique dans le pipeline. Si la page reste monolithique, ça devient impraticable.

## Précédent à connaître : dazzling-nightingale worktree

Le worktree `claude/dazzling-nightingale` (275 commits behind master, 27 fichiers dirty) contient **déjà un refacto partiel** :

- `src/lib/components/ChatCockpit.svelte` (NEW) — header cockpit avec readouts métriques
- `src/lib/components/FeedbackPanel.svelte` (NEW) — extraction du panel feedback
- `src/lib/components/RulesPanel.svelte` (NEW) — extraction du panel règles
- `src/lib/components/SettingsPanel.svelte` (NEW) — extraction du panel settings (depuis migré dans `/brain/[persona]`)
- `src/lib/components/SidePanel.svelte` (NEW) — coquille latérale unifiée
- `src/routes/hub/+page.svelte` (NEW) — hub multi-clones (déprécié : ChatTopBar a remplacé)

**Décision recommandée pour ce WIP** : **ne pas le rebaser** (275 commits = trop de conflits) mais **lire les composants comme inspiration** avant de réextraire from scratch on master. L'architecture proposée ci-dessous reprend l'esprit (cockpit + side-panels) sans le code stale.

## Architecture cible

```
src/routes/chat/[persona]/+page.svelte                      # 1609 → ~300 LOC
├── ChatTopBar.svelte                          # déjà existe
├── ConversationSidebar.svelte                 # déjà existe
├── ChatComposer.svelte                        # déjà existe
├── ChatMessage.svelte                         # déjà existe
├── FeedbackRail.svelte                        # déjà existe
├── CommandPalette.svelte                      # déjà existe
├── LeadPanel.svelte                           # déjà existe
├── IngestPreviewBubble.svelte                 # déjà existe
│
├── ChatPipeline.svelte    [NEW]              # state machine : streaming, draft, error
├── ChatHandlers.svelte    [NEW]              # tous les handlers feedback (validate, correct, regen, saveRule)
└── lib/chat-state.svelte.js [NEW]            # store dérivé : currentConversation, ruleStats, fidelity, styleHealth
```

Le `+page.svelte` final orchestre les composants et ne porte plus de logique métier. Les handlers deviennent props ou viennent de `chat-state.svelte.js`.

## Phasing — plan en 5 chunks indépendants

Chaque chunk = 1 PR, mergeable seul, master vert entre chaque.

### Chunk 1 — extraire `lib/chat-state.svelte.js` (state pur)
- Sortir : `currentConversation`, `ruleStats`, `collapseIdx`, `fidelity`, `styleHealth`, `personasListEnriched`
- Garder : tout ce qui touche `$page.data` (router-bound) dans la page
- ~250 LOC déplacées, +1 fichier
- Test : ajouter `test/chat-state.test.js` avec 3 cas styleHealth (ok/warn/drift)

### Chunk 2 — extraire les handlers feedback dans `lib/chat-handlers.svelte.js`
- Sortir : `handleValidate`, `handleClientValidate`, `handleExcellent`, `handleCorrect`, `handleRegen`, `handleSaveRule`, `handleRejectEntities`
- Pattern : chaque handler prend `(args, deps)` où `deps = { feedbackRailRef, showToast, supabase, ... }`
- ~320 LOC déplacées
- Test : 1 test par handler, mock fetch + supabase

### Chunk 3 — extraire `ChatPipeline.svelte`
- Composant qui encapsule `streamChat`, l'ingest preview flow, l'érreur SSE
- Émet des events : `on:draft`, `on:done`, `on:error`
- ~200 LOC déplacées
- Test : smoke preview chat live

### Chunk 4 — extraire `ChatHandlers.svelte` (slot wrapper qui injecte les props handlers)
- Permet au composer + ChatMessage + FeedbackRail de recevoir les handlers comme props sans que la page les passe une à une
- ~50 LOC réduites en haut de page
- Test : preview, vérifier qu'aucun handler n'est rompu

### Chunk 5 — déplacer le CSS `<style>` dans des fichiers `.css` co-localisés
- Diviser : `chat-shell.css`, `chat-body.css`, `chat-mobile.css`
- Importer via `@import` dans le module ou via le `vite-plugin` configuré
- ~330 LOC déplacées hors du `+page.svelte`
- Test : visual regression manuel sur 3 viewports

**Cible finale** : `+page.svelte` ~300 LOC, focused sur orchestration + render.

## Anti-objectifs

- **Pas de TypeScript dans ce refacto** — converti `.js` en `.ts` est une PR séparée. Le scope ici = découpage seulement.
- **Pas de changement de comportement user-visible** — purement structurel. Tous les tests existants doivent passer sans modif.
- **Pas de réécriture des Svelte 4 → Svelte 5 patterns** — la page utilise déjà $state/$derived/$effect, on garde.
- **Pas de réintégration de `dazzling-nightingale`** — trop coûteux à rebaser. On lit pour s'inspirer, pas plus.

## Risques

1. **Cassure SSE pendant Chunk 3** — le pipeline streaming est tricky. Avoir une preview Vercel verte avant de merger.
2. **Tests unitaires de handlers nécessitent des mocks fetch** — il faut un `lib/test-helpers.js` partagé avant Chunk 2.
3. **Sessions parallèles cassent le refacto** — recommandation : geler les autres branches qui touchent `chat/[persona]/+page.svelte` pendant les chunks 1-4. Cohérent avec memory `project_voiceclone_parallel_refactor_coordination`.

## Critères d'acceptation globaux

- [ ] `chat/[persona]/+page.svelte` ≤ 350 lignes après Chunk 5
- [ ] Aucun changement visible utilisateur
- [ ] Couverture de test : au moins 1 test par handler extrait (Chunk 2)
- [ ] Master CI vert après chaque chunk merge
- [ ] Smoke preview Vercel passé sur le flow chat complet (init persona → DM 3 turns → validate → save rule → regen)

## Décision attendue (avant Chunk 1)

- ☐ Valider l'architecture cible (composants + state files)
- ☐ Confirmer le geler des sessions parallèles sur `chat/[persona]/+page.svelte` pour la durée des chunks 1-4 (~3 jours estimés)
- ☐ Choisir si Chunk 5 (CSS) est prioritaire ou peut attendre une session future
