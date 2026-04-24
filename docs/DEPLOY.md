# Deploy procedure

Rapide et non-négociable. Rédigé après l'incident du 2026-04-23 où 3 PRs merge → prod cassée car non testé sur Preview URL.

## Règle d'or

**Toujours tester le flow chat init sur Vercel Preview URL avant merge master.** Le CI valide la syntaxe, pas la feature. `vite dev` ne sert pas `/api/*` — seul Preview expose l'app complète.

---

## Pre-merge checklist (5 items)

Avant de cliquer "Merge":

1. **Tests verts** : `npm test` local ou CI Ubuntu (174+ tests).
2. **Build vert** : `npm run build` sur CI (échec symlink Windows local est OK).
3. **Preview URL testé bout-en-bout** :
   - Ouvrir [app-git-<branch>.vercel.app](#) (lien depuis la PR).
   - Login (access code ou admin code).
   - Créer ou ouvrir un clone existant.
   - Envoyer un message dans `/chat/[persona]` → vérifier que le stream SSE démarre ET se termine.
   - Upload un fichier knowledge si la PR touche `/api/knowledge` ou l'upload.
   - Ouvrir la console browser + onglet Network : pas d'erreur 500, pas de CORS.
4. **Migration DB appliquée** : si la PR ajoute un fichier dans `supabase/migrations/`, l'appliquer sur la base prod **avant** de merger le code (sinon runtime casse).
5. **Revue diff** :
   - Diff <500 lignes → solo OK si tu as testé le Preview.
   - Diff >500 lignes → revue humaine obligatoire OU split la PR.

## Post-merge (10 min de surveillance)

1. Ouvrir [Vercel dashboard](https://vercel.com) → project → Deployments → le déploiement prod fraîchement build.
2. Onglet "Functions logs" : grep `"event":"api_error"` → doit être calme.
3. Si Sentry est wire : ouvrir dashboard → aucune nouvelle erreur dans les 10 min.
4. Envoyer 1 message sur prod URL via un vrai compte (pas admin) → vérifier que le flow complet passe.

Si une de ces checks clignote rouge → rollback immédiat (voir [INCIDENT_RUNBOOK.md](./INCIDENT_RUNBOOK.md)).

---

## Env vars à synchroniser

Avant tout déploiement qui introduit une nouvelle var dans `.env.example`, la copier dans Vercel :

```
Vercel → Project → Settings → Environment Variables
→ Production + Preview + Development scopes
```

Vars actuellement requises : voir `.env.example`. En cas de doute, comparer `.env.example` HEAD avec Vercel env et aligner.

---

## Liens utiles

- Supabase dashboard (migrations, RLS, usage)
- Anthropic console (usage, rate limits, budget)
- Vercel dashboard (deployments, logs, env)
- Sentry (une fois wire)
