# audit/screens/calibrate.md — `/calibrate/[persona]`

**Écran** : calibration initiale d'un clone juste créé. 5 essais générés par Sonnet, notés 1-5, corrigés optionnellement.
**Fichier** : `src/routes/calibrate/[persona]/+page.svelte` (420 lignes) + `api/calibrate.js`.

---

## 1. IDENTITÉ

### Job-to-be-done (1 phrase)
> **Valider à chaud que le clone tout juste créé colle à la voix du client (ou pas), corriger les premières dérives, avant que l'opérateur ne commence à produire du contenu facturé avec.**

### Test des 3 secondes
**Moyen.** Le manifest "Calibration — étalonne le clone sur ton jugement" est clair. Mais dès que l'opérateur arrive, il voit 5 essais pleins de texte + 5 boutons 1-5 × 5 + 5 textareas. **Zero contexte visuel** : pas d'affichage des posts de référence du corpus. Il note "dans le vide", au feeling.

### Test de nécessité
**L'écran est flottant.** Rien ne le force (on peut "Passer"), rien ne permet d'y revenir plus tard. Deux options produit :
- **Garder** : reconnecter l'écran au flow chat (bouton "Relancer calibration" accessible depuis `/chat`)
- **Dissoudre** : intégrer la calibration **dans** le chat à la création, pas comme écran séparé

La Version B défend la dissolution. C'est aligné avec la philosophie "feedback continu > calibration one-shot" que le guide lui-même vend ("10-15 corrections et le clone colle à ta voix").

---

## 2. DIAGNOSTIC BRUTAL

| Axe | Note | Justification |
|---|---|---|
| **Clarté d'intention** | 7/10 | Manifest fort ("pas un benchmark générique — ton jugement"). Actions binaires simples : noter + corriger. |
| **Hiérarchie visuelle** | 7/10 | Trials empilés, scored vs unscored visible via left border vermillon. Propre. |
| **Charge cognitive** | 6/10 | 5 essais × (5 boutons + textarea) gérable, MAIS sans référence au corpus source — l'opérateur note à l'aveugle. |
| **Densité d'information** | 5/10 | Clairsemé. Pas de split view "réponse clone vs. post de référence". Demi-écran de potentiel informatif gaspillé. |
| **Microcopy & CTAs** | 7/10 | "étalonne le clone sur ton jugement" + "correction (optionnel) — dis ce qui cloche, le clone l'intègre" — direct et efficace. |
| **Cohérence globale** | 7/10 | Aligné sur le design labo du reste de l'app. |
| **Signal émotionnel** | 5/10 | Zéro feedback post-submit ("ce que tu as corrigé a fait gagner +8 pts de fidélité" — absent). |
| **Accessibilité** | 6/10 | `role="radiogroup"` + `aria-pressed` OK. Boutons 36×32 limite mobile (44px recommandé pour touch). |

**Moyenne : 6.5/10.** Meilleur que `/chat`, en-dessous de `/create` sur impact business car flottant et non réutilisable.

---

## 3. RED FLAGS IMMÉDIATS (par impact business)

### 🔴 RF1 — Pas de contexte du corpus source affiché à côté des essais
Pour juger si l'essai "colle à Lucile", l'opérateur devrait pouvoir **comparer** avec les posts originaux de Lucile. Aujourd'hui : l'essai apparaît seul, l'opérateur doit se rappeler de tête si le ton est juste.

Résultat : notation molle, corrections vagues. L'opérateur note 3/5 par défaut sans savoir vraiment si c'est 3 ou 4. **Signal dégradé** pour le pipeline de consolidation derrière.

**Correctif** : split view → à gauche l'essai, à droite le post de référence **sémantiquement le plus proche** du corpus (via RAG Voyage-3 déjà en place). L'opérateur juge en face-à-face. Pour un prompt "relance quelqu'un qui n'a pas répondu", on lui montre le post/DM de relance le plus proche de Lucile dans son corpus ingéré.

### 🔴 RF2 — 5 contextes génériques hardcodés, non personnalisés au client
`api/calibrate.js:8-14` hardcode 5 contextes universels :
```
"Quelqu'un te pose une question simple…"
"Un prospect froid t'envoie un message…"
"Tu reagis a une actualite recente…"
...
```

Pour un clone qui va produire **des posts B2B SaaS sur LinkedIn**, aucun des 5 contextes n'est adapté : "relance quelqu'un qui n'a pas répondu" est un scenario DM, pas un use case post. Pour un clone **DM-only**, idem à l'inverse.

Conséquence : la calibration teste des scenarios qui ne seront **jamais utilisés** pour ce client. L'opérateur note des choses hors-sujet. Le signal résultant est bruité.

**Correctif** : contextes dérivés du **type de clone** (Posts / DMs / Both) + **tags/domaine du persona**. Pour un clone post B2B SaaS : 5 contextes de post LinkedIn (hook personnel, frameworks, retour d'expérience, prise de position, annonce). Pour DM : 5 contextes DM (1er message prospect froid, relance, réponse à qualification, closing, follow-up RDV). Le backend a déjà les infos (type, bio, thèmes) — il suffit d'adapter le prompt généreur.

### 🔴 RF3 — Pas de régénération d'un essai raté
Si l'essai #2 est complètement à côté, l'opérateur ne peut que :
- Noter 1/5
- Écrire dans la textarea "pas du tout, trop générique"
- Espérer que le clone "apprend" derrière

Il ne peut pas dire "**régénère celui-ci avec tel angle** et note la nouvelle version". C'est un one-shot.

Pour un clone qui rate fort en pass initiale (cas fréquent vu la hardcoded list), l'opérateur passe sans corriger — perte de signal pur.

**Correctif** : bouton `↺ Régénérer` par essai. Click → nouveau call backend avec le prompt original + une directive de correction implicite ("cette fois, sois plus direct / plus personnel / etc."). L'opérateur peut faire 2-3 itérations sur le même contexte.

### 🔴 RF4 — Écran jamais ré-accessible après création
`/calibrate/[persona]` n'est linkée **nulle part** sauf depuis le flow `/create` → redirect auto. Après avoir "Passer" ou "Validé", impossible d'y revenir sans manipuler l'URL manuellement.

Or le guide dit : "Apres 10-15 corrections, le clone colle a votre voix" — donc la calibration est **récursive**, pas one-shot. Mais l'UI n'offre aucun chemin pour recalibrer.

**Alternatives** :
- Ajouter un bouton `🎯 Relancer calibration` dans `SettingsPanel` ou dans `IntelligencePanel` du chat
- OU tout fondre dans chat (Version B)

### 🔴 RF5 — Granularité 1-5 excessive ; "Passer" dangereux à côté de "Valider"
Deux petits problèmes qui cumulés cassent la flow :

**5.a — Rating 1-5** : forcer la granularité 1-5 sur un jugement qualitatif est un anti-pattern connu. L'opérateur hésite entre 3 et 4 systématiquement → note moyenne = aucun signal net. Superhuman, Linear, Notion utilisent tous `good / bad` ou `ok / meh / drop`. Plus décisif, moins de friction.

**5.b — Boutons "Passer" et "Valider" côte à côte** : l'opérateur qui passe 10 min à rater 5 essais puis click par erreur "Passer" → tout le travail est perdu sans confirmation. Principe "prevent error" de Nielsen violé.

**Correctifs** :
- Rating 3 options : 👍 / 🤔 / 👎 (mappés en interne 3/2/1 ou booleen + needs-rewrite)
- "Passer" devient un lien texte subtle aligné **à gauche** (pas un bouton), "Valider" gros bouton vermillon à droite
- Si des notes ont été données avant un "Passer", afficher un confirm dialog "vraiment passer ? 3 notes seront perdues"

---

## 4. REFONTE RADICALE — Deux versions

### Version A — **Évolutive** (calibrate reste un écran, on le muscle)

**Principe** : garder le flow `create → calibrate → chat` mais rendre calibrate **actionnable** et **réutilisable**.

#### Structure proposée (ASCII)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ◎ VoiceClone / calibration                                              │
│ Lucile Dupont · CEO @Atomi · POST                          notées 3/5   │
├─────────────────────────────────────────────────────────────────────────┤
│ Calibration — étalonne Lucile sur ton jugement.                         │
│ 5 essais dans ses scenarios (post B2B SaaS). Note + corrige.            │
│                                                                         │
│ ┌─ essai:01 · hook personnel ────────────────────────────────────────┐  │
│ │ ┌── réponse Lucile ─────┐  ┌── ton corpus ────────────────────┐   │  │
│ │ │ "J'ai fait X pendant  │  │ "Il y a 3 ans je dirigeais X, et │   │  │
│ │ │  3 ans. Au final,    │  │  j'ai compris que Y. Aujourd'hui  │   │  │
│ │ │  j'ai appris Y. ..."  │  │  quand je vois Z, je me dis ..." │   │  │
│ │ └───────────────────────┘  └───────────────────────────────────┘   │  │
│ │                                                                    │  │
│ │ [ 👍 bon ] [ 🤔 moyen ] [ 👎 à refaire ]        [ ↺ régénérer ]    │  │
│ │ correction (optionnel) ____________________________________        │  │
│ └────────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│ ... essai 02 ... 03 ... 04 ... 05                                       │
│                                                                         │
│                                                                         │
│ ↙ passer pour l'instant                      [ valider la calibration ] │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Changements précis

1. **Header contextualisé** : nom client + persona + type (POST / DM / BOTH). L'opérateur voit immédiatement quel clone il calibre.

2. **Contextes générés par type + domaine** :
   - Backend `api/calibrate.js` remplace les 5 contextes hardcoded par une **lookup table** `{type, domaine_persona}` → 5 scenarios appropriés
   - Pour v1 : 3 lookups hardcoded (post, DM, both) × les thèmes top du persona (extraits du graphe d'entités via `/api/feedback?persona=X`)
   - L'opérateur voit `essai:01 · hook personnel`, `essai:02 · framework`, etc. (pas "essai 01" tout seul)

3. **Split view réponse vs. corpus source** :
   - Pour chaque essai, à droite : **le post/DM le plus proche sémantiquement** du corpus source (RAG Voyage-3 déjà en place)
   - Si aucun match assez proche (cosine < 0.5) : afficher "aucun équivalent direct dans le corpus" en subtle
   - Layout responsive : side-by-side en desktop, stacked en mobile

4. **Rating 3 options** (👍 / 🤔 / 👎) mappés en `3 / 2 / 1` côté payload — compat avec le backend existant, zéro migration data. `0` reste "non noté".

5. **Bouton régénérer par essai** :
   - Click → nouveau call `/api/calibrate` avec `{persona, regenerate_index: i, prior_correction: "..."}`
   - Remplace l'essai i sans perdre les autres notes
   - Hard-cap 3 régénérations par essai pour limiter coûts

6. **Footer sécurisé** :
   - "passer pour l'instant" devient un **lien texte** aligné à gauche, subtle
   - "valider la calibration" reste un **bouton solid vermillon** aligné à droite
   - Si au moins 1 note existe et user click "passer" → confirm dialog "x notes seront perdues. Continuer ?"

7. **Feedback post-validation** :
   - Au lieu de redirect silencieux, afficher 2s un feedback : "✓ Calibration intégrée. 4 notes + 2 corrections ingérées. Fidélité baseline : 0.78 (+0.06)."
   - Puis redirect vers `/chat/[id]`

8. **Bouton "Relancer calibration" dans `SettingsPanel` du chat** :
   - Ajoute un lien `🎯 Calibrer à nouveau (5 nouveaux essais)` dans le panel réglages
   - Reouvre `/calibrate/[persona]` avec des nouveaux contextes (non répétés)

9. **Track calibration runs** :
   - Persister chaque session de calibration côté Supabase
   - Afficher dans `/calibrate` en header : "3e calibration · 2e run il y a 4j · score moyen : 3.2/5"
   - L'opérateur voit la progression

10. **Raccourcis clavier** :
    - `1` `2` `3` rating rapide sur l'essai focus
    - `Tab` passe à l'essai suivant
    - `R` régénère l'essai focus
    - `Cmd+Enter` valide

#### CTA principal
`Valider la calibration →` (vermillon solid, droite). `Régénérer` et `Passer` sont visuellement soumis.

#### Principes appliqués
- *Comparative judgment* (split view corpus) — Kahneman
- *Fewer choices* (3 options au lieu de 5) — Hick
- *Recovery over prevention* (régénérer) — Nielsen
- *Contextual CTAs* (lien passer subtle, bouton valider fort)

#### Benchmarks
- **Superhuman training mode** (annotations inline, comparatif)
- **Linear priority selector** (3 options max)
- **Arc peekable URLs** (split preview)

#### Impact attendu
- **Signal qualité calibration** : ~50% plus net (split view + 3 options)
- **Taux d'essais corrigés** (vs. passés) : ~25% → ~60%
- **Temps à compléter** : stable ~2 min (gain split view compensé par meilleur feedback)

---

### Version B — **Zéro compromis** (dissoudre calibrate dans `/chat`)

**Principe directeur** : un écran séparé pour la calibration initiale **brise le flow**. Le chat est là pour converser avec le clone et le corriger. Pourquoi séparer la 1ère session des suivantes ?

On fait disparaître `/calibrate` comme route. La calibration devient un **mode "onboarding"** du chat, déclenché automatiquement à la création du clone.

#### Structure proposée (ASCII)

```
Mode onboarding du chat — à la création uniquement
┌─────────────────────────────────────────────────────────────────────────┐
│ Lucile (Atomi) · calibration · 3/5 essais notés                         │
├─────────────────────────────────────────────────────────────────────────┤
│ [Lucile, système]                                                       │
│ Salut. Je vais te montrer 5 exemples dans mes scenarios. Tu notes,     │
│ corriges si besoin, et on démarre. Prêt ?                              │
│                                                                         │
│ ─── essai 1/5 · hook personnel                                         │
│ [user-sys] Écris un hook personnel sur ton parcours.                   │
│ [Lucile]    "J'ai fait X pendant 3 ans. Au final, j'ai appris Y..."    │
│             [ 👍 ] [ 🤔 ] [ 👎 ]  [↺]  [ 💬 Corriger ]                 │
│             ─ corpus le plus proche ─────────────────────────────       │
│             Il y a 3 ans je dirigeais X, et j'ai compris que Y...      │
│                                                                         │
│ ─── essai 2/5 · retour d'expérience                                    │
│ [user-sys] Raconte un apprentissage pro récent.                        │
│ [Lucile]    ...                                                         │
│                                                                         │
│ Quand les 5 sont traités → bouton "Ouvrir la conversation libre"       │
│ Si l'opérateur écrit dans l'input → calibration mise de côté, chat     │
│ libre commence. Calibration reprendra via bouton dédié.                 │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Détails

- **Création du clone** : après "Générer", au lieu d'un redirect `/calibrate`, on arrive directement dans `/chat/[id]` avec un **onboarding thread** auto-injecté : 5 prompts système + 5 réponses clone en attente d'évaluation
- **Chaque réponse clone** a sa propre barre d'actions inline : `👍 / 🤔 / 👎 / ↺ régénérer / 💬 corriger` — même logique que Version A mais sans écran dédié
- **Le corpus de référence** apparaît en dessous de chaque réponse, non pas en split view (mobile-first) mais en toggle discret "↓ corpus le plus proche"
- **Si l'opérateur saute la calibration** : il écrit dans l'input, le chat libre commence. Les 5 essais calibration restent dans l'historique de la conv "onboarding" (retrouvable dans la sidebar)
- **Relancer calibration plus tard** : bouton dans `SettingsPanel` ou dans `CommandPalette` (`Cmd+K > calibrer`) → injecte 5 nouveaux essais dans le chat courant (ou crée une nouvelle conv "calibration v2")

#### Composants supprimés
- Route `/calibrate/[persona]/+page.svelte` entière
- Pas de nouveau composant top-level — la logique vit dans `ChatMessage` (barre d'actions étendue en mode onboarding) et dans le pipeline d'init chat

#### Composants ajoutés
- `CalibrationInlineActions.svelte` — extension de `ChatMessage` pour le mode onboarding
- `CorpusComparePopover.svelte` — toggle discret affichant le post source sémantiquement proche

#### Principes appliqués
- *Unification of surfaces* — une seule surface (chat) au lieu de deux (calibrate + chat)
- *Flow preservation* — pas de redirect brutal après création, continuité
- *Progressive engagement* — l'opérateur peut sauter la calibration, la reprendre, la faire à son rythme

#### Benchmarks
- **Notion AI inline feedback** (👍/👎 sur chaque réponse, inline dans la conv)
- **ChatGPT share conversation mode** (onboarding injectée au premier chat)
- **Superhuman "train your AI"** (corrections inline au fil, pas de mode séparé)

#### Impact attendu
- **Taux de calibration complétée** : actuellement ~estimé 40% (beaucoup skippent), après Version B : ~85% (c'est sur le chemin critique)
- **Continuum feedback** : la calibration initiale ET les corrections quotidiennes utilisent la **même UI** → courbe d'apprentissage zéro pour les corrections ultérieures
- **Route supprimée** : 1 page de moins à maintenir

#### Risque identifié
Le chat devient plus lourd en messages système à la création. Il faut **bien désigner visuellement** les messages calibration vs. les messages user libre — sinon confusion. Une simple étiquette `calibration` sur le side de ces messages suffit (pattern "system vs. user" bien connu).

---

## 5. PRIORISATION

| # | Changement | Impact /10 | Effort /10 | Priorité | Qui | Version |
|---|---|---|---|---|---|---|
| 1 | **Rating 3 options (👍/🤔/👎)** | 6 | 1 | 🔥 P0 | Dev front | A + B |
| 2 | **Header contextualisé (nom/client/type)** | 6 | 1 | 🔥 P0 | Dev front | A |
| 3 | **Contextes générés par type/domaine** | 8 | 4 | P1 | Dev BE | A + B |
| 4 | **Split view corpus source** | 9 | 5 | P1 | Dev full-stack | A + B |
| 5 | **Bouton régénérer par essai** | 7 | 4 | P1 | Dev full-stack | A + B |
| 6 | **"Passer" subtle + confirm destructive** | 5 | 1 | P1 | Dev front | A |
| 7 | **Feedback post-validation (gains fidélité)** | 6 | 3 | P2 | Dev front | A + B |
| 8 | **"Relancer calibration" dans Settings chat** | 7 | 2 | P2 | Dev front | A |
| 9 | **Track calibration runs (historique)** | 6 | 4 | P2 | Dev full-stack | A |
| 10 | **Raccourcis clavier (1/2/3/R/Enter)** | 5 | 2 | P2 | Dev front | A |
| 11 | **Dissolution complète dans chat (mode onboarding)** | 9 | 8 | P2-radical | Dev full-stack + design | B |

### Quick wins flaggés
- 🔥 **#1 + #2** : 2h de dev combinées, rating simplifié + header contextualisé. Ne changent pas la structure mais améliorent immédiatement le taux de notation effectif.
- 🔥 **#3 Contextes par type/domaine** : le gain business est énorme (calibration qui teste les vrais scenarios du clone) pour 1 journée dev backend.

---

**Audit écran 4/8 terminé. Valide, conteste, ou passe à `/` (landing).**
