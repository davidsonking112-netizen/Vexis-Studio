import { Agent } from "./agent.js";
import { createFilesystemTools } from "./tools/filesystem.js";
import { createCommandTool } from "./tools/command.js";
import { createCodebaseTool } from "./tools/codebase.js";
import { createEditTool } from "./tools/edit.js";
import { createTestTool } from "./tools/test.js";
import { createTaskStateTool } from "./tools/task_state.js";
import { createToolRegistry } from "./tools/registry.js";

export function createRuntime({ workspace = process.cwd() } = {}) {
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
  const model = {
    async next({ messages, tools: availableTools }) {
      const last = messages.at(-1);
      if (last?.role === "user") return { type: "tool_call", name: "inspect_codebase", input: { path: ".", max_files: 100 } };
      if (last?.role === "tool" && last.name === "inspect_codebase") return { type: "tool_call", name: "run_command", input: { command: process.execPath, args: ["--version"] } };
      if (last?.role === "tool" && last.name === "run_command") return { type: "final", content: `Codebase inspection and controlled command execution are operational. Editing is available through hash-guarded exact replacements. Tools: ${availableTools.join(", ")}.` };
      return { type: "final", content: "Done." };
    }
  };
  return { agent: new Agent({ model, tools }), registry, filesystem, edit, codebase, workspace };
}
