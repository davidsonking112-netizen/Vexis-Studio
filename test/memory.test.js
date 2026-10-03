import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAgentMemory } from "../src/memory/engine.js";

async function tempWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "vexis-memory-"));
}

test("agent memory persists structured entries and recalls relevant memories", async () => {
  const workspace = await tempWorkspace();
  const memory = createAgentMemory({ workspace });

  const decision = await memory.remember({
    type: "decision",
    content: "Use atomic writes for workspace state.",
    tags: ["persistence", "atomic"],
    source: "test",
    confidence: 0.95
  });
  await memory.remember({
    type: "failure",
    content: "The stale editor buffer must be rejected before saving.",
    tags: ["editor", "stale"],
    source: "test"
  });

  assert.ok(decision.id);
  const recalled = await memory.recall({ query: "atomic workspace state", limit: 5 });
  assert.equal(recalled.entries[0].type, "decision");

  const reloaded = createAgentMemory({ workspace });
  const persisted = await reloaded.recall({ query: "stale editor buffer", limit: 5 });
  assert.equal(persisted.entries[0].type, "failure");
});

test("agent memory deduplicates identical observations", async () => {
  const workspace = await tempWorkspace();
  const memory = createAgentMemory({ workspace });

  await memory.remember({ type: "capability", content: "Vexis supports streaming tool calls.", tags: ["streaming"] });
  await memory.remember({ type: "capability", content: "Vexis supports streaming tool calls.", tags: ["streaming"] });

  const stats = await memory.stats();
  assert.equal(stats.entries, 1);
});

test("agent memory is bounded and supports forgetting", async () => {
  const workspace = await tempWorkspace();
  const memory = createAgentMemory({ workspace, maxEntries: 2 });

  await memory.remember({ type: "fact", content: "one" });
  await memory.remember({ type: "fact", content: "two" });
  await memory.remember({ type: "fact", content: "three" });

  const stats = await memory.stats();
  assert.equal(stats.entries, 2);

  const recalled = await memory.recall({ query: "two" });
  assert.ok(recalled.entries.length >= 1);
  const removed = await memory.forget({ ids: [recalled.entries[0].id] });
  assert.equal(removed.removed, 1);
});

test("agent memory rejects unsafe paths", () => {
  assert.throws(() => createAgentMemory({ workspace: "/tmp", memoryPath: "../outside.json" }), /escapes/);
});
