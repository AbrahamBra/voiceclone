/**
 * extractDraft(text) — extrait le contenu envoyable d'un message qui peut
 * contenir du meta-reasoning ("MESSAGE A ENVOYER :", "POURQUOI CETTE APPROCHE :",
 * "APPRENTISSAGE INTEGRE :", etc.).
 *
 * Ces blocs meta sont présents dans ~80% des messages Thomas stockés
 * (coaching mode / auto-reasoning). Pour calculer correctement le rythme d'un
 * vrai draft, il faut isoler la section envoyable.
 *
 * Retourne le texte nettoyé. Si aucun marqueur reconnu, retourne le texte brut.
 */

// Marqueurs de début de section "draft envoyable" (tous insensibles à la casse, accents).
const SEND_MARKERS = [
  /^(?:\s*\**\s*)?MESSAGE\s*(?:A|À)\s*ENVOYER\s*[:\-—]?\s*\**\s*\n+/im,
  /^(?:\s*\**\s*)?HOOK\s*(?:COMPLET|RECALIBR(?:E|É))?\s*[:\-—]?\s*\**\s*\n+/im,
  /^(?:\s*\**\s*)?NOUVELLE\s*OUVERTURE\s*[:\-—]?\s*\**\s*\n+/im,
  /^(?:\s*\**\s*)?R(?:E|É)PONSE\s*[:\-—]?\s*\**\s*\n+/im,
];

// Marqueurs de FIN (section post-message à couper).
const END_MARKERS = [
  /\n+\s*\**\s*POURQUOI\s*(?:CETTE\s*APPROCHE|(?:C|Ç)A\s*MARCHE)\b/i,
  /\n+\s*\**\s*APPRENTISSAGE/i,
  /\n+\s*\**\s*ANALYSE/i,
  /\n+\s*\**\s*CORRECTION/i,
  /\n+\s*\**\s*R(?:E|È|É)GLE\s+AJOUT(?:E|É)E/i,
  /\n+\s*\**\s*\[CORRECTION/i,
  /\n+\s*\**\s*\[INSIGHT/i,
  /\n+\s*\**\s*\[METHODOLOGIE/i,
  /\n+\s*\**\s*M(?:E|É)THODE\s+VALID(?:E|É)E/i,
];

// Blocs entièrement meta (pas de draft du tout à l'intérieur).
const FULL_META_MARKERS = [
  /^(?:\s*\**\s*)?APPRENTISSAGES?\s+(?:ENREGISTR|INT(?:E|É)GR)/i,
  /^(?:\s*\**\s*)?CE\s+QUE\s+JE\s+DOIS/i,
  /^(?:\s*\**\s*)?ANALYSE\s+PROFIL/i,
];

export function extractDraft(text) {
  if (!text) return "";
  const trimmed = text.trim();

  // Tout-meta (pas de draft à extraire).
  for (const re of FULL_META_MARKERS) {
    if (re.test(trimmed)) return "";
  }

  let work = trimmed;

  // Couper après le marqueur de début si présent.
  for (const re of SEND_MARKERS) {
    const m = work.match(re);
    if (m) {
      work = work.slice(m.index + m[0].length);
      break;
    }
  }

  // Couper avant le premier marqueur de fin.
  let cutAt = work.length;
  for (const re of END_MARKERS) {
    const m = work.match(re);
    if (m && m.index < cutAt) cutAt = m.index;
  }
  work = work.slice(0, cutAt).trim();

  return work;
}
