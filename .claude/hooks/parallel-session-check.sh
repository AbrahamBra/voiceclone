#!/usr/bin/env bash
# SessionStart hook : surface les PRs ouvertes + diff vs origin/master
# avant que Claude ne touche un fichier supprimé/en conflit par une
# session parallèle. Incident 2026-04-24 : PR #69 a perdu son travail UX
# parce que #70 avait supprimé le fichier sous elle pendant que je
# codais. Cf feedback_audit_prod_resume.md.
#
# Doit finir en < 10s, exit 0 même en cas d'échec (pas crasher la session).
set +e
set +u
read -r -d '' _INPUT 2>/dev/null || true  # SessionStart stdin — unused

# Cross-platform stdout helpers
emit_context() {
  # $1 = plain-text block (already formatted)
  node -e '
    const text = process.argv[1] || "";
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text }
    }) + "\n");
  ' "$1"
}

# Locate repo root. CLAUDE_PROJECT_DIR is provided by the harness.
REPO="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$REPO" ] || [ ! -d "$REPO/.git" ] && [ ! -f "$REPO/.git" ]; then
  REPO=$(git rev-parse --show-toplevel 2>/dev/null)
fi
if [ -z "$REPO" ]; then
  emit_context "🔎 Parallel-session check: pas de repo git détecté."
  exit 0
fi
cd "$REPO" 2>/dev/null || { emit_context "🔎 Parallel-session check: cd vers repo a échoué."; exit 0; }

# Fetch master (timeout 5s)
timeout 5 git fetch origin master --quiet 2>/dev/null || true

LINES=()
LINES+=("🔎 Parallel-session check")

# --- Master moved ? ---
BEHIND=$(git rev-list --count HEAD..origin/master 2>/dev/null || echo 0)
if [ "${BEHIND:-0}" -gt 0 ]; then
  OLDEST=$(git log origin/master --format="%ar" HEAD..origin/master 2>/dev/null | tail -1)
  LINES+=("⏱  master avancé de $BEHIND commits (plus ancien : ${OLDEST:-?})")
  # Last 5 merged PR titles
  while IFS= read -r line; do
    [ -n "$line" ] && LINES+=("   • $line")
  done < <(git log origin/master --format="%s" HEAD..origin/master 2>/dev/null | head -5)
fi

# --- Current branch + diff vs origin/master ---
BR=$(git symbolic-ref --short HEAD 2>/dev/null || echo "detached")
DIFF_FILES=""
DIFF_COUNT=0
if [ "$BR" != "master" ] && [ "$BR" != "main" ] && [ "$BR" != "detached" ]; then
  DIFF_FILES=$(git diff --name-only origin/master...HEAD 2>/dev/null)
  if [ -n "$DIFF_FILES" ]; then
    DIFF_COUNT=$(echo "$DIFF_FILES" | grep -c . 2>/dev/null || echo 0)
    LINES+=("🌿 ta branche : $BR ($DIFF_COUNT fichiers diffèrent d'origin/master)")
  else
    LINES+=("🌿 ta branche : $BR (pas de diff vs origin/master)")
  fi
fi

# --- Open PRs + overlap detection ---
OVERLAP_WARNING=""
if command -v gh >/dev/null 2>&1; then
  PRS_META=$(timeout 5 gh pr list --state open --limit 5 --json number,title,headRefName 2>/dev/null)
  if [ -n "$PRS_META" ] && [ "$PRS_META" != "[]" ]; then
    LINES+=("📬 PRs ouvertes :")
    # Parse + emit PR rows via node
    while IFS= read -r row; do
      [ -n "$row" ] && LINES+=("   • $row")
    done < <(echo "$PRS_META" | node -e '
      let raw = ""; process.stdin.on("data", d => raw += d); process.stdin.on("end", () => {
        try { const arr = JSON.parse(raw);
          for (const p of arr) console.log(`#${p.number} ${p.title} [${p.headRefName}]`);
        } catch {}
      });
    ' 2>/dev/null)

    # Overlap detection (only if we have local diff files)
    if [ -n "$DIFF_FILES" ]; then
      PR_NUMBERS=$(echo "$PRS_META" | node -e '
        let raw=""; process.stdin.on("data",d=>raw+=d); process.stdin.on("end",()=>{
          try{ JSON.parse(raw).forEach(p=>console.log(p.number)); }catch{}
        });
      ' 2>/dev/null)

      OVERLAP_PRS=""
      for PR in $PR_NUMBERS; do
        PR_FILES=$(timeout 3 gh pr diff "$PR" --name-only 2>/dev/null)
        [ -z "$PR_FILES" ] && continue
        # Count exact path matches between local diff and PR files (awk = no exit-code games)
        SHARED=$(awk 'NR==FNR{a[$0]=1;next} a[$0]' <(echo "$DIFF_FILES") <(echo "$PR_FILES") | awk 'END{print NR}')
        if [ "${SHARED:-0}" -gt 0 ] 2>/dev/null; then
          OVERLAP_PRS="$OVERLAP_PRS #$PR($SHARED)"
        fi
      done
      if [ -n "$OVERLAP_PRS" ]; then
        OVERLAP_WARNING="⚠️  chevauchement fichiers avec :$OVERLAP_PRS — rebase/check avant commit"
      else
        OVERLAP_WARNING="✅ pas de chevauchement avec les PRs ouvertes"
      fi
    fi
  fi
else
  LINES+=("📬 gh indisponible, skip check PRs ouvertes.")
fi

[ -n "$OVERLAP_WARNING" ] && LINES+=("$OVERLAP_WARNING")

# Emit
CONTEXT=$(printf '%s\n' "${LINES[@]}")
emit_context "$CONTEXT"
exit 0
