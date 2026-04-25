# Review Deck v0 — design

**Statut :** design approuvé par AhmetA, à implémenter
**Date :** 2026-04-25
**Auteur :** AhmetA (vision produit), spec rédigée en session
**Précédent :** [docs/superpowers/specs/2026-04-24-protocole-vivant-design.md](2026-04-24-protocole-vivant-design.md) (architecture protocol-v2 dont ce deck est dérivé)

## Contexte

VoiceClone vend des clones DM LinkedIn aux agences ghostwriting+setting. Le protocole v2 est le différenciateur produit ([project_voiceclone_protocol_differentiator]) — il vit, apprend, évolue à chaque correction. Mais l'agence n'a aujourd'hui aucun livrable à montrer au client pour justifier l'abonnement (~100€/clone) et matérialiser cet apprentissage.

Le **Review Deck** est ce livrable. Il prend la forme d'une **proposition de nouvelle version du protocole** + un **changelog explicatif** sur ce qui a changé / ajouté / retiré et pourquoi, à partir des apprentissages capturés sur la période. L'agence l'envoie au client par mail/Slack pour validation. Le client valide → l'agence publie la nouvelle version active.

Aligné sur :
- `feedback_real_conversations.md` (story-driven, pas de métriques génériques)
- `feedback_deliverable_is_object.md` (le livrable EST le protocole enrichi, pas un dashboard parallèle)
- `project_voiceclone_protocol_differentiator.md` (protocole = wow effect)

## Non-goals (V0)

- Pas d'UI visuelle (génération côté API uniquement, l'agence consomme via curl/postman/intégration manuelle)
- Pas de PDF (Markdown only — l'agence convertit côté agence si besoin : pandoc, Notion, copy-paste mail)
- Pas d'envoi automatisé (pas d'email/Slack push — juste génération à la demande)
- Pas de templating personnalisé (un seul format par flavor)
- Pas de paramètre de fenêtre temporelle (30 jours fixe, à paramétrer plus tard si besoin)

## Architecture

Trois fichiers, ~200 lignes total :

```
lib/review-deck-builder.js   ← assembly fonctionnel pur (DB → Markdown)
api/v2/review-deck.js        ← endpoint HTTP wrapper
test/review-deck-builder.test.js
test/api-v2-review-deck.test.js
```

**Aucun appel LLM.** Pure assembly DB → Markdown. Idempotent, cacheable.

## Endpoint

```
GET /api/v2/review-deck?persona_id=<uuid>
```

**Response :** `text/markdown; charset=utf-8`
**Auth :** même middleware que les autres endpoints `api/v2/protocol/*` (pattern à suivre)
**Errors :**
- 400 si `persona_id` manquant ou non-UUID
- 404 si persona n'existe pas
- 404 si persona n'a aucun `protocol_document` (ni active, ni draft)
- 500 sur erreur DB inattendue

## Logique de flavor

Le builder détecte le flavor selon la présence de documents :

| Cas | Flavor |
|---|---|
| Persona a un `protocol_document` status=active ET un status=draft | **Ongoing** (changelog v_draft vs v_active) |
| Persona a seulement un status=active (jamais de draft) | **Ongoing** (changelog vide → "doctrine stable") |
| Persona a seulement un status=draft (jamais publié) | **Kickoff** |
| Persona n'a rien | 404 |

## Format Markdown — flavor Ongoing

```markdown
# Protocole {persona_name} — proposition v{N+1}
*Présenté le {date_iso} · Pour validation · {N_changes} modifications vs v{N}*

## Ce qui change

### §{section_kind} — "{section_heading}"

**↻ Modifié** — il y a {N} jours
> Avant : "{source_quote}"
> Après : "{proposed_text}"
> *Pourquoi :* {rationale}

**+ Ajouté** — il y a {N} jours
> "{proposed_text}"
> *Pourquoi :* {rationale}

**− Retiré** — il y a {N} jours
> "{source_quote}"
> *Pourquoi :* {rationale}

(repeat per change, groupé par section, sorted par resolved_at DESC)

---

## Le protocole tel que proposé

### §1. {section_heading_1}
{section_prose_1}

### §2. {section_heading_2}
{section_prose_2}

(toutes les sections du draft, ordonnées par `order`)

---
*Validez en répondant à ce mail, ou commentez section par section.*
```

## Format Markdown — flavor Kickoff

```markdown
# Protocole {persona_name} — première version
*Extraite de votre playbook · Pour validation*

## Comment votre clone va "penser"

### §1. {section_heading_1}
{section_prose_1}

### §2. {section_heading_2}
{section_prose_2}

(toutes les sections, ordonnées par `order`)

---
*C'est la fondation. Chaque correction qu'on fera ensuite enrichira cette doctrine, et vous reverrez chaque évolution dans le prochain Review Deck.*
```

## Mapping data → contenu

| Élément Markdown | Source DB |
|---|---|
| `{persona_name}` | `personas.label` (ou `personas.name`, à confirmer à l'implem) |
| `v_active.version` | `protocol_document` where status='active' AND owner_kind='persona' AND owner_id=persona_id |
| `v_draft` | `protocol_document` where status='draft' AND owner_kind='persona' AND owner_id=persona_id |
| Sections affichées | `protocol_section` where document_id=v_draft.id (ou v_active si pas de draft), ordered by `order` |
| `{N_changes}` | count(`proposition` where document_id=v_draft.id AND status='accepted') |
| Liste changes | `proposition` where document_id=v_draft.id AND status='accepted', sorted by `resolved_at` DESC |
| Symbole par change | mapping `proposition.intent` (voir table ci-dessous) |
| Avant | `proposition.source_quote` (omis si null) |
| Après | `proposition.proposed_text` |
| Pourquoi | `proposition.rationale` (affiche "—" si null/vide) |
| Date relative | diff entre `proposition.resolved_at` et `now()` → "il y a N jours" |

## Mapping intent → symbole

| `proposition.intent` | Symbole | Libellé |
|---|---|---|
| `add_paragraph` | + | Ajouté |
| `add_rule` | + | Ajouté |
| `amend_paragraph` | ↻ | Modifié |
| `refine_pattern` | ↻ | Modifié |
| `remove_rule` | − | Retiré |

## Edge cases

| Cas | Comportement |
|---|---|
| Persona sans aucun `protocol_document` | 404 + body "Ce persona n'a pas encore de protocole." |
| v_active mais zéro proposition acceptée | Flavor Ongoing, section "Ce qui change" affiche "Aucune modification depuis v{N} — votre doctrine est stable." |
| Section avec `prose` vide | Skip dans le rendu (ni heading ni body) |
| `proposition.rationale` null/vide | Affiche "*Pourquoi :* —" |
| `proposition.source_quote` null sur amend ou remove | Omettre la ligne "Avant :", garder "Après :" |
| Plus de 50 propositions accepted | Pas de cap (cf. `feedback_unbounded_scale_by_design`), mais log warning si > 100 |
| Persona avec seulement draft (jamais publié) | Flavor Kickoff |

## Tests

### `test/review-deck-builder.test.js` (unitaires, mock DB)

- Flavor ongoing : 3 sections + 5 propositions accepted (mix add/amend/remove) → snapshot Markdown
- Flavor ongoing : zéro proposition accepted → "doctrine stable"
- Flavor kickoff : 2 sections → snapshot Markdown
- Persona sans aucun document → throws Error 404
- Mapping intent → symbole couvre les 5 intents (table)
- Date "il y a N jours" calculée correctement à partir de `resolved_at`
- `source_quote` null sur amend → ligne "Avant" omise
- Section `prose` vide → section skippée

### `test/api-v2-review-deck.test.js` (endpoint, mock supabase)

- 200 + `content-type: text/markdown` sur cas nominal
- 400 si `persona_id` manquant
- 400 si `persona_id` non-UUID
- 404 si persona inexistante
- 404 si persona sans protocole
- 500 sur erreur DB simulée
- Auth header manquant → 401 (pattern endpoint v2)

## Décisions tranchées

| Choix | Décision | Pourquoi |
|---|---|---|
| Format de sortie | Markdown | Convertible (PDF/Notion/mail), human-readable, zéro dépendance |
| LLM ou pas | Aucun appel LLM | V0 mécanique, prédictible, zéro coût marginal, testable par snapshot |
| UI | Pas d'UI | API d'abord ; UI add-on plus tard. Curl-able pour proof |
| Diff prose char-by-char | Non | Spec protocol-v2 l'exclut (Non-goals ligne 451). Source de "ce qui change" = `proposition` rows |
| Fenêtre temporelle | 30 jours fixe | Simplicité v0. Param `window_days` à venir |
| Inline annotations dans la prose finale | Non | Bruit visuel pour le client. Changelog en haut suffit |
| Endpoint method | GET | RESTful, cacheable côté agence, idempotent |
| Cap propositions affichées | Aucun | `feedback_unbounded_scale_by_design` |

## Liens implémentation

- Plan d'implémentation : `docs/superpowers/plans/2026-04-25-review-deck-v0-plan.md` (à créer via skill `writing-plans`)
- Spec parent : `docs/superpowers/specs/2026-04-24-protocole-vivant-design.md`

## Mémoires utilisées

- `feedback_real_conversations.md`
- `feedback_deliverable_is_object.md`
- `project_voiceclone_protocol_differentiator.md`
- `feedback_unbounded_scale_by_design.md`
- `feedback_keep_moving.md`
- `feedback_clarity_in_guidance.md`
