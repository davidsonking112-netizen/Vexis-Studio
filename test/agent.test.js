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
