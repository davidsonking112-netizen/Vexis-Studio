import { createInterface } from "node:readline/promises";

const COMMANDS = new Map([
  ["/help", "Show available commands."],
  ["/tools", "List registered tools."],
  ["/discover <query>", "Search tools by name or description."],
  ["/quit", "Exit Vexis."],
  ["/exit", "Exit Vexis."]
]);

function write(output, message = "") {
  output.write(message.endsWith("\n") ? message : message + "\n");
}

function renderResult(output, result) {
  if (result?.output) write(output, result.output);
  if (result?.status === "max_steps") write(output, "[agent] stopped at the configured step limit.");
}

export function createCli({ agent, registry, input = process.stdin, output = process.stdout, prompt = "vexis> " }) {
  if (!agent || typeof agent.run !== "function") throw new TypeError("agent.run must be a function");
  if (!registry || typeof registry.list !== "function" || typeof registry.discover !== "function") throw new TypeError("tool registry is required");

  async function handle(line) {
    const value = line.trim();
    if (!value) return { action: "continue" };
    if (value === "/quit" || value === "/exit") return { action: "exit" };
    if (value === "/help") {
      write(output, ["Vexis Studio", "", "Enter a task for the agent, or use:",
        ...[...COMMANDS.entries()].map(([command, description]) => `  ${command.padEnd(22)} ${description}`)].join("\n"));
      return { action: "continue" };
    }
    if (value === "/tools") {
      const tools = registry.list();
      write(output, tools.length ? tools.map(tool => `- ${tool.name}: ${tool.description}`).join("\n") : "No tools registered.");
      return { action: "continue" };
    }
    if (value.startsWith("/discover")) {
      const query = value.slice("/discover".length).trim();
      if (!query) { write(output, "Usage: /discover <query>"); return { action: "continue" }; }
      const matches = registry.discover(query);
      write(output, matches.length ? matches.map(tool => `- ${tool.name}: ${tool.description}`).join("\n") : "No matching tools.");
      return { action: "continue" };
    }
    const result = await agent.run(value);
    renderResult(output, result);
    return { action: "continue", result };
  }

  async function start() {
    write(output, "Vexis Studio — interactive coding agent");
    write(output, "Type /help for commands.");
    const rl = createInterface({ input, output, prompt });
    try {
      rl.prompt();
      for await (const line of rl) {
        const result = await handle(line);
        if (result.action === "exit") break;
        rl.prompt();
      }
    } finally {
      rl.close();
    }
  }

  return { handle, start };
}
