// Fire-and-forget emitter for brain events. Reads Svelte stores, calls the pure
// core to build the payload (which handles the message_id skip policy), and
// POSTs to /api/feedback-events. Never blocks UX.
import { get } from 'svelte/store';
import { messages, currentConversationId } from '$lib/stores/chat';  // verified in Step 1
import { authHeaders } from '$lib/api';                               // verified in Step 1 — NOT $lib/auth
import { buildBrainEventPayload } from './brainEventsCore.js';

const NARRATIVE_KINDS = ['toi', 'prospect', 'clone_draft', 'draft_rejected'];

/**
 * @param {'brain_drawer_opened'|'brain_edit_during_draft'} type
 */
export async function emitBrainEvent(type) {
  const payload = buildBrainEventPayload({
    conversationId: get(currentConversationId),
    messages: get(messages),
    eventType: type,
    narrativeKinds: NARRATIVE_KINDS,
  });
  if (!payload) return;  // core's skip policy — conv vierge or no conv

  try {
    const res = await fetch('/api/feedback-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`${type} HTTP`, res.status, text);
    }
  } catch (err) {
    console.warn(`${type} network error:`, err);
  }
}
