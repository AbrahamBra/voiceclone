# Setclone × Breakcold via n8n — Workflow 1 : draft auto à l'entrée d'une liste

Setup pas-à-pas pour brancher Setclone sur Breakcold sans migrer d'outil :
chaque lead ajouté à une liste "À contacter" dans Breakcold déclenche la
génération d'un draft personnalisé qui atterrit en note dans la card du
lead, avec un deep link vers Setclone pour les ajustements / l'envoi.

**Temps estimé** : ~1 min de smoke (Étape 0), ~25 min de setup n8n complet (Étapes 1-4), ~5 min par n8n test sur 1 lead.

---

## Pré-requis

- Un compte n8n self-hosted ou cloud avec accès aux nodes Webhook + HTTP Request.
- Un compte Breakcold avec une API key (Settings → Developers → API).
- Un clone Setclone créé et calibré (page `/create` puis `/calibrate`).
- Une URL Setclone (preview Vercel ou prod) — par défaut `https://voiceclone-lake.vercel.app`.

---

## Étape 0 — Smoke test (recommandé avant tout setup n8n)

Avant d'attaquer le setup complet n8n + Breakcold, valide en 1 min que ta clé Setclone fonctionne et que le flow draft → conv → deep link tient. Si cette étape passe, tout ce qu'il restera à debugger plus loin sera côté n8n / Breakcold (pas Setclone).

1. Mint une API key Setclone via `/brain/<persona>/intégrations` (cf. Étape 1 ci-dessous), copie la clé `sk_…`.
2. Lance le smoke depuis le repo Setclone :

   ```bash
   SETCLONE_API_KEY=sk_… \
   SETCLONE_BASE_URL=https://voiceclone-lake.vercel.app \
   node scripts/smoke-breakcold-draft.js
   ```

3. Le script imprime ✓/✗ pour chaque assertion, le draft généré dans la voix du clone, et le deep link Setclone que Breakcold mettra dans la note. Tu cliques le lien → tu dois atterrir sur la conv dans la sidebar **À envoyer**.

Si tout est vert : passe à Étape 1. Si rouge : le payload d'erreur indique le problème (key invalide, persona inactive, prod down…).

---

## Étape 1 — Générer une API key Setclone

1. Ouvre Setclone → Brain page du clone → onglet **intégrations**.
2. Tape un label `breakcold-prod` (ou `n8n-test` si tu fais un essai), clique **+ Nouvelle clé**.
3. **Copie la clé immédiatement** (`sk_…`). Elle ne sera plus jamais affichée — si tu la perds, révoque-la et regénère.
4. Stocke la clé dans n8n :
   - n8n → Settings → Variables → ajoute `SETCLONE_API_KEY = sk_…`
   - n8n → Settings → Variables → ajoute `SETCLONE_BASE_URL = https://voiceclone-lake.vercel.app` (ou ton URL preview).

> Tu peux générer plusieurs clés en parallèle (rotation, multi-environnements).
> Révocation = soft-delete : la clé cesse d'être acceptée immédiatement, l'historique d'usage reste.

---

## Étape 2 — Importer le template n8n

1. Télécharge `templates/n8n/breakcold-draft-on-list-add.json` du repo Setclone.
2. n8n → Workflows → **+ Add workflow** → **Import from file** → sélectionne le JSON.
3. Le workflow apparaît avec 6 nodes. Clique chacun pour le configurer :

### 2.a — Webhook node

- Le path par défaut est `/breakcold-list-add`. n8n te donne une URL complète type `https://votre-n8n.com/webhook/breakcold-list-add`.
- Note cette URL — tu vas la coller dans Breakcold à l'étape 3.

### 2.b — Fetch Breakcold lead

- Crée un credential **HTTP Header Auth** : Header name = `X-Api-Key`, Header value = ton API key Breakcold.
- Sélectionne ce credential sur le node `Fetch Breakcold lead` ET sur les deux nodes `Write Breakcold note/warn` plus loin.

### 2.c — Config map (Breakcold list → source_core)

C'est le mapping le plus critique. Pour chaque source_core Setclone, mets le **nom EXACT** de ta liste Breakcold (case-insensitive, mais l'orthographe doit matcher) :

| source_core | Champ à éditer | Exemple de valeur |
|---|---|---|
| `visite_profil` | `list_to_source_core_visite_profil` | `À contacter (visite profil)` |
| `dr_recue` | `list_to_source_core_dr_recue` | `DR reçues` |
| `interaction_contenu` | `list_to_source_core_interaction_contenu` | `Interactions posts` |
| `premier_degre` | `list_to_source_core_premier_degre` | `Premier degré nouveaux` |
| `spyer` | `list_to_source_core_spyer` | `Spyer Alec` |
| `sales_nav` | `list_to_source_core_sales_nav` | `Sales Nav export` |

Si une liste Breakcold ne correspond à aucun source_core, laisse le champ vide — Setclone fallback sur le protocole global, et l'API te renvoie un `warnings[]` non-bloquant.

### 2.d — Setclone draft

Aucune édition normalement, sauf si tu veux ajouter `scenario_type: "DM_1st"` ou un `prospect_data.context` calculé depuis d'autres champs Breakcold.

### 2.e — Branch on qualification verdict

Setclone renvoie `qualification: {verdict, reason, confidence}` dans la réponse. Le branchement par défaut :
- `verdict ∈ {in, uncertain}` → écrit le draft + deep link dans la note Breakcold (chemin **TRUE** du IF).
- `verdict = out` → écrit un warning "lead hors-cible" au lieu du draft (chemin **FALSE**).

Si tu veux écrire le draft **même quand verdict=out** (par exemple pour laisser le setter décider), supprime le node `Write Breakcold warn` et reconnecte la sortie FALSE vers `Write Breakcold note`.

### 2.f — Write Breakcold note + warn

Ces deux nodes appellent `POST /rest/note` Breakcold. La note inclut :
- Le draft généré (texte LinkedIn-ready, voix du clone).
- Un résumé `qualification: <verdict> (<reason>)`.
- Le deep link Setclone : `<base_url>/chat/<persona_id>/<conversation_id>` — clique pour atterrir directement dans la conv setclone et ajuster avant envoi.

---

## Étape 3 — Configurer Breakcold

Breakcold supporte les automations (Settings → Automations) avec un trigger **Lead added to list** + une action **Send webhook**.

1. Settings → Automations → **+ New automation**.
2. **Trigger** : `Lead added to list`. Sélectionne la ou les listes que tu veux brancher (peut être la même qu'au mapping étape 2.c, ou un sous-ensemble).
3. **Action** : `Send webhook` :
   - URL = la production webhook URL de l'étape 2.a (`https://votre-n8n.com/webhook/breakcold-list-add`).
   - Method = `POST`.
   - Body = JSON avec au minimum `{ "lead_id": "{{lead.id}}", "list_name": "{{list.name}}" }`.
4. Active l'automation.

---

## Étape 4 — Tester sur 1 lead

1. Ajoute manuellement 1 lead dans une des listes mappées.
2. Vérifie n8n → Executions : le run doit afficher 6 verts.
3. Vérifie Breakcold → card du lead → onglet Notes : tu dois voir une note du genre :

   > Salut Alex, vu ton post sur l'IA chez les PME — t'es en exploration ou déjà en prod ?
   >
   > — qualification: in (Founder PME 50p, post récent IA)
   > — Setclone link: https://voiceclone-lake.vercel.app/chat/<persona_id>/<conv_id>

4. Clique le deep link → tu dois atterrir sur la conv dans Setclone, sidebar gauche → onglet **À envoyer** la conv y est listée.

---

## Étape 5 — Idempotency & re-fires

Si Breakcold re-fire le webhook pour le même lead (retry réseau, ré-ajout à la liste, etc.), Setclone reconnaît `external_lead_ref: breakcold:<id>` et :
- Ne génère **pas** de nouveau draft (zéro coût LLM additionnel).
- Renvoie la même conv + le même draft.
- Renvoie `idempotent: true` dans la réponse JSON.

Une seule note Breakcold est créée, pas de pollution.

> Si tu changes de persona Setclone et que Breakcold re-fire le webhook avec le même `lead.id` mais une `SETCLONE_API_KEY` différente, Setclone renvoie un **409 Conflict** (refus de cross-persona reuse).

---

## Failure modes

| Symptôme | Diagnostic |
|---|---|
| `503 — VoiceClone unavailable` dans n8n | Le LLM Anthropic a échoué (timeout, 5xx). La note Breakcold contient `fallback_message`, pas un draft. Re-trigger plus tard ou drafter manuellement. |
| `409 — different persona` | Le `lead.id` Breakcold a déjà été utilisé pour un autre clone Setclone. Renomme le lead dans Breakcold ou use une autre key. |
| `429 — Too many requests` | Tu dépasses 20 requêtes/min côté n8n vers Setclone. Ajoute un delay node entre les batchs si tu importes plusieurs leads simultanément. |
| Pas de note Breakcold mais run vert dans n8n | Vérifie le credential Breakcold sur le node `Write Breakcold note`. La 401 silencieuse remonte en exécution OK si le node ne valide pas le status. |
| `warnings: ["source_core ... invalide"]` | Ton mapping étape 2.c ne match pas le `list.name` envoyé par Breakcold. Vérifie l'orthographe / accents. |

---

## Workflow 3 — Feedback loop sur RDV (V3.6.5 PR-2)

Quand le statut Breakcold d'un lead change ("RDV demandé", "RDV signé", "no show", "deal perdu"), ce 2ème workflow appelle `POST /api/v2/feedback` Setclone pour enregistrer le résultat business contre la conversation. Setclone associe l'outcome à la conv via `external_lead_ref` (le même que Workflow 1) ; aucun risque de doublon — un re-fire renvoie `200 + duplicate=true`.

C'est ce workflow qui ferme la boucle d'apprentissage : les `business_outcomes` rentrent dans les pipelines critic / proposition pour valider quels drafts ont produit des RDV.

### Étape A — Importer le template

1. Télécharge `templates/n8n/breakcold-feedback-on-rdv-status.json`.
2. n8n → Workflows → **+ Add workflow** → **Import from file**.
3. Le workflow apparaît avec 5 nodes (webhook → config map → resolve outcome → IF → Setclone feedback). Aucun node Breakcold-side : ce workflow n'écrit pas de note Breakcold.

### Étape B — Mapping statut → outcome

Édite le node **Config map (Breakcold status → outcome)** pour matcher le **nom EXACT** de tes statuts Breakcold sur les 4 outcomes Setclone :

| outcome Setclone | Champ à éditer | Exemple Breakcold |
|---|---|---|
| `rdv_triggered` | `status_to_outcome_rdv_triggered` | `Premier RDV demandé` |
| `rdv_signed` | `status_to_outcome_rdv_signed` | `RDV signé` |
| `rdv_no_show` | `status_to_outcome_rdv_no_show` | `No show` |
| `rdv_lost` | `status_to_outcome_rdv_lost` | `Deal perdu` |

Si un statut Breakcold n'a pas d'équivalent Setclone, laisse le champ vide — le node `Resolve outcome` renverra `null` et le IF stoppera le workflow sans appel API.

### Étape C — Configurer Breakcold

Settings → Automations → **+ New automation**.

1. **Trigger** : `Lead status changed`. Sélectionne tous les statuts qui doivent remonter (a minima ceux mappés à l'étape B).
2. **Action** : `Send webhook` :
   - URL = `https://votre-n8n.com/webhook/breakcold-rdv-status`
   - Method = `POST`
   - Body JSON minimal : `{ "lead_id": "{{lead.id}}", "status_name": "{{status.name}}" }`
   - Optionnels (utiles pour le critic) : `"deal_value": {{lead.deal_value}}`, `"note": "{{notes.last}}"`, `"message_id": "<uuid d'un msg Setclone>"` (rare — seulement si ton flow connaît la corrélation message-niveau).
3. Active l'automation.

### Étape D — Smoke test

1. Bascule manuellement un lead test (déjà passé dans Workflow 1) vers le statut Breakcold mappé à `rdv_signed`.
2. n8n → Executions : 5 verts.
3. Vérifie côté Setclone DB que la ligne est bien créée :
   ```sql
   SELECT outcome, value, note, created_at
   FROM business_outcomes
   WHERE conversation_id = '<conv_id du Workflow 1>';
   ```
4. Re-trigger le même statut → la 2ème exécution doit aussi remonter `200`, mais `duplicate: true` dans la réponse n8n et **aucune nouvelle ligne** en DB.

### Failure modes (Workflow 3)

| Symptôme | Diagnostic |
|---|---|
| `404 — No conversation matches` | Le `lead.id` Breakcold n'a jamais déclenché Workflow 1 (donc pas de conv Setclone associée). Re-process ce lead via Workflow 1, ou ignore l'outcome. |
| `409 — different persona` | Le `external_lead_ref` est associé à un autre clone Setclone. Indique généralement que la même `SETCLONE_API_KEY` est utilisée pour 2 comptes Breakcold différents — mauvaise config. |
| `400 — Invalid message_id` | Le `message_id` envoyé par n8n n'existe pas en DB ou ne correspond pas à la conv. Soit retire le champ (rdv_signed ne l'exige pas), soit corrige la corrélation côté n8n. |
| `outcome=null` dans le node `Resolve outcome` | Statut Breakcold pas mappé. Édite le node `Config map`. |

---

## Sécurité & rotation

- **API keys Setclone** : rotation propre = générer une nouvelle clé sous un nouveau label, mettre à jour `SETCLONE_API_KEY` dans n8n, puis révoquer l'ancienne. Pas de downtime.
- Les clés Setclone sont stockées en hash sha256 — la valeur en clair n'existe que dans n8n et chez toi.
- En cas de fuite (clé en clair dans un commit / log), révoque-la immédiatement depuis l'onglet **intégrations** du brain — la révocation est instantanée.
