# Audit complet — Spa de Haute Provence

**Date :** 16 avril 2026
**URL :** https://www.spadehauteprovence.com/
**Type d'activite :** Spa thermal / Centre de bien-etre (LocalBusiness)
**Localisation :** 29 Avenue des Thermes, Digne-les-Bains (04)
**Pages analysees :** 7 (+ domaine externe soins-spadehauteprovence.com)
**Concurrents analyses :** vals-les-bains.fr, evauxthermes.com

---

## Resume executif

**Score GEO global : 32/100 (Critique)**

Le site du Spa de Haute Provence presente des lacunes majeures sur tous les axes : contenu tres mince (7 pages), absence totale de blog, schema markup quasi inexistant, marque diluee sous l'entite "Thermes de Digne-les-Bains", et fragmentation de l'autorite entre deux domaines. Le site est fonctionnel mais n'est pas construit pour etre visible, ni dans les moteurs traditionnels, ni dans les moteurs IA.

**Forces :** Photos professionnelles, informations pratiques presentes, WordPress + Yoast (base saine), SSR correct, HTTPS actif.

**Faiblesses critiques :** Site ultra-mince (7 pages), zero blog/contenu educatif, schema markup minimal, marque non identifiable en tant qu'entite independante, domaine de soins separe qui fragmente l'autorite SEO.

### Tableau des scores

| Categorie | Score | Poids | Score pondere |
|---|---|---|---|
| AI Citability | 30/100 | 25% | 7.5 |
| Brand Authority | 28/100 | 20% | 5.6 |
| Content E-E-A-T | 38/100 | 20% | 7.6 |
| Technical GEO | 48/100 | 15% | 7.2 |
| Schema & Structured Data | 22/100 | 10% | 2.2 |
| Platform Optimization | 20/100 | 10% | 2.0 |
| **Score GEO global** | | | **32/100** |

---

## Benchmark concurrentiel

### vs. evauxthermes.com (reference forte)

| Critere | Spa Haute Provence | Evaux-les-Bains |
|---|---|---|
| Pages indexees | ~7 | 30+ estimees |
| Blog/Actualites | Aucun | Oui, actif (agenda, promos saisonnieres) |
| Schema markup | WebPage + Org basique | WebPage + Org + BreadcrumbList + Social |
| Navigation | 5-6 items plats | 5 sections avec sous-menus structures |
| Positionnement medical | Absent | Fort (rhumatologie, phlebologie, gynecologie) |
| Reservation | Lien externe (elisath.fr) | Integree (Myasterio) + telephone |
| Multi-langue | Non | FR/EN |
| Instagram integre | Non | Oui (feed embarque) |
| Partenariats visibles | Aucun | The Originals Relais |
| Performance web | Elementor lourd, pas d'optimisation | Rocket (prefetch, cache, lazy loading) |
| Cookie consent | Basique | Tarteaucitron (conforme RGPD) |

**Verdict :** Evaux-les-Bains est un cran au-dessus sur tous les axes : contenu plus riche, positionnement medical clair, techniquement plus optimise, et meilleure integration de la preuve sociale.

### vs. vals-les-bains.fr

| Critere | Spa Haute Provence | Vals-les-Bains |
|---|---|---|
| Type de site | Spa mono-etablissement | Site officiel de ville thermale |
| CMS | WordPress + Elementor | WordPress + Divi |
| Design | Correct, photos pro | Plus moderne, animations CSS, multi-typo |
| Contenu | Tres mince | Riche (residents + visiteurs) |
| E-commerce | Non | WooCommerce pret |

**Note :** vals-les-bains.fr est un site de ville, pas un concurrent direct, mais il illustre le niveau de qualite attendu par une clientele thermale.

---

## Problemes critiques (a corriger immediatement)

### 1. Site ultra-mince : 7 pages seulement
- Aucune chance de construire une autorite thematique avec 7 pages
- Pas de blog, pas de contenu educatif, pas de FAQ
- Les moteurs IA ne peuvent pas citer un site qui n'a rien a citer
- **Impact :** Invisibilite totale dans les reponses IA (ChatGPT, Perplexity, Gemini)

### 2. Domaine de soins separe (soins-spadehauteprovence.com)
- Les soins/massages/forfaits vivent sur un domaine distinct
- Zero schema markup sur ce domaine
- Zero lien dans le sitemap principal
- L'autorite SEO est fractionnee en deux
- **Impact :** Google et les IA voient deux entites faibles au lieu d'une forte

### 3. Schema markup quasi inexistant (22/100)
- Pas de LocalBusiness / HealthAndBeautyBusiness
- Pas de sameAs (zero liaison avec les profils externes)
- Pas de Service schema pour les prestations
- Pas de OpeningHoursSpecification
- Pas de FAQPage
- **Impact :** Google ne peut pas afficher les rich snippets (horaires, prix, avis)

### 4. Identite de marque diluee (28/100)
- Pas de fiche TripAdvisor dediee (noyee sous "Thermes de Digne-les-Bains")
- Comptes sociaux partages avec les Thermes
- Aucune video YouTube
- 1 seul resultat organique pour la recherche exacte du nom
- **Impact :** Les IA ne reconnaissent pas le Spa comme entite distincte

---

## Problemes prioritaires (semaine 1-2)

### 5. Titre de page redondant
- Actuel : "Spa de Haute Provence - Spa Haute Provence"
- Recommande : "Spa Thermal de Haute-Provence | Bien-etre a Digne-les-Bains"

### 6. Pas de balises Open Graph / Twitter Card
- Les partages sur les reseaux sociaux n'ont ni image, ni titre, ni description
- Chaque page devrait avoir og:title, og:description, og:image, og:type

### 7. Performance web a risque
- Images sans dimensions (width/height) = CLS
- Google Fonts charge en JS sans font-display:swap = LCP
- Elementor charge de multiples CSS/JS bloquants
- Police Avenir Black TTF sans font-display = FOIT

### 8. Sitemap pollue
- 4 sous-sitemaps dont 2 datent de 2018 (probablement morts)
- Elementor header/footer expose comme pages indexables
- Aucune page du domaine soins- dans le sitemap

### 9. Pas de fichier llms.txt
- Aucun guidage pour les crawlers IA
- Opportunite facile a saisir

### 10. Zero contenu citationable par les IA
- Le contenu est promotionnel et generique
- Aucune donnee unique (composition minerale de l'eau, resultats, etudes)
- Aucun passage auto-suffisant qu'une IA pourrait extraire et citer

---

## Analyse design et UX

### Points positifs
- Photographies professionnelles de qualite
- Palette chaleureuse coherente (terre : #D9944F, bordeaux : #8e3c40, turquoise : #24929f)
- Typographie Montserrat lisible avec bonne hierarchie de poids
- Informations pratiques completes (horaires, tarifs, regles)
- CTA "Acheter" bien visibles

### Points faibles
- **Architecture de l'information pauvre :** 7 pages ne suffisent pas pour un spa thermal complet
- **Pas de page equipe/a-propos :** Aucun visage humain, aucune expertise affichee
- **Navigation fragmentee :** Les soins renvoient vers un autre domaine = friction utilisateur
- **Pas de preuve sociale integree :** Les temoignages sont anonymes, pas de note Google/TripAdvisor
- **Pas d'experience immersive :** Pas de video, pas de visite virtuelle embarquee (lien externe seulement)
- **Mobile non verifie :** Elementor peut etre lourd sur mobile
- **Accessibilite :** Alt text manquant sur la majorite des images

### Comparaison design vs. concurrents
- **Evaux :** Plus professionnel, instagram integre, agenda evenementiel, positionnement medical clair
- **Vals :** Animations CSS, multi-typographies, design plus moderne et dynamique
- **Spa HP :** Correct mais "site vitrine de 2018" — pas au niveau de 2026

---

## Orientation devis — Recommandations pour la refonte

### Option 1 : Refonte Essentielle (budget modere)

**Objectif :** Corriger les problemes critiques, moderniser le design, unifier le contenu.

| Poste | Details |
|---|---|
| **Refonte design** | Nouveau theme sur mesure (exit Elementor), responsive, animations modernes, dark/light theme |
| **Consolidation domaines** | Rapatrier soins-spadehauteprovence.com en /soins/ sur le domaine principal |
| **Schema markup complet** | HealthAndBeautyBusiness, Service, FAQPage, sameAs, OpeningHours |
| **SEO technique** | Titre/meta uniques, OG tags, sitemap propre, llms.txt, canonical, performance |
| **Pages nouvelles** | A propos/equipe, FAQ, page soins integree, mentions legales mises a jour |
| **Reservation integree** | Iframe ou API du systeme de reservation au lieu de lien externe |

**Estimation :** 8-12 pages, design moderne, SEO de base solide.

### Option 2 : Refonte Complete + Strategie de contenu (budget eleve)

**Tout de l'Option 1, plus :**

| Poste | Details |
|---|---|
| **Blog/Actualites** | Section blog avec 10-15 articles initiaux (bienfaits eau thermale, guide visiteur, saisonnalite...) |
| **Strategie GEO** | Contenu optimise pour les citations IA : FAQ riches, donnees uniques, passages citables |
| **Multi-langue** | FR + EN minimum (clientele touristique internationale) |
| **Video embarquee** | Visite virtuelle integree, video de presentation, temoignages video |
| **Preuve sociale** | Widget Google Reviews, lien TripAdvisor, temoignages nommes avec photos |
| **Performance** | Score Lighthouse 90+, Core Web Vitals verts, lazy loading, WebP/AVIF |
| **Analytics** | GA4 + events tracking + conversion tracking sur reservations |
| **Identite de marque** | Creer une fiche TripAdvisor dediee, optimiser Google Business Profile, YouTube |

**Estimation :** 20-30 pages, blog actif, strategie de contenu long terme.

### Option 3 : Refonte Premium + Accompagnement GEO (budget premium)

**Tout de l'Option 2, plus :**

| Poste | Details |
|---|---|
| **Accompagnement GEO mensuel** | Audit mensuel, creation de contenu, optimisation continue |
| **Strategie de marque** | Separation claire de l'entite "Thermes" vs "Spa", branding digital complet |
| **Programmatic SEO** | Pages par soin, par pathologie, par saison |
| **E-commerce** | Vente de bons cadeaux, forfaits, produits Sothys en ligne |
| **Email marketing** | Newsletter, sequences automatisees, relance panier |
| **Social media** | Comptes dedies, strategie de contenu, calendrier editorial |

---

## Quick Wins (cette semaine)

1. **Corriger le title tag** de la homepage (enlever la redondance)
2. **Ajouter les balises OG** sur toutes les pages via Yoast
3. **Ajouter un fichier llms.txt** a la racine du site
4. **Nettoyer le sitemap** (supprimer les 2 sitemaps de 2018 et celui d'Elementor HF)
5. **Ajouter alt text** a toutes les images

---

## Plan d'action 30 jours (si refonte validee)

### Semaine 1 : Fondations techniques
- [ ] Audit technique complet (Lighthouse, PageSpeed, WAVE)
- [ ] Corriger title/meta/OG sur le site actuel
- [ ] Creer le fichier llms.txt
- [ ] Nettoyer le sitemap
- [ ] Definir l'arborescence cible de la refonte

### Semaine 2 : Architecture et design
- [ ] Wireframes des pages cles
- [ ] Choix du stack technique (SvelteKit ou WordPress optimise)
- [ ] Maquettes desktop + mobile
- [ ] Validation client

### Semaine 3 : Contenu et schema
- [ ] Redaction des contenus (pages + premiers articles blog)
- [ ] Implementation schema markup complet
- [ ] Migration du contenu soins vers le domaine principal
- [ ] Configuration reservation integree

### Semaine 4 : Lancement et optimisation
- [ ] Developpement et integration
- [ ] Tests cross-browser et mobile
- [ ] Mise en production avec redirections 301
- [ ] Soumission sitemap a Google Search Console
- [ ] Verification score GEO post-lancement

---

## Annexe : Pages analysees

| URL | Titre | Score | Problemes |
|---|---|---|---|
| / | Spa de Haute Provence - Spa Haute Provence | 35/100 | Title redondant, pas d'OG, schema minimal |
| /espace-aqualudique/ | Espace Aqualudique | 40/100 | Pas d'alt text, schema basique |
| /aquagym/ | Aquagym | 38/100 | Contenu mince (~850 mots), pas d'alt text |
| /contact/ | Contact | 45/100 | Formulaire OK, directions OK, schema basique |
| /cgv/ | CGV | N/A | Page legale, non modifiee depuis 2023 |
| /mentions-legales/ | Mentions legales | N/A | Page legale |
| /accueil-noel/ | Accueil Noel | N/A | Page saisonniere |
| soins-spadehauteprovence.com | Soins (domaine separe) | 20/100 | Zero schema, domaine fragmente, pas de meta |

---

*Audit realise par AhmetA — 16 avril 2026*
