# audit/screens/share.md — `/share/[token]`

**Écran** : page d'acceptation d'un clone partagé via token.
**Fichier** : `src/routes/share/[token]/+page.svelte` (~235 lignes).
**5 états** : `loading · login · preview · already · claimed · error`.

---

## 1. IDENTITÉ

### Job-to-be-done (1 phrase)
> **Permettre à un destinataire (collaborateur agence ou client final) de récupérer l'accès à un clone partagé par l'agence, avec le minimum de friction et le maximum de confiance.**

### Test des 3 secondes
**Acceptable pour le happy path.** Le destinataire voit avatar + nom du clone + bouton "Ajouter a mes clones". Compréhensible.
**Échec pour les edge cases** : si pas de code, détour par auth. Si token expiré, redirect générique. Si le destinataire est méfiant (`pourquoi je vois ce clone ?`), aucune réponse.

### Test de nécessité
Critique pour une agence. Deux use cases principaux :
1. **Onboarding collaborateur interne** : nouvel employé agence → reçoit 5-10 clones des clients en cours
2. **Handoff client** : le client final reçoit "son" clone pour l'utiliser / valider / partager à son équipe

Aujourd'hui le flow gère correctement le cas 1 (collaborateur agence qui a déjà un code), mal le cas 2 (client final sans code = friction).

---

## 2. DIAGNOSTIC BRUTAL

| Axe | Note | Justification |
|---|---|---|
| **Clarté d'intention** | 7/10 | "On vous partage ce clone. Voulez-vous l'ajouter ?" direct. |
| **Hiérarchie visuelle** | 7/10 | Card centrée, action primary claire. |
| **Charge cognitive** | 7/10 | Une action, un click. Minimal. |
| **Densité d'information** | 3/10 | **Avatar + nom + title seulement**. Zero preview, zero contexte, zero identité du partageur. |
| **Microcopy & CTAs** | 5/10 | "On vous partage" passif. Pas de "AhmetA vous a préparé le clone de Lucile Dupont". |
| **Cohérence globale** | 5/10 | Design card centrée différent du reste de l'app (plutôt mode `/create` mini). Pas d'esthétique labo. |
| **Signal émotionnel** | 4/10 | Transaction pure, zéro chaleur d'accueil. |
| **Accessibilité** | 7/10 | Form basique fonctionnel, mais pas de `aria-label` sur bouton primary. |
| **Sécurité / confiance** | 3/10 | Pas d'expiration visible, pas de whitelist email, pas d'identité du partageur. N'importe qui avec le token claim. |
| **Post-claim flow** | 4/10 | "Clone ajouté !" + bouton "Aller au hub". Aucun onboarding, aucun "premier message", aucune explication. |

**Moyenne : 5.5/10.** Suffisant pour un collaborateur agence averti, insuffisant pour un client final qui arrive à froid.

---

## 3. RED FLAGS IMMÉDIATS (par impact business)

### 🔴 RF1 — Exige un code d'accès préalable = bloque les clients finaux
Flow actuel : si `!$accessCode` → état `login` → input password + bouton Entrer → `POST /api/personas` avec ce code → si valide, charge la preview.

Pour un **collaborateur agence** : OK, il a déjà un code.
Pour un **client final** qui reçoit un share depuis l'agence : il n'a **pas** de code. Il voit "Connectez-vous" sans savoir **quel code utiliser**. Flow cassé.

Deux réponses possibles :
- **A** : le token share vaut session temporaire (pas besoin de code pour claim, le token est le ticket)
- **B** : création de compte automatique via le share-link — le claim génère un access code dédié pour ce user, envoyé par email

Actuellement aucun des deux n'est implémenté. **Le client final est bloqué à la porte.**

### 🔴 RF2 — Preview minimale : avatar + nom + titre
Un destinataire voit `[Avatar] Lucile Dupont · CEO @Atomi` et doit décider s'il claim. Manquent :
- Échantillon de **posts** que le clone peut générer (2-3 extraits)
- **Scenarios** disponibles (post, DM-1st, DM-relance, etc.)
- **Date de création** + **dernière mise à jour** du clone
- **Niveau de fidélité** actuelle (signal "ce clone est bien entraîné")
- **Nombre de corrections déjà ingérées** (signal "mature")

Sans ça, le destinataire claim **à l'aveugle**. Pour un collaborateur = OK il fait confiance. Pour un client = **méfiance** potentielle ("c'est vraiment mon style ?").

### 🔴 RF3 — Pas d'identité du partageur visible
Le message "On vous partage ce clone" est anonyme. Qui partage ? L'agence AhmetA ? Un individu de l'agence ? Un prospect qui a compromis un token ?

Pour une app vendue par une agence à des clients, le **branding agence** doit être présent : "AhmetA (votre agence) vous a préparé le clone de [X]". Signal de confiance, signal de légitimité.

Aujourd'hui : aucune identité partageur. Invite la méfiance.

### 🔴 RF4 — Aucun garde-fou sécurité visible
- **Pas d'expiration du token** (vu les commits, aucun champ `expires_at` évident — à vérifier côté schéma `shares` Supabase)
- **Pas de whitelist email** (le lien est bearer-authorized : quiconque intercepte peut claim)
- **Pas de révocation visible** côté agence (comment l'agence retire l'accès d'un client churn ?)
- **Pas de 2FA / vérification supplémentaire** pour les clones "sensibles"

Pour un outil B2B avec de la propriété intellectuelle client (posts, DMs, docs métier), c'est sous-dimensionné.

### 🔴 RF5 — Post-claim = cul-de-sac
État `claimed` :
```
"Clone ajouté !"
"Le clone est maintenant disponible dans votre hub."
[Aller au hub]
```

Pas de :
- "Ouvrir le chat avec le clone →" (next logique)
- Message d'onboarding : "Voici ce que tu peux faire maintenant"
- Vidéo / GIF de bienvenue de l'agence
- Premier message suggéré

Le destinataire est livré au hub avec 1 clone dans sa liste. À lui de deviner le reste. **Handoff client raté.**

### 🔴 RF6 — État `error` générique
```
"Erreur"
{errorMsg}
[Retour]
```

`errorMsg` vient du backend (`Lien invalide`, `Erreur de connexion`, `Erreur`). Pour un destinataire qui arrive via un lien LinkedIn, ça donne zéro action possible. Pas de "contactez votre agence si ce lien est expiré", pas de lien retour vers l'agence.

---

## 4. REFONTE RADICALE — Deux versions

### Version A — **Évolutive** (garde le flow, l'enrichit)

**Principe** : garder la page simple avec ses 5 états, mais ajouter contexte + preview + identité + post-claim onboarding.

#### Changements précis

1. **Page header enrichi** pour tous les états
   ```
   ┌──────────────────────────────────────────────┐
   │ Partagé par AhmetA — atelier LinkedIn        │
   │ [logo agence]                                 │
   │                                               │
   │ ─────────                                    │
   │                                               │
   │ (card content selon état)                    │
   └──────────────────────────────────────────────┘
   ```
   - Nom + logo agence visible en tête
   - Permet de reconnaître la source

2. **État `preview` enrichi** :
   ```
   Avatar [L] Lucile Dupont
            CEO @Atomi · clone POST + DM
            
   À propos de ce clone :
   · entraîné sur 23 posts LinkedIn
   · 14 corrections ingérées
   · fidélité actuelle : 0.81 (sain)
   · dernière mise à jour : il y a 3 jours
   
   Échantillon (un post généré récemment) :
   ┌──────────────────────────────────────────────┐
   │ "J'ai lancé Atomi il y a 18 mois. Premier... │
   │ (extrait 3-4 lignes)"                        │
   └──────────────────────────────────────────────┘
   
   [ Ajouter à mes clones ]   [ Rejeter ]
   ```

3. **Lien expire dans : X heures** visible sur le preview si le backend supporte une expiration :
   ```
   ⏱ Ce lien expire le 20 avril à 18h
   ```
   (et si pas d'expiration, ne rien afficher — mais prévoir le champ backend).

4. **Option "Rejeter"** explicite à côté de "Ajouter" :
   - Confirme à l'agence que le lien a été vu et refusé
   - Permet de ne pas laisser des shares en suspens dans le dashboard agence

5. **Flow `login` repensé** :
   - Si pas de code : **2 options** présentées clairement
     - `J'ai déjà un code (collaborateur agence)` → input classique
     - `Je suis un nouveau client → créer mon compte` → flow signup avec email → l'agence reçoit notification pour approuver

6. **État `claimed` enrichi** :
   ```
   ✓ Clone ajouté !
   
   Tu peux maintenant :
   · Ouvrir le chat avec Lucile → [Commencer à discuter]
   · Parcourir le guide en 2 min → [Voir le guide]
   · Retourner au hub → [Hub]
   
   Besoin d'aide ? AhmetA est joignable à contact@ahmeta.fr
   ```

7. **État `error` enrichi** :
   ```
   ⚠ Ce lien n'est plus valide
   
   Raisons possibles : expiré, révoqué, ou déjà utilisé.
   
   Contactez votre agence : contact@ahmeta.fr
   ou retournez à l'accueil → [Accueil]
   ```

8. **État `already` enrichi** :
   ```
   [Avatar] Lucile Dupont
   
   Ce clone est déjà dans votre liste.
   
   [ Ouvrir le chat avec Lucile → ]
   [ Retour au hub ]
   ```
   Direct action utile au lieu d'un dead-end.

9. **Design aligné labo** :
   - Remplacer la card centrée générique par une mise en page dans l'esthétique lab : grid en fond, mono pour les meta, vermillon comme accent
   - Cohérence visuelle avec le reste de l'app (le destinataire ne sent pas "je suis sur une autre app")

10. **Mobile-first form UX** :
    - Input code d'accès avec `inputmode="text"` + `autocomplete="one-time-code"` sur iOS/Android
    - Submit en Enter natif
    - Boutons full-width en mobile

#### CTA principal
Varie selon l'état :
- `preview` → `Ajouter à mes clones` (vermillon solid)
- `claimed` → `Commencer à discuter` (ouvre chat direct)
- `already` → `Ouvrir le chat`
- `login` → bouton segmenté `J'ai un code` / `Nouveau client`

#### Principes appliqués
- *Social proof + identity* (partageur visible)
- *Preview before commitment* (échantillon + stats)
- *Recovery* (error actionnable, "rejeter" explicite)
- *Next step guidance* (post-claim pas un cul-de-sac)

#### Benchmarks
- **Figma share** (preview fidèle + "added by X" + permission level)
- **Notion guest access** (préview + "accepté par" + next step après join)
- **Slack channel invite** (identité du partageur + preview du channel + accept/decline)

#### Impact attendu
- **Taux de claim** : +30-50% pour les clients finaux (qui sont bloqués aujourd'hui)
- **Temps pour "premier usage après claim"** : -70% (redirect direct chat vs retour hub générique)
- **Signal de confiance** : quantifiable par le taux de rebond post-preview (baisse attendue -40%)

---

### Version B — **Zéro compromis** (share devient onboarding client complet)

**Principe directeur** : un share-link vers un client final n'est pas juste "ajoute ce clone à ta liste", c'est le **1er contact de ce client avec l'app**. C'est un moment stratégique de l'expérience agence. Mérite un vrai tunnel d'onboarding, pas une page transactionnelle.

On fait de `/share/[token]` (ou d'une nouvelle `/bienvenue/[token]` cf. audit `/guide` Version B) une **expérience guidée** en 3-4 écrans qui emmène le client du lien à son premier message.

#### Structure proposée

```
/bienvenue/[token] — page d'onboarding client (4 écrans séquentiels)

Écran 1/4 — Bienvenue
┌──────────────────────────────────────────────────────────┐
│ [logo AhmetA] Bienvenue chez AhmetA                     │
│                                                          │
│ Lucile, ton clone LinkedIn est prêt.                    │
│ (préparé par Thomas @ AhmetA, il y a 3 jours)           │
│                                                          │
│ En 2 minutes, tu vas :                                  │
│ 1. Découvrir ton clone                                  │
│ 2. Valider son style sur 3 exemples                     │
│ 3. Envoyer ton premier message                          │
│                                                          │
│                        [ Commencer → ]                  │
└──────────────────────────────────────────────────────────┘

Écran 2/4 — Ton clone
┌──────────────────────────────────────────────────────────┐
│ Étape 1/3 · Voici ton clone                             │
│                                                          │
│ [Style Fingerprint SVG] Lucile Dupont — CEO @Atomi      │
│                                                          │
│ Ton clone connaît :                                     │
│ ✓ 23 posts LinkedIn que tu as écrits                    │
│ ✓ 8 DMs récents                                         │
│ ✓ Offre, méthode SCALE, cas clients (4 docs)            │
│                                                          │
│ Son style détecté :                                     │
│ · tonalité : directe, pas de jargon                     │
│ · format préféré : hook + story + insight               │
│ · questions rhétoriques : 1 sur 5 posts                 │
│                                                          │
│ [ ← Retour ]                       [ Suivant → ]        │
└──────────────────────────────────────────────────────────┘

Écran 3/4 — Valide le style (3 exemples)
┌──────────────────────────────────────────────────────────┐
│ Étape 2/3 · 3 exemples à valider                        │
│                                                          │
│ Post 1 : "J'ai lancé Atomi il y a 18 mois. Premier..."  │
│   [ 👍 OK ] [ 🤔 moyen ] [ 👎 pas du tout ]             │
│                                                          │
│ Post 2 : "Il y a 3 ans je dirigeais une équipe de..."   │
│   [ 👍 OK ] [ 🤔 moyen ] [ 👎 pas du tout ]             │
│                                                          │
│ DM : "Marc, j'ai vu ta levée la semaine dernière..."    │
│   [ 👍 OK ] [ 🤔 moyen ] [ 👎 pas du tout ]             │
│                                                          │
│ [ ← Retour ]                       [ Suivant → ]        │
└──────────────────────────────────────────────────────────┘

Écran 4/4 — Premier message
┌──────────────────────────────────────────────────────────┐
│ Étape 3/3 · Ton premier message                         │
│                                                          │
│ Essaye maintenant. Demande à ton clone d'écrire :       │
│                                                          │
│ [suggérés]                                              │
│ · "Un post sur une leçon métier récente"                │
│ · "Une relance à un prospect froid"                     │
│ · "Ou écris le tien..."                                 │
│                                                          │
│ [ Démarrer dans le chat → ]                             │
└──────────────────────────────────────────────────────────┘

→ redirect /chat/[personaId] avec premier prompt pré-rempli
```

#### Détails

- **Auth implicite via token** : pas de détour par un écran login. Le token valide vaut session jusqu'au claim. Post-claim, on crée un account dédié + envoi d'un email avec "voici ton lien personnel à conserver".
- **Preview riche + feedback calibration inline** : les 3 exemples sont un mini-flow calibration déguisé. Le client final valide d'entrée son clone — les signaux alimentent `/api/feedback`.
- **Onboarding en 3 étapes chiffrées** : barre de progression visible, effet "presque fini" qui pousse à terminer.
- **Redirect chat avec 1er prompt** : le client arrive dans le chat avec un message déjà amorcé, pas un écran vide anxiogène.
- **Email de suivi** post-claim : "bienvenue, voici ton lien permanent + tutoriel en vidéo 90s"
- **Option "mode lecture seule"** pour l'agence quand elle partage un clone en preview (le client peut voir sans modifier — utile pour les démos pré-signature)

#### Composants supprimés
- La page `/share/[token]` actuelle (5 états condensés sur une card)

#### Composants ajoutés
- Nouvelle route `/bienvenue/[token]/+page.svelte` (4 écrans séquentiels)
- `WelcomeOnboardingStep.svelte` composant base de step
- Email transactionnel templates (welcome, post-claim)
- Dashboard agence : section `Partages actifs` avec statut (en attente / accepté / expiré / révoqué)

#### Principes appliqués
- *Onboarding as storytelling* — le client vit un flow, pas une transaction
- *Progressive commitment* — chaque étape engage un peu plus
- *Calibration as welcome* — les 3 validations initiales servent directement au clone
- *First success fast* — au 4e écran, le client envoie son 1er message

#### Benchmarks
- **Linear team invite** (flow guidé post-accept)
- **Notion workspace join** (onboarding progressif avec checklist)
- **Loom guest join** (preview video + 1-click start)
- **Cal.com booking flow** (étapes claires, progression visible)

#### Impact attendu
- **Taux de claim → first message** : aujourd'hui ~30% (estimation), après Version B : **~80%**
- **Temps premier message après claim** : ~10 min → **~3 min**
- **Ticket support client final "comment je fais ?"** : -80% (onboarding intégré)
- **Signal perçu par le client** : "cette agence a un vrai process" — conversion trial → paying+60%

#### Risque identifié
Plus de friction au claim (4 écrans au lieu d'un). Mitigation : bouton "Je veux juste aller au chat, skipper l'onboarding" visible à chaque étape. Mais défaut = flow complet.

---

## 5. PRIORISATION

| # | Changement | Impact /10 | Effort /10 | Priorité | Qui | Version |
|---|---|---|---|---|---|---|
| 1 | **Identité du partageur visible** (logo + nom agence) | 7 | 1 | 🔥 P0 | Dev front + config | A |
| 2 | **Preview enrichie** (posts + scenarios + fidélité + dates) | 8 | 4 | P1 | Dev full-stack | A + B |
| 3 | **État `claimed` avec "Ouvrir chat direct"** | 7 | 1 | 🔥 P0 | Dev front | A |
| 4 | **État `error` avec contact agence + actions** | 5 | 2 | P1 | Dev front | A |
| 5 | **État `already` avec "Ouvrir chat"** | 6 | 1 | P1 | Dev front | A |
| 6 | **Flow login pour nouveau client (signup via token)** | 9 | 6 | P1 | Dev full-stack | A + B |
| 7 | **Token expiration + affichage** | 7 | 4 | P1 | Dev full-stack | A + B |
| 8 | **Révocation partage depuis admin** | 8 | 4 | P1 | Dev full-stack | A + B |
| 9 | **Whitelist email optionnelle** | 7 | 5 | P2 | Dev BE | A + B |
| 10 | **Design aligné labo** | 5 | 2 | P2 | Design + front | A |
| 11 | **Mobile form UX (autocomplete otp)** | 4 | 1 | P2 | Dev front | A |
| 12 | **Tunnel onboarding client 4 écrans (`/bienvenue/[token]`)** | 9 | 8 | P2-radical | Design + dev full-stack | B |
| 13 | **Email transactionnel post-claim** | 6 | 4 | P2 | Dev BE + copy | B |
| 14 | **Mode lecture seule (preview pré-signature)** | 7 | 6 | P3 | Dev full-stack | B |

### Quick wins flaggés
- 🔥 **#1 + #3** : identité partageur + redirect chat direct post-claim. **1 journée combinée**. Rend le handoff 2× plus cohérent.
- 🔥 **#6 Signup pour nouveau client** : débloque le use-case "partage à client final sans compte" — aujourd'hui cassé. Impact énorme sur adoption.

---

## 6. NOTE TRANSVERSE — Dépendances cross-écran

Le `/share` Version B se connecte à :
- **Audit `/calibrate` Version B** (calibration fondue dans chat) : les 3 validations de l'écran 3 alimentent la même logique
- **Audit `/guide` Version B** (`/bienvenue/[token]` mentionné) : c'est exactement la même route proposée
- **Audit `/admin` Version B** : la section "Partages actifs" pour révoquer/monitorer vit dans le cockpit manager

Si on fait Version B sur share ET calibrate ET guide ET admin, on a une **expérience agence ↔ client** cohérente de bout en bout. Livrer les 4 ensemble = cohérence maximale. Les livrer isolément = patches locaux.

---

**Audit écran 8/8 terminé. Phase 3 complète. Dis-moi si tu veux :**
- la **synthèse transverse** (Phase 4) — problèmes systémiques, top 10 priorisé inter-écrans, north star refonte
- un **zoom** sur un écran spécifique
- **réviser** un audit à la lumière d'un point que tu veux challenger
