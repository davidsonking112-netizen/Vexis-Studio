import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { createCli } from "../src/cli.js";

function createRegistry() {
  return {
    list: () => [
      { name: "inspect_codebase", description: "Inspect the project" },
      { name: "run_tests", description: "Run project tests" }
    ],
    discover: query => [{ name: "run_tests", description: "Run project tests" }]
      .filter(tool => tool.name.includes(query) || tool.description.toLowerCase().includes(query.toLowerCase()))
  };
}

test("handles help, tool listing, and discovery commands", async () => {
  const output = new PassThrough();
  let text = "";
  output.on("data", chunk => { text += chunk.toString(); });
  const cli = createCli({ agent: { run: async () => ({ output: "unused" }) }, registry: createRegistry(), output });
  await cli.handle("/help");
  await cli.handle("/tools");
  await cli.handle("/discover tests");
  assert.match(text, /Vexis Studio/);
  assert.match(text, /inspect_codebase: Inspect the project/);
  assert.match(text, /run_tests: Run project tests/);
});

test("runs user tasks through the agent and renders the result", async () => {
  const output = new PassThrough();
  let text = "";
  output.on("data", chunk => { text += chunk.toString(); });
  const tasks = [];
  const cli = createCli({
    agent: { run: async task => { tasks.push(task); return { status: "completed", output: "Task completed." }; } },
    registry: createRegistry(),
    output
  });
  const result = await cli.handle("inspect the authentication flow");
  assert.equal(result.action, "continue");
  assert.deepEqual(tasks, ["inspect the authentication flow"]);
  assert.match(text, /Task completed\./);
});

test("supports clean exit commands", async () => {
  const cli = createCli({ agent: { run: async () => ({ output: "unused" }) }, registry: createRegistry(), output: new PassThrough() });
  assert.equal((await cli.handle("/quit")).action, "exit");
  assert.equal((await cli.handle("/exit")).action, "exit");
});

test("reports empty discovery queries without invoking the agent", async () => {
  const output = new PassThrough();
  let called = false;
  const cli = createCli({ agent: { run: async () => { called = true; } }, registry: createRegistry(), output });
  await cli.handle("/discover");
  assert.equal(called, false);
});
