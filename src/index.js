import { createRuntime } from "./runtime.js";

const { agent } = createRuntime();
const task = process.argv.slice(2).join(" ") || "Inspect this workspace";
const result = await agent.run(task);

console.log(result.output);
