import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { createTui, createTuiState, handleTuiKey, renderTui } from "../src/tui.js";

function registry() {
  return {
    list: () => [
      { name: "inspect_codebase", description: "Inspect the project" },
      { name: "run_tests", description: "Run project tests" }
    ],
    discover: query => [{ name: "run_tests", description: "Run project tests" }]
      .filter(tool => tool.name.includes(query) || tool.description.toLowerCase().includes(query.toLowerCase()))
  };
}

test("TUI state accepts text, edits it, and submits on Enter", () => {
  let state = createTuiState();
  for (const sequence of ["h", "i"]) {
    state = handleTuiKey(state, { sequence }).state;
  }
  state = handleTuiKey(state, { name: "left" }).state;
  state = handleTuiKey(state, { name: "delete" }).state;
  const result = handleTuiKey(state, { name: "enter" });
  assert.equal(result.submit, true);
  assert.equal(result.task, "h");
  assert.equal(result.state.status, "running");
  assert.equal(result.state.messages.at(-1).content, "h");
  assert.deepEqual(result.state.history, ["h"]);
});

test("TUI renders bounded transcript and controls", () => {
  const state = createTuiState({ width: 40, height: 10 });
  const rendered = renderTui({
    ...state,
    messages: [{ role: "agent", content: "A long response that must be wrapped." }]
  });
  assert.match(rendered, /Vexis Studio/);
  assert.match(rendered, /A long response/);
  assert.match(rendered, /Enter run/);
});

test("TUI executes tasks and exposes tool commands", async () => {
  const output = new PassThrough();
  let rendered = "";
  output.on("data", chunk => { rendered += chunk.toString(); });
  const tasks = [];
  const tui = createTui({
    agent: { run: async task => { tasks.push(task); return { status: "completed", output: "Completed." }; } },
    registry: registry(),
    input: new PassThrough(),
    output
  });

  await tui.handleKey({ sequence: "/" });
  for (const char of "tools") await tui.handleKey({ sequence: char });
  await tui.handleKey({ name: "enter" });

  assert.deepEqual(tasks, []);
  assert.match(rendered, /inspect_codebase/);

  for (const char of "inspect auth") await tui.handleKey({ sequence: char });
  await tui.handleKey({ name: "enter" });
  assert.deepEqual(tasks, ["inspect auth"]);
  assert.match(rendered, /Completed\./);
});

test("Ctrl+C requests exit and stop restores terminal mode", () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const tui = createTui({
    agent: { run: async () => ({ output: "unused" }) },
    registry: registry(),
    input,
    output
  });
  const result = handleTuiKey(tui.getState(), { ctrl: true, name: "c" });
  assert.equal(result.state.exit, true);
});


test("TUI supports bounded command history", () => {
  let state = createTuiState();
  state = { ...state, history: ["first", "second"], historyIndex: -1 };
  state = handleTuiKey(state, { name: "up" }).state;
  assert.equal(state.input, "second");
  state = handleTuiKey(state, { name: "up" }).state;
  assert.equal(state.input, "first");
  state = handleTuiKey(state, { name: "down" }).state;
  assert.equal(state.input, "second");
  state = handleTuiKey(state, { name: "down" }).state;
  assert.equal(state.input, "");
});

test("TUI does not confuse similarly prefixed commands with /discover", async () => {
  const output = new PassThrough();
  let rendered = "";
  output.on("data", chunk => { rendered += chunk.toString(); });
  let called = false;
  const tui = createTui({
    agent: { run: async task => { called = task === "/discovery"; return { output: "agent handled it" }; } },
    registry: registry(),
    input: new PassThrough(),
    output
  });
  for (const char of "/discovery") await tui.handleKey({ sequence: char });
  await tui.handleKey({ name: "enter" });
  assert.equal(called, true);
  assert.match(rendered, /agent handled it/);
});
