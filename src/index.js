import { Agent } from "./agent.js";

const model = {
  async next({ messages, tools }) {
    const last = messages.at(-1);

    if (last?.role === "user") {
      return {
        type: "final",
        content: "Agent kernel is running. No tools are installed yet."
      };
    }

    return {
      type: "final",
      content: "Done."
    };
  }
};

const agent = new Agent({ model });

const task = process.argv.slice(2).join(" ") || "Start Vexis Studio";
const result = await agent.run(task);

console.log(result.output);
