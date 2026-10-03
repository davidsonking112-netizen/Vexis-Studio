import { createRuntime } from "./runtime.js";
import { createDesktop } from "./desktop.js";

const { agent, registry } = createRuntime();
const desktop = createDesktop({ agent, registry });
const address = await desktop.start();

process.stdout.write(`Vexis Desktop: ${address.url}\n`);
process.stdout.write("Press Ctrl+C to stop.\n");

const shutdown = async () => {
  await desktop.stop();
  process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
