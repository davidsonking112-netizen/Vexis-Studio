import { createRuntime } from "./runtime.js";
import { createTui } from "./tui.js";
import { createCli } from "./cli.js";

const { agent, registry } = createRuntime();

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  await createCli({ agent, registry }).start();
} else {
  await createTui({ agent, registry }).start();
}
