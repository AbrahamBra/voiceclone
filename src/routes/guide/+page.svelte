<script>
  import { goto } from "$app/navigation";
  import { accessCode } from "$lib/stores/auth.js";
  import { fly } from "svelte/transition";

  let activeSection = $state(null);

  function toggle(id) {
    activeSection = activeSection === id ? null : id;
  }

  // Les 4 onglets du Cerveau (ce que voit l'opérateur quand il ouvre /brain/[persona])
  const brainTabs = [
    {
      id: "tab-connaissance",
      title: "Connaissance",
      role: "La matière brute",
      content: "Les docs uploadés : offre, audience, background, témoignages, articles. Stockés en chunks sémantiques. Quand le setter drafte, le clone retrouve les passages utiles par similarité et les utilise comme contexte. Plus vous enrichissez, plus le clone a de matière à citer.",
      example: "Doc 'Background Nicolas' (3 chunks, extraction OK), 'Audience cible' (4 chunks), 'Positionnement' (3 chunks). Type = Générique. Le clone pioche dedans.",
    },
    {
      id: "tab-protocole",
      title: "Protocole",
      role: "Les règles dures",
      content: "Le playbook DM de votre client : qui cibler, comment ouvrir, max N questions, ce qu'il ne dit jamais, quand pitcher, quand reculer. Stocké en 6 sections (hard_rules, errors, process, icp_patterns, scoring, templates) plus des artefacts compilés. Si un draft viole une règle, le clone le réécrit automatiquement.",
      example: "Hard rule : 'Jamais 2 questions dans un même message'. Si le draft en met 2, le clone le réécrit avant de l'afficher au setter.",
    },
    {
      id: "tab-intelligence",
      title: "Intelligence",
      role: "L'apprentissage continu",
      content: "Ce qui sort de l'usage : entités extraites des docs, corrections du setter, propositions de règles à arbitrer, score de fidélité voix. Ce n'est pas une zone de mémoire en soi. C'est la vue sur ce que les autres zones produisent.",
      example: "5 nouvelles entités extraites de 'Background' (EPITA, Ludik Factory). 3 corrections setter cette semaine. 2 propositions de règles en attente d'arbitrage.",
    },
    {
      id: "tab-reglages",
      title: "Réglages",
      role: "Les paramètres persona",
      content: "Nom, titre, avatar, label client, type. Modifiable à tout moment. Aucun impact sur le runtime du clone existant.",
      example: "Renommer 'Nicolas' en 'Nicolas Lavallée, coach dirigeants'. Changer l'avatar. Archiver le clone.",
    },
  ];

  // Le flow d'onboarding réel (5 steps depuis 2026-04-30, DM-only)
  const onboardingSteps = [
    {
      num: "01",
      title: "Maturité",
      desc: "Vous choisissez L1, L2 ou L3 selon le doc source que vous avez. L1 = positionnement seul. L2 = playbook DM sur un seul scénario (par exemple icebreaker outbound). L3 = playbook multi-scénario (icebreaker × multi-source, creusement, call_proposal, graceful_exit). Skippable si vous n'êtes pas sûr.",
      time: "30 sec"
    },
    {
      num: "02",
      title: "Infos générales",
      desc: "URL LinkedIn de votre client (auto-remplit nom, titre, bio, posts publics) ou saisie manuelle. Les posts publics récupérés servent de baseline de voix. Ils sont lus, pas régénérés.",
      time: "1 min"
    },
    {
      num: "03",
      title: "DMs de référence",
      desc: "Colle 5 à 15 conversations DM réelles de votre client. Format : 'Prénom: message' ligne par ligne, conversations séparées par --- ou par une ligne vide. Le clone apprend la dynamique 1:1 : relances, clôtures, ton.",
      time: "5 à 10 min"
    },
    {
      num: "04",
      title: "Protocole opérationnel",
      desc: "Optionnel, mais c'est ce qui change tout. Uploade le doc de cadrage prospection co-construit avec votre client (.txt .md .pdf .docx). Le parsing tourne en arrière-plan environ 10 min après création. Vous validerez les règles extraites avant activation depuis Cerveau → Protocole.",
      time: "1 min upload + 10 min parsing"
    },
    {
      num: "05",
      title: "Docs complémentaires et génération",
      desc: "Optionnel. Uploade offre, témoignages, méthodes, audience. L'embed est synchrone (chunks RAG dispo immédiatement). Click 'Générer le clone' lance la création persona, l'analyse de style et de DMs en 30 à 60 secondes, puis redirige vers /calibrate.",
      time: "1 min upload + 1 min génération"
    },
  ];

  // Ce que vous pouvez uploader (avec direction : ça part dans Protocole ou dans Connaissance)
  const knowledgeItems = [
    {
      id: "background",
      title: "Background et parcours",
      desc: "Qui est votre client",
      target: "Connaissance",
      content: "Parcours pro, expériences clés, formation, réalisations. Le clone s'en sert pour répondre quand un prospect demande 'tu as fait quoi avant' ou 'pourquoi je devrais te croire'.",
      example: "Ex : '15 ans en B2B SaaS, ex-VP Sales chez X, scale 0 → 50M ARR. Aujourd'hui CEO de Y, accompagne les founders sur le GTM LinkedIn.'",
      priority: "à avoir"
    },
    {
      id: "positioning",
      title: "Positionnement et expertise",
      desc: "Sur quoi votre client est expert",
      target: "Connaissance",
      content: "Thèmes principaux, angle, ce qui le différencie. Le clone l'utilise pour cadrer les réponses et orienter vers les sujets où votre client est solide.",
      example: "Ex : 'Expert LinkedIn B2B. Angle : pas de growth hacks, que du fond. Anti-bullshit, pro-valeur.'",
      priority: "à avoir"
    },
    {
      id: "audience",
      title: "Audience cible (ICP)",
      desc: "À qui votre client s'adresse",
      target: "Connaissance",
      content: "Profil prospect idéal, niveau de maturité, vocabulaire, références. Le clone reconnaît un prospect ICP par rapport à un hors-cible et ajuste le niveau du discours.",
      example: "Ex : 'CEOs et VP Sales de startups B2B SaaS Series A-C. Ils connaissent LinkedIn mais n'ont pas de stratégie structurée. Budget 5 à 20k par mois sur l'acquisition.'",
      priority: "à avoir"
    },
    {
      id: "product",
      title: "Offre et pricing",
      desc: "Ce que votre client vend",
      target: "Connaissance",
      content: "Description offre, pricing, process de vente, objections courantes, arguments. Le clone pioche dedans pour qualifier et closer.",
      example: "Ex : 'Accompagnement LinkedIn 3 mois. 3 paliers : Starter 1.5k, Growth 3k, Scale 6k. Objection numéro 1 : \"j'ai pas le temps de poster\".'",
      priority: "à avoir"
    },
    {
      id: "method",
      title: "Méthode et frameworks",
      desc: "Concepts propriétaires",
      target: "Connaissance",
      content: "Frameworks maison, méthodologies, acronymes signature. Ce qui fait la patte intellectuelle de votre client. Le clone les nomme et les utilise comme un porte-parole.",
      example: "Ex : 'Méthode SCALE : Stratégie / Contenu / Audience / Leads / Engagement. Utilisée dans chaque accompagnement.'",
      priority: "en plus"
    },
    {
      id: "leadmagnet",
      title: "Lead magnets",
      desc: "Ressources offertes",
      target: "Connaissance",
      content: "Guides, templates, audits gratuits. Le clone peut les recommander quand le moment s'y prête.",
      example: "Ex : 'Guide 30 hooks LinkedIn (lien). Template calendrier édito (lien). Audit gratuit profil (lien).'",
      priority: "en plus"
    },
    {
      id: "dms",
      title: "DMs de référence",
      desc: "Style 1:1 réel",
      target: "Voice baseline (étape 03)",
      content: "5 à 15 conversations DM réelles complètes, les deux côtés. Le clone apprend les relances, les clôtures, les pivots. Format : 'Prénom: message' par ligne, conversations séparées par --- ou ligne vide.",
      example: "Collé directement à l'étape 03 de la création. Pas un upload de doc.",
      priority: "à avoir"
    },
    {
      id: "protocol",
      title: "Protocole opérationnel",
      desc: "Règles dures du DM",
      target: "Protocole",
      content: "Le playbook prospection : qui cibler, comment ouvrir, max N questions par message, ce qu'il ne dit JAMAIS, quand pitcher, quand reculer. Le clone applique en dur. Il réécrit tout draft qui viole. Sans protocole, il reste fidèle au style mais ne bloque rien.",
      example: "Ex : 'Jamais 2 questions par message. Max 8 lignes. Pas de mention de prix avant le call. Toujours signer par le prénom.' Uploadé à l'étape 04.",
      priority: "à avoir"
    },
  ];

  // Boucle d'apprentissage (comment ça évolue après création)
  const loopSteps = [
    {
      num: "1",
      title: "Le setter drafte",
      desc: "Le setter ouvre le chat du clone et colle le DM du prospect. Le clone répond avec un draft qui respecte le protocole, la connaissance et le style appris.",
    },
    {
      num: "2",
      title: "Le setter corrige ou valide",
      desc: "Si le draft passe, le setter clique sur 'validé' (signal positif). Sinon il clique 'corriger' avec le bon texte, ou il donne l'instruction directement dans le chat ('trop long', 'jamais ce mot', 'ajoute la règle X'). Chaque action est tracée.",
    },
    {
      num: "3",
      title: "Le système propose",
      desc: "Les corrections récurrentes sont clusterisées et transformées en propositions de règles. Vous retrouvez la queue dans Cerveau → Protocole → Propositions.",
    },
    {
      num: "4",
      title: "Vous arbitrez",
      desc: "Pour chaque proposition vous choisissez : Accepter (la règle entre dans le protocole), Modifier (vous reformulez), Rejeter (signal noté, pas de règle). C'est ce qui fait évoluer le clone dans le temps.",
    },
  ];
</script>

<div class="guide-page">
  <div class="guide-container">
    <header class="guide-header">
      <button class="back-btn" onclick={() => history.back()}>&larr; Retour</button>
      <h1>Guide</h1>
      <p class="guide-subtitle">
        Comment fonctionne Setclone, et comment piloter un clone pour un client.
      </p>
    </header>

    <!-- SECTION 1: Le cerveau du clone, modèle mental -->
    <section class="guide-section" id="cerveau">
      <h2 class="section-title">
        <span class="section-num">01</span>
        Comment le clone fonctionne
      </h2>
      <p class="section-desc">
        Le clone a deux zones de mémoire. Elles agissent à des moments différents quand le setter drafte une réponse.
      </p>

      <div class="brain-compare">
        <div class="brain-side">
          <div class="brain-tag">PROTOCOLE</div>
          <div class="brain-headline">Les règles dures</div>
          <p class="brain-body">
            <em>Comment</em> votre client prospecte. Vouvoie ou tutoie. Max 2 questions par message. Jamais "n'hésitez pas". Pitche après 3 échanges, pas avant.
          </p>
          <div class="brain-runtime">
            <strong>Au runtime :</strong> les règles sont injectées dans le prompt, et re-vérifiées après génération. Si un draft viole une règle, le clone le <strong>réécrit automatiquement</strong>.
          </div>
        </div>

        <div class="brain-vs">vs</div>

        <div class="brain-side">
          <div class="brain-tag tag-alt">CONNAISSANCE</div>
          <div class="brain-headline">La matière brute</div>
          <p class="brain-body">
            <em>Ce que</em> votre client sait. Son ICP, son histoire, son offre, ses cas, ses anecdotes, ses verbatims.
          </p>
          <div class="brain-runtime">
            <strong>Au runtime :</strong> la question du prospect est embeddée, et on cherche les passages proches. Le clone reçoit ces passages comme <strong>contexte</strong>. Il s'en sert s'il en a besoin, sans y être forcé.
          </div>
        </div>
      </div>

      <div class="metaphor">
        <strong>Pense à ça comme la grammaire et le dictionnaire.</strong> Protocole = la <em>grammaire</em> (règles non-négociables). Connaissance = le <em>dictionnaire</em> (vocabulaire et savoir disponibles). Un dictionnaire énorme avec une grammaire bancale donne un clone qui parle de plein de trucs mais qui peut violer le ton. Une grammaire stricte avec un dictionnaire pauvre donne un clone discipliné mais creux. Les deux comptent.
      </div>
    </section>

    <!-- SECTION 2: Créer un clone -->
    <section class="guide-section" id="onboarding">
      <h2 class="section-title">
        <span class="section-num">02</span>
        Créer un clone
      </h2>
      <p class="section-desc">
        5 étapes, moins de 15 min de saisie. Le parsing protocole tourne en arrière-plan environ 10 min après. Ça ne bloque rien.
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

    <!-- SECTION 3: La page Cerveau -->
    <section class="guide-section" id="brain">
      <h2 class="section-title">
        <span class="section-num">03</span>
        La page Cerveau
      </h2>
      <p class="section-desc">
        4 onglets à <code>/brain/[persona]</code>. Click sur chacun pour voir ce qu'il contient et quand l'enrichir.
      </p>

      <div class="knowledge-grid">
        {#each brainTabs as tab, i}
          <button
            class="knowledge-card"
            class:active={activeSection === tab.id}
            onclick={() => toggle(tab.id)}
            transition:fly={{ y: 12, delay: i * 40, duration: 200 }}
          >
            <div class="knowledge-card-header">
              <div class="knowledge-card-left">
                <strong>{tab.title}</strong>
                <span class="knowledge-card-desc">{tab.role}</span>
              </div>
            </div>
            {#if activeSection === tab.id}
              <div class="knowledge-card-body" transition:fly={{ y: -8, duration: 150 }}>
                <p>{tab.content}</p>
                <div class="knowledge-example">{tab.example}</div>
              </div>
            {/if}
          </button>
        {/each}
      </div>
    </section>

    <!-- SECTION 4: Quoi uploader -->
    <section class="guide-section" id="knowledge">
      <h2 class="section-title">
        <span class="section-num">04</span>
        Quoi uploader, et où ça atterrit
      </h2>
      <p class="section-desc">
        Chaque type de contenu va dans la bonne zone : Protocole pour les règles, Connaissance pour la matière. Click pour voir l'usage.
      </p>

      <div class="knowledge-grid">
        {#each knowledgeItems as item, i}
          <button
            class="knowledge-card"
            class:active={activeSection === item.id}
            onclick={() => toggle(item.id)}
            transition:fly={{ y: 12, delay: i * 30, duration: 180 }}
          >
            <div class="knowledge-card-header">
              <div class="knowledge-card-left">
                <strong>{item.title}</strong>
                <span class="knowledge-card-desc">{item.desc} → <em>{item.target}</em></span>
              </div>
              <span class="priority-badge"
                class:essential={item.priority === "à avoir"}
                class:important={item.priority === "en plus"}
              >{item.priority}</span>
            </div>
            {#if activeSection === item.id}
              <div class="knowledge-card-body" transition:fly={{ y: -8, duration: 150 }}>
                <p>{item.content}</p>
                <div class="knowledge-example">{item.example}</div>
              </div>
            {/if}
          </button>
        {/each}
      </div>
    </section>

    <!-- SECTION 5: La boucle d'apprentissage -->
    <section class="guide-section" id="loop">
      <h2 class="section-title">
        <span class="section-num">05</span>
        La boucle d'apprentissage
      </h2>
      <p class="section-desc">
        Le clone n'est pas figé après création. Chaque correction setter peut devenir une règle. Vous arbitrez.
      </p>

      <div class="feedback-flow">
        {#each loopSteps as step, i}
          <div class="feedback-step" transition:fly={{ y: 12, delay: i * 60, duration: 200 }}>
            <div class="feedback-icon">{step.num}</div>
            <div class="feedback-body">
              <strong>{step.title}</strong>
              <p>{step.desc}</p>
            </div>
          </div>
          {#if i < loopSteps.length - 1}
            <div class="feedback-arrow">&#8595;</div>
          {/if}
        {/each}
      </div>

      <div class="feedback-tips">
        <h3>Quelques principes opérationnels</h3>
        <ul>
          <li><strong>Soyez spécifique.</strong> "Trop long" passe. "Trop long, max 3 lignes par paragraphe" donne une règle exploitable.</li>
          <li><strong>Corrigez tôt, corrigez souvent.</strong> Les 15 premières corrections sont les plus impactantes. C'est là que le clone calibre.</li>
          <li><strong>Validez aussi les bonnes réponses.</strong> Le bouton "validé" compte autant qu'une correction. Le clone renforce ce qui marche.</li>
          <li><strong>Séparez règle dure et préférence.</strong> Une règle dure ("jamais d'emoji") va au protocole. Une préférence ("plutôt court") nourrit le style mais ne bloque rien.</li>
          <li><strong>Enrichissez la connaissance régulièrement.</strong> Nouveau cas client, nouvelle offre, nouveau verbatim : upload depuis Cerveau → Connaissance. Le clone élargit son contexte sans changer ses règles.</li>
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
        <p class="cta-text">Connectez-vous pour créer votre premier clone.</p>
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
    max-width: 640px;
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

  .section-desc code {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 0.05em 0.35em;
    font-size: 0.7rem;
  }

  /* Brain compare (Protocole vs Connaissance) */
  .brain-compare {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 0.75rem;
    align-items: stretch;
    margin-bottom: 1rem;
  }

  .brain-side {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .brain-tag {
    font-size: 0.5625rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--vermillon);
    align-self: flex-start;
  }
  .brain-tag.tag-alt {
    color: var(--text-secondary);
  }

  .brain-headline {
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .brain-body {
    font-size: 0.75rem;
    color: var(--text-secondary);
    line-height: 1.55;
    margin: 0;
  }

  .brain-body em {
    font-style: italic;
    color: var(--text);
    font-weight: 500;
  }

  .brain-runtime {
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    line-height: 1.55;
    border-top: 1px solid var(--border);
    padding-top: 0.5rem;
    margin-top: auto;
  }

  .brain-runtime strong {
    color: var(--text-secondary);
  }

  .brain-vs {
    font-size: 0.625rem;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    align-self: center;
    padding: 0 0.25rem;
  }

  .metaphor {
    background: var(--bg);
    border-left: 2px solid var(--vermillon);
    padding: 0.75rem 1rem;
    font-size: 0.75rem;
    color: var(--text-secondary);
    line-height: 1.6;
  }
  .metaphor strong { color: var(--text); font-weight: 600; }
  .metaphor em { font-style: italic; color: var(--text); font-weight: 500; }

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

  .timeline-content { flex: 1; }

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

  /* Knowledge / brain tabs cards */
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

  .knowledge-card:hover { border-color: var(--text-tertiary); }
  .knowledge-card.active { border-color: var(--text-secondary); }

  .knowledge-card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .knowledge-card-left { flex: 1; }

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

  .knowledge-card-desc em {
    color: var(--text-secondary);
    font-style: normal;
    font-weight: 500;
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

  .feedback-body { flex: 1; }

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

  @media (max-width: 600px) {
    .guide-page { padding: 1.25rem 1rem 3rem; }
    .guide-header { margin-bottom: 2rem; }
    .guide-section { margin-bottom: 2.5rem; }
    .timeline-header { flex-direction: column; gap: 0.125rem; }
    .brain-compare {
      grid-template-columns: 1fr;
      gap: 0.5rem;
    }
    .brain-vs {
      align-self: center;
      padding: 0.25rem 0;
    }
  }
</style>
