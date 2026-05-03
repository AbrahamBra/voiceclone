import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import fs from "node:fs/promises";

import { classifyUserFollowup } from "../lib/classify-user-followup.js";

describe("classifyUserFollowup", () => {
  it("classifies opening 'non' as correct", () => {
    assert.equal(classifyUserFollowup("non c'est pas ma voix"), "correct");
  });

  it("returns null for empty input", () => {
    assert.equal(classifyUserFollowup(""), null);
    assert.equal(classifyUserFollowup("   "), null);
    assert.equal(classifyUserFollowup(null), null);
    assert.equal(classifyUserFollowup(undefined), null);
  });

  it("classifies positive short follow-up as accept", () => {
    assert.equal(classifyUserFollowup("ok merci"), "accept");
    assert.equal(classifyUserFollowup("super on continue"), "accept");
    assert.equal(classifyUserFollowup("parfait"), "accept");
  });

  it("classifies 'arrête' / 'stop' as correct", () => {
    assert.equal(classifyUserFollowup("arrête de me vouvoyer"), "correct");
    assert.equal(classifyUserFollowup("stop refais"), "correct");
  });

  it("classifies 'j'ai déraillé' / 'j'ai dérapé' as correct", () => {
    assert.equal(classifyUserFollowup("j'ai déraillé là refais"), "correct");
    assert.equal(classifyUserFollowup("j'ai dérapé"), "correct");
    assert.equal(classifyUserFollowup("j'ai merdé sur le dernier"), "correct");
  });

  it("classifies 'c'est pas' / 'ce n'est pas' as correct", () => {
    assert.equal(classifyUserFollowup("c'est pas ma voix"), "correct");
    assert.equal(classifyUserFollowup("ce n'est pas du tout ce que je voulais"), "correct");
  });

  it("does NOT false-positive on 'pas mal' / 'pas de souci' (positive expressions)", () => {
    assert.equal(classifyUserFollowup("pas mal du tout"), "accept");
    assert.equal(classifyUserFollowup("pas de souci on continue"), "accept");
  });

  it("only inspects the first clause (sentence terminator)", () => {
    // A negation in the 2nd sentence shouldn't flip the verdict — too noisy.
    assert.equal(
      classifyUserFollowup("super. mais non en fait refais"),
      "accept",
    );
  });

  it("handles capitalized input", () => {
    assert.equal(classifyUserFollowup("Non c'est pas ma voix"), "correct");
    assert.equal(classifyUserFollowup("ARRÊTE"), "correct");
  });
});

describe("api/chat.js implicit_correct wiring (static check)", () => {
  it("imports classifyUserFollowup and dispatches both implicit branches", async () => {
    const src = await fs.readFile(new URL("../api/chat.js", import.meta.url), "utf8");
    assert.match(src, /from\s+["']\.\.\/lib\/classify-user-followup\.js["']/, "missing classifyUserFollowup import");
    assert.match(src, /classifyUserFollowup\(message\)/, "classifier not invoked on user message");
    assert.match(src, /emitImplicitCorrect\s*\(/, "emitImplicitCorrect not called");
    assert.match(src, /emitImplicitAccept\s*\(/, "emitImplicitAccept call regressed");
  });

  it("emitImplicitCorrect emits event_type='corrected' with harmful firing outcome", async () => {
    const src = await fs.readFile(new URL("../api/chat.js", import.meta.url), "utf8");
    // Slice the function body to scope assertions
    const start = src.indexOf("function emitImplicitCorrect(");
    assert.ok(start > 0, "emitImplicitCorrect function not found");
    const end = src.indexOf("function emitImplicitAccept(", start);
    assert.ok(end > start, "emitImplicitAccept boundary not found");
    const body = src.slice(start, end);
    assert.match(body, /event_type:\s*["']corrected["']/, "event_type !== 'corrected'");
    assert.match(body, /outcome:\s*["']harmful["']/, "firing outcome !== 'harmful'");
    assert.match(body, /correction_text:\s*correctionText/, "user text not stored as correction_text");
  });
});
