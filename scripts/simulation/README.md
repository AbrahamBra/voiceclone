# VoiceClone Simulation Harness

Un seul script Python pour valider la boucle complète (critic → fidelity → feedback → consolidation → backtest) sur une persona fictive, sans dépendre du trafic prod.

## Pourquoi

Les clones actifs en prod n'ont pas de chunks `linkedin_post` → `calculateFidelityScore` retourne `null`, le backtest auto-revert ne s'active jamais, et les feedback events n'atteignent que la persona demo "Alex". Cette suite crée une persona **propre** (chunks + embeddings + voice rules) pour que chaque maillon se déclenche et que le diagnostic soit observable.

## Garde-fou

Toute opération d'écriture vérifie que le slug de la persona commence par `sim_`. Un bug qui pointerait vers une persona prod serait refusé par `assert_sim_persona()` avant tout insert/update/delete.

## Setup (pas-à-pas, non-tech)

1. **Python 3.10+** — `python --version`

2. **Récupérer les clés Vercel automatiquement** (depuis la racine du projet) :
   ```bash
   npx vercel env pull scripts/simulation/.env
   ```
   Ça crée le `.env` déjà rempli avec `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VOYAGE_API_KEY`, `ADMIN_CODE`, `CRON_SECRET`. Tu n'as rien à copier-coller.

3. **Ajouter une seule ligne manuellement** dans `scripts/simulation/.env` (cette var n'est pas dans Vercel) :
   ```
   API_BASE_URL=http://localhost:3000
   ```
   (ou l'URL de ton déploiement Vercel si tu ne veux pas lancer le dev server)

4. **Venv + dépendances** :
   ```bash
   cd scripts/simulation
   python -m venv .venv
   # Windows : .venv\Scripts\activate    Linux/Mac : source .venv/bin/activate
   pip install -r requirements.txt
   ```

5. **Lancer le dev server** (autre terminal, racine du projet) — optionnel si tu tapes sur l'URL prod :
   ```bash
   npx vercel dev
   ```

## Workflow type (boucle complète)

```bash
# 1. Créer la persona simulée + 15 posts + embeddings
python run.py seed

# 2. Envoyer 10 conversations via /api/chat (alimente rhythm_shadow)
python run.py chat 10

# 3. Poster des règles via save_rule (alimente corrections — fodder pour consolidation)
python run.py feedback

# 4. Simuler les clics UI ✓/✓✓/★ (alimente feedback_events)
python run.py validate

# 5. Forcer un calcul de fidelity (alimente fidelity_scores)
python run.py fidelity

# 6. Déclencher la consolidation (alimente learning_events, peut déclencher backtest)
python run.py consolidate

# 7. Générer le rapport
python run.py verdict
```

| Commande | Table remplie | Déclenche |
|---|---|---|
| `seed` | `personas`, `chunks` | — |
| `chat` | `rhythm_shadow`, `conversations`, `messages` | voiceCritic, rhythmCritic, inlineFidelityCheck |
| `feedback` | `corrections` (status=active) | extraction Haiku → règle |
| `validate` | `feedback_events`, `corrections` (+boost) | signal positif |
| `fidelity` | `fidelity_scores` | calcul composite + collapse_index |
| `consolidate` | `learning_events`, éventuellement `writingRules` | backtest + auto-revert |

## Scénario avancé : tester l'auto-revert

```bash
python run.py seed
python run.py chat 5
python run.py feedback --bad        # corrections contradictoires
python run.py consolidate            # attend auto-revert
python run.py verdict                # vérifie consolidation_reverted > 0
```

## Scénario avancé : tester le critic sur dérive forcée

```bash
python run.py seed
python run.py stress                 # injecte 5 drafts pourris
python run.py verdict                # vérifie flag rate > 60%
```

## Nettoyage

```bash
python run.py cleanup                # confirme avant de supprimer
python run.py cleanup --yes          # skip confirmation
```

Supprime **uniquement** les personas `sim_*` et leurs données via CASCADE. Le client `sim_client_harness` est aussi supprimé s'il n'a plus de personas.

## Structure

```
scripts/simulation/
├── run.py              # master CLI — 10 subcommands
├── fixtures.py         # 15 posts FR + scenarios + corrections + drifted drafts
├── requirements.txt
├── .env.example
└── README.md (ce fichier)
```

## Limites connues

- **Stress test indirect** : pour valider le critic, on passe par `/api/chat` en demandant au modèle de copier un draft dérivé. Ce n'est pas un test unitaire du critic — il faudrait un endpoint dédié ou appeler `lib/critic/*` directement depuis Node. Workaround acceptable pour un smoke test bout-en-bout.
- **Rhythm baseline** : non seedée ici. Le critic tourne quand même (score peut être partiel). Pour une baseline complète, lancer le script Node `scripts/seed-rhythm-gold.js` contre la sim persona après le seed Python.
- **Taper sur prod** : choix assumé (pas de Supabase payant). Le prefixe `sim_` isole logiquement mais pas physiquement. Ne lance JAMAIS `cleanup` sans relire la liste qui s'affiche.

## Checks "non-tech" avant de lancer

- [ ] J'ai un `.env` rempli avec `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VOYAGE_API_KEY`, `ADMIN_ACCESS_CODE`, `CRON_SECRET`
- [ ] `vercel dev` tourne sur le port défini dans `API_BASE_URL` (par défaut 3000)
- [ ] Je suis OK que le script crée une persona "Sim Clone Alpha" avec slug "sim_clone_alpha" dans la DB prod
- [ ] J'ai bien lu que `cleanup` supprime uniquement ce qui commence par `sim_`
