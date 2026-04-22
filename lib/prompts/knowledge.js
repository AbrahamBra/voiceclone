// System prompts for /api/knowledge. Extracted so prompt edits don't touch
// route logic and can be reviewed/versioned independently.

export const KEYWORD_PROMPT = `Extrais 5 à 15 mots-clés représentatifs de ce document.
Retourne UNIQUEMENT un tableau JSON de strings, sans aucun autre texte ni balises markdown.
Exemple: ["stratégie", "linkedin", "contenu", "audience", "engagement"]`;
