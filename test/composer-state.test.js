import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { inferPrimary, shouldShowPasteZone } from "../src/lib/composer-state.js";

describe("inferPrimary", () => {
  it("returns null when not DM mode", () => {
    assert.equal(inferPrimary({ isDmMode: false, isEmptyConversation: false, lastTurnKind: 'toi' }), null);
  });

  it("returns DM_1st when conv is empty in DM mode", () => {
    assert.equal(inferPrimary({ isDmMode: true, isEmptyConversation: true, lastTurnKind: null }), 'DM_1st');
  });

  it("returns DM_relance when last turn is 'toi'", () => {
    assert.equal(inferPrimary({ isDmMode: true, isEmptyConversation: false, lastTurnKind: 'toi' }), 'DM_relance');
  });

  it("returns DM_reply when last turn is 'prospect'", () => {
    assert.equal(inferPrimary({ isDmMode: true, isEmptyConversation: false, lastTurnKind: 'prospect' }), 'DM_reply');
  });

  it("returns null when last turn is 'clone_draft' (fallback)", () => {
    assert.equal(inferPrimary({ isDmMode: true, isEmptyConversation: false, lastTurnKind: 'clone_draft' }), null);
  });

  it("returns null when last turn is 'draft_rejected' (fallback)", () => {
    assert.equal(inferPrimary({ isDmMode: true, isEmptyConversation: false, lastTurnKind: 'draft_rejected' }), null);
  });

  it("returns null for legacy conv (lastTurnKind=null, not empty)", () => {
    assert.equal(inferPrimary({ isDmMode: true, isEmptyConversation: false, lastTurnKind: null }), null);
  });

  it("prioritizes isEmptyConversation over lastTurnKind (defensive)", () => {
    assert.equal(inferPrimary({ isDmMode: true, isEmptyConversation: true, lastTurnKind: 'toi' }), 'DM_1st');
  });
});

describe("shouldShowPasteZone", () => {
  it("returns true when DM + last='toi' + not dismissed", () => {
    assert.equal(shouldShowPasteZone({ isDmMode: true, lastTurnKind: 'toi', pasteDismissed: false }), true);
  });

  it("returns false when dismissed", () => {
    assert.equal(shouldShowPasteZone({ isDmMode: true, lastTurnKind: 'toi', pasteDismissed: true }), false);
  });

  it("returns false when last turn is 'prospect'", () => {
    assert.equal(shouldShowPasteZone({ isDmMode: true, lastTurnKind: 'prospect', pasteDismissed: false }), false);
  });

  it("returns false when last turn is 'clone_draft'", () => {
    assert.equal(shouldShowPasteZone({ isDmMode: true, lastTurnKind: 'clone_draft', pasteDismissed: false }), false);
  });

  it("returns false when not in DM mode", () => {
    assert.equal(shouldShowPasteZone({ isDmMode: false, lastTurnKind: 'toi', pasteDismissed: false }), false);
  });
});
