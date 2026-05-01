<script>
  // Setclone — landing commerciale publique.
  // Audience : Heads of Setter d'agences ghostwriting + setting LinkedIn.
  // Pitch : capitaliser le travail des setters dans des clones qui apprennent.

  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { accessCode, sessionToken, isAdmin, clientName } from "$lib/stores/auth.js";

  const FOUNDER_CTA = "mailto:a.brakha@challengerslab.com?subject=30%20min%20avec%20le%20founder%20-%20Setclone";

  let openFaq = $state(null);

  function pickPersona(personas) {
    if (!Array.isArray(personas) || personas.length === 0) return null;
    try {
      const lastId = localStorage.getItem("setclone_last_persona") || localStorage.getItem("vc_last_persona");
      if (lastId) {
        const match = personas.find((p) => p.id === lastId);
        if (match) return match;
        localStorage.removeItem("setclone_last_persona");
        localStorage.removeItem("vc_last_persona");
      }
    } catch {}
    return personas[0];
  }

  async function resolveHome() {
    try {
      const headers = {};
      if ($accessCode) headers["x-access-code"] = $accessCode;
      if ($sessionToken) headers["x-session-token"] = $sessionToken;
      const resp = await fetch("/api/personas", { headers });
      if (!resp.ok) return "/create";
      const data = await resp.json();
      isAdmin.set(!!data.isAdmin);
      if (data.clientName) clientName.set(data.clientName);
      const target = pickPersona(data.personas);
      return target ? `/chat/${target.id}` : "/create";
    } catch {
      return "/create";
    }
  }

  onMount(async () => {
    if ($accessCode || $sessionToken) {
      const dest = await resolveHome();
      goto(dest);
    }
  });

  function toggleFaq(idx) {
    openFaq = openFaq === idx ? null : idx;
  }

  const PAINS = [
    {
      tag: "01 · FORMATION",
      title: "Trop de docs pour former un setter",
      promise: "Le clone retient ce qui est dans la doc. Plus de manuel à lire avant de drafter."
    },
    {
      tag: "02 · COPIER-COLLER",
      title: "Heures perdues à retrouver le bon template",
      promise: "Chaque correction forme le clone. Plus jamais à réexpliquer."
    },
    {
      tag: "03 · MANAGEMENT",
      title: "Vous relisez tout, vous recadrez tout",
      promise: "Vous arbitrez les propositions du système. Le copier-coller, c'est plus votre problème."
    },
    {
      tag: "04 · DRIFT",
      title: "Vos setters sortent des règles sans que vous le voyiez",
      promise: "Règles client et agence écrites une fois, vérifiables, qui ne bougent qu'avec votre accord."
    }
  ];

  const FAQS = [
    {
      q: "Mes setters perdent-ils leur sens du métier ?",
      a: "Non. Le clone propose, le setter décide. Vous gardez la main sur le ton, le choix des prospects et la stratégie. Setclone supprime le copier-coller et la répétition de règles, pas le jugement."
    },
    {
      q: "Comment trace-t-on qui a écrit quoi ?",
      a: "Chaque message porte sa signature : draft du clone, modifié par tel setter, validé par tel arbitre. L'historique complet est consultable, exportable et opposable."
    },
    {
      q: "Que se passe-t-il si un clone dérape sur un client ?",
      a: "Trois lectures avant chaque envoi : score shadow sur chaque draft, alerte soft sur dérive douce, blocage hard si une règle agence est violée. Aucun message ne sort sans avoir passé les 3 filtres."
    },
    {
      q: "À partir de quand on voit l'effet ?",
      a: "Dès les premières corrections. Chaque règle ajoutée par un setter s'applique au draft suivant — c'est l'effet immédiat. Pour le ROI sur le temps de management, on publiera les chiffres quand la cohorte bêta sera assez large pour être représentative."
    },
    {
      q: "Confidentialité des conversations client ?",
      a: "Les données sont stockées sur Supabase (région EU) et hébergées sur Vercel (région EU). Les corrections de votre agence restent isolées : elles ne fuitent jamais vers les clones d'autres agences."
    }
  ];
</script>

<svelte:head>
  <title>Setclone — un protocole vivant par clone, pour les agences multi-clients</title>
  <meta name="description" content="Un protocole vivant par clone : voix du client, playbooks de votre agence, arbitrages de vos setters. Versionné, vérifiable. Pour les agences ghostwriting, branding, growth qui pilotent une cellule setting LinkedIn sur plusieurs clients." />
</svelte:head>

<a href="#hero" class="skip-link">Aller au contenu</a>

<main class="landing">

  <header class="topbar">
    <a class="brand" href="/">
      <span class="brand-mark">◎</span>
      <span class="brand-name">Setclone</span>
    </a>
    <nav class="topbar-nav">
      <a href="#offres">Tarifs</a>
      <a href="#demo">Démo</a>
      <a class="top-cta" href="/login">accès client →</a>
    </nav>
  </header>

  <!-- ═══════ HERO — protocole-first ═══════ -->
  <section class="hero" id="hero">
    <div class="overline mono">
      ◇ ghostwriting · branding · growth — quand vos setters tournent sur plusieurs clients en parallèle
    </div>

    <h1 class="headline">
      Un protocole par clone.<br />
      Il s'épaissit à chaque correction.<br />
      Le prochain DM le respecte.
    </h1>

    <p class="sub">
      <strong>Voix du client</strong>, <strong>playbooks de votre agence</strong>, <strong>arbitrages de vos setters</strong> : tout converge dans un protocole versionné. Chaque correction l'enrichit, le draft suivant la respecte. Plus dans la tête d'un setter qui peut partir.
    </p>

    <div class="hero-cta">
      <a class="btn-primary" href={FOUNDER_CTA}>📅 30 min avec le founder</a>
      <a class="btn-ghost" href="#demo">▶ voir une boucle d'apprentissage</a>
    </div>

    <div class="trust-band">
      <span class="trust-label mono">— bêta privée · agences partenaires sous NDA · logos affichés à la sortie de bêta —</span>
    </div>
  </section>

  <!-- ═══════ 3 COUCHES — promu position #2 ═══════ -->
  <section class="asset" id="ontology" aria-labelledby="asset-title">
    <div class="section-kicker mono">◇ ce qu'il y a dedans</div>
    <h2 class="section-title" id="asset-title">
      Trois couches. Une seule voix par client.
    </h2>

    <div class="asset-layers">
      <div class="layer">
        <span class="layer-num mono">1</span>
        <div class="layer-body">
          <h3 class="layer-title">La voix du <span class="layer-actor">CLIENT</span></h3>
          <p>Captée à l'onboarding (90 min). Règles, ouvertures, cadence, signature, ton. N'évolue qu'avec son accord. C'est son bien, pas le vôtre.</p>
        </div>
      </div>

      <div class="layer layer-strong">
        <span class="layer-num mono">2</span>
        <div class="layer-body">
          <h3 class="layer-title">Les playbooks de l'<span class="layer-actor">AGENCE</span></h3>
          <p>Par <strong>type d'action outbound</strong> : DM, ajout de contact, interaction de contenu, listes outbound, spy, visite de profil. Construits par <strong>vous</strong>, à <strong>vous</strong>. Le savoir-faire que vous accumulez reste à l'agence, pas chez le client.</p>
        </div>
      </div>

      <div class="layer">
        <span class="layer-num mono">3</span>
        <div class="layer-body">
          <h3 class="layer-title">Les arbitrages du <span class="layer-actor">SETTER</span></h3>
          <p>Chaque correction quotidienne durcit le protocole. Plus jamais de « j'ai déjà dit ça la semaine dernière ». Le savoir-faire de votre meilleur setter devient celui de toute l'équipe.</p>
        </div>
      </div>
    </div>

    <p class="asset-punch">
      → Ce que vos setters apprennent reste chez <strong>vous</strong>.
      <br />Pas chez le client, pas dans la tête d'un setter qui peut partir.
    </p>
  </section>

  <!-- ═══════ 4 PAINS ═══════ -->
  <section class="pains" aria-labelledby="pains-title">
    <div class="section-kicker mono">◇ ce qu'on résout</div>
    <h2 class="section-title" id="pains-title">
      Les 4 douleurs de quiconque pilote des setters.
    </h2>

    <div class="pains-grid">
      {#each PAINS as pain}
        <article class="pain-card">
          <div class="pain-tag mono">{pain.tag}</div>
          <h3 class="pain-title">« {pain.title} »</h3>
          <p class="pain-promise"><span class="arrow">→</span> {pain.promise}</p>
        </article>
      {/each}
    </div>
  </section>

  <!-- ═══════ DÉMO — boucle d'apprentissage avec diff de protocole ═══════ -->
  <section class="demo" id="demo" aria-labelledby="demo-title">
    <div class="section-kicker mono">◇ une boucle d'apprentissage, en 3 temps</div>
    <h2 class="section-title" id="demo-title">
      Une correction de setter. Une règle dans le protocole. Un draft suivant qui s'aligne.
    </h2>
    <p class="demo-lede">
      Le setter corrige un draft. Le clone demande pourquoi. La règle entre dans le protocole, datée et portée. Le prochain DM la respecte sans qu'on la rappelle.
    </p>

    <div class="demo-flow">
      <div class="flow-step">
        <span class="flow-num mono">01</span>
        <div class="flow-card">
          <div class="flow-frame-bar mono"><span>◎</span><span>cockpit · DM relance</span></div>
          <div class="flow-frame-body">
            <span class="flow-meta mono">draft du clone</span>
            <p class="flow-bubble flow-draft">Sophie, je voulais juste vous relancer concernant notre échange. N'hésitez pas à revenir vers moi !</p>
            <span class="flow-meta mono">le setter corrige</span>
            <p class="flow-bubble flow-correction">Sophie, 7 jours sans nouvelles. 2 lignes : ça redescend dans la pile, ou un truc coince ?</p>
          </div>
        </div>
      </div>

      <div class="flow-step">
        <span class="flow-num mono">02</span>
        <div class="flow-card">
          <div class="flow-frame-bar mono"><span>◎</span><span>protocole · diff</span></div>
          <div class="flow-frame-body">
            <div class="flow-diff">
              <span class="flow-diff-meta mono">ce qui change</span>
              <div class="flow-diff-row removed">
                <span class="marker">−</span>
                <span>« N'hésitez pas » : toléré en relance.</span>
              </div>
              <div class="flow-diff-row added">
                <span class="marker">+</span>
                <span><strong>« N'hésitez pas »</strong> : interdit en relance.</span>
              </div>
              <div class="flow-diff-row added">
                <span class="marker">+</span>
                <span>Pattern relance : 2 hypothèses précises au prospect.</span>
              </div>
              <span class="flow-diff-meta mono">portée : agence · à partir de maintenant</span>
            </div>
          </div>
        </div>
      </div>

      <div class="flow-step">
        <span class="flow-num mono">03</span>
        <div class="flow-card">
          <div class="flow-frame-bar mono"><span>◎</span><span>cockpit · prochain DM</span></div>
          <div class="flow-frame-body">
            <span class="flow-meta mono">draft du clone, sans intervention</span>
            <p class="flow-bubble flow-draft-ok">Marc, 5 jours qu'on s'est croisés. 2 hypothèses : (1) ça a redescendu dans ta pile, (2) la stack t'a fait douter. Réponds-moi par un chiffre, je m'occupe du reste.</p>
            <span class="flow-tag mono">✓ règle « relance 2 hypothèses » appliquée automatiquement</span>
          </div>
        </div>
      </div>
    </div>

    <p class="demo-foot mono">
      <a href="/lab" class="demo-link">voir le pipeline observable →</a>
    </p>
  </section>

  <!-- ═══════ 3 LECTURES (recadré : pas trois censures, trois angles) ═══════ -->
  <section class="guards" aria-labelledby="guards-title">
    <div class="section-kicker mono">◇ trois lectures, en parallèle</div>
    <h2 class="section-title" id="guards-title">
      Avant chaque envoi, le système relit trois fois.
    </h2>
    <p class="guards-lede">
      Trois angles, pas trois censures : score, voix, règle. Le setter décide. Le système l'a déjà relu.
    </p>

    <div class="guards-grid">
      <article class="guard-card">
        <div class="guard-tag mono">SHADOW</div>
        <h3 class="guard-title">Score, sans bloquer.</h3>
        <p class="guard-body">Chaque draft est noté en arrière-plan. Aucun blocage : juste une trace que le système relit ensuite pour ajuster les drafts suivants.</p>
      </article>

      <article class="guard-card">
        <div class="guard-tag mono">🔓 SOFT</div>
        <h3 class="guard-title">Alerte, si la voix dérive.</h3>
        <p class="guard-body">Quand un draft commence à s'écarter de la voix du client (cliché IA, tournure générique), le setter voit l'alerte et choisit : ignorer, réécrire, ou ajouter une règle.</p>
      </article>

      <article class="guard-card">
        <div class="guard-tag mono">🔒 HARD</div>
        <h3 class="guard-title">Bloque et propose un rewrite, si une règle agence est violée.</h3>
        <p class="guard-body">Mot interdit, tournure bannie, signature mal placée : le système bloque l'envoi et propose une réécriture. La règle est tracée et vérifiable.</p>
      </article>
    </div>
  </section>

  <!-- ═══════ MÉTRIQUES (placeholder honnête) ═══════ -->
  <section class="metrics" aria-labelledby="metrics-title">
    <div class="section-kicker mono">◇ état d'avancement</div>
    <h2 class="section-title" id="metrics-title">
      En bêta privée. Premiers retours d'agences.
    </h2>
    <p class="metrics-body">
      Setclone est en cours de déploiement chez les premières agences partenaires.
      Les chiffres seront publiés ici dès que la cohorte de bêta sera assez large
      pour être représentative.
    </p>
    <p class="metrics-foot mono">
      → vous voulez en faire partie ? <a href={FOUNDER_CTA}>30 min avec le founder →</a>
    </p>
  </section>

  <!-- ═══════ TESTIMONIAL ═══════ -->
  <section class="testimonial" aria-labelledby="testimonial-title">
    <div class="section-kicker mono">◇ ce qu'on entend en discovery</div>
    <blockquote class="testimonial-quote">
      <p>« Avant : recadrer plusieurs versions de la même relance, semaine après semaine. La cadence J+3/J+7, les ouvertures, les signatures. Aujourd'hui chaque clone a son protocole. La règle est posée une fois, le draft suivant l'applique. Mes setters tapent dedans. Mes clients ne sentent plus la différence entre eux. »</p>
      <footer>
        <span class="testimonial-who">Scénario type</span>
        <span class="testimonial-where mono">synthèse de plusieurs discoveries — vrais témoignages affichés en sortie de bêta</span>
      </footer>
    </blockquote>
  </section>

  <!-- ═══════ OFFRES ═══════ -->
  <section class="offres" id="offres" aria-labelledby="offres-title">
    <div class="section-kicker mono">◇ tarifs</div>
    <h2 class="section-title" id="offres-title">
      3 packs, calibrés sur la taille de votre cellule setting.
    </h2>

    <div class="offres-grid">
      <article class="offre-card">
        <header class="offre-head">
          <h3 class="offre-name">Solo</h3>
          <span class="offre-meta mono">1 setter · 1-3 clones</span>
        </header>
        <p class="offre-body">Pour démarrer en solo ou tester l'outil. Le clone capte la voix du 1er client dès les premières corrections.</p>
        <p class="offre-price mono">sur devis</p>
        <a class="offre-cta" href={FOUNDER_CTA}>en parler →</a>
      </article>

      <article class="offre-card offre-highlight">
        <header class="offre-head">
          <h3 class="offre-name">Cellule</h3>
          <span class="offre-meta mono">3-5 setters · 5-15 clones</span>
        </header>
        <p class="offre-body">Pour les agences qui scalent. Vos setters montent en autonomie, vous reprenez la main sur le pilotage.</p>
        <p class="offre-price mono">sur devis</p>
        <a class="offre-cta" href={FOUNDER_CTA}>en parler →</a>
      </article>

      <article class="offre-card">
        <header class="offre-head">
          <h3 class="offre-name">Studio</h3>
          <span class="offre-meta mono">6+ setters · 15+ clones</span>
        </header>
        <p class="offre-body">Pour les agences avec une cellule setting structurée. Intégration à votre stack outbound, gouvernance multi-clients.</p>
        <p class="offre-price mono">sur devis</p>
        <a class="offre-cta" href={FOUNDER_CTA}>en parler →</a>
      </article>
    </div>
  </section>

  <!-- ═══════ FAQ ═══════ -->
  <section class="faq" aria-labelledby="faq-title">
    <div class="section-kicker mono">◇ objections fréquentes</div>
    <h2 class="section-title" id="faq-title">
      Les questions qu'on nous pose, en vrai.
    </h2>

    <ul class="faq-list">
      {#each FAQS as item, i}
        <li class="faq-item" class:faq-open={openFaq === i}>
          <button class="faq-q" type="button" onclick={() => toggleFaq(i)} aria-expanded={openFaq === i}>
            <span class="faq-arrow mono">{openFaq === i ? "▾" : "▸"}</span>
            {item.q}
          </button>
          {#if openFaq === i}
            <p class="faq-a">{item.a}</p>
          {/if}
        </li>
      {/each}
    </ul>
  </section>

  <!-- ═══════ FOOTER ═══════ -->
  <footer class="foot">
    <div class="foot-brand">
      <span class="brand-mark">◎</span>
      <span class="brand-name">Setclone</span>
    </div>
    <div class="foot-links">
      <a href={FOUNDER_CTA}>contact</a>
      <a href="/lab">le pipeline</a>
      <a href="/login" class="foot-login">déjà client ? →</a>
    </div>
    <div class="foot-legal mono">
      Setclone · Paris
    </div>
  </footer>
</main>

<style>
  .landing {
    min-height: 100dvh;
    background:
      linear-gradient(var(--grid) 1px, transparent 1px) 0 0 / 100% 24px,
      var(--paper);
    color: var(--ink);
    font-family: var(--font-ui);
    display: flex;
    flex-direction: column;
  }

  .skip-link {
    position: absolute; left: -9999px; top: 0;
    background: var(--ink); color: var(--paper);
    padding: 8px 12px; font-family: var(--font-mono); font-size: 12px;
  }
  .skip-link:focus { left: 12px; top: 12px; z-index: 100; }

  .mono { font-family: var(--font-mono); }

  /* ───────── Topbar ───────── */
  .topbar {
    display: flex; justify-content: space-between; align-items: center;
    gap: 20px;
    padding: 12px 28px;
    border-bottom: 1px solid var(--rule-strong);
    font-family: var(--font-mono);
    font-size: 12.5px;
    position: sticky;
    top: 0;
    background: var(--paper);
    z-index: 10;
  }
  .brand { display: inline-flex; align-items: baseline; gap: 8px; text-decoration: none; }
  .brand-mark { color: var(--vermillon); font-size: 14px; }
  .brand-name { font-weight: 600; color: var(--ink); letter-spacing: 0.01em; }

  .topbar-nav {
    display: inline-flex;
    align-items: center;
    gap: 24px;
  }
  .topbar-nav a {
    color: var(--ink-70);
    text-decoration: none;
    transition: color var(--dur-fast, 120ms) var(--ease, ease);
  }
  .topbar-nav a:hover { color: var(--vermillon); }
  .top-cta {
    color: var(--ink) !important;
    border-bottom: 1px solid var(--vermillon);
    padding-bottom: 2px;
  }

  /* ───────── Section primitives ───────── */
  .section-kicker {
    font-size: 11px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    margin-bottom: 12px;
  }
  .section-title {
    font-family: var(--font);
    font-weight: 400;
    font-size: clamp(24px, 3.4vw, 38px);
    line-height: 1.12;
    letter-spacing: -0.018em;
    color: var(--ink);
    margin: 0 0 24px;
    max-width: 28ch;
  }

  /* ───────── HERO ───────── */
  .hero {
    padding: 56px 28px 44px;
    max-width: var(--max-width, 1200px);
    margin: 0 auto;
    width: 100%;
  }
  .overline {
    font-size: 11px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    margin-bottom: 18px;
  }
  .headline {
    font-family: var(--font);
    font-weight: 400;
    font-size: clamp(36px, 6vw, 68px);
    line-height: 1.05;
    letter-spacing: -0.022em;
    color: var(--ink);
    margin: 0 0 24px;
    max-width: 22ch;
  }

  .sub {
    font-size: 17px;
    color: var(--ink-70);
    line-height: 1.55;
    max-width: 64ch;
    margin: 0 0 32px;
  }
  .sub strong { color: var(--ink); font-weight: 600; }
  .sub em { color: var(--ink); font-style: italic; }

  .hero-cta {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 14px;
    margin-bottom: 36px;
  }
  .btn-primary {
    display: inline-block;
    padding: 14px 22px;
    background: var(--ink);
    color: var(--paper);
    border: 1px solid var(--ink);
    text-decoration: none;
    font-family: var(--font-mono);
    font-size: 13px;
    letter-spacing: 0.01em;
    transition: background var(--dur-fast, 120ms) var(--ease, ease),
                border-color var(--dur-fast, 120ms) var(--ease, ease);
  }
  .btn-primary:hover {
    background: var(--vermillon);
    border-color: var(--vermillon);
  }
  .btn-ghost {
    display: inline-block;
    padding: 14px 22px;
    background: transparent;
    color: var(--ink);
    border: 1px solid var(--rule-strong);
    text-decoration: none;
    font-family: var(--font-mono);
    font-size: 13px;
    transition: border-color var(--dur-fast, 120ms) var(--ease, ease),
                color var(--dur-fast, 120ms) var(--ease, ease);
  }
  .btn-ghost:hover { border-color: var(--vermillon); color: var(--vermillon); }

  .trust-band {
    border-top: 1px solid var(--rule);
    padding-top: 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: flex-start;
  }
  .trust-label {
    font-size: 11px;
    color: var(--ink-40);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  /* ───────── PAINS ───────── */
  .pains {
    padding: 56px 28px;
    max-width: var(--max-width, 1200px);
    margin: 0 auto;
    width: 100%;
    border-top: 1px solid var(--rule-strong);
  }
  .pains-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0;
    border-top: 1px solid var(--rule-strong);
    border-left: 1px solid var(--rule-strong);
  }
  .pain-card {
    padding: 22px 22px 24px;
    border-right: 1px solid var(--rule-strong);
    border-bottom: 1px solid var(--rule-strong);
  }
  .pain-tag {
    font-size: 10.5px;
    color: var(--vermillon);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    margin-bottom: 10px;
  }
  .pain-title {
    font-family: var(--font);
    font-weight: 400;
    font-style: italic;
    font-size: 19px;
    color: var(--ink);
    line-height: 1.3;
    margin: 0 0 14px;
  }
  .pain-promise {
    font-size: 14.5px;
    color: var(--ink-70);
    line-height: 1.5;
    margin: 0;
  }
  .pain-promise .arrow { color: var(--vermillon); margin-right: 4px; }

  /* ───────── DÉMO ───────── */
  .demo {
    padding: 56px 28px;
    max-width: var(--max-width, 1200px);
    margin: 0 auto;
    width: 100%;
    border-top: 1px solid var(--rule-strong);
  }
  .demo-lede {
    font-size: 15.5px;
    color: var(--ink-70);
    line-height: 1.6;
    max-width: 60ch;
    margin: 0 0 28px;
  }
  .demo-flow {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 18px;
  }
  .flow-step {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .flow-num {
    font-size: 11px;
    color: var(--ink-40);
    letter-spacing: 0.12em;
  }
  .flow-card {
    background: var(--paper);
    border: 1px solid var(--rule-strong);
    box-shadow: 0 6px 20px rgba(0,0,0,0.04);
    overflow: hidden;
    min-height: 220px;
    display: flex;
    flex-direction: column;
  }
  .flow-frame-bar {
    display: flex; gap: 8px; align-items: center;
    padding: 7px 12px;
    border-bottom: 1px dashed var(--rule);
    font-size: 10.5px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .flow-frame-bar span:first-child { color: var(--vermillon); }
  .flow-frame-body {
    padding: 14px;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .flow-meta {
    font-size: 10.5px;
    color: var(--ink-40);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .flow-bubble {
    padding: 10px 12px;
    font-size: 13.5px;
    line-height: 1.5;
    color: var(--ink);
    border: 1px solid var(--rule);
    margin: 0;
    background: var(--paper);
  }
  .flow-draft { background: var(--paper-subtle, #f6f5f1); color: var(--ink-70); font-style: italic; }
  .flow-correction { border-left: 2px solid var(--vermillon); color: var(--ink); }
  .flow-draft-ok { border-left: 2px solid #2d8659; }
  .flow-tag {
    font-size: 11px;
    color: #2d8659;
    letter-spacing: 0.04em;
    margin-top: 4px;
  }
  /* DIFF de protocole (V2 — remplace flow-rule en step 02) */
  .flow-diff {
    padding: 12px;
    background: var(--paper-subtle, #f6f5f1);
    border-left: 2px solid var(--vermillon);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .flow-diff-row {
    display: grid;
    grid-template-columns: 14px 1fr;
    gap: 8px;
    font-size: 13px;
    line-height: 1.45;
    align-items: baseline;
  }
  .flow-diff-row .marker {
    font-family: var(--font-mono);
    font-weight: 600;
    text-align: center;
  }
  .flow-diff-row.removed {
    color: var(--ink-70);
    text-decoration: line-through;
    text-decoration-color: var(--ink-40);
    text-decoration-thickness: 1px;
  }
  .flow-diff-row.removed .marker { color: var(--ink-40); }
  .flow-diff-row.added { color: var(--ink); }
  .flow-diff-row.added .marker { color: var(--vermillon); }
  .flow-diff-row.added strong { color: var(--vermillon); font-weight: 600; }
  .flow-diff-meta {
    font-size: 10.5px;
    color: var(--ink-70);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-top: 2px;
  }
  .demo-foot {
    margin-top: 24px;
    font-size: 12px;
    color: var(--ink-40);
  }
  .demo-link {
    color: var(--ink);
    text-decoration: none;
    border-bottom: 1px dashed var(--vermillon);
    margin-left: 8px;
  }
  .demo-link:hover { color: var(--vermillon); }

  /* ───────── GUARDS / 3 LECTURES ───────── */
  .guards {
    padding: 56px 28px;
    max-width: var(--max-width, 1200px);
    margin: 0 auto;
    width: 100%;
    border-top: 1px solid var(--rule-strong);
  }
  .guards-lede {
    font-size: 15.5px;
    color: var(--ink-70);
    line-height: 1.6;
    max-width: 60ch;
    margin: 0 0 28px;
  }
  .guards-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 18px;
  }
  .guard-card {
    padding: 22px;
    background: var(--paper);
    border: 1px solid var(--rule-strong);
  }
  .guard-tag {
    display: inline-block;
    padding: 4px 8px;
    background: var(--paper-subtle, #f6f5f1);
    border: 1px solid var(--rule);
    font-size: 11px;
    color: var(--ink);
    letter-spacing: 0.08em;
    margin-bottom: 14px;
  }
  .guard-title {
    font-family: var(--font);
    font-weight: 500;
    font-style: italic;
    font-size: 18px;
    color: var(--vermillon);
    line-height: 1.3;
    margin: 0 0 10px;
  }
  .guard-body {
    font-size: 14px;
    color: var(--ink-70);
    line-height: 1.55;
    margin: 0;
  }

  /* ───────── ASSET / 3 LAYERS ───────── */
  .asset {
    padding: 56px 28px;
    max-width: var(--max-width, 1200px);
    margin: 0 auto;
    width: 100%;
    border-top: 1px solid var(--rule-strong);
  }
  .asset-layers {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--rule-strong);
  }
  .layer {
    display: grid;
    grid-template-columns: 80px 1fr;
    gap: 24px;
    padding: 22px 24px;
    border-bottom: 1px solid var(--rule);
  }
  .layer:last-child { border-bottom: none; }
  .layer-strong {
    background: var(--paper-subtle, #f6f5f1);
  }
  .layer-num {
    font-family: var(--font);
    font-size: 40px;
    color: var(--vermillon);
    line-height: 1;
    font-style: italic;
  }
  .layer-title {
    font-family: var(--font);
    font-weight: 400;
    font-size: 21px;
    color: var(--ink);
    margin: 0 0 8px;
    letter-spacing: -0.01em;
  }
  .layer-actor {
    font-size: 12.5px;
    color: var(--vermillon);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    font-family: var(--font-mono);
    margin-left: 6px;
    vertical-align: middle;
  }
  .layer-body p {
    font-size: 14.5px;
    color: var(--ink-70);
    line-height: 1.6;
    margin: 0;
    max-width: 70ch;
  }
  .layer-body strong { color: var(--ink); font-weight: 600; }
  .asset-punch {
    margin-top: 24px;
    font-family: var(--font);
    font-size: clamp(18px, 2.4vw, 24px);
    font-style: italic;
    color: var(--ink);
    line-height: 1.4;
    letter-spacing: -0.005em;
  }
  .asset-punch strong { color: var(--vermillon); font-weight: 500; }

  /* ───────── METRICS placeholder ───────── */
  .metrics {
    padding: 48px 28px;
    max-width: var(--max-width, 1200px);
    margin: 0 auto;
    width: 100%;
    border-top: 1px solid var(--rule-strong);
  }
  .metrics-body {
    font-size: 15.5px;
    color: var(--ink-70);
    line-height: 1.6;
    max-width: 60ch;
    margin: 0 0 16px;
  }
  .metrics-foot {
    font-size: 12.5px;
    color: var(--ink-40);
  }
  .metrics-foot a {
    color: var(--ink);
    border-bottom: 1px dashed var(--vermillon);
    text-decoration: none;
  }
  .metrics-foot a:hover { color: var(--vermillon); }

  /* ───────── TESTIMONIAL ───────── */
  .testimonial {
    padding: 56px 28px;
    max-width: var(--max-width, 1200px);
    margin: 0 auto;
    width: 100%;
    border-top: 1px solid var(--rule-strong);
  }
  .testimonial-quote {
    margin: 0;
    padding: 32px;
    border-left: 3px solid var(--vermillon);
    background: var(--paper-subtle, #f6f5f1);
  }
  .testimonial-quote p {
    font-family: var(--font);
    font-style: italic;
    font-size: clamp(18px, 2.2vw, 22px);
    line-height: 1.45;
    color: var(--ink);
    margin: 0 0 18px;
    max-width: 56ch;
    letter-spacing: -0.005em;
  }
  .testimonial-quote em { color: var(--vermillon); font-style: italic; }
  .testimonial-quote footer {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 13px;
    color: var(--ink-70);
  }
  .testimonial-who { font-weight: 600; color: var(--ink); }
  .testimonial-where { font-size: 11.5px; color: var(--ink-40); letter-spacing: 0.04em; }

  /* ───────── OFFRES ───────── */
  .offres {
    padding: 56px 28px;
    max-width: var(--max-width, 1200px);
    margin: 0 auto;
    width: 100%;
    border-top: 1px solid var(--rule-strong);
  }
  .offres-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
  }
  .offre-card {
    padding: 24px;
    background: var(--paper);
    border: 1px solid var(--rule-strong);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .offre-highlight {
    border-color: var(--vermillon);
    box-shadow: 0 8px 28px rgba(214, 73, 51, 0.08);
  }
  .offre-head {
    border-bottom: 1px solid var(--rule);
    padding-bottom: 12px;
  }
  .offre-name {
    font-family: var(--font);
    font-weight: 400;
    font-style: italic;
    font-size: 26px;
    color: var(--vermillon);
    margin: 0 0 4px;
  }
  .offre-meta {
    font-size: 11px;
    color: var(--ink-40);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .offre-body {
    font-size: 14px;
    color: var(--ink-70);
    line-height: 1.55;
    margin: 0;
    flex: 1;
  }
  .offre-price {
    font-size: 13px;
    color: var(--ink);
    margin: 0;
    font-weight: 600;
  }
  .offre-cta {
    align-self: flex-start;
    color: var(--ink);
    text-decoration: none;
    border-bottom: 1px solid var(--vermillon);
    padding-bottom: 2px;
    font-family: var(--font-mono);
    font-size: 12.5px;
  }
  .offre-cta:hover { color: var(--vermillon); }

  /* ───────── FAQ ───────── */
  .faq {
    padding: 56px 28px;
    max-width: var(--max-width, 1200px);
    margin: 0 auto;
    width: 100%;
    border-top: 1px solid var(--rule-strong);
  }
  .faq-list {
    list-style: none;
    padding: 0;
    margin: 0;
    border-top: 1px solid var(--rule-strong);
  }
  .faq-item {
    border-bottom: 1px solid var(--rule);
  }
  .faq-q {
    width: 100%;
    text-align: left;
    padding: 16px 0;
    background: none;
    border: none;
    color: var(--ink);
    font-family: var(--font);
    font-size: 17px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 12px;
    line-height: 1.4;
  }
  .faq-q:hover { color: var(--vermillon); }
  .faq-arrow {
    color: var(--vermillon);
    font-size: 12px;
    width: 16px;
    flex-shrink: 0;
  }
  .faq-a {
    padding: 0 0 18px 28px;
    font-size: 14.5px;
    color: var(--ink-70);
    line-height: 1.6;
    margin: 0;
    max-width: 70ch;
  }

  /* ───────── FOOTER ───────── */
  .foot {
    padding: 28px;
    border-top: 1px solid var(--rule-strong);
    max-width: var(--max-width, 1200px);
    margin: 0 auto;
    width: 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink-40);
  }
  .foot-brand {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
  }
  .foot-links {
    display: inline-flex;
    gap: 18px;
    flex-wrap: wrap;
  }
  .foot-links a {
    color: var(--ink-70);
    text-decoration: none;
    border-bottom: 1px dashed transparent;
    transition: color var(--dur-fast, 120ms) var(--ease, ease),
                border-color var(--dur-fast, 120ms) var(--ease, ease);
  }
  .foot-links a:hover {
    color: var(--vermillon);
    border-bottom-color: var(--vermillon);
  }
  .foot-login { color: var(--ink) !important; }
  .foot-legal { font-size: 10.5px; }

  /* ───────── Responsive ───────── */
  @media (max-width: 760px) {
    .pains-grid,
    .demo-flow,
    .guards-grid,
    .offres-grid {
      grid-template-columns: 1fr;
    }
    .layer {
      grid-template-columns: 60px 1fr;
      gap: 16px;
    }
    .layer-num { font-size: 32px; }
    .topbar-nav { gap: 14px; }
    .topbar-nav a:not(.top-cta) { display: none; }
  }
</style>
