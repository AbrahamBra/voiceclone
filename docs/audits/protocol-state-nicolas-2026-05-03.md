# Audit — État du protocole Nicolas + chemin vers V2 propre (2026-05-03)

> Suit et précise [protocol-underutilization-2026-05-01.md](./protocol-underutilization-2026-05-01.md). Méthode identique : queries directes contre Supabase prod + lecture de code, pas d'inférences.
>
> **Scope** : ce que contient *aujourd'hui* le protocole Nicolas et ce qu'il faut faire pour qu'il soit cohérent et utile en prod.

---

## TL;DR

Le pipeline V2 marche **techniquement** pour Nicolas (extraction OK, 455 propositions générées, dédup sémantique appliquée). Mais **rien d'extrait n'arrive dans le prompt** : il y a 1 seul artifact actif (le pattern ICP) sur 455 propositions extraites. Le goulot est unique et identifié : **personne n'a accepté les propositions**.

Trois canaux d'injection coexistent toujours dans le prompt — le V2 (artifacts), le legacy V1 (`operating_protocols` → vide pour Nicolas, mais toujours lu), et `scenario_files` (toujours actif, contient encore le seed générique). Tant que le 3ème canal n'est pas nettoyé, **purger `voice.writingRules` ne suffit pas** : les mêmes 12 règles génériques sont aussi dans `scenario_files.default` et continuent d'arriver dans le prompt par cet autre chemin.

---

## 1. Trois canaux dans le prompt (vérifiés dans le code)

```
                                ┌─────────────────────────┐
                                │   buildSystemPrompt     │
                                │   lib/prompt.js         │
                                └────────────┬────────────┘
                                             │
       ┌─────────────────────────────────────┼─────────────────────────────────────┐
       ▼                                     ▼                                     ▼
┌──────────────────┐                 ┌──────────────────┐                 ┌──────────────────┐
│ Canal A — VOICE  │                 │ Canal B —        │                 │ Canal C —        │
│                  │                 │   SCENARIO       │                 │   PROTOCOL       │
│ persona.voice    │                 │                  │                 │                  │
│ JSON             │                 │ scenario_files   │                 │ legacy + V2      │
│                  │                 │ table            │                 │                  │
│ tone, perso,     │                 │                  │                 │ V1: operating_   │
│ signaturePhrases │                 │ slug → content   │                 │   protocols +    │
│ neverDoes,       │                 │                  │                 │   protocol_hard_ │
│ forbiddenWords,  │                 │ Injecté sous     │                 │   rules          │
│ writingRules     │                 │ "INSTRUCTIONS DU │                 │ (chat.js:398)    │
│                  │                 │  SCENARIO"       │                 │                  │
│ prompt.js:144-149│                 │ prompt.js:197    │                 │ V2: protocol_    │
│                  │                 │                  │                 │   artifact       │
│                  │                 │                  │                 │ (chat.js:399)    │
└──────────────────┘                 └──────────────────┘                 └──────────────────┘
```

**Important** : `protocol_section.prose` (le contenu humain-lisible des sections du protocol_document) **n'est PAS injecté dans le prompt**. Il sert de doctrine humaine pour l'UI. Le seul chemin V2 vers le prompt est `protocol_artifact`, qui est créé exclusivement via accept d'une proposition (api/v2/propositions.js:184-247).

---

## 2. État Nicolas par canal (queries directes)

### Canal A — Voice
| Champ | État avant 2026-05-03 | Après cleanup en cours |
|---|---|---|
| `tone` | 5 entrées (direct, pragmatique, …) | inchangé — collent à Nicolas |
| `personality` | 5 entrées (analytique, no-bullshit, …) | inchangé — collent |
| `signaturePhrases` | 8 entrées | inchangé — réelles, à garder |
| `forbiddenWords` | 6 entrées (génial, fantastique, …) | inchangé — défensible |
| `neverDoes` | 8 entrées | inchangé — défensible |
| **`writingRules`** | **12 entrées génériques** dont "Structurer en points numérotés ou à puces" qui **contredit** la prop V2 mergée "Jamais de liste à puces" | **vidé le 2026-05-03 ~20:48** (backup `scripts/_tmp-nicolas-backup-2026-05-03T20-48-53-945Z.json`) |

### Canal B — Scenario
| slug | chars | Contenu réel | À faire |
|---|---|---|---|
| `default` | 761 | **Les 12 mêmes writingRules génériques** (dont "Structurer en points numérotés ou à puces") | **À nettoyer** — sinon l'effort sur Canal A est neutralisé |
| `qualification` | 2744 | Vrai prompt scénario métier (états ATTENTE_PROFIL / ANALYSE / REDACTION) | À garder |
| `post` | (manquant) | défini dans `persona.scenarios` JSON mais aucune ligne dans `scenario_files` | À créer si utilisé |

`persona.scenarios` JSON déclare 3 scénarios (post, default, qualification) mais `scenario_files` n'a que 2 lignes. La sélection scénario tombe sur `default` quand aucun n'est spécifié → le bruit générique tombe par défaut.

### Canal C — Protocole

**V1 (legacy) — toujours chargé par chat.js mais vide pour Nicolas :**
- `operating_protocols` (filtré sur `intelligence_source_id`) : **0 ligne**
- `protocol_hard_rules` : 0 ligne
- → `formatProtocolSection` retourne `""`
- Le code V1 est toujours appelé à chaque chat (overhead, pas erreur). Sprint A de l'audit 2026-05-01 prévoyait sa coupe — pas fait à ce jour.

**V2 — étape par étape :**

Inputs déjà ingérés :
- 4 docs (.odt + .pdf) importés via `import-doc.js` → source `upload_batch`
- 5 source-specific playbooks seedés via `seed-nicolas-premier-degre-spyer.js` (et un précurseur pour visite_profil / dr_recue / interaction_contenu) → `source_core` distincts

Propositions extraites (state 2026-05-03 21:00) :
| Status | Compte | Origine |
|---|---|---|
| `pending` | **379** (291 ≥ 0.9 confidence) | 305 playbook_extraction + 72 upload_batch + 2 chat_rewrite — **JAMAIS REVIEW** |
| `merged` | 75 | toutes `upload_batch`, provenance vide, resolved en batch 2026-05-03 09:21. Origine non identifiée formellement (pas le code live). Probablement un cleanup manuel post-audit du 2026-05-01. **N'apparaissent ni en prose section ni en artifact** |
| `accepted` | 1 | le pattern ICP (CEO 35-55 ans, 500K€-20M€) |

Sections du global doc (32eed005) :
| kind | prose chars | Notes |
|---|---|---|
| `identity` | 23133 → **2021** | dump Notion brut → curé le 2026-05-03 ~20:48 |
| `icp_patterns` | 518 | seul autre rempli |
| `hard_rules` | 0 | la majorité des 138 propositions hard_rules en pending pointaient ici |
| `process` | 0 | 77 props pending |
| `errors` | 0 | 46 props pending |
| `templates` | 0 | 35 props pending |
| `scoring` | 0 | 14 props pending |

Artifacts actifs (= ce qui vraiment dans le prompt) :
- 1 seul : `pattern` `severity=light`, le pattern ICP, créé via accept le 2026-05-02 11:29

→ **Le prompt actuel de Nicolas n'a qu'une règle V2 sur 455 candidates extraites. Le pipeline n'a pas tourné dans son rôle d'apprentissage : il a stocké, pas appris.**

---

## 3. Ce qui contredit ce que pensait l'audit du 2026-05-01

L'audit notait pour Nicolas : *"6 artifacts (5 hard / 1 soft) avec content.check_params = {}"*. Aujourd'hui : **1 artifact** (le soft pattern ICP). Les 6 hard_check sans params ont disparu (nettoyés ou désactivés entre le 2026-05-01 et aujourd'hui — non tracé). Le **bug "params vides"** signalé dans cet audit n'est plus actif puisque l'unique artifact est un pattern (qui n'a pas besoin de params).

---

## 4. Les vrais gaps pour atteindre V2 propre — **côté Nicolas**

Dans cet ordre (chacun indépendant, à coût croissant) :

### G1. Compléter la purge des 12 règles génériques (5 minutes)

L'effort fait sur `voice.writingRules` est **partiellement annulé** par `scenario_files.default` qui contient les mêmes règles. Soit on vide ce content, soit on le remplace par un scénario métier vrai. Sans ça, "Structurer en points numérotés ou à puces" continue d'arriver dans le prompt par Canal B et contredit la doctrine V2 dès qu'elle s'établira.

Action : `UPDATE scenario_files SET content = '' (ou un contenu Nicolas réel) WHERE persona_id = <nicolas> AND slug = 'default'`.

### G2. Trier les 379 pending propositions

Goulot principal du système. Trois sous-options par effort :

- **G2a — UI manuelle** : naviguer sur `/brain/<persona-id>` (composant `ProtocolPanel.svelte` → `ProtocolPropositionsQueue.svelte`). Triage à la main, accept/reject/revise par carte. Coût : 1-2h pour 379 props.
- **G2b — Bulk-accept assisté** : aucun script de bulk-accept n'existe à ce jour. Il faudrait écrire un script qui hit `POST /api/v2/propositions { action: "accept" }` en boucle, avec filtre confidence ≥ 0.9 (ce qui sélectionnerait 291/379). Estimation : 30 min de script + ~10 min d'exécution.
- **G2c — Auto-accept par batch DB** : risqué, contourne `materializeArtifact` qui vit dans le code. À éviter — perdrait la cohérence section.prose / artifact.

Recommandé : **G2b** (script propre qui appelle l'API, donc respecte la sémantique accept). Filtre initial sur confidence ≥ 0.9 + intent=add_rule pour matérialiser d'abord les hard_check, ensuite tourner sur add_paragraph.

### G3. Décider du sort des 75 props "merged"

Provenance vide, source `upload_batch`, batch-resolved 2026-05-03 09:21 sans création d'artifact. Soit du déchet à laisser, soit du contenu à recycler. Inspection rapide nécessaire pour décider — leurs `proposed_text` sont dans la DB.

### G4. Audit `target_section_id` sur les pending

Aucune des 379 pending n'a `target_section_id` rempli. Le drain (qui patch la section.prose lors de l'accept) appelle `resolveTargetSection` qui retombe sur le kind. Vérifier que ça marche correctement avant de bulk-accepter — sinon les propositions tomberaient dans la mauvaise section.

### G5. (Indépendant Nicolas mais le concerne) Sprint A "purge dead surfaces" de l'audit 2026-05-01

L'audit prévoyait de couper `operating_protocols`, `protocol_hard_rules`, `cron-consolidate.js`, `lib/protocol-parser.js`, `lib/fidelity.js`, `lib/critic/rhythmCritic.js`. **Pas fait.** Inoffensif pour Nicolas (les tables legacy sont vides), mais charge le pipeline chat à chaque turn.

---

## 5. Ordre suggéré (sans urgence calendaire)

```
G1 (5 min)  ──► G3 (15 min)  ──► G4 (30 min)  ──► G2b (1h)  ──► G5 (audit 2026-05-01 Sprint A, 1-2 jours)
purge       │   inspect 75    │   verify        │  bulk      │  système
scenario    │   merged        │   resolveTarget │  accept    │  housecleaning
files       │   props         │   Section       │  ≥0.9      │
```

À chaque étape, le clone est testable depuis l'UI chat — vérification fonctionnelle continue, pas d'effet de big-bang.

---

## 6. Ce que NE fait PAS ce document

- Ne propose pas de design V3 (l'audit 2026-05-01 §6 garde Sprint A/B/C en garde-fou avant V3 — j'y souscris).
- Ne tranche pas sur la cause exacte du status `merged` posé en batch ce matin. Pour info uniquement, pas de blocker.
- Ne couvre pas Boni-yai, Mohamed, Adrien, Thomas — ils sont dans l'audit 2026-05-01.
- Ne couvre pas le canal `feedback_events` (Sprint B de l'audit 2026-05-01) — important mais hors scope ici.

---

## Appendice — Backups écrits le 2026-05-03

Pour Nicolas spécifiquement :
- `scripts/_tmp-nicolas-backup-2026-05-03T20-48-43-799Z.json` (dry-run pre-write)
- `scripts/_tmp-nicolas-backup-2026-05-03T20-48-53-945Z.json` (snapshot juste avant écriture)

Contiennent : `voice` complet et `identity.prose` complet d'avant cleanup. Restauration = un UPDATE par champ.

## Appendice — Fichiers code de référence

| Quoi | Où |
|---|---|
| Pipeline chat principal | [api/chat.js:389-432](../../api/chat.js#L389) |
| Build prompt | [lib/prompt.js](../../lib/prompt.js) (entrée: `buildSystemPrompt` ligne 121) |
| Loader artifacts V2 | [lib/protocol-v2-db.js:135](../../lib/protocol-v2-db.js#L135) (`getActiveArtifactsForPersona`) |
| Loader hard rules legacy | [lib/protocol-db.js:68](../../lib/protocol-db.js#L68) (`getActiveHardRules`) |
| Loader scenario | [lib/knowledge-db.js:340](../../lib/knowledge-db.js#L340) (`loadScenarioFromDb`) |
| Accept proposition (endpoint) | [api/v2/propositions.js:184-247](../../api/v2/propositions.js#L184) |
| Materialize artifact | [api/v2/propositions.js:375-424](../../api/v2/propositions.js#L375) |
| Extract playbook → propositions | [scripts/extract-source-playbooks-to-global.js](../../scripts/extract-source-playbooks-to-global.js) |
| Drain feedback → propositions (cron 5min) | [api/cron-protocol-v2-drain.js](../../api/cron-protocol-v2-drain.js) |
| UI review queue | [src/lib/components/protocol-v2/ProtocolPropositionsQueue.svelte](../../src/lib/components/protocol-v2/ProtocolPropositionsQueue.svelte) |
| UI page brain | [src/routes/brain/[persona]/+page.svelte](../../src/routes/brain/[persona]/+page.svelte) |
