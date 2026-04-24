# Incident runbook

Ce qu'il faut faire quand prod casse. Optimisé pour l'agence ghostwriting qui doit répondre aux DM/posts client rapidement.

---

## Règle 0 — Rollback d'abord, diagnostic ensuite

Si prod est cassée et bloque les clients : **revert immédiatement** le dernier commit master puis diagnostique sur une branche.

```bash
# Identifier le commit fautif
git log --oneline -10

# Revert
git revert <sha-du-commit-fautif>
git push origin master
# → Vercel redéploie tout seul (1–2 min)
```

Si le commit est un merge de PR (majorité des cas) :

```bash
git revert -m 1 <sha-du-merge-commit>
git push origin master
```

**Ne pas `git reset --hard master@{1}`** sauf si tu sais ce que tu fais — tu perdrais les commits subséquents.

---

## Top 3 scénarios probables (basés sur l'histoire du repo)

### 1. `/api/chat` renvoie 500 sur tous les messages

**Symptômes** : UI affiche "Erreur de generation", rien dans la conversation.

**Diagnostic** :
1. Vercel → Functions logs → filtrer `"event":"chat_error"` ou `"event":"api_error"`.
2. Si Sentry wire : dashboard → dernière erreur + stacktrace.
3. Cas historique 2026-04-23 : `rateLimit()` sans `await` → promesse non résolue → 429 partout.

**Fix rapide** : rollback. Réouvre la PR, ajoute un test, re-teste Preview URL, re-merge.

### 2. Stream SSE qui freeze au milieu de la génération

**Symptômes** : message commence à streamer puis plus rien, spinner infini.

**Diagnostic** :
1. Vercel logs → chercher `timeout` ou `ETIMEDOUT`.
2. Vérifier `vercel.json` : `maxDuration` suffisant (90s pour `/api/chat`).
3. Vérifier que le heartbeat `ping` tombe toutes les 15s dans [lib/sse.js](../lib/sse.js).

**Fix rapide** : rollback si une PR a touché `lib/sse.js` ou `api/chat.js` récemment.

### 3. Rate limit RPC indisponible → tout le monde bloqué

**Symptômes** : 429 partout, même sans trafic.

**Diagnostic** :
1. Supabase status → le service est-il up ?
2. `api/_rateLimit.js` est codé "fail open" sur erreur DB — vérifier les logs pour `rate_limit_rpc_error`.
3. Si la RPC `rate_limit_check` a disparu (rollback migration 017 par ex), le fail-open devrait couvrir.

**Fix rapide** : si c'est vraiment Supabase down, attendre que Supabase revienne. Sinon rollback la PR qui a touché les migrations.

---

## Seuils d'alerte (une fois Sentry wire)

- **>5 `api_error` / min pendant 5 min** → page (PagerDuty ou manuel).
- **>10 `chat_error` / min** → rollback préventif.
- **Latence p95 `/api/chat` > 30s** → enquêter Anthropic / Supabase avant rollback.

---

## Contacts / dashboards

- Vercel dashboard : <dashboard-url>
- Supabase dashboard : <dashboard-url>
- Anthropic console : https://console.anthropic.com
- Status pages : status.vercel.com · status.supabase.com · status.anthropic.com

Remplir les URLs spécifiques projet au premier tour de garde.

---

## Checklist post-incident (obligatoire)

1. Écrire un post-mortem court (5–10 lignes) : quoi / pourquoi / comment on a su / comment on l'a fixé / comment on l'évite à l'avenir.
2. Ajouter un test qui aurait attrapé le bug.
3. Mettre à jour [DEPLOY.md](./DEPLOY.md) si la checklist pre-merge aurait dû inclure ce cas.
