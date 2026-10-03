import { Agent } from "./agent.js";
import { createFilesystemTools, toAgentTools } from "./tools/filesystem.js";

const filesystem = createFilesystemTools({
  workspace: process.cwd()
});

const tools = toAgentTools(filesystem);

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
        type: "final",
        content: `I inspected the workspace. Available tools: ${availableTools.join(", ")}. The filesystem layer is operational.`
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
