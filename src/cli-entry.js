import { createRuntime } from "./runtime.js";
import { createCli } from "./cli.js";

const { agent, registry } = createRuntime();
await createCli({ agent, registry }).start();
