import test from "node:test";
import assert from "node:assert/strict";
import { Agent } from "../src/agent.js";
import { ScriptedModel } from "../src/model.js";

test("agent can call a tool and continue", async () => {
  const model = new ScriptedModel([
    { type: "tool_call", name: "echo", input: { value: "hello" } },
    { type: "final", content: "finished" }
  ]);

  const events = [];
  const agent = new Agent({
    model,
    tools: {
      echo: async ({ value }) => value
    },
    onEvent: event => events.push(event)
  });

  const result = await agent.run("say hello");

  assert.equal(result.status, "completed");
  assert.equal(result.output, "finished");
  assert.equal(result.steps, 2);

  const toolResult = events.find(event => event.type === "tool_result");
  assert.equal(toolResult.observation.result, "hello");
});

test("agent reports unknown tools to the model", async () => {
  const model = new ScriptedModel([
    { type: "tool_call", name: "missing", input: {} },
    { type: "final", content: "recovered" }
  ]);

  const agent = new Agent({ model });
  const result = await agent.run("recover");

  assert.equal(result.output, "recovered");
});

test("agent stops at the step limit", async () => {
  const model = {
    async next() {
      return { type: "tool_call", name: "loop", input: {} };
    }
  };

  const agent = new Agent({
    model,
    tools: { loop: async () => "again" },
    maxSteps: 3
  });

  const result = await agent.run("loop");

  assert.equal(result.status, "max_steps");
  assert.equal(result.steps, 3);
});


test("agent can verify, repair, and verify again", async () => {
  let verified = false;
  let repaired = false;

  const model = new ScriptedModel([
    { type: "tool_call", name: "run_tests", input: {} },
    { type: "tool_call", name: "edit_file", input: { path: "fixture.js" } },
    { type: "tool_call", name: "run_tests", input: {} },
    { type: "final", content: "verified" }
  ]);

  const agent = new Agent({
    model,
    tools: {
      run_tests: async () => {
        if (!repaired) {
          return { status: "failed", diagnostics: ["expected 1, received 2"] };
        }

        verified = true;
        return { status: "passed", diagnostics: [] };
      },
      edit_file: async () => {
        repaired = true;
        return { changed: true, replacements: 1 };
      }
    }
  });

  const result = await agent.run("repair the failing test");

  assert.equal(result.status, "completed");
  assert.equal(result.output, "verified");
  assert.equal(verified, true);
  assert.equal(repaired, true);
});


test("agent executes multiple streaming tool calls concurrently and preserves result order", async () => {
  const started = [];
  let releaseSlow;
  const slowGate = new Promise(resolve => { releaseSlow = resolve; });

  const model = {
    async next() {
      return { type: "final", content: "unused" };
    },
    async *nextStream({ messages }) {
      if (messages.length === 1) {
        yield {
          type: "complete",
          response: {
            type: "tool_calls",
            calls: [
              { id: "a", name: "slow", input: { value: 1 } },
              { id: "b", name: "fast", input: { value: 2 } }
            ]
          }
        };
        return;
      }
      yield { type: "complete", response: { type: "final", content: "done" } };
    }
  };

  const agent = new Agent({
    model,
    tools: {
      slow: async input => {
        started.push("slow");
        await slowGate;
        return input.value;
      },
      fast: async input => {
        started.push("fast");
        releaseSlow();
        return input.value;
      }
    }
  });

  const result = await agent.run("run both");
  assert.equal(result.status, "completed");
  assert.deepEqual(started, ["slow", "fast"]);
  assert.equal(result.output, "done");
});
