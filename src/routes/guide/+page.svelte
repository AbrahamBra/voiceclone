<script>
  import { goto } from "$app/navigation";
  import { accessCode } from "$lib/stores/auth.js";
  import { fly, fade } from "svelte/transition";

  let activeSection = $state(null);

  function toggle(id) {
    activeSection = activeSection === id ? null : id;
  }

  const knowledgeItems = [
    {
      id: "background",
      title: "Background & parcours",
      desc: "Qui est la personne derriere le clone ?",
      content: "Parcours professionnel, experiences cles, formation, realisations marquantes. Ce qui rend cette personne credible et unique dans son domaine.",
      example: "Ex: \"15 ans en B2B SaaS, ex-VP Sales chez X, a scale de 0 a 50M ARR. Aujourd'hui CEO de Y, accompagne les founders sur le GTM LinkedIn.\"",
      priority: "Essentiel"
    },
    {
      id: "positioning",
      title: "Positionnement & expertise",
      desc: "Sur quels sujets ce clone est-il l'expert ?",
      content: "Themes principaux, angle d'attaque, ce qui differencie cette personne des autres experts du meme domaine. La promesse de valeur.",
      example: "Ex: \"Expert LinkedIn B2B. Angle: pas de growth hacks, que du fond. Anti-bullshit, pro-valeur. Positionnement: le contenu LinkedIn comme levier de pipe commercial.\"",
      priority: "Essentiel"
    },
    {
      id: "audience",
      title: "Audience cible",
      desc: "A qui cette personne s'adresse-t-elle ?",
      content: "ICP (profil client ideal), persona principal, niveau de maturite de l'audience. Le vocabulaire et les references que l'audience comprend.",
      example: "Ex: \"CEOs et VP Sales de startups B2B SaaS (Series A-C). Connaissent LinkedIn mais n'ont pas de strategie structuree. Budget 5-20k/mois pour l'acquisition.\"",
      priority: "Essentiel"
    },
    {
      id: "product",
      title: "Offre & produit",
      desc: "Qu'est-ce que cette personne vend ?",
      content: "Description de l'offre, pricing, process de vente, objections courantes, arguments cles. Ce que le clone doit savoir pour qualifier et closer.",
      example: "Ex: \"Accompagnement LinkedIn en 3 mois. 3 offres: Starter (1.5k), Growth (3k), Scale (6k). Inclut: strategie, ghostwriting, analytics. Objection #1: 'Je n'ai pas le temps de poster'.\"",
      priority: "Important"
    },
    {
      id: "leadmagnet",
      title: "Lead magnets & ressources",
      desc: "Les contenus qui attirent et convertissent",
      content: "Lead magnets existants (guides, templates, outils), leur URL, le contexte d'utilisation. Le clone pourra les recommander naturellement dans les conversations.",
      example: "Ex: \"Guide '30 hooks LinkedIn qui convertissent' (lien). Template 'Calendrier editorial LinkedIn' (lien). Outil gratuit 'Audit de profil LinkedIn' (lien).\"",
      priority: "Recommande"
    },
    {
      id: "posts",
      title: "Exemples de posts LinkedIn",
      desc: "Le style d'ecriture public",
      content: "10 a 20 des meilleurs posts. Ils sont analyses pour extraire le ton, les structures recurrentes, le vocabulaire, les tics de langage, les hooks preferes.",
      example: "Collez vos posts directement dans le flow de creation (etape 2). Separez chaque post par --- sur une ligne seule.",
      priority: "Essentiel"
    },
    {
      id: "dms",
      title: "Exemples de DMs",
      desc: "Le style de conversation prive",
      content: "Echanges DM reels avec des prospects ou clients. Le clone apprend le ton 1:1, la facon de qualifier, de relancer, de closer en message prive.",
      example: "Collez vos conversations dans le flow de creation (etape 3). Le format: chaque message sur une ligne, conversations separees par ---.",
      priority: "Important"
    },
    {
      id: "method",
      title: "Methode & frameworks",
      desc: "Les concepts proprietaires",
      content: "Frameworks maison, methodologies, acronymes proprietaires, process signatures. Tout ce qui fait la \"patte\" intellectuelle de cette personne.",
      example: "Ex: \"Methode SCALE: S=Strategie, C=Contenu, A=Audience, L=Leads, E=Engagement. Utilise dans chaque post et chaque accompagnement.\"",
      priority: "Recommande"
    }
  ];

  const feedbackSteps = [
    {
      icon: "1",
      title: "Validez les bonnes reponses",
      desc: "Cliquez sur le check quand une reponse vous plait. Le clone renforce ce style."
    },
    {
      icon: "2",
      title: "Corrigez le clone",
      desc: "Deux facons : cliquez sur \"Corriger\" sur une reponse, ou dites-le directement dans le chat (\"Trop long\", \"Desormais tutoie toujours\", \"Ajoute une regle: ...\"). Dans les deux cas, la correction est sauvegardee automatiquement."
    },
    {
      icon: "3",
      title: "Le clone s'ameliore",
      desc: "Chaque correction est analysee et integree. Apres 10-15 corrections, le clone colle a votre voix."
    }
  ];

  const onboardingSteps = [
    {
      num: "01",
      title: "Preparer le contenu",
      desc: "Rassemblez vos meilleurs posts LinkedIn (10-20), votre bio, et vos documents cles (offre, methode, audience).",
      time: "15 min"
    },
    {
      num: "02",
      title: "Creer le clone",
      desc: "Suivez le formulaire de creation: choisissez le type (Posts / DMs / Les deux), remplissez les infos, collez vos posts et documents.",
      time: "5 min"
    },
    {
      num: "03",
      title: "Calibrer",
      desc: "Le clone genere 5 messages-tests. Notez chaque message de 1 a 5 etoiles et corrigez ceux qui ne vous ressemblent pas.",
      time: "5 min"
    },
    {
      num: "04",
      title: "Enrichir la base de connaissances",
      desc: "Uploadez vos documents depuis le panneau Intelligence dans le chat. Plus le clone a de contexte, plus il est precis.",
      time: "10 min"
    },
    {
      num: "05",
      title: "Utiliser et corriger",
      desc: "Chattez avec votre clone, validez les bonnes reponses, corrigez les mauvaises. C'est la boucle de feedback qui rend le clone excellent.",
      time: "En continu"
    }
  ];
</script>

<div class="guide-page">
  <div class="guide-container">
    <header class="guide-header">
      <button class="back-btn" onclick={() => history.back()}>
        &larr; Retour
      </button>
      <h1>Guide d'onboarding</h1>
      <p class="guide-subtitle">
        Tout ce qu'il faut savoir pour creer et entrainer votre clone VoiceClone
      </p>
    </header>

    <!-- SECTION 1: Process d'onboarding -->
    <section class="guide-section" id="onboarding">
      <h2 class="section-title">
        <span class="section-num">01</span>
        Le process d'onboarding
      </h2>
      <p class="section-desc">
        De la preparation du contenu au clone operationnel, en 5 etapes.
      </p>

      <div class="timeline">
        {#each onboardingSteps as step, i}
          <div class="timeline-item" transition:fly={{ y: 12, delay: i * 60, duration: 200 }}>
            <div class="timeline-num">{step.num}</div>
            <div class="timeline-content">
              <div class="timeline-header">
                <strong>{step.title}</strong>
                <span class="timeline-time">{step.time}</span>
              </div>
              <p>{step.desc}</p>
            </div>
          </div>
        {/each}
      </div>
    </section>

    <!-- SECTION 2: Base de connaissances -->
    <section class="guide-section" id="knowledge">
      <h2 class="section-title">
        <span class="section-num">02</span>
        Quoi mettre dans la base de connaissances
      </h2>
      <p class="section-desc">
        Plus le clone a de contexte, plus il est precis. Voici les 8 types de contenu a fournir, par ordre de priorite.
      </p>

      <div class="knowledge-grid">
        {#each knowledgeItems as item, i}
          <button
            class="knowledge-card"
            class:active={activeSection === item.id}
            onclick={() => toggle(item.id)}
            transition:fly={{ y: 12, delay: i * 40, duration: 200 }}
          >
            <div class="knowledge-card-header">
              <div class="knowledge-card-left">
                <strong>{item.title}</strong>
                <span class="knowledge-card-desc">{item.desc}</span>
              </div>
              <span class="priority-badge" class:essential={item.priority === "Essentiel"} class:important={item.priority === "Important"}>
                {item.priority}
              </span>
            </div>

            {#if activeSection === item.id}
              <div class="knowledge-card-body" transition:fly={{ y: -8, duration: 150 }}>
                <p>{item.content}</p>
                <div class="knowledge-example">
                  {item.example}
                </div>
              </div>
            {/if}
          </button>
        {/each}
      </div>
    </section>

    <!-- SECTION 3: Boucle de feedback -->
    <section class="guide-section" id="feedback">
      <h2 class="section-title">
        <span class="section-num">03</span>
        La boucle de feedback
      </h2>
      <p class="section-desc">
        Le clone s'ameliore a chaque interaction. Plus vous le corrigez, plus il vous ressemble. Voici comment.
      </p>

      <div class="feedback-flow">
        {#each feedbackSteps as step, i}
          <div class="feedback-step" transition:fly={{ y: 12, delay: i * 60, duration: 200 }}>
            <div class="feedback-icon">{step.icon}</div>
            <div class="feedback-body">
              <strong>{step.title}</strong>
              <p>{step.desc}</p>
            </div>
          </div>
          {#if i < feedbackSteps.length - 1}
            <div class="feedback-arrow">&#8595;</div>
          {/if}
        {/each}
      </div>

      <div class="feedback-tips">
        <h3>Conseils pour un clone au top</h3>
        <ul>
          <li><strong>Soyez specifique</strong> dans vos corrections. "Trop long" est bien, "Trop long, max 3 lignes par paragraphe" est mieux.</li>
          <li><strong>Corrigez tot, corrigez souvent.</strong> Les 15 premieres corrections sont les plus impactantes.</li>
          <li><strong>Utilisez les instructions directes</strong> pour les regles absolues: "Ne jamais utiliser d'emojis", "Toujours tutoyer".</li>
          <li><strong>Validez les bonnes reponses</strong> — ca compte autant que les corrections. Le clone renforce ce qui marche.</li>
          <li><strong>Uploadez du contenu regulierement</strong> — nouveau post viral, nouvelle offre, nouveau cas client.</li>
        </ul>
      </div>
    </section>

    <!-- CTA -->
    <section class="guide-cta">
      {#if $accessCode}
        <button class="cta-btn" onclick={() => goto("/")}>
          Commencer &rarr;
        </button>
      {:else}
        <p class="cta-text">Connectez-vous pour creer votre clone.</p>
        <button class="cta-btn" onclick={() => goto("/")}>
          Se connecter &rarr;
        </button>
      {/if}
    </section>
  </div>
</div>

<style>
  .guide-page {
    min-height: 100dvh;
    padding: 2rem 1.5rem 4rem;
    display: flex;
    justify-content: center;
  }

  .guide-container {
    max-width: 600px;
    width: 100%;
  }

  /* Header */
  .guide-header {
    margin-bottom: 3rem;
  }

  .back-btn {
    background: none;
    border: none;
    color: var(--text-tertiary);
    font-size: 0.75rem;
    font-family: var(--font);
    cursor: pointer;
    padding: 0;
    margin-bottom: 1.5rem;
    display: block;
    transition: color 0.15s;
  }

  .back-btn:hover { color: var(--text); }

  .guide-header h1 {
    font-size: 1.25rem;
    font-weight: 600;
    letter-spacing: -0.03em;
    margin-bottom: 0.375rem;
  }

  .guide-subtitle {
    font-size: 0.8125rem;
    color: var(--text-tertiary);
    line-height: 1.5;
  }

  /* Sections */
  .guide-section {
    margin-bottom: 3rem;
    scroll-margin-top: 80px;
  }

  .section-title {
    font-size: 0.9375rem;
    font-weight: 600;
    letter-spacing: -0.02em;
    display: flex;
    align-items: center;
    gap: 0.625rem;
    margin-bottom: 0.375rem;
  }

  .section-num {
    font-size: 0.625rem;
    font-weight: 600;
    color: var(--text-tertiary);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.125rem 0.375rem;
    letter-spacing: 0.02em;
  }

  .section-desc {
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.6;
    margin-bottom: 1.5rem;
  }

  /* Timeline */
  .timeline {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .timeline-item {
    display: flex;
    gap: 0.875rem;
    padding: 0.875rem;
    border-radius: var(--radius);
    transition: background 0.15s;
  }

  .timeline-item:hover {
    background: rgba(255, 255, 255, 0.02);
  }

  .timeline-num {
    font-size: 0.625rem;
    font-weight: 600;
    color: var(--text-tertiary);
    width: 1.5rem;
    height: 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 0.125rem;
  }

  .timeline-content {
    flex: 1;
  }

  .timeline-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.25rem;
  }

  .timeline-header strong {
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .timeline-time {
    font-size: 0.625rem;
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .timeline-content p {
    font-size: 0.75rem;
    color: var(--text-secondary);
    line-height: 1.55;
  }

  /* Knowledge cards */
  .knowledge-grid {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .knowledge-card {
    width: 100%;
    text-align: left;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.75rem 1rem;
    cursor: pointer;
    transition: border-color 0.15s;
    font-family: var(--font);
    color: var(--text);
  }

  .knowledge-card:hover {
    border-color: var(--text-tertiary);
  }

  .knowledge-card.active {
    border-color: var(--text-secondary);
  }

  .knowledge-card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .knowledge-card-left {
    flex: 1;
  }

  .knowledge-card-left strong {
    display: block;
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    margin-bottom: 0.125rem;
  }

  .knowledge-card-desc {
    display: block;
    font-size: 0.6875rem;
    color: var(--text-tertiary);
  }

  .priority-badge {
    font-size: 0.5625rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.125rem 0.375rem;
    border-radius: 3px;
    flex-shrink: 0;
    background: var(--border);
    color: var(--text-tertiary);
  }

  .priority-badge.essential {
    background: rgba(34, 197, 94, 0.12);
    color: var(--success);
  }

  .priority-badge.important {
    background: rgba(245, 158, 11, 0.12);
    color: var(--warning);
  }

  .knowledge-card-body {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
  }

  .knowledge-card-body p {
    font-size: 0.75rem;
    color: var(--text-secondary);
    line-height: 1.6;
    margin-bottom: 0.625rem;
  }

  .knowledge-example {
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.625rem 0.75rem;
    line-height: 1.55;
  }

  /* Feedback flow */
  .feedback-flow {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
    margin-bottom: 2rem;
  }

  .feedback-step {
    display: flex;
    gap: 0.875rem;
    padding: 0.875rem;
    border-radius: var(--radius);
    width: 100%;
    transition: background 0.15s;
  }

  .feedback-step:hover {
    background: rgba(255, 255, 255, 0.02);
  }

  .feedback-icon {
    width: 1.75rem;
    height: 1.75rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: 50%;
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .feedback-body {
    flex: 1;
  }

  .feedback-body strong {
    display: block;
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    margin-bottom: 0.25rem;
  }

  .feedback-body p {
    font-size: 0.75rem;
    color: var(--text-secondary);
    line-height: 1.55;
  }

  .feedback-arrow {
    color: var(--text-tertiary);
    font-size: 0.75rem;
    opacity: 0.4;
    padding: 0.125rem 0;
  }

  /* Tips */
  .feedback-tips {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1.25rem;
  }

  .feedback-tips h3 {
    font-size: 0.8125rem;
    font-weight: 600;
    margin-bottom: 0.75rem;
    letter-spacing: -0.01em;
  }

  .feedback-tips ul {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }

  .feedback-tips li {
    font-size: 0.75rem;
    color: var(--text-secondary);
    line-height: 1.55;
    padding-left: 0.75rem;
    position: relative;
  }

  .feedback-tips li::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0.5em;
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: var(--text-tertiary);
  }

  .feedback-tips li strong {
    color: var(--text);
    font-weight: 500;
  }

  /* CTA */
  .guide-cta {
    text-align: center;
    padding-top: 1rem;
  }

  .cta-text {
    font-size: 0.75rem;
    color: var(--text-tertiary);
    margin-bottom: 0.75rem;
  }

  .cta-btn {
    padding: 0.625rem 1.5rem;
    background: var(--text);
    color: var(--bg);
    border: none;
    border-radius: var(--radius);
    font-size: 0.8125rem;
    font-weight: 500;
    font-family: var(--font);
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .cta-btn:hover { opacity: 0.85; }

  @media (max-width: 480px) {
    .guide-page { padding: 1.25rem 1rem 3rem; }
    .guide-header { margin-bottom: 2rem; }
    .guide-section { margin-bottom: 2.5rem; }
    .timeline-header { flex-direction: column; gap: 0.125rem; }
  }
</style>
