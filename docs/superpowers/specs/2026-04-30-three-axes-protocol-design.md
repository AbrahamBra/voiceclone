# Trois axes du protocole vivant

**Status** : posé après #158/#161 ; trace l'architecture mentale pour les futurs chantiers.

## Pourquoi cette spec existe

PR #158 a introduit `source_core` comme nouvelle dimension du protocole. À ce moment-là, plusieurs concepts qui paraissent voisins ont commencé à se chevaucher : `scenario_type` (DM_1st / relance / closing), `source_core` (visite_profil / spyer / sales_nav), et un éventuel `action_kind` (ajout de connexion vs DM vs interaction contenu côté setter). Sans clarté sur ces axes, la prochaine personne (humain ou agent) qui touche le pipeline va remélanger les concepts et figer une mauvaise structure.

Ce doc pose **3 axes orthogonaux**, leur sémantique, et un exemple concret par combo. À lire avant tout PR qui ajoute une dimension au système prompt.

## Les 3 axes

### Axe 1 — `scenario_type` : STAGE dans la conversation

Source de vérité : `supabase/025_sprint0_foundation.sql` (enum `scenario_canonical`), `src/lib/scenarios.js`, `api/chat.js:251-272` (`SCENARIO_OVERRIDES`).

Valeurs (DM-only depuis #156) :
- `DM_1st` — premier message à un prospect (cold opener)
- `DM_relance` — follow-up après silence du prospect
- `DM_reply` — le prospect a répondu, on enchaîne
- `DM_closing` — le prospect est chaud, on propose un RDV

**Ce que cet axe modélise** : la position dans le cycle de vie d'UNE conversation. Évolue au fil du thread, jamais en arrière (DM_1st → DM_reply, pas l'inverse).

**Ce qu'il ne modélise PAS** : d'où vient le lead, quelle stratégie d'entrée, le type de canal.

### Axe 2 — `source_core` : ORIGINE du lead

Source de vérité : `supabase/055_protocol_source_core.sql`, `src/lib/source-core.js`.

Valeurs (V1, fixed enum) :
- `visite_profil` — le prospect a visité ton profil sans demande de connexion
- `dr_recue` — il t'a envoyé une demande de connexion (inbound)
- `interaction_contenu` — il a réagi/commenté un de tes posts
- `premier_degre` — il est déjà 1er degré, lead tiède
- `spyer` — il vient d'une audience tierce que tu surveilles
- `sales_nav` — il vient d'une liste outbound froid

**Ce que cet axe modélise** : par quel canal le lead est arrivé. Constant sur toute la conv, capturé à la création (manuel V1, auto-détecté V2 depuis le scrape).

**Ce qu'il ne modélise PAS** : ce que tu fais (envoyer un DM, commenter, réagir). Ni le stage de la conv.

### Axe 3 — `action_kind` : ACTION OUTBOUND que tu fais (pas encore en code)

Pas implémenté. Dimension hypothétique. À ajouter SI un cas d'usage le nécessite (cf. "Quand ouvrir le 3e axe" plus bas).

Valeurs candidates si on l'ouvre :
- `dm` — tu envoies un DM (couvert aujourd'hui par la combinaison `scenario_type` × `source_core`)
- `connection_request` — tu envoies une demande de connexion (texte qui accompagne la demande)
- `content_interaction` — tu commentes/likes un post du prospect (action côté toi, distincte de "il a interagi avec ton contenu" qui est `source_core=interaction_contenu`)

**Ce que cet axe modélise** : le canal/format de sortie que tu produis. Le DM est UNE action ; envoyer une demande de connexion avec mot personnalisé en est une autre, avec ses contraintes propres (300 caractères max, pas de question, ton plus direct).

## Tableau combinatoire — 3 exemples concrets

| `scenario_type` | `source_core` | `action_kind` | Que produit le LLM ? |
|---|---|---|---|
| `DM_1st` | `visite_profil` | `dm` (implicite V1) | « saalut PRÉNOM, j'ai remarqué que tu étais passé par mon profil… » + 2 lignes de curiosité symétrique |
| `DM_1st` | `spyer` (Alec Henry) | `dm` (implicite V1) | « j'ai vu que tu suivais Alec Henry, ce que tu construis sur [secteur] m'a interpellé… » — référence au compte tiers, ton outbound tiède |
| `DM_relance` | `visite_profil` | `dm` (implicite V1) | « j'ai vu que ton dernier post sur [X], ça pose la question de [Y] » — nouvelle observation business, JAMAIS reformuler le 1er DM (règle visite_profil) |
| `DM_1st` | `sales_nav` | `dm` (implicite V1) | « bonjour PRÉNOM, on ne se connaît pas, votre profil sur [secteur] » — outbound froid pur, vouvoiement, pas de prétexte |
| (futur) `—` | `dr_recue` | `connection_request` | « bonjour, je suis CEO chez [X], on partage un intérêt sur [Y] » — 200 caractères, pas de question, professionnel |
| (futur) `—` | (any) | `content_interaction` | Génère un commentaire authentique sur un post du prospect — pas un DM, autre format |

## Quand ouvrir le 3e axe (`action_kind`)

**Pas maintenant.** Pour V1/V1.5, l'axe est implicite (`dm`). Toutes les conv passent par le pipeline DM.

**Ouvrir quand** :
- Un client dit "je veux automatiser le texte de mes demandes de connexion entrantes" → action ≠ DM, contraintes ≠ DM (300 chars, pas de question)
- Le `connection_request` mérite son propre `protocol_document` parce que les règles diffèrent radicalement du DM (ton, longueur, contraintes plateforme)
- Sales nav cold + connection_request : tout le mot d'ouverture vit là

**Comment l'ajouter sans casser** :
- Nouvelle colonne `protocol_document.action_kind text` (CHECK enum) — additive, NULL = DM par défaut (back-compat)
- Mêmes 6 valeurs `source_core` × N valeurs `action_kind` = matrice de playbooks possibles
- Pas plus invasif que ce qu'on a fait avec `source_core` en #158

## Règles d'or pour les futurs PR

1. **Avant de proposer une nouvelle dimension**, écris l'exemple concret par combo dans le tableau ci-dessus. Si tu ne peux pas le remplir, la dimension n'existe pas — c'est juste un sous-cas d'une dimension existante.

2. **Une dimension par enum**. Si tu as envie d'ajouter une 7e valeur à `source_core` mais qu'elle implique une action différente (pas juste une origine), c'est un nouvel axe, pas une nouvelle valeur.

3. **Les axes sont orthogonaux par design**. Si deux axes corrèlent fortement (ex: `source_core=sales_nav` corrèle avec `action_kind=connection_request`), c'est OK — la corrélation est dans la donnée, pas dans le schéma. Le schéma garde les axes séparés pour rester compositional.

4. **Le system prompt assemble les axes** en additionnant les artifacts pertinents (cf. `getActiveArtifactsForPersona` qui union global + source-specific). Ajouter un axe = ajouter un autre `protocol_document` au lookup, pas une refonte.

## Implications pour les chantiers actuels

- **V2 — Upload UX brain page** : la UI doit penser "je crée un playbook pour [persona] sur [source_core]". Le `scenario_type` est implicite (DM-only) ; `action_kind` n'existe pas encore. Donc 1 dropdown source = suffisant pour V2.

- **V2 — Templates 5 autres sources** : pour chaque template, écrire 1 ligne dans le tableau combinatoire ci-dessus avec un exemple concret. Si tu ne peux pas écrire l'exemple, le template n'a pas de valeur — recommence.

- **V3+ — Routing fin** : si on ajoute `action_kind`, le routing des corrections devient `(persona, source_core, action_kind)` au lieu de `(persona, source_core)`. Mêmes patterns, juste un axe de plus.

## Anti-patterns à éviter

- ❌ Mettre `connection_request` dans `source_core` (= confondre origine et action)
- ❌ Faire de `DM_1st` une valeur de `source_core` (= confondre stage et origine)
- ❌ Créer un `protocol_document.kind` fourre-tout qui mélange les 3 axes
- ❌ Ajouter une 4e dimension sans écrire le tableau combinatoire d'abord
