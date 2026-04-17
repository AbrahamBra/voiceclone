<script>
  import { onMount, onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import { accessCode, sessionToken } from "$lib/stores/auth.js";
  import { SCENARIOS, TYPE_SPEED_OUTPUT, PHASE_DELAYS } from "$lib/landing-demo.js";

  // ───────── Live chrome ─────────
  let now = $state(new Date());
  let clockInterval;
  const BUILD_HASH = "25e585b";

  // ───────── Scenario state ─────────
  let scenarioIdx = $state(0);
  /** @type {import('$lib/landing-demo.js').Scenario} */
  let current = $derived(SCENARIOS[scenarioIdx]);

  let phase = $state("idle"); // idle | prompt | thinking | stream1 | checks | rewrite | stream2 | done
  let promptTyped = $state("");
  let outputTyped = $state("");
  let firesAt = $state(new Set()); // rule ids that have fired
  let showDiff = $state(false);

  // Metric interpolation (0..1)
  let metricsProgress = $state(0);
  let fidelityProgress = $state(0);
  let counter = $state(0); // simple incrementing tick count

  // ───────── Access footer ─────────
  let codeInput = $state("");
  let authLoading = $state(false);
  let authError = $state("");
  let authShake = $state(false);

  // ───────── Scripted runner ─────────
  /** @type {Array<{cancel: () => void}>} */
  let timers = [];
  let running = true;
  const clearTimers = () => { timers.forEach(x => x.cancel()); timers = []; };
  const t = (fn, ms) => {
    const id = setTimeout(fn, ms);
    const handle = { cancel: () => clearTimeout(id) };
    timers.push(handle);
    return handle;
  };

  // Typewriter driven by wall-clock time, not setTimeout latency.
  // charsPerSecond controls speed. Callback fires on each visible change.
  function typewriter(source, charsPerSecond, onEach, onDone) {
    const started = performance.now();
    let lastLen = -1;
    let rafId;
    const tick = (now) => {
      if (!running) return;
      const elapsed = (now - started) / 1000;
      const targetLen = Math.min(source.length, Math.floor(elapsed * charsPerSecond));
      if (targetLen !== lastLen) {
        lastLen = targetLen;
        onEach(source.slice(0, targetLen));
      }
      if (targetLen >= source.length) { onDone && onDone(); return; }
      rafId = requestAnimationFrame(tick);
      timers.push({ cancel: () => cancelAnimationFrame(rafId) });
    };
    rafId = requestAnimationFrame(tick);
    timers.push({ cancel: () => cancelAnimationFrame(rafId) });
  }

  function runScenario(sc) {
    phase = "prompt";
    promptTyped = "";
    outputTyped = "";
    firesAt = new Set();
    showDiff = false;
    metricsProgress = 0;
    fidelityProgress = 0;

    // 1) Type the prompt at ~40 char/s
    typewriter(sc.prompt_text, 40, (s) => { promptTyped = s; }, () => {
      t(() => {
        phase = "thinking";
        t(() => {
          phase = "stream1";
          // 2) Stream pass 1 output, firing rules at scheduled ms
          const scheduleRules = () => {
            for (const r of sc.rules) {
              if (r.fires_at_ms > 0 && r.severity !== "hard") {
                t(() => { firesAt = new Set([...firesAt, r.rule]); counter++; }, r.fires_at_ms);
              }
            }
          };
          scheduleRules();
          typewriter(sc.pass1_text, 160, (s) => {
            outputTyped = s;
            const p = s.length / sc.pass1_text.length;
            metricsProgress = p * 0.6; // partial during stream
          }, () => {
            // 3) Checks complete
            t(() => {
              phase = "checks";
              metricsProgress = 0.8;
              if (sc.outcome === "rewrite") {
                // 4) Rewrite
                t(() => {
                  phase = "rewrite";
                  t(() => {
                    phase = "stream2";
                    showDiff = true;
                    outputTyped = "";
                    typewriter(sc.pass2_text, 200, (s) => {
                      outputTyped = s;
                      const p = s.length / sc.pass2_text.length;
                      metricsProgress = 0.8 + p * 0.2;
                      fidelityProgress = p;
                    }, () => {
                      t(() => {
                        phase = "done";
                        metricsProgress = 1;
                        fidelityProgress = 1;
                        scheduleNext();
                      }, PHASE_DELAYS.rewrite_end_to_done);
                    });
                  }, PHASE_DELAYS.checks_to_rewrite);
                }, PHASE_DELAYS.stream_end_to_checks);
              } else {
                metricsProgress = 1;
                fidelityProgress = 1;
                t(() => {
                  phase = "done";
                  scheduleNext();
                }, PHASE_DELAYS.stream_end_to_checks + PHASE_DELAYS.rewrite_end_to_done);
              }
            }, PHASE_DELAYS.stream_end_to_checks);
          });
        }, PHASE_DELAYS.thinking_to_stream);
      }, PHASE_DELAYS.prompt_to_thinking);
    });
  }

  function scheduleNext() {
    t(() => {
      scenarioIdx = (scenarioIdx + 1) % SCENARIOS.length;
      runScenario(SCENARIOS[scenarioIdx]);
    }, PHASE_DELAYS.done_to_next);
  }

  // ───────── Derived values ─────────
  function lerp(a, b, p) { return a + (b - a) * p; }
  const liveMetrics = $derived(current.metrics.map(m => ({
    name: m.name,
    value: lerp(m.from, m.to, metricsProgress),
    to: m.to,
  })));
  const liveFidelity = $derived(lerp(current.fidelity_before, current.fidelity_after, fidelityProgress));

  // ───────── Mount ─────────
  onMount(() => {
    clockInterval = setInterval(() => { now = new Date(); }, 1000);

    // If already authenticated, redirect to /hub
    if ($accessCode || $sessionToken) {
      goto("/hub");
      return;
    }

    runScenario(current);
  });

  onDestroy(() => {
    running = false;
    clearTimers();
    clearInterval(clockInterval);
  });

  // ───────── Access submit ─────────
  async function submitCode(e) {
    e?.preventDefault?.();
    const code = codeInput.trim();
    if (!code) return;
    authError = "";
    authLoading = true;
    try {
      const resp = await fetch("/api/personas", { headers: { "x-access-code": code } });
      if (resp.status === 403) {
        authError = "refusé";
        authShake = true;
        setTimeout(() => { authShake = false; }, 300);
        authLoading = false;
        return;
      }
      if (!resp.ok) throw new Error("server");
      const data = await resp.json();
      accessCode.set(code);
      if (data.session?.token) sessionToken.set(data.session.token);
      goto("/hub");
    } catch {
      authError = "erreur réseau";
      authLoading = false;
    }
  }

  function fmtClock(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
  }
  function fmtNum(n, d = 2) {
    return Number(n).toFixed(d);
  }
</script>

<svelte:head>
  <title>VoiceClone — laboratoire</title>
</svelte:head>

<a href="#lab-main" class="skip-link">Aller au contenu principal</a>

<main class="lab" id="lab-main">
  <!-- ═══════ Header ═══════ -->
  <header class="lab-head">
    <div class="brand">
      <span class="brand-mark">◎</span>
      <span class="brand-name">VoiceClone</span>
      <span class="brand-sub">/ laboratoire</span>
    </div>
    <nav class="head-meta">
      <span class="kv"><span class="k">clock</span><span class="v">{fmtClock(now)}</span></span>
      <span class="kv"><span class="k">build</span><span class="v">{BUILD_HASH}</span></span>
      <span class="kv"><span class="k">pipeline</span><span class="v">4-stage</span></span>
      <span class="kv status-on"><span class="dot"></span><span class="v">live</span></span>
    </nav>
  </header>

  <!-- ═══════ Hero rule ═══════ -->
  <section class="manifest">
    <h1 class="headline">
      <span class="h-lead">Un pipeline de clonage vocal</span>
      <span class="h-accent">observable en direct</span>
      <span class="h-tail">— pas un chatbot de plus.</span>
    </h1>
    <p class="sub">
      Generate <span class="arrow">→</span> check <span class="arrow">→</span>
      rewrite <span class="arrow">→</span> fidelity. Chaque étape lisible, chaque
      règle compte son activation, chaque drift déclenche une réécriture.
    </p>
  </section>

  <!-- ═══════ The lab grid ═══════ -->
  <section class="grid">
    <!-- Col 1 — Prompt + Output -->
    <div class="col col-main">
      <!-- Prompt panel -->
      <article class="panel">
        <header class="p-head">
          <span class="p-idx">01</span>
          <span class="p-name">prompt</span>
          <span class="p-meta">{current.prompt_context}</span>
        </header>
        <div class="p-body mono prompt-body">
          <span class="caret-host">
            {promptTyped}<span class="caret" class:blink={phase === "prompt"}>▍</span>
          </span>
        </div>
      </article>

      <!-- Output panel -->
      <article class="panel">
        <header class="p-head">
          <span class="p-idx">02</span>
          <span class="p-name">output</span>
          <span class="p-meta">
            {#if phase === "thinking"}thinking…{/if}
            {#if phase === "stream1"}pass 1 / stream{/if}
            {#if phase === "checks"}checks / {current.rules.filter(r => firesAt.has(r.rule)).length} violations{/if}
            {#if phase === "rewrite"}rewrite / feedback injected{/if}
            {#if phase === "stream2"}pass 2 / stream{/if}
            {#if phase === "done"}
              {#if current.outcome === "pass"}✓ passed clean{/if}
              {#if current.outcome === "rewrite"}✓ rewritten{/if}
              {#if current.outcome === "drift"}! drift unresolved{/if}
            {/if}
          </span>
        </header>
        <div class="p-body output-body">
          {#if phase === "thinking"}
            <div class="thinking">
              <span class="dot-seq"></span><span class="dot-seq"></span><span class="dot-seq"></span>
            </div>
          {:else}
            {#if showDiff && current.pass2_text}
              <details class="diff-wrap" open>
                <summary>
                  <span class="diff-badge">diff</span>
                  <span class="diff-label">voir pass 1 original</span>
                </summary>
                <div class="diff-old mono-body">{current.pass1_text}</div>
              </details>
            {/if}
            <div class="output-text">{outputTyped}{#if phase === "stream1" || phase === "stream2"}<span class="caret blink">▍</span>{/if}</div>
          {/if}
        </div>
      </article>
    </div>

    <!-- Col 2 — Rules engine -->
    <div class="col col-side">
      <article class="panel">
        <header class="p-head">
          <span class="p-idx">03</span>
          <span class="p-name">rules engine</span>
          <span class="p-meta">{current.rules.filter(r => firesAt.has(r.rule)).length}/{current.rules.length} active</span>
        </header>
        <ul class="rules">
          {#each current.rules as r}
            {@const fired = firesAt.has(r.rule)}
            <li class="rule" class:fired class:severity-hard={r.severity === "hard"} class:severity-strong={r.severity === "strong"}>
              <span class="rule-tick" aria-hidden="true">{fired ? "●" : "○"}</span>
              <span class="rule-name mono">{r.rule}</span>
              <span class="rule-sev">{r.severity}</span>
              <span class="rule-detail mono">{fired ? r.detail : ""}</span>
            </li>
          {/each}
        </ul>
      </article>

      <!-- Metrics -->
      <article class="panel">
        <header class="p-head">
          <span class="p-idx">04</span>
          <span class="p-name">live metrics</span>
          <span class="p-meta">phase / {phase}</span>
        </header>
        <div class="metrics">
          {#each liveMetrics as m}
            <div class="metric">
              <div class="m-head">
                <span class="m-name mono">{m.name}</span>
                <span class="m-val mono">{fmtNum(m.value, m.name === "collapse_idx" || m.name === "kurtosis" ? 1 : 2)}</span>
              </div>
              <div class="m-bar"><div class="m-bar-fill" style="width: {Math.min(100, (m.name === 'collapse_idx' ? m.value : m.value * 50))}%"></div></div>
            </div>
          {/each}
        </div>
      </article>

      <!-- Fidelity -->
      <article class="panel panel-fidelity">
        <header class="p-head">
          <span class="p-idx">05</span>
          <span class="p-name">fidelity</span>
          <span class="p-meta">cosine vs. source corpus</span>
        </header>
        <div class="fidelity">
          <div class="fid-big mono">{fmtNum(liveFidelity, 3)}</div>
          <div class="fid-delta" class:negative={liveFidelity < current.fidelity_before}>
            Δ {fmtNum(liveFidelity - current.fidelity_before, 3)}
          </div>
          <div class="fid-threshold mono">threshold 0.720</div>
          <div class="fid-bar">
            <div class="fid-bar-fill" style="width: {liveFidelity * 100}%" class:below={liveFidelity < 0.72}></div>
            <div class="fid-bar-threshold" style="left: 72%"></div>
          </div>
        </div>
      </article>
    </div>
  </section>

  <!-- ═══════ Case label + progress ═══════ -->
  <div class="case-strip" aria-live="polite" aria-atomic="true">
    <div class="case-label mono">{current.label}</div>
    <div class="case-dots" role="tablist" aria-label="Scénarios de démonstration">
      {#each SCENARIOS as sc, i}
        <span
          class="case-dot"
          class:active={i === scenarioIdx}
          role="tab"
          aria-selected={i === scenarioIdx}
          aria-label={sc.label}
        ></span>
      {/each}
    </div>
  </div>

  <!-- ═══════ Footer (access + manifest link) ═══════ -->
  <footer class="lab-foot">
    <div class="foot-left">
      <span class="kv"><span class="k">open</span><span class="v">mock pipeline · données scriptées</span></span>
      <a class="foot-link" href="/guide">notes d'onboarding</a>
    </div>

    <form class="access" onsubmit={submitCode}>
      <span class="access-k">◇ access</span>
      <input
        type="password"
        autocomplete="off"
        placeholder="code"
        bind:value={codeInput}
        class:shake={authShake}
        disabled={authLoading}
      />
      <button type="submit" disabled={authLoading}>
        {authLoading ? "…" : "→"}
      </button>
      {#if authError}<span class="access-err">{authError}</span>{/if}
    </form>
  </footer>
</main>

<style>
  /* ────────────────────────────────────────────────────────────
     Global lab
     ──────────────────────────────────────────────────────────── */
  .lab {
    min-height: 100dvh;
    padding: 0;
    background:
      linear-gradient(var(--grid) 1px, transparent 1px) 0 0 / 100% 24px,
      var(--paper);
    color: var(--ink);
    font-family: var(--font-ui);
    display: flex;
    flex-direction: column;
  }

  /* ────────────────────────────────────────────────────────────
     Header
     ──────────────────────────────────────────────────────────── */
  .lab-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 20px;
    border-bottom: 1px solid var(--rule-strong);
    font-family: var(--font-mono);
    font-size: 11px;
    gap: 20px;
    flex-wrap: wrap;
  }
  .brand {
    display: inline-flex; align-items: baseline; gap: 8px;
    letter-spacing: 0.01em;
  }
  .brand-mark { color: var(--vermillon); font-size: 14px; }
  .brand-name { font-weight: 600; color: var(--ink); }
  .brand-sub { color: var(--ink-40); }
  .head-meta { display: inline-flex; gap: 20px; flex-wrap: wrap; }
  .kv { display: inline-flex; gap: 6px; align-items: baseline; }
  .k { color: var(--ink-40); }
  .v { color: var(--ink); font-variant-numeric: tabular-nums; }
  .status-on .dot {
    display: inline-block; width: 7px; height: 7px; background: var(--vermillon);
    transform: translateY(-1px);
    animation: pulse 1.6s infinite linear;
  }
  @keyframes pulse {
    0%, 60%, 100% { opacity: 1; }
    80% { opacity: 0.25; }
  }

  /* ────────────────────────────────────────────────────────────
     Manifest
     ──────────────────────────────────────────────────────────── */
  .manifest {
    padding: 56px 20px 36px;
    max-width: var(--max-width);
    margin: 0 auto;
    width: 100%;
  }
  .headline {
    font-family: var(--font);
    font-size: clamp(32px, 5.2vw, 64px);
    font-weight: 400;
    line-height: 1.04;
    letter-spacing: -0.022em;
    color: var(--ink);
    margin-bottom: 24px;
    max-width: 22ch;
  }
  .h-lead { display: inline; }
  .h-accent {
    display: inline;
    font-style: italic;
    color: var(--vermillon);
    position: relative;
  }
  .h-accent::after {
    content: "";
    position: absolute;
    left: 0; right: 0; bottom: -2px;
    height: 1px;
    background: var(--vermillon);
    opacity: 0.35;
  }
  .h-tail { display: inline; color: var(--ink-70); }
  .sub {
    font-family: var(--font-ui);
    font-size: 14px;
    color: var(--ink-70);
    max-width: 60ch;
    line-height: 1.55;
  }
  .arrow {
    font-family: var(--font-mono);
    color: var(--vermillon);
    margin: 0 4px;
  }

  /* ────────────────────────────────────────────────────────────
     Grid
     ──────────────────────────────────────────────────────────── */
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr);
    gap: 0;
    max-width: var(--max-width);
    margin: 0 auto;
    width: 100%;
    padding: 0 20px 12px;
    border-top: 1px solid var(--rule-strong);
  }
  .col { display: flex; flex-direction: column; }
  .col-main { border-right: 1px solid var(--rule-strong); }
  .panel {
    border-bottom: 1px solid var(--rule-strong);
    background: transparent;
  }
  .col-main .panel { border-right: 0; }
  .col-side .panel { padding-left: 12px; }
  .col-main .panel { padding-right: 12px; }

  .p-head {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 10px 0 8px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    border-bottom: 1px dashed var(--rule);
  }
  .p-idx { color: var(--vermillon); font-weight: 600; }
  .p-name { color: var(--ink); font-weight: 600; }
  .p-meta { margin-left: auto; color: var(--ink-40); text-transform: none; letter-spacing: 0; }

  .p-body { padding: 14px 0 18px; }
  .mono-body, .mono { font-family: var(--font-mono); }

  /* ────────────────────────────────────────────────────────────
     Prompt
     ──────────────────────────────────────────────────────────── */
  .prompt-body {
    font-family: var(--font-mono);
    font-size: 13px;
    min-height: 48px;
    color: var(--ink-90);
    white-space: pre-wrap;
    line-height: 1.55;
  }
  .caret {
    display: inline-block;
    color: var(--vermillon);
    font-weight: 600;
    margin-left: 1px;
    opacity: 0;
  }
  .caret.blink { animation: caretblink 0.9s steps(2) infinite; opacity: 1; }
  @keyframes caretblink { 50% { opacity: 0; } }

  /* ────────────────────────────────────────────────────────────
     Output
     ──────────────────────────────────────────────────────────── */
  .output-body { min-height: 160px; }
  .output-text {
    font-family: var(--font);
    font-size: 15.5px;
    line-height: 1.52;
    color: var(--ink);
    white-space: pre-wrap;
  }
  .thinking {
    display: flex; gap: 6px; padding: 12px 0;
  }
  .dot-seq {
    width: 6px; height: 6px;
    background: var(--ink-40);
    animation: seq 1.2s infinite linear;
  }
  .dot-seq:nth-child(2) { animation-delay: 0.2s; }
  .dot-seq:nth-child(3) { animation-delay: 0.4s; }
  @keyframes seq {
    0%, 100% { background: var(--ink-40); }
    50% { background: var(--vermillon); }
  }
  .diff-wrap {
    margin-bottom: 16px;
    border-left: 2px solid var(--vermillon);
    padding-left: 10px;
    background: color-mix(in srgb, var(--vermillon) 4%, transparent);
  }
  .diff-wrap summary {
    cursor: pointer;
    list-style: none;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 6px 0;
    display: flex; gap: 8px; align-items: center;
  }
  .diff-wrap summary::-webkit-details-marker { display: none; }
  .diff-badge {
    color: var(--vermillon);
    font-weight: 600;
  }
  .diff-old {
    font-size: 13px;
    color: var(--ink-40);
    text-decoration: line-through;
    text-decoration-color: var(--vermillon);
    padding: 6px 0 10px;
    white-space: pre-wrap;
    line-height: 1.5;
  }

  /* ────────────────────────────────────────────────────────────
     Rules engine
     ──────────────────────────────────────────────────────────── */
  .rules {
    list-style: none;
    padding: 4px 0 0;
  }
  .rule {
    display: grid;
    grid-template-columns: 18px auto 1fr auto;
    gap: 8px;
    align-items: baseline;
    padding: 6px 0;
    border-bottom: 1px dashed var(--rule);
    font-size: 12px;
    color: var(--ink-40);
    transition: color 0.08s linear;
  }
  .rule:last-child { border-bottom: 0; }
  .rule-tick {
    font-family: var(--font-mono);
    color: var(--ink-20);
    font-size: 10px;
    line-height: 1;
  }
  .rule-name { color: var(--ink-70); font-size: 11.5px; }
  .rule-sev {
    font-family: var(--font-mono);
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-40);
    padding: 1px 5px;
    border: 1px solid var(--rule-strong);
  }
  .rule-detail {
    grid-column: 2 / -1;
    font-size: 10.5px;
    color: var(--ink-40);
    padding-top: 2px;
  }

  .rule.fired {
    color: var(--ink);
  }
  .rule.fired .rule-tick { color: var(--vermillon); }
  .rule.fired .rule-name { color: var(--vermillon); font-weight: 600; }
  .rule.fired .rule-sev { color: var(--vermillon); border-color: var(--vermillon); }
  .rule.fired .rule-detail { color: var(--ink-70); }

  .rule.severity-hard .rule-sev { /* hard severity still styled when fired above */ }
  .rule.severity-strong.fired .rule-sev { background: var(--vermillon); color: var(--paper); }

  /* ────────────────────────────────────────────────────────────
     Metrics
     ──────────────────────────────────────────────────────────── */
  .metrics {
    padding-top: 6px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .metric { display: flex; flex-direction: column; gap: 3px; }
  .m-head {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--ink-40);
  }
  .m-name { color: var(--ink-70); }
  .m-val { color: var(--ink); font-weight: 600; }
  .m-bar {
    height: 3px;
    background: var(--rule-strong);
    position: relative;
    overflow: hidden;
  }
  .m-bar-fill {
    height: 100%;
    background: var(--vermillon);
    transition: width 0.12s linear;
  }

  /* ────────────────────────────────────────────────────────────
     Fidelity
     ──────────────────────────────────────────────────────────── */
  .panel-fidelity { background: var(--paper-subtle); }
  .panel-fidelity .p-head { border-bottom-color: var(--rule-strong); }
  .fidelity { padding: 8px 12px 14px 0; }
  .fid-big {
    font-size: 34px;
    font-weight: 500;
    color: var(--ink);
    letter-spacing: -0.02em;
    line-height: 1;
    transition: color 0.1s linear;
  }
  .fid-delta {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-40);
    margin-top: 4px;
  }
  .fid-delta.negative { color: var(--vermillon); }
  .fid-threshold {
    font-size: 10.5px;
    color: var(--ink-40);
    margin-top: 6px;
  }
  .fid-bar {
    margin-top: 8px;
    height: 4px;
    background: var(--rule-strong);
    position: relative;
    overflow: hidden;
  }
  .fid-bar-fill {
    height: 100%;
    background: var(--ink);
    transition: width 0.15s linear, background 0.15s linear;
  }
  .fid-bar-fill.below { background: var(--vermillon); }
  .fid-bar-threshold {
    position: absolute;
    top: -2px; bottom: -2px;
    width: 1px;
    background: var(--vermillon);
  }

  /* ────────────────────────────────────────────────────────────
     Case strip
     ──────────────────────────────────────────────────────────── */
  .case-strip {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 20px;
    border-top: 1px solid var(--rule-strong);
    border-bottom: 1px solid var(--rule-strong);
    max-width: var(--max-width);
    margin: 0 auto;
    width: 100%;
  }
  .case-label {
    font-size: 10.5px;
    letter-spacing: 0.12em;
    color: var(--ink);
    text-transform: uppercase;
  }
  .case-dots { display: flex; gap: 6px; }
  .case-dot {
    width: 8px; height: 8px;
    border: 1px solid var(--ink-40);
    background: transparent;
    transition: all 0.08s linear;
  }
  .case-dot.active { background: var(--vermillon); border-color: var(--vermillon); }

  /* ────────────────────────────────────────────────────────────
     Footer (access demoted)
     ──────────────────────────────────────────────────────────── */
  .lab-foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 20px 22px;
    max-width: var(--max-width);
    margin: 0 auto;
    width: 100%;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-40);
    gap: 20px;
    flex-wrap: wrap;
  }
  .foot-left { display: inline-flex; gap: 20px; align-items: center; flex-wrap: wrap; }
  .foot-link {
    color: var(--ink-70);
    text-decoration: none;
    border-bottom: 1px dashed var(--ink-40);
  }
  .foot-link:hover { color: var(--vermillon); border-bottom-color: var(--vermillon); }

  .access {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink-40);
  }
  .access-k { color: var(--ink-40); }
  .access input {
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--ink-20);
    padding: 3px 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink);
    width: 90px;
    transition: border-color 0.08s linear;
    outline: none;
  }
  .access input:focus { border-bottom-color: var(--vermillon); }
  .access input::placeholder { color: var(--ink-20); }
  .access button {
    background: transparent;
    border: 1px solid var(--ink-20);
    padding: 2px 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--ink);
    cursor: pointer;
    transition: border-color 0.08s linear, color 0.08s linear;
  }
  .access button:hover { border-color: var(--vermillon); color: var(--vermillon); }
  .access button:disabled { opacity: 0.4; cursor: not-allowed; }
  .access-err { color: var(--vermillon); margin-left: 8px; }

  .shake { animation: shake 0.28s linear; }
  @keyframes shake {
    20%, 60% { transform: translateX(-3px); }
    40%, 80% { transform: translateX(3px); }
  }

  /* ────────────────────────────────────────────────────────────
     Responsive
     ──────────────────────────────────────────────────────────── */
  @media (max-width: 900px) {
    .grid { grid-template-columns: 1fr; }
    .col-main { border-right: 0; }
    .col-main .panel, .col-side .panel { padding-left: 0; padding-right: 0; }
    .headline { font-size: 34px; }
    .manifest { padding: 36px 20px 24px; }
  }
  @media (max-width: 480px) {
    .head-meta .kv:nth-child(2), .head-meta .kv:nth-child(3) { display: none; }
    .access input {
      width: 100px;
      min-height: var(--touch-min);
      padding: 8px 10px;
      font-size: var(--fs-small);
    }
    .access button {
      min-height: var(--touch-min);
      min-width: var(--touch-min);
      padding: 8px 14px;
      font-size: var(--fs-small);
    }
    .foot-link {
      display: inline-flex;
      align-items: center;
      min-height: var(--touch-min);
    }
  }
</style>
