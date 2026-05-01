import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { mintApiKey, hashApiKey } from "../lib/api-key-auth.js";

describe("api-key-auth", () => {
  it("mintApiKey returns sk_-prefixed base64url string", () => {
    const k = mintApiKey();
    assert.match(k, /^sk_[A-Za-z0-9_-]{40,}$/);
  });

  it("mintApiKey produces unique values across calls", () => {
    const a = mintApiKey();
    const b = mintApiKey();
    assert.notEqual(a, b);
  });

  it("hashApiKey is deterministic and 64-char hex", () => {
    const k = "sk_test123";
    const h1 = hashApiKey(k);
    const h2 = hashApiKey(k);
    assert.equal(h1, h2);
    assert.match(h1, /^[0-9a-f]{64}$/);
  });

  it("hashApiKey returns null on empty/non-string", () => {
    assert.equal(hashApiKey(""), null);
    assert.equal(hashApiKey(null), null);
    assert.equal(hashApiKey(undefined), null);
    assert.equal(hashApiKey(42), null);
  });

  it("hashApiKey output differs for different inputs", () => {
    assert.notEqual(hashApiKey("key1"), hashApiKey("key2"));
  });
});
