// Pure state helpers for ChatComposer. Extracted to stay testable without Svelte.
// See spec: docs/superpowers/specs/2026-04-24-chat-composer-state-machine-design.md

/**
 * Infère le CTA DM primaire depuis l'état conv.
 * @param {{ isDmMode: boolean, isEmptyConversation: boolean, lastTurnKind: string|null }} args
 * @returns {'DM_1st'|'DM_relance'|'DM_reply'|null}
 */
export function inferPrimary({ isDmMode, isEmptyConversation, lastTurnKind }) {
  if (!isDmMode) return null;
  if (isEmptyConversation) return 'DM_1st';
  if (lastTurnKind === 'toi') return 'DM_relance';
  if (lastTurnKind === 'prospect') return 'DM_reply';
  return null;
}

/**
 * Décide si la zone paste "réponse prospect" doit être visible.
 * @param {{ isDmMode: boolean, lastTurnKind: string|null, pasteDismissed: boolean }} args
 * @returns {boolean}
 */
export function shouldShowPasteZone({ isDmMode, lastTurnKind, pasteDismissed }) {
  return isDmMode && lastTurnKind === 'toi' && !pasteDismissed;
}
