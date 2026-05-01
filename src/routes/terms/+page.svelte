<script>
  // Conditions Generales d'Utilisation — version beta privee.
  // Volontairement courtes : pas de promesse SLA, pas de claim qu'on ne peut pas tenir,
  // mention claire que le service est en beta privee sous NDA.
  // Mise a jour : 2026-05-01.
</script>

<svelte:head>
  <title>Conditions générales · Setclone</title>
  <meta name="description" content="Conditions générales d'utilisation de Setclone — service, compte, responsabilité, loi applicable." />
</svelte:head>

<main class="legal">
  <header class="legal-head">
    <a class="back" href="/">← Setclone</a>
    <h1>Conditions générales d'utilisation</h1>
    <p class="legal-meta mono">Dernière mise à jour : 1<sup>er</sup> mai 2026 · version bêta privée</p>
  </header>

  <section>
    <h2>1. Objet</h2>
    <p>
      Les présentes conditions régissent l'usage de <strong>Setclone</strong>, un service en bêta privée qui permet à une agence de ghostwriting LinkedIn de drafter des messages directs pour ses clients à partir d'un protocole opérationnel et d'un corpus de posts.
    </p>
    <p>
      L'accès est réservé aux utilisateurs ayant signé un accord de confidentialité (NDA) avec l'éditeur. La création de compte vaut acceptation pleine et entière des présentes conditions.
    </p>
  </section>

  <section>
    <h2>2. Compte et accès</h2>
    <ul>
      <li>L'accès est nominatif et non-cessible. Vous êtes responsable de la confidentialité de votre code d'accès.</li>
      <li>Vous garantissez que les données fournies (posts, DMs, doctrine client) sont licites et que vous disposez des droits nécessaires pour les téléverser.</li>
      <li>L'éditeur peut suspendre un compte en cas d'usage manifestement abusif (spam, scraping massif tiers, contenu illicite) avec un préavis raisonnable sauf urgence.</li>
      <li>Vous pouvez désactiver votre compte à tout moment via <code>POST /api/account/delete</code> ou en écrivant à <a href="mailto:contact@setclone.app">contact@setclone.app</a>. Voir la <a href="/privacy">politique de confidentialité</a> pour la conservation des données après désactivation.</li>
    </ul>
  </section>

  <section>
    <h2>3. Service en bêta privée</h2>
    <p>
      Setclone est en bêta privée. Cela implique :
    </p>
    <ul>
      <li>Aucun engagement de niveau de service (SLA). Indisponibilités possibles, notamment sur les fenêtres de déploiement.</li>
      <li>Évolutions fonctionnelles fréquentes. Les changements de comportement importants vous sont signalés par email avant déploiement.</li>
      <li>Audit RGPD en cours. Voir la <a href="/privacy">politique de confidentialité</a> pour la situation détaillée.</li>
      <li>Tarification sur devis pendant la bêta. Voir conditions financières dans votre contrat individuel.</li>
    </ul>
  </section>

  <section>
    <h2>4. Propriété intellectuelle</h2>
    <ul>
      <li><strong>Données fournies par vous</strong> (posts, DMs, doctrine, corrections) : vous en restez seul propriétaire. Vous nous accordez une licence non-exclusive pour les traiter aux seules fins de l'exécution du service et de l'amélioration du clone associé à votre compte.</li>
      <li><strong>Drafts générés par le clone</strong> : vous en avez la libre disposition pour l'envoi à vos prospects ou clients finaux. Setclone ne revendique aucun droit sur ces drafts.</li>
      <li><strong>Logiciel Setclone</strong> (code, modèles, prompts, architecture) : reste la propriété exclusive de l'éditeur. Aucune licence implicite ne vous est accordée au-delà de l'usage du service.</li>
      <li><strong>Apprentissage anonymisé</strong> : sous réserve de votre acceptation explicite (à activer dans les paramètres du compte), des patterns anonymisés issus de votre usage peuvent contribuer à l'amélioration du modèle générique. Aucun contenu identifiable n'est partagé entre clients sans cet opt-in.</li>
    </ul>
  </section>

  <section>
    <h2>5. Limitation de responsabilité</h2>
    <p>
      Setclone est fourni « tel quel » pendant la bêta privée. Les drafts générés peuvent contenir des erreurs, des inexactitudes ou des éléments inadaptés à votre contexte. Vous validez chaque message avant envoi à votre prospect ou client final — le clone n'envoie rien automatiquement.
    </p>
    <p>
      Dans la mesure permise par le droit applicable, la responsabilité totale de l'éditeur au titre du service est plafonnée au montant payé par vous au cours des douze mois précédant le fait générateur. Cette limitation ne s'applique pas en cas de faute lourde, dol, ou pour les dommages corporels.
    </p>
  </section>

  <section>
    <h2>6. Confidentialité réciproque</h2>
    <p>
      Les présentes conditions complètent — sans s'y substituer — l'accord de confidentialité signé entre vous et l'éditeur préalablement à votre accès. En cas de contradiction, le NDA prévaut sur la question concernée.
    </p>
  </section>

  <section>
    <h2>7. Modifications</h2>
    <p>
      Les présentes conditions peuvent évoluer. Toute modification substantielle vous sera notifiée par email au moins quinze jours avant son entrée en vigueur. Vous pouvez résilier votre compte sans frais si vous refusez les modifications.
    </p>
  </section>

  <section>
    <h2>8. Loi applicable et juridiction</h2>
    <p>
      Les présentes conditions sont régies par le droit français. À défaut d'accord amiable, tout litige relatif à leur interprétation ou exécution relève de la compétence exclusive des tribunaux de Paris, sous réserve des dispositions impératives applicables aux consommateurs.
    </p>
  </section>

  <section>
    <h2>9. Contact</h2>
    <p>
      Pour toute question sur les présentes conditions : <a href="mailto:contact@setclone.app">contact@setclone.app</a>.
    </p>
  </section>

  <footer class="legal-foot mono">
    <a href="/privacy">Confidentialité</a>
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
