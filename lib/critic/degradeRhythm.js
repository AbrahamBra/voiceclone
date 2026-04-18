/**
 * degradeRhythm — transformations rule-based qui cassent le rythme sans
 * changer le sens ni le vocabulaire. Utilisées pour générer des anti-gold
 * synthétiques (calibration du critic en l'absence de vrais labels).
 *
 * Modes :
 *   - uniformize : fusionne les phrases courtes + découpe les longues pour
 *                  aplatir la variance de longueur (cible = μ ± 2 mots)
 *   - flatten_punct : remplace `?`, `!`, `…` par `.` (spike rm_dryness)
 *   - monotone : combine uniformize + flatten_punct (dégradation max)
 *
 * Déterministe, sans LLM, sans coût. Reproduit fidèlement ce qu'un LLM
 * médiocre pourrait produire : du texte grammaticalement correct mais
 * rythmiquement plat.
 */

const WORD_RE = /\S+/g;
const SENT_SPLIT = /(?<=[.!?…])\s+(?=[A-ZÀÂÉÈÊ0-9])/;

function words(s) { return (s.match(WORD_RE) || []); }

function sentences(text) {
  return text.split(SENT_SPLIT).map(s => s.trim()).filter(Boolean);
}

/**
 * Fusionne les phrases courtes consécutives avec ", " jusqu'à atteindre
 * la cible de longueur moyenne. Découpe les phrases trop longues aux virgules.
 */
function uniformize(text, targetLen = 15) {
  const sents = sentences(text);
  if (sents.length < 2) return text;

  const out = [];
  let buf = "";

  for (const s of sents) {
    const bufLen = buf ? words(buf).length : 0;
    const sLen = words(s).length;

    // Si la phrase courante est courte et qu'on a du buffer sous la cible, on fusionne.
    if (bufLen > 0 && bufLen + sLen <= targetLen + 3) {
      const clean = s.replace(/[.!?…]+\s*$/, "");
      buf = buf.replace(/[.!?…]+\s*$/, "") + ", " + clean.charAt(0).toLowerCase() + clean.slice(1);
    } else if (sLen > targetLen + 5) {
      // Phrase trop longue : on la découpe à la première virgule plausible (après ≥target/2 mots)
      if (buf) out.push(buf.endsWith(".") ? buf : buf + ".");
      buf = "";
      const parts = s.split(/,\s*/);
      let cur = "";
      for (const p of parts) {
        const candidate = cur ? cur + ", " + p : p;
        if (words(candidate).length >= targetLen) {
          out.push((cur || p).replace(/[.!?…]+\s*$/, "") + ".");
          cur = cur ? p : "";
        } else {
          cur = candidate;
        }
      }
      if (cur) buf = cur.replace(/[.!?…]+\s*$/, "") + ".";
    } else {
      if (buf) out.push(buf.endsWith(".") ? buf : buf.replace(/[.!?…]+\s*$/, "") + ".");
      buf = s;
    }
  }
  if (buf) out.push(buf.endsWith(".") ? buf : buf.replace(/[.!?…]+\s*$/, "") + ".");
  return out.join(" ");
}

function flattenPunct(text) {
  return text.replace(/[!?…]+/g, ".");
}

export function degradeRhythm(text, mode) {
  if (!text) return text;
  switch (mode) {
    case "uniformize": return uniformize(text);
    case "flatten_punct": return flattenPunct(text);
    case "monotone": return flattenPunct(uniformize(text));
    default: throw new Error(`Unknown degrade mode: ${mode}`);
  }
}
