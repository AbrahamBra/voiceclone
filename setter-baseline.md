# Setter Baseline — DM B2B LinkedIn

**Scope** : DM 1-to-1, B2B LinkedIn, sortie d'un setter ghostwriter (clone IA). Couvre la verticale "agence ghostwriting + setting multi-clients". Le content/post LinkedIn n'est pas couvert — verticale retirée du produit.

**Voisinage** : ce doc traite des **règles de comportement** que le clone doit respecter dans ses messages (Couche 1 setter). Pour les **règles de format** des documents d'onboarding clients (comment catégoriser, prioriser, ingérer un nouveau doc), voir [`docs/superpowers/specs/2026-04-27-clone-meta-rules-and-maturity.md`](docs/superpowers/specs/2026-04-27-clone-meta-rules-and-maturity.md) + [`docs/superpowers/specs/2026-04-26-doc-ingestion-rules.md`](docs/superpowers/specs/2026-04-26-doc-ingestion-rules.md). Les deux axes sont indépendants et se complètent.

## Architecture en couches

| Couche | Source de vérité | Description |
|---|---|---|
| **Couche 0** — invariants cross-canal | [`lib/checks.js`](lib/checks.js) | Garde-fous anti-IA universels : self-reveal, prompt-leak, AI patterns FR, AI clichés, markdown, `forbidden_words` par persona |
| **Couche 1** — DM setter B2B | [`lib/critic/setterBaseline.js`](lib/critic/setterBaseline.js) | Règles spécifiques au registre setter B2B en DM (catégories A: forme, B: ton, C: structure, D: relance, E: auth, F: contenu) |
| **Couche 2** — override per-persona | `persona.voice.setter_overrides: ["A2", ...]` + flags type `tutoiement_default` | Désactive ou paramètre certaines règles 🔓 pour un clone donné |

**Légende**
- 🔒 absolue (jamais surchargeable, même en Couche 2)
- 🔓 surchargeable per-persona
- `[audit X/N]` règle confirmée empiriquement sur X des N personas audités
- ✓ implémentée — ⏳ pending — 🌑 shadow (logge sans bloquer)

## Couche 1 — Règles actives

### A. Forme / longueur

- ✓ **A1** 🔒 Aucun mur de texte (>60 mots) — `wordCount > 60`
- ✓ **A2** 🔓 `[audit 2/3]` Une seule question par message — `count("?") > 1`
- ✓ **A3** 🔓 Phrase moyenne < 18 mots
- ✓ **A4** 🔒 Pas de markdown/bullets en DM

### B. Ton / registre

- ✓ **B2** 🔓 `[audit 6/6]` Pas de sur-vente (incroyable / révolutionnaire / exceptionnel) — **candidat à promotion 🔒** : 6/6 personas listent ces termes en `forbiddenWords`, aucun usage légitime constaté
- ✓ **B3** 🔓 Pas plus d'1 emoji par message
- ✓ **B4** 🔓 Pas d'auto-promo au premier contact
- 🌑 **B5** 🔓 `[audit 3/3]` **Vouvoiement par défaut, miroir si lead initie tutoiement** — détection : si lead a vouvoyé ou n'a pas tutoyé ET clone tutoie ET pas d'override `voice.tutoiement_default: true` → violation. Ajoutée en mode `shadow: true` (logge sans bloquer) le 2026-04-27 ; flip 🌑 → ✓ après 1-2 semaines de stats réelles.
  - **Provenance du flag** `tutoiement_default` : préférence documentée explicitement dans les supports d'onboarding du clone (charte de voix, protocole, exemples de DM partagés par le client). Sans signal explicite dans les docs → flag absent → vouvoiement par défaut s'applique. Process d'intake doit poser la question si elle ne ressort pas naturellement des docs.

### C. Structure conversationnelle

- ✓ **C3** 🔓 `[audit 3/3]` Ouverture ≠ pitch — pas d'offre/produit/service au premier contact
- ✓ **C4** 🔓 Pas de double CTA (question + lien créneau)

### D. Relance / timing

- ✓ **D2** 🔓 `[audit 2/3]` Pas de "je me permets / je reviens vers vous" — formule usée
- ✓ **D3** 🔓 Pas de culpabilisation du prospect

### E. Authenticité

- ✓ **E3** 🔓 Pas de répétition prénom prospect (>1 par message)

### F. Contenu

- ✓ **F1** 🔓 `[audit 5/6]` Pas de chiffre/stat sans source — **candidat à promotion 🔒** : 5/6 personas listent "ne survend pas / ne fait pas de promesses irréalistes" en `neverDoes`

## Règles déléguées à la Couche 0 ([`lib/checks.js`](lib/checks.js))

- **B1** Aucune formule IA typique → `AI_PATTERNS_FR`, `AI_CLICHES`
- **E1** Pas de self-reveal → `SELF_REVEAL`
- **E2** Pas de prompt leak → `PROMPT_LEAK`
- **A4 (markdown)** également capté par `MARKDOWN_PATTERNS`

## Règles non implémentées (besoin de contexte conversationnel)

- ⏳ **C1** 🔓 Acknowledge avant de pousser (sur messages de réponse, pas d'ouverture)
- ⏳ **C2** 🔒 Pas de recap de ce que le prospect vient de dire — nécessite n-grammes du message prospect
- ⏳ **D1** 🔒 Jamais deux relances consécutives sans réponse — nécessite état de la conversation
- ⏳ **F2** 🔓 Pas de comparaison concurrent explicite — nécessite liste de concurrents per-persona

## Audit cross-persona du 2026-04-27

Audit sur 6 personas actifs : Nicolas Lavallée (L3 setter), Thierry/ImmoStates (L3 setter), Thomas (L1 setter), Adrien Fernandez (L1 content), Mory-Fodé Cisse (L1 content), Mohamed Camara (L1 content).

**Méthode** : extraction des règles par persona depuis `voice` + `protocol_section`, intersection rigoureuse, validation hors-training sur les 3 content clones (devenus contrôle accidentel — la verticale content sortant du produit, ils ne servent plus que de test de généralisation).

**Conclusions :**

1. **B2 + F1 doivent passer 🔒** : preuve empirique 6/6 et 5/6 explicite, aucun contre-exemple. Promotion sans risque.

2. **B5 (vouvoiement par défaut)** : nouvelle règle, manquait au baseline. Ajoutée en shadow. Override `voice.tutoiement_default: true` appliqué sur Nicolas + Thomas — leurs documents d'onboarding explicitent un tutoiement par défaut. Thierry n'a pas de signal explicite dans ses docs → pas d'override → vouvoiement par défaut s'applique (ce qui est cohérent avec son registre CGP/AMF/régulé).

3. **D2 à élargir** : la règle empirique "relance = nouvel angle, jamais reformulation" (Nicolas A1 + Thierry process explicites) est plus large que la regex actuelle qui ne capture que les formules usées. Élargissement nécessiterait similarité sémantique entre message précédent et nouveau — non trivial, à plumber côté pipeline relance.

4. **Couche 2 (overrides)** : le mécanisme existe en code (`setter_overrides` + `tutoiement_default`) mais la base persona n'est pas encore peuplée. À enrichir progressivement au fur et à mesure des feedbacks.

## Pipeline d'évolution d'une règle

Une nouvelle règle suit ce cycle :
1. **🌑 Shadow** : `shadow: true`, logge dans `shadowViolations` mais ne contribue pas au `violationScore`. Récolte des stats sur 1-2 semaines de trafic réel.
2. **✓ Active 🔓** : passage en règle bloquante surchargeable per-persona si les stats valident la pertinence (taux de fire raisonnable, pas de faux positif évident).
3. **✓ Active 🔒** : promotion en règle absolue si l'audit cross-persona confirme l'invariance (pas de contre-exemple légitime sur l'ensemble des personas actifs).

### Requête de décision

Pour décider du flip 🌑 → 🔓 d'une règle shadow (cas concret : B5), exécuter la
requête suivante J+14 après merge en master sur la base de données prod :

```sql
-- Promotion B5 🌑 → 🔓 : exécuter J+14 après merge
SELECT
  COUNT(*) AS total_shadow_logs,
  AVG((signals->>'setter_shadow_count')::int) AS avg_violations_per_msg,
  COUNT(*) FILTER (WHERE signals @> '{"setter_shadow_ids":["B5"]}'::jsonb) AS b5_fires,
  ROUND(100.0 * COUNT(*) FILTER (WHERE signals @> '{"setter_shadow_ids":["B5"]}'::jsonb) / NULLIF(COUNT(*), 0), 1) AS b5_fire_rate_pct
FROM rhythm_shadow
WHERE created_at > NOW() - INTERVAL '14 days';
```

**Critère de promotion** : fire rate B5 < 15% sur l'échantillon. Au-delà, la
règle est trop bruyante en l'état → calibrer la regex (ex : restreindre les
pronoms, exclure des homonymes courants) avant de flip.
