## Résumé
<!-- 1-2 phrases : quoi et pourquoi -->

## Preview checklist

Avant merge `master` : ouvrir l'**URL Vercel Preview** de la PR et cocher ce qui s'applique. Cette checklist rattrape ce que les 294 tests unitaires ne voient pas (auth, SSE, DB, UI).

### Smoke (toujours)
- [ ] Landing `/` charge, console browser clean (pas de rouge)
- [ ] `/chat/[persona]` charge à froid, **F5 ne casse pas l'auth**
- [ ] Topbar Post | DM visible et cliquable

### Create clone
<!-- Si touché : api/clone.js, api/scrape.js, src/routes/create/, lib/prompts/clone.js -->
- [ ] Scrape LinkedIn renvoie nom + titre
- [ ] Génération aboutit sous 90s (pas de 504 Vercel)
- [ ] Nouveau clone apparaît dans la liste personas
- [ ] `topics/style-*.md` + (si doc) `documents/client-docs.md` présents en DB

### Chat (DM + Post)
<!-- Si touché : api/chat.js, lib/pipeline.js, lib/prompt.js, lib/checks.js, lib/prompts/ -->
- [ ] Premier message streame progressivement (pas d'attente + bloc d'un coup)
- [ ] DM = plusieurs messages courts ; Post = bloc unique
- [ ] Pas de `\n\n` littéraux dans l'output
- [ ] Pas de welcome répété après le 2e message

### Feedback loop (cœur data remontée)
<!-- Si touché : api/feedback*.js, api/messages.js, lib/correction-*.js, lib/feedback-detect.js -->
- [ ] Feedback / correction s'enregistre (toast ou UI de confirmation)
- [ ] Message similaire juste après → la correction est prise en compte dans la réponse
- [ ] Heat / stage conversation bouge visuellement

### Migration DB
<!-- Si touché : supabase/*.sql -->
- [ ] Migration appliquée **AVANT** de tester la Preview (sinon l'API casse silencieusement)
- [ ] Aucun `relation X does not exist` dans les logs Vercel de la Preview

<!-- Si rien en dehors de doc/README/test → cocher Smoke uniquement et merger. -->
