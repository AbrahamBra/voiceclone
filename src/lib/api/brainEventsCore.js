// Pure payload builder for brain events. No fetch, no Svelte store reads.
// Returns null to signal "skip emission" — the wrapper honors this silently.

/**
 * @param {object} args
 * @param {string|null} args.conversationId
 * @param {Array<{id: string, turn_kind: string}>} args.messages
 * @param {'brain_drawer_opened'|'brain_edit_during_draft'} args.eventType
 * @param {string[]} args.narrativeKinds
 * @returns {{conversation_id: string, message_id: string, event_type: string}|null}
 */
export function buildBrainEventPayload({ conversationId, messages, eventType, narrativeKinds }) {
  if (!conversationId) return null;
  const narrative = (messages || []).filter(m => narrativeKinds.includes(m.turn_kind));
  const last = narrative.at(-1);
  if (!last) return null;
  return {
    conversation_id: conversationId,
    message_id: last.id,
    event_type: eventType,
  };
}
