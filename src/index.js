import { Agent } from "./agent.js";
import { createFilesystemTools, toAgentTools } from "./tools/filesystem.js";
import { createCommandTool, toAgentCommandTool } from "./tools/command.js";

const workspace = process.cwd();

const filesystem = createFilesystemTools({
  workspace
});

const command = createCommandTool({
  workspace
});

const tools = {
  ...toAgentTools(filesystem),
  ...toAgentCommandTool(command)
};

const model = {
  async next({ messages, tools: availableTools }) {
    const last = messages.at(-1);

    if (last?.role === "user") {
      return {
        type: "tool_call",
        name: "list_files",
        input: { path: ".", max_entries: 100 }
      };
    }

    if (last?.role === "tool" && last.name === "list_files") {
      return {
        type: "tool_call",
        name: "run_command",
        input: {
          command: process.execPath,
          args: ["--version"]
        }
      };
    }

    if (last?.role === "tool" && last.name === "run_command") {
      return {
        type: "final",
        content: `Workspace inspection and controlled command execution are operational. Tools: ${availableTools.join(", ")}.`
      };
    }

    return {
      type: "final",
      content: "Done."
    };
  }
};

const agent = new Agent({
  model,
  tools,
  onEvent: event => {
    if (event.type === "tool_result") {
      console.log(`[tool] ${event.name}`);
    }
  }
});

const task = process.argv.slice(2).join(" ") || "Inspect this workspace";
const result = await agent.run(task);

console.log(result.output);
