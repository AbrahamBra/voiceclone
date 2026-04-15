<script>
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { api } from "$lib/api.js";
  import { showToast } from "$lib/stores/ui.js";
  import { renderMarkdown } from "$lib/utils.js";

  let personaId = $derived($page.data.personaId);

  let loading = $state(true);
  let loadError = $state("");
  let messages = $state([]);
  let ratings = $state([]);
  let submitting = $state(false);

  $effect(() => {
    if (personaId) loadCalibration(personaId);
  });

  async function loadCalibration(pid) {
    loading = true;
    loadError = "";

    try {
      const data = await api("/api/calibrate", {
        method: "POST",
        body: JSON.stringify({ persona: pid }),
      });
      messages = data.messages;
      ratings = data.messages.map(() => ({ score: 0, correction: "" }));
    } catch {
      loadError = "Calibration indisponible. Vous pouvez passer.";
    } finally {
      loading = false;
    }
  }

  function setRating(index, score) {
    ratings[index] = { ...ratings[index], score };
  }

  function setCorrection(index, value) {
    ratings[index] = { ...ratings[index], correction: value };
  }

  async function submitCalibration() {
    submitting = true;

    const payload = messages.map((msg, i) => ({
      index: i,
      score: ratings[i].score || 3,
      correction: ratings[i].correction.trim(),
      response: msg.response?.slice(0, 300) || "",
    }));

    try {
      const data = await api("/api/calibrate-feedback", {
        method: "POST",
        body: JSON.stringify({ persona: personaId, ratings: payload }),
      });
      if (data.message) showToast(data.message);
    } catch {
      // silent
    }

    setTimeout(() => {
      goto(`/chat/${personaId}`);
    }, 500);
  }

  function skip() {
    goto(`/chat/${personaId}`);
  }
</script>

<div class="calibrate-page">
  <div class="calibrate-container">
    <h2>Calibration</h2>
    <p class="calibrate-subtitle">Evaluez les reponses generees pour affiner le clone</p>

    {#if loading}
      <div class="calibrate-loading">Generation des messages de test...</div>
    {:else if loadError}
      <div class="calibrate-error">{loadError}</div>
    {:else}
      <div class="calibrate-cards">
        {#each messages as msg, i}
          <div class="calibrate-card">
            <div class="calibrate-context">{msg.context}</div>
            <div class="calibrate-response">{@html renderMarkdown(msg.response)}</div>
            <div class="calibrate-rating">
              {#each [1, 2, 3, 4, 5] as n}
                <button
                  class="star-btn"
                  class:active={ratings[i].score >= n}
                  onclick={() => setRating(i, n)}
                >
                  {ratings[i].score >= n ? "\u2605" : "\u2606"}
                </button>
              {/each}
            </div>
            <textarea
              class="calibrate-correction"
              placeholder="Correction (optionnel)"
              rows="2"
              value={ratings[i].correction}
              oninput={(e) => setCorrection(i, e.target.value)}
            ></textarea>
          </div>
        {/each}
      </div>
    {/if}

    <div class="calibrate-actions">
      <button class="btn-secondary" onclick={skip}>Passer</button>
      <button onclick={submitCalibration} disabled={submitting || loading}>
        {submitting ? "Envoi..." : "Valider la calibration"}
      </button>
    </div>
  </div>
</div>

<style>
  .calibrate-page {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    min-height: 100vh;
    padding-top: 3rem;
  }

  .calibrate-container {
    width: 100%;
    max-width: var(--max-width);
    padding: 0 1.5rem 3rem;
  }

  .calibrate-container h2 {
    font-size: 1rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
  }

  .calibrate-subtitle {
    font-size: 0.75rem;
    color: var(--text-tertiary);
    margin-bottom: 0.5rem;
  }

  .calibrate-loading,
  .calibrate-error {
    font-size: 0.75rem;
    color: var(--text-tertiary);
    margin-top: 1.5rem;
  }

  .calibrate-error {
    color: var(--warning);
  }

  .calibrate-cards {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-top: 1.5rem;
  }

  .calibrate-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1rem;
  }

  .calibrate-context {
    font-size: 0.75rem;
    color: var(--text-tertiary);
    margin-bottom: 0.5rem;
    font-style: italic;
  }

  .calibrate-response {
    font-size: 0.8125rem;
    line-height: 1.5;
    margin-bottom: 0.75rem;
  }

  .calibrate-rating {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 0.5rem;
  }

  .star-btn {
    width: 2rem;
    height: 2rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-tertiary);
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.15s;
    padding: 0;
  }

  .star-btn.active {
    background: var(--warning);
    border-color: var(--warning);
    color: var(--bg);
  }

  .star-btn:hover {
    border-color: var(--warning);
    color: var(--warning);
  }

  .calibrate-correction {
    width: 100%;
    padding: 0.5rem 0.75rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font-size: 0.75rem;
    font-family: var(--font);
    resize: vertical;
  }

  .calibrate-correction:focus {
    outline: none;
    border-color: var(--text-tertiary);
  }

  .calibrate-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 1.5rem;
  }

  .btn-secondary {
    padding: 0.5rem 0.75rem;
    background: var(--surface);
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: 0.75rem;
    font-weight: 500;
    font-family: var(--font);
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    white-space: nowrap;
  }

  .btn-secondary:hover {
    border-color: var(--text-secondary);
    color: var(--text);
  }

  @media (max-width: 640px) {
    .calibrate-container {
      padding: 0 1rem 3rem;
    }
  }
</style>
