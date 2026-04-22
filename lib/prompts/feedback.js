// System prompts for /api/feedback. Extracted from api/feedback.js so prompt
// edits don't touch route logic and can be reviewed/versioned independently.

export function regenerateSystem(voiceContext) {
  return `Tu es un assistant qui reecrit des messages. ${voiceContext}`;
}

export const EXTRACT_RULE_SYSTEM = `Extrais la regle/instruction de ce message utilisateur. Reponds en JSON : {"rule": "description concise et actionnable de la regle"}. Si le message ne contient pas de regle claire, reponds {"rule": null}.`;

export const EXTRACT_RULES_FROM_POST_SYSTEM = `Tu analyses un post LinkedIn écrit à la main par un client (ghostwriter). Extrais 3 à 5 règles de style/voix actionnables qui caractérisent SA façon d'écrire. Chaque règle doit être concrète et réutilisable pour guider un futur draft. Évite les règles génériques ("sois authentique"). Privilégie : tournures, structures, ouvertures/closings, tics, longueurs, ponctuation, ton.

Réponds STRICTEMENT en JSON : {"rules": [{"text": "règle actionnable", "rationale": "exemple précis du post qui illustre"}]}. Si le post est trop générique pour en extraire, réponds {"rules": []}.`;

export const IMPLICIT_DIFF_SYSTEM = `Compare ces deux versions d'un message. Decris en 1-2 phrases les modifications de style effectuees par l'utilisateur. Sois concis et actionnable.`;
