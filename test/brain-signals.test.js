import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildBrainEventPayload } from "../src/lib/api/brainEventsCore.js";

const NARRATIVE_KINDS = ['toi', 'prospect', 'clone_draft', 'draft_rejected'];

describe("buildBrainEventPayload", () => {
  it("returns null when no conversationId", () => {
    const out = buildBrainEventPayload({
      conversationId: null,
      messages: [{ id: 'm1', turn_kind: 'toi' }],
      eventType: 'brain_drawer_opened',
      narrativeKinds: NARRATIVE_KINDS,
    });
    assert.equal(out, null);
  });

  it("returns null when conversation has no messages", () => {
    const out = buildBrainEventPayload({
      conversationId: 'c1',
      messages: [],
      eventType: 'brain_drawer_opened',
      narrativeKinds: NARRATIVE_KINDS,
    });
    assert.equal(out, null);
  });

  it("returns null when conversation has only non-narrative messages", () => {
    const out = buildBrainEventPayload({
      conversationId: 'c1',
      messages: [{ id: 'm1', turn_kind: 'rule_added' }, { id: 'm2', turn_kind: 'system' }],
      eventType: 'brain_drawer_opened',
      narrativeKinds: NARRATIVE_KINDS,
    });
    assert.equal(out, null);
  });

  it("picks the last narrative message_id", () => {
    const out = buildBrainEventPayload({
      conversationId: 'c1',
      messages: [
        { id: 'm1', turn_kind: 'toi' },
        { id: 'm2', turn_kind: 'rule_added' },    // not narrative — skip
        { id: 'm3', turn_kind: 'prospect' },       // last narrative
      ],
      eventType: 'brain_drawer_opened',
      narrativeKinds: NARRATIVE_KINDS,
    });
    assert.deepEqual(out, {
      conversation_id: 'c1',
      message_id: 'm3',
      event_type: 'brain_drawer_opened',
    });
  });

  it("picks last narrative even when trailing messages are non-narrative", () => {
    const out = buildBrainEventPayload({
      conversationId: 'c1',
      messages: [
        { id: 'm1', turn_kind: 'toi' },
        { id: 'm2', turn_kind: 'clone_draft' },
        { id: 'm3', turn_kind: 'rule_added' },
      ],
      eventType: 'brain_edit_during_draft',
      narrativeKinds: NARRATIVE_KINDS,
    });
    assert.equal(out.message_id, 'm2');
    assert.equal(out.event_type, 'brain_edit_during_draft');
  });

  it("does NOT include dimensional fields (source/tab/has_draft)", () => {
    const out = buildBrainEventPayload({
      conversationId: 'c1',
      messages: [{ id: 'm1', turn_kind: 'toi' }],
      eventType: 'brain_drawer_opened',
      narrativeKinds: NARRATIVE_KINDS,
    });
    // Contract: only 3 fields. Dimensions go to analytics (track()), not DB.
    assert.deepEqual(Object.keys(out).sort(), ['conversation_id', 'event_type', 'message_id']);
  });
});
