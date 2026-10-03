import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRuntime } from "../src/runtime.js";

test("runtime wires memory and repository intelligence into one shared agent", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "vexis-runtime-"));
  const model = {
    describe() { return { provider: "test", model: "test" }; },
    async next() {
      return { type: "final", content: "ok" };
    }
  };
  const runtime = createRuntime({
    workspace,
    model,
    enablePlanning: false
  });
  assert.ok(runtime.memory);
  assert.ok(runtime.repositoryIntelligence);
  assert.ok(runtime.registry.has("agent_memory"));
  assert.ok(runtime.registry.has("repository_intelligence"));
  const result = await runtime.agent.run("inspect the repository");
  assert.equal(result.output, "ok");
});
