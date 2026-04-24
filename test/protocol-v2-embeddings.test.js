import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  EMBEDDING_DIM,
  SEMANTIC_DEDUP_THRESHOLD,
  embedForProposition,
  findSimilarProposition,
  isProtocolEmbeddingAvailable,
} from "../lib/protocol-v2-embeddings.js";

describe("protocol-v2-embeddings constants", () => {
  test("EMBEDDING_DIM matches proposition.embedding vector(1536)", () => {
    assert.equal(EMBEDDING_DIM, 1536);
  });

  test("SEMANTIC_DEDUP_THRESHOLD matches spec (0.85)", () => {
    assert.equal(SEMANTIC_DEDUP_THRESHOLD, 0.85);
  });
});

describe("isProtocolEmbeddingAvailable", () => {
  test("returns a boolean", () => {
    assert.equal(typeof isProtocolEmbeddingAvailable(), "boolean");
  });
});

describe("embedForProposition — guard clauses", () => {
  test("returns null on empty text", async () => {
    assert.equal(await embedForProposition(""), null);
    assert.equal(await embedForProposition("   "), null);
  });

  test("returns null on null/undefined", async () => {
    assert.equal(await embedForProposition(null), null);
    assert.equal(await embedForProposition(undefined), null);
  });
});

describe("findSimilarProposition — guard clauses", () => {
  const neverCalled = () => {
    throw new Error("supabase.rpc should not be called with invalid args");
  };
  const supabaseStub = { rpc: neverCalled };

  test("returns [] when documentId is missing", async () => {
    const out = await findSimilarProposition(supabaseStub, {
      embedding: new Array(EMBEDDING_DIM).fill(0),
    });
    assert.deepEqual(out, []);
  });

  test("returns [] when embedding has wrong dim", async () => {
    const out = await findSimilarProposition(supabaseStub, {
      documentId: "00000000-0000-0000-0000-000000000001",
      embedding: [0.1, 0.2, 0.3],
    });
    assert.deepEqual(out, []);
  });

  test("returns [] when embedding is not an array", async () => {
    const out = await findSimilarProposition(supabaseStub, {
      documentId: "00000000-0000-0000-0000-000000000001",
      embedding: null,
    });
    assert.deepEqual(out, []);
  });

  test("forwards args to supabase.rpc with expected shape", async () => {
    let captured = null;
    const supabase = {
      rpc: (name, args) => {
        captured = { name, args };
        return Promise.resolve({ data: [{ id: "abc", similarity: 0.9 }], error: null });
      },
    };
    const emb = new Array(EMBEDDING_DIM).fill(0.01);
    const out = await findSimilarProposition(supabase, {
      documentId: "doc-1",
      embedding: emb,
      targetKind: "hard_rules",
    });
    assert.equal(captured.name, "match_propositions");
    assert.equal(captured.args.match_document_id, "doc-1");
    assert.equal(captured.args.match_target_kind, "hard_rules");
    assert.equal(captured.args.query_embedding, emb);
    assert.equal(captured.args.match_threshold, SEMANTIC_DEDUP_THRESHOLD);
    assert.equal(captured.args.match_count, 5);
    assert.equal(out.length, 1);
  });

  test("defaults targetKind to null (no filter)", async () => {
    let captured = null;
    const supabase = {
      rpc: (_name, args) => {
        captured = args;
        return Promise.resolve({ data: [], error: null });
      },
    };
    await findSimilarProposition(supabase, {
      documentId: "doc-1",
      embedding: new Array(EMBEDDING_DIM).fill(0.01),
    });
    assert.equal(captured.match_target_kind, null);
  });

  test("returns [] and logs on rpc error", async () => {
    const supabase = {
      rpc: () => Promise.resolve({ data: null, error: { message: "boom" } }),
    };
    const out = await findSimilarProposition(supabase, {
      documentId: "doc-1",
      embedding: new Array(EMBEDDING_DIM).fill(0.01),
    });
    assert.deepEqual(out, []);
  });
});
