import { Agent } from "./agent.js";
import { createModel } from "./models/http.js";
import { createFilesystemTools } from "./tools/filesystem.js";
import { createCommandTool } from "./tools/command.js";
import { createCodebaseTool } from "./tools/codebase.js";
import { createEditTool } from "./tools/edit.js";
import { createTestTool } from "./tools/test.js";
import { createTaskStateTool } from "./tools/task_state.js";
import { createToolRegistry } from "./tools/registry.js";

export function createRuntime({
  workspace = process.cwd(),
  model = createModel()
} = {}) {
  if (!model || typeof model.next !== "function") {
    throw new TypeError("model.next must be a function");
  }

  const filesystem = createFilesystemTools({ workspace });
  const command = createCommandTool({ workspace, timeoutMs: 120_000 });
  const codebase = createCodebaseTool({ workspace, filesystem });
  const edit = createEditTool({ workspace, filesystem });
  const testTool = createTestTool({ workspace, command });
  const taskState = createTaskStateTool({ workspace });
  const registry = createToolRegistry({
    ...filesystem,
    run_command: command,
    inspect_codebase: codebase,
    edit_file: edit,
    run_tests: testTool,
    task_state: taskState
  });
  const tools = registry.toAgentTools();

  const agent = new Agent({
    model,
    tools,
    toolDefinitions: registry.list()
  });

  return {
    agent,
    model,
    registry,
    filesystem,
    edit,
    codebase,
    workspace
  };
}
