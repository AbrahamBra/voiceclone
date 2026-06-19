# Multi-bulle execution — spec

**Date** : 2026-05-02
**Auteur** : Claude (session avec Abraham)
**Status** : ready for implementation
**Scope** : DM LinkedIn uniquement. Posts / emails / autres surfaces hors scope.
**Dépend de** : la séquence 5-PR d'Abraham sur le pipeline d'ingestion (en flight)

## Pourquoi ce spec existe

Le clone produit aujourd'hui **un message par draft**. Le playbook de Nicolas (et de tout client L2/L3 sérieux) prescrit explicitement des **séquences de plusieurs messages courts** sur LinkedIn (ex: dr_recue avec un icebreaker en 3 bulles + une relance en 2 bulles). Tant que le clone collapse ces séquences en un bloc, il **n'exécute pas le setting du client** — il le mime à l'écrit, ce qui est inutile dans la vraie vie.

L'objectif du produit est *clone-opérateur, pas clone-vocal*. Un clone qui ne sait pas faire ses bulles selon le doc client est cosmétique pour un L2.

Référence : memory `project_voiceclone_playbook_taxonomy.md` — un playbook = templates avec niveaux de personnalisation distincts (variables, lookups, copy-paste) **ET** structure de bulles (mono / multi). Confirmé sur le seed Nicolas (`scripts/seed-nicolas-source-playbooks.js`) : artifacts `template_skeleton` mentionnent explicitement *"Plusieurs messages courts"*.

## Dépendances sur le travail d'Abraham (5-PR sequence)

| PR | Apport | Consommé par ce spec |
|---|---|---|
| #1 `/api/v2/protocol/import-doc` | un doc → 6 extracteurs → propositions | base : c'est là que les templates `template_skeleton` sont créés |
| #2 doc categorization (`operational_playbook` enum) | tag du kind de doc à l'upload | gate : le pipeline bulles ne tourne **que** si `document_kind = operational_playbook` |
| #3 section identity | hors scope (voix narrative, pas templates) | n/a |
| #4 coherence calibration | preview avant commit, contradictions inter-docs | n/a — orthogonal |
| #5 fix `check_params={}` | hard_rules deviennent testables | n/a — orthogonal |

Ce spec attend que #1 et #2 soient mergés. Ensuite il s'enchaîne dessus sans rien casser.

## Goals

1. Détecter à l'ingestion qu'un template est multi-bulles et capturer la séquence ordonnée
2. Détecter les variables (`{prénom}`, `PRÉNOM`, `[NOM_ENTREPRISE]`) dans les templates
3. Au runtime (chat draft + calibrage), produire une **liste de bulles** quand le scénario détecté a un template multi-bulles
4. Afficher cette liste comme N blocs distincts dans l'UI, chacun copiable individuellement
5. Tester le résultat via le calibrage scénario-driven (cf. décisions session 2026-05-02)

## Non-goals (V1)

- Lookup auto profil/site web pour remplir les variables → V2 (pour V1 : laisser placeholder, l'utilisateur remplit avant envoi)
- Génération conditionnelle (si réponse prospect = X → bulle Y) → V2 — V1 produit la séquence linéaire prescrite
- Multi-bulle pour autres surfaces que DM
- Backfill rétroactif des templates existants — V1 traite les nouveaux uploads, V1.1 fera un pass sur l'existant

## Architecture

```
[Upload doc operational_playbook]
        ↓
[/api/v2/protocol/import-doc — PR #1]
        ↓ extracteurs en parallèle
[proposition.kind = template_skeleton, content.text = prose]
        ↓
[NEW : bubble + variable enricher]
   - LLM pass sur content.text
   - sortie : { bubbles: [{order, text}], variables: [{name, source_hint}] }
        ↓
[proposition acceptée → protocol_artifacts.content enrichi]
        ↓ runtime
[/api/chat ou /api/calibrate]
   - getActiveArtifactsForPersona retourne template avec bubbles[] / variables[]
   - prompt drafter détecte template multi-bulles → demande JSON sequence
        ↓
[chat composer / calibrage UI rend N bulles copiables]
```

## Couche 1 — storage

### Shape `protocol_artifacts.content` pour kind=`template_skeleton`

**Avant (actuel)** :
```json
{
  "text": "merxi pour la connexion PRÉNOM\nje suis curieux...",
  "severity": "strong"
}
```

**Après (enrichi)** :
```json
{
  "text": "merxi pour la connexion PRÉNOM\nje suis curieux...",
  "bubbles": [
    { "order": 1, "text": "merxi pour la connexion {prénom}" },
    { "order": 2, "text": "je suis curieux de savoir ce qui t'a amené à faire la demande 🙂" },
    { "order": 3, "text": "Nicolas" }
  ],
  "variables": [
    { "name": "prénom", "source_hint": "lead_first_name", "required": true }
  ],
  "severity": "strong"
}
```

`text` reste pour back-compat (lecture par les surfaces V1 qui ne savent pas lire `bubbles`). `bubbles` et `variables` sont **additionnels**, pas un remplacement. Si `bubbles` absent → comportement mono-bulle actuel.

### Migration

Pas de migration SQL — `content` est déjà jsonb, on enrichit le shape sans changer la colonne. Les artifacts existants sans `bubbles` continuent de marcher.

## Couche 2 — extracteur d'enrichissement

### Quand il tourne

Après que PR #1 a posé une proposition `template_skeleton`, **avant** que l'utilisateur l'accepte. Idéalement intégré dans le même pipeline d'extraction (le LLM appelé pour produire les `template_skeleton` produit aussi les bulles + variables dans la même réponse — coût marginal nul).

Si pas faisable dans la même call : un cron `enrich-templates` qui lit les propositions `template_skeleton` non-enrichies, appelle un LLM léger (Haiku) pour les structurer.

### Prompt extracteur (sketch)

```
Voici un template DM extrait d'un playbook : <text>

1. Découpe-le en bulles distinctes (= messages séparés sur LinkedIn).
   Indices de séparation : ligne vide, retour à la ligne après une signature,
   indication explicite "puis envoie" / "ensuite" / "Plusieurs messages courts".
   Si tu n'es pas sûr, garde une seule bulle.

2. Détecte les variables à remplir (PRÉNOM, {nom}, [ENTREPRISE], etc.).
   Pour chaque, propose un source_hint :
   - lead_first_name / lead_last_name / lead_company
   - subject_of_post (= sujet du post liké)
   - other (= variable libre que l'utilisateur remplira)

Réponds en JSON strict :
{ "bubbles": [{order, text}], "variables": [{name, source_hint, required}] }
```

### Edge cases

- **Pas de séparateur clair** → 1 bulle, pas d'erreur (back-compat mono)
- **Variable ambiguë** (ex: "le sujet") → `source_hint: "other"`, l'utilisateur la classifiera
- **Doc anglais** → l'extracteur supporte les indices "then / next message / send separately"

## Couche 3 — runtime draft

### Détection scénario → template

Existant : `getActivePlaybookForSource(personaId, source_core)` retourne le doc playbook actif pour un scénario (lu par `chat.js` et `draft.js`). Ses `template_skeleton` artifacts sont chargés via `getActiveArtifactsForPersona`.

Nouveau : si le scénario détecté côté chat a un template `template_skeleton` avec `content.bubbles` peuplé → le pipeline drafter passe en **mode séquence**.

### Mode séquence (prompt)

Au lieu de "produis 1 message", le prompt devient :

```
Tu dois exécuter ce template de setting (scénario : dr_recue) :

[template avec bulles ordonnées et variables marquées]

Produis la séquence de N bulles. Garde la voix du persona, adapte minimalement
si le contexte du prospect demande un ajustement, mais respecte l'ordre, la
longueur et la structure.

Réponds en JSON strict :
{ "bubbles": [{order, text}], "filled_variables": {name: value} }

Pour les variables que tu ne peux pas remplir (lookup non disponible),
laisse le placeholder en clair : {prénom} reste {prénom}.
```

### Endpoints touchés

- `/api/chat` : retourne maintenant `{ assistant_message, bubbles?: [{order, text}] }`. Si `bubbles` présent, le client rend la séquence. Sinon comportement actuel (single message).
- `/api/calibrate` POST : pour chaque CALIBRATION_CONTEXT, si on bascule en mode scénario-driven (cf. décision session) et que le scénario a un template multi-bulles, retourne `bubbles`. Sinon string mono comme aujourd'hui.

## Couche 4 — UI

### Chat composer

- Si la réponse drafter contient `bubbles[]` : afficher comme **N cards séparées** dans la fenêtre composer, chacune avec son bouton "copier".
- Bouton "copier tout" supplémentaire qui copie tout en une fois (séparé par retours à la ligne) si l'utilisateur veut paste-once dans LinkedIn.
- Variables non remplies (placeholder `{prénom}`) sont **highlight** en vermillon dans la card avec un tooltip "à remplir manuellement avant envoi".
- Édition : chaque bulle est éditable indépendamment, edit déclenche les events training existants (correction si user re-écrit).

### Calibrage UI

Aujourd'hui : 5 cartes "context + response". Demain en mode scénario-driven : 5 cartes "scénario : dr_recue / interaction_contenu / etc. — séquence à valider", chacune affichant les N bulles attendues. Rating reste 1-5 sur l'ensemble de la séquence (pas par bulle pour V1).

## Couche 5 — calibrage scénario-driven (impacte ce spec)

Décision prise en session : pour L2/L3, le calibrage tape sur les scénarios du persona (lus depuis `protocol_document` par `source_core`), pas sur les 5 contextes génériques. Pour L1, fallback générique inchangé.

Implication concrète :
- `api/calibrate.js` détecte `persona.maturity_level`. Si L2/L3 et que le persona a au moins 1 `protocol_document` actif avec `source_core` non-null → mode scénario-driven.
- Génère 1 message (ou 1 séquence si template multi-bulles) par scénario actif (cap à 5).
- Sinon → comportement actuel (5 contextes hardcodés).

## Plan d'implémentation (4 phases, ~3 jours)

### Phase A — storage + enrichisseur (~0.75j)
- [ ] Étendre le prompt extracteur de `protocol_artifacts.kind=template_skeleton` dans PR #1 pour produire `bubbles[]` + `variables[]` dans la même réponse LLM. Si infra figée, faire un cron de second pass `enrich-templates`.
- [ ] Tests unitaires sur l'extracteur : 5 cas issus de Nicolas (dr_recue icebreaker, dr_recue relance, interaction_contenu, sortie propre, premier_degre).
- [ ] Migration data : pas de SQL, juste des tests qui valident que les artifacts Nicolas existants ont `bubbles` après re-extraction.

### Phase B — runtime draft (~1j)
- [ ] `lib/prompt.js` : si template actif avec `bubbles`, passer en mode séquence (prompt JSON).
- [ ] `api/chat.js` : parser la réponse, retourner `bubbles` au client si applicable.
- [ ] Fallback : si JSON invalide ou pas de `bubbles` dans le template → mode actuel.
- [ ] Tests : 1 cas Nicolas dr_recue → 3 bulles renvoyées dans la bonne forme.

### Phase C — UI (~0.75j)
- [ ] Composant `BubbleSequence.svelte` (N cards copiables, highlight variables, "copy all").
- [ ] Branchement chat composer + calibrage page.
- [ ] Tests visuels via vite dev.

### Phase D — calibrage scénario-driven (~0.5j)
- [ ] `api/calibrate.js` : branche le mode scénario sur `maturity_level` + `protocol_document.source_core`.
- [ ] UI calibrage adapte les labels (contexte → scénario).
- [ ] Test bout-en-bout sur Nicolas : 4 scénarios actifs (dr_recue, interaction_contenu, premier_degre, spyer) → 4 séquences, chacune cohérente avec son template.

## Risques

- **Coût LLM phase A** : ajouter `bubbles` + `variables` au prompt extracteur PR #1 = +20% tokens output environ. Acceptable. Si fait en cron séparé : +1 LLM call par template, mais cron tourne une fois par upload, pas critique.
- **Détection bulles ratée** : extracteur peut sur-fragmenter ou sous-fragmenter. Mitigation : fallback mono-bulle quand pas sûr ; user voit la séquence dans la queue Propositions et peut éditer avant accept.
- **Régression mode mono** : pour les personas L1 ou sans templates multi-bulles, rien ne doit changer. Couvert par la condition "si bubbles présent" dans le prompt.
- **Multi-bulle dans chat UX réel** : copier 3 messages d'affilée dans LinkedIn est manuel. Acceptable V1. V2 envisageable : intégration directe LinkedIn pour envoyer la séquence.

## Tests à écrire

- `test/protocol-template-bubble-extraction.test.js` : 5 cas Nicolas (input prose → output bubbles[]/variables[]).
- `test/api-chat-bubble-sequence.test.js` : persona avec template multi-bulles → réponse contient `bubbles[]`.
- `test/api-chat-bubble-mono-fallback.test.js` : persona sans template → comportement actuel inchangé.
- `test/api-calibrate-scenario-driven.test.js` : L2 avec scénarios → calibrage retourne 1 séquence par scénario actif.

## Open questions (à trancher avant code)

1. **L'enrichissement (bulles + variables) tourne dans le prompt extracteur PR #1, ou en cron séparé ?**
   - Préférence : dans le prompt PR #1 si Abraham accepte +20% output tokens. Plus simple, latence quasi-nulle, pas de cron à maintenir. Sinon cron.

2. **`source_hint` des variables : enum fermé ou string libre ?**
   - V1 enum fermé `lead_first_name | lead_last_name | lead_company | subject_of_post | other`. Permet de brancher le lookup auto V2 sans deviner.

3. **Quand l'utilisateur édite une bulle dans le chat composer, on stocke ça comme un `correction_event` (existant) ou un nouveau type "bubble_edit" ?**
   - Préférence : `correction_event` existant avec un flag `correction_kind=bubble_edit` dans le payload. Pas de nouveau type pour V1.

4. **Calibrage scénario-driven : on appelle 1 LLM par scénario (4-5 calls, plus cher) ou 1 seul LLM avec tous les scénarios en input ?**
   - 1 par scénario : meilleure qualité de pioche RAG (déjà payée par PR #208). Plus cher mais plus juste. Acceptable.

## Liens

- Memory : `project_voiceclone_playbook_taxonomy.md`
- Memory : `project_voiceclone_clone_maturity_levels.md`
- Spec connexe : `2026-04-27-clone-meta-rules-and-maturity.md`
- Audit : `docs/audits/protocol-underutilization-2026-05-01.md`
- Seed : `scripts/seed-nicolas-source-playbooks.js`
- PR séquence Abraham (parallèle) : #1 import-doc, #2 doc categorization, #3 identity, #4 coherence, #5 check_params
