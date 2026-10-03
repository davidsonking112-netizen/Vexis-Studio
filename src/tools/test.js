import { promises as fs } from "node:fs";
import path from "node:path";

const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);

function normalizePackageManager(value) {
  if (typeof value !== "string") return "npm";
  const name = value.split("@")[0].trim().toLowerCase();
  return PACKAGE_MANAGERS.has(name) ? name : "npm";
}

export function createTestTool({
  workspace,
  command,
  timeoutMs = 120_000
}) {
  if (!workspace) throw new TypeError("workspace is required");
  if (!command?.execute) throw new TypeError("command tool is required");

  const root = path.resolve(workspace);

  return {
    description: "Run the workspace's declared test script and return bounded verification diagnostics.",
    input: {
      timeout_ms: "optional test timeout in milliseconds"
    },

    execute: async ({ timeout_ms } = {}) => {
      const manifestPath = path.join(root, "package.json");

      let manifest;
      try {
        const content = await fs.readFile(manifestPath, "utf8");
        manifest = JSON.parse(content);
      } catch (error) {
        if (error?.code === "ENOENT") {
          return {
            status: "unavailable",
            reason: "No package.json test manifest was found"
          };
        }

        return {
          status: "unavailable",
          reason: `Unable to read package.json: ${error.message}`
        };
      }

      if (!manifest?.scripts?.test || typeof manifest.scripts.test !== "string") {
        return {
          status: "unavailable",
          reason: "package.json does not declare a test script"
        };
      }

      const packageManager = normalizePackageManager(manifest.packageManager);
      const result = await command.execute({
        command: packageManager,
        args: ["test"],
        timeout_ms: timeout_ms ?? timeoutMs
      });

      return {
        status: result.ok ? "passed" : "failed",
        command: [packageManager, "test"],
        exit_code: result.exitCode,
        signal: result.signal,
        timed_out: result.timedOut,
        output_limit_reached: result.outputLimitReached,
        stdout: result.stdout,
        stderr: result.stderr,
        stdout_truncated: result.stdoutTruncated,
        stderr_truncated: result.stderrTruncated,
        duration_ms: result.durationMs,
        diagnostics: result.ok
          ? []
          : [
              "Test command exited unsuccessfully or was interrupted.",
              result.stderr || result.stdout || "No test output was captured."
            ]
      };
    }
  };
}

export function toAgentTestTool(testTool) {
  return { run_tests: testTool.execute };
}
