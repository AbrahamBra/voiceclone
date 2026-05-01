<script>
  // Politique de confidentialite — minimum viable RGPD article 13.
  // Honnete sur l'audit en cours, sous-traitants nommes, droits enumeres.
  // Mise a jour : 2026-05-01.
</script>

<svelte:head>
  <title>Confidentialité · Setclone</title>
  <meta name="description" content="Politique de confidentialité Setclone — données traitées, sous-traitants, droits RGPD." />
</svelte:head>

<main class="legal">
  <header class="legal-head">
    <a class="back" href="/">← Setclone</a>
    <h1>Politique de confidentialité</h1>
    <p class="legal-meta mono">Dernière mise à jour : 1<sup>er</sup> mai 2026</p>
  </header>

  <section>
    <h2>En une phrase</h2>
    <p>
      Setclone aide les agences de ghostwriting à drafter des messages LinkedIn pour leurs clients. Pour ça nous traitons des données fournies par vous (posts LinkedIn, conversations DM, corrections). Cette page décrit ce que nous faisons de ces données, qui les voit, et comment vous reprenez la main dessus.
    </p>
    <div class="callout">
      <strong>Audit RGPD en cours.</strong> Setclone est en phase bêta privée. Notre conformité RGPD est en cours d'audit externe (été 2026). Cette page reflète la situation actuelle de manière honnête : ne lisez pas « certifié RGPD » là où nous écrivons « en conformité ».
    </div>
  </section>

  <section>
    <h2>Responsable de traitement</h2>
    <p>
      <strong>Setclone</strong>, basé à Paris, France.<br>
      Contact général et exercice des droits : <a href="mailto:contact@setclone.app">contact@setclone.app</a><br>
      L'identité juridique complète (forme sociale, RCS, SIREN) sera publiée à la sortie de la bêta privée. Disponible sur demande à l'adresse ci-dessus pendant la phase bêta.
    </p>
  </section>

  <section>
    <h2>Données que nous traitons</h2>
    <ul>
      <li><strong>Compte</strong> : code d'accès, nom de l'agence, clé API Anthropic chiffrée si vous fournissez la vôtre.</li>
      <li><strong>Persona du clone</strong> : nom, titre, avatar, bio, posts LinkedIn que vous nous fournissez, doctrine opérationnelle uploadée.</li>
      <li><strong>Conversations</strong> : messages échangés via le chat Setclone, drafts générés, corrections setter, propositions de règles, retours validés/rejetés.</li>
      <li><strong>Logs techniques</strong> : usage tokens, coût par message, événements d'apprentissage. Pas de cookie tiers, pas de tracking publicitaire.</li>
    </ul>
    <p>
      Nous ne traitons pas de catégories particulières (article 9 RGPD) sauf si vous décidez d'uploader un document qui en contient — ce qui relèverait alors de votre responsabilité au titre de la base légale.
    </p>
  </section>

  <section>
    <h2>Pourquoi nous les traitons (finalités &amp; bases légales)</h2>
    <ul>
      <li><strong>Exécution du contrat</strong> (article 6.1.b RGPD) : faire fonctionner le service — créer le clone, générer les drafts, persister les conversations.</li>
      <li><strong>Intérêt légitime</strong> (article 6.1.f) : améliorer la qualité du clone via la consolidation des corrections en règles. Vous pouvez vous opposer à cet usage en nous écrivant.</li>
      <li><strong>Obligation légale</strong> (article 6.1.c) : conservation des logs facturation pour les durées légales fiscales et comptables.</li>
    </ul>
  </section>

  <section>
    <h2>Sous-traitants et transferts hors UE</h2>
    <p>
      Setclone fait appel aux sous-traitants suivants. Nous avons signé avec chacun les clauses contractuelles types ou un Data Processing Addendum (DPA) là où c'est requis.
    </p>
    <table class="subprocessors">
      <thead>
        <tr><th>Sous-traitant</th><th>Rôle</th><th>Localisation</th><th>Transfert</th></tr>
      </thead>
      <tbody>
        <tr><td>Supabase</td><td>Base de données + stockage</td><td>Francfort (UE)</td><td>Pas de transfert hors UE</td></tr>
        <tr><td>Vercel</td><td>Hébergement applicatif</td><td>États-Unis (régions globales)</td><td>Clauses contractuelles types</td></tr>
        <tr><td>Anthropic</td><td>Génération LLM (Claude)</td><td>États-Unis</td><td>Clauses contractuelles types · DPA signé</td></tr>
        <tr><td>Voyage AI</td><td>Embeddings vectoriels</td><td>États-Unis</td><td>Clauses contractuelles types</td></tr>
        <tr><td>LinkdAPI</td><td>Scraping LinkedIn (optionnel)</td><td>États-Unis</td><td>Clauses contractuelles types</td></tr>
      </tbody>
    </table>
    <p class="footnote">
      La liste à jour des sous-traitants est tenue à disposition sur demande à <a href="mailto:contact@setclone.app">contact@setclone.app</a>.
    </p>
  </section>

  <section>
    <h2>Combien de temps</h2>
    <ul>
      <li>Compte actif : tant que le compte est actif.</li>
      <li>Compte désactivé via <code>/api/account/delete</code> ou demande email : suppression logique immédiate (compte verrouillé, clés API purgées, nom anonymisé). Le hard delete complet — y compris messages, logs d'usage, événements d'apprentissage — est en cours d'implémentation et sera disponible avant la sortie de la bêta privée.</li>
      <li>Logs facturation : 10 ans (obligation comptable et fiscale française).</li>
    </ul>
  </section>

  <section>
    <h2>Vos droits</h2>
    <p>
      Au titre du RGPD, vous disposez des droits suivants. Pour les exercer, écrivez à <a href="mailto:contact@setclone.app">contact@setclone.app</a> en précisant le compte concerné.
    </p>
    <ul>
      <li><strong>Droit d'accès</strong> et de rectification (articles 15 et 16).</li>
      <li><strong>Droit à l'effacement</strong> (article 17). Soft-delete immédiat via <code>POST /api/account/delete</code>. Hard-delete sur demande pendant la bêta, automatisé après.</li>
      <li><strong>Droit à la limitation</strong> du traitement (article 18).</li>
      <li><strong>Droit à la portabilité</strong> (article 20). Export JSON sur demande pendant la bêta.</li>
      <li><strong>Droit d'opposition</strong> (article 21), notamment au traitement fondé sur l'intérêt légitime (consolidation des corrections).</li>
      <li><strong>Droit de retirer votre consentement</strong> à tout moment.</li>
      <li><strong>Droit d'introduire une réclamation</strong> auprès de la CNIL : <a href="https://www.cnil.fr" target="_blank" rel="noopener">cnil.fr</a>.</li>
    </ul>
  </section>

  <section>
    <h2>Décision automatisée</h2>
    <p>
      Le clone Setclone produit des drafts via un LLM. Aucun de ces drafts n'est envoyé à un destinataire final sans validation humaine — le setter relit, corrige, copie. Il n'y a donc pas de décision juridiquement contraignante automatisée au sens de l'article 22 RGPD.
    </p>
  </section>

  <section>
    <h2>Sécurité</h2>
    <p>
      Données chiffrées en transit (TLS) et au repos pour Supabase. Authentification par code d'accès ou jeton de session expirant. Le chiffrement applicatif des messages stockés (DMs LinkedIn) est en cours d'implémentation et sera annoncé dans les notes de version. Si vous voulez le détail technique, écrivez-nous.
    </p>
  </section>

  <section>
    <h2>Modifications</h2>
    <p>
      Nous mettrons à jour cette page si les sous-traitants, les durées de conservation ou les bases légales changent. La date en haut de page reflète la dernière révision. Pendant la bêta, les changements significatifs vous sont communiqués par email.
    </p>
  </section>

  <footer class="legal-foot mono">
    <a href="/terms">CGU</a>
    <span class="sep">·</span>
    <a href="/">retour à l'accueil</a>
  </footer>
</main>

<style>
  .legal {
    max-width: 720px;
    margin: 0 auto;
    padding: 3rem 1.5rem 4rem;
    color: var(--ink, #1a1a1a);
    line-height: 1.6;
  }
  .legal-head {
    margin-bottom: 2.5rem;
    border-bottom: 1px solid var(--rule-strong, #d8d4ce);
    padding-bottom: 1.5rem;
  }
  .back {
    display: inline-block;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.75rem;
    color: var(--ink-60, #555);
    margin-bottom: 1rem;
    text-decoration: none;
  }
  .back:hover { color: var(--ink, #1a1a1a); }
  h1 {
    font-size: 1.875rem;
    font-weight: 500;
    margin: 0 0 0.5rem;
    letter-spacing: -0.02em;
  }
  .legal-meta {
    font-size: 0.75rem;
    color: var(--ink-60, #555);
    margin: 0;
  }
  section {
    margin-bottom: 2.25rem;
  }
  h2 {
    font-size: 1.125rem;
    font-weight: 600;
    margin: 0 0 0.75rem;
    letter-spacing: -0.01em;
  }
  p {
    margin: 0 0 0.75rem;
  }
  ul {
    margin: 0 0 0.75rem;
    padding-left: 1.25rem;
  }
  li {
    margin-bottom: 0.4rem;
  }
  code {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.85em;
    background: var(--paper-subtle, #f4f1ec);
    padding: 1px 5px;
    border-radius: 2px;
  }
  .callout {
    background: var(--paper-subtle, #f4f1ec);
    border-left: 3px solid var(--vermillon, #c14a2c);
    padding: 0.875rem 1rem;
    margin: 1rem 0;
    font-size: 0.95em;
  }
  .subprocessors {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
    margin: 0.5rem 0 1rem;
  }
  .subprocessors th, .subprocessors td {
    text-align: left;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--rule-strong, #d8d4ce);
  }
  .subprocessors th {
    font-weight: 600;
    background: var(--paper-subtle, #f4f1ec);
  }
  .footnote {
    font-size: 0.85rem;
    color: var(--ink-70, #444);
  }
  .legal-foot {
    margin-top: 3rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--rule-strong, #d8d4ce);
    font-size: 0.75rem;
    color: var(--ink-60, #555);
  }
  .legal-foot a {
    color: var(--ink-70, #444);
    text-decoration: none;
  }
  .legal-foot a:hover { color: var(--ink, #1a1a1a); }
  .sep { margin: 0 0.5rem; color: var(--ink-40, #888); }
  a { color: var(--vermillon, #c14a2c); }
</style>
