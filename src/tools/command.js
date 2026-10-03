import { spawn } from "node:child_process";
import path from "node:path";

const DEFAULT_ALLOWED_COMMANDS = new Set([
  "bun",
  "cargo",
  "git",
  "go",
  "java",
  "javac",
  "node",
  "npm",
  "npx",
  "pnpm",
  "pytest",
  "python",
  "python3",
  "rustc",
  "yarn"
]);

function commandName(command) {
  return path.basename(command).toLowerCase().replace(/\\.exe$/i, "");
}

function appendOutput(state, chunk, maxOutputBytes) {
  const text = chunk.toString("utf8");
  const remaining = maxOutputBytes - state.bytes;

  if (remaining <= 0) {
    state.truncated = true;
    return false;
  }

  if (Buffer.byteLength(text, "utf8") > remaining) {
    state.parts.push(Buffer.from(text, "utf8").subarray(0, remaining).toString("utf8"));
    state.bytes = maxOutputBytes;
    state.truncated = true;
    return false;
  }

  state.parts.push(text);
  state.bytes += Buffer.byteLength(text, "utf8");
  return true;
}

export function createCommandTool({
  workspace,
  allowedCommands = DEFAULT_ALLOWED_COMMANDS,
  timeoutMs = 30_000,
  maxOutputBytes = 256 * 1024,
  approval = async () => true
}) {
  if (!workspace) {
    throw new TypeError("workspace is required");
  }

  const root = path.resolve(workspace);
  const allowed = new Set(
    [...allowedCommands].map(value => commandName(String(value)))
  );

  return {
    description: "Run an approved development command in the workspace without invoking a shell.",
    input: {
      command: "executable name, such as node, npm, git, or pytest",
      args: "array of command arguments",
      timeout_ms: "optional timeout in milliseconds"
    },

    execute: async ({ command, args = [], timeout_ms } = {}) => {
      if (typeof command !== "string" || command.trim() === "") {
        throw new Error("A command is required");
      }

      if (!Array.isArray(args) || args.some(arg => typeof arg !== "string")) {
        throw new Error("args must be an array of strings");
      }

      const name = commandName(command);

      if (!allowed.has(name)) {
        throw new Error(`Command is not allowed: ${name}`);
      }

      const requestedTimeout = Number(timeout_ms);
      const effectiveTimeout =
        Number.isFinite(requestedTimeout) && requestedTimeout > 0
          ? Math.min(requestedTimeout, timeoutMs)
          : timeoutMs;

      const approved = await approval({
        command,
        args,
        cwd: root,
        timeoutMs: effectiveTimeout
      });

      if (!approved) {
        throw new Error("Command execution was not approved");
      }

      const startedAt = Date.now();
      const stdout = { parts: [], bytes: 0, truncated: false };
      const stderr = { parts: [], bytes: 0, truncated: false };

      return await new Promise((resolve, reject) => {
        let settled = false;
        let timedOut = false;
        let outputLimitReached = false;

        const child = spawn(command, args, {
          cwd: root,
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"]
        });

        const finish = result => {
          if (settled) return;
          settled = true;
          resolve({
            ...result,
            stdout: stdout.parts.join(""),
            stderr: stderr.parts.join(""),
            stdoutTruncated: stdout.truncated,
            stderrTruncated: stderr.truncated,
            durationMs: Date.now() - startedAt
          });
        };

        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, effectiveTimeout);

        child.stdout.on("data", chunk => {
          if (!appendOutput(stdout, chunk, maxOutputBytes)) {
            outputLimitReached = true;
            child.kill("SIGTERM");
          }
        });

        child.stderr.on("data", chunk => {
          if (!appendOutput(stderr, chunk, maxOutputBytes)) {
            outputLimitReached = true;
            child.kill("SIGTERM");
          }
        });

        child.on("error", error => {
          clearTimeout(timer);

          if (settled) return;
          settled = true;
          reject(new Error(`Failed to start command: ${error.message}`));
        });

        child.on("close", (exitCode, signal) => {
          clearTimeout(timer);

          finish({
            exitCode,
            signal,
            timedOut,
            outputLimitReached,
            ok: !timedOut && !outputLimitReached && exitCode === 0
          });
        });
      });
    }
  };
}

export function toAgentCommandTool(commandTool) {
  return {
    run_command: commandTool.execute
  };
}
