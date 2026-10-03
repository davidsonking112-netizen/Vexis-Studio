import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTestTool } from "../src/tools/test.js";

async function createWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "vexis-test-"));
}

async function writePackage(workspace, packageJson) {
  await fs.writeFile(
    path.join(workspace, "package.json"),
    JSON.stringify(packageJson, null, 2)
  );
}

async function writeScript(workspace, name, content) {
  await fs.writeFile(path.join(workspace, name), content, "utf8");
}

test("runs the declared npm test script and returns structured diagnostics", async () => {
  const workspace = await createWorkspace();

  try {
    await writePackage(workspace, {
      name: "fixture",
      scripts: {
        test: "node pass.js"
      }
    });
    await writeScript(workspace, "pass.js", "process.stdout.write('verification ok');");

    const calls = [];
    const command = {
      execute: async (input) => {
        calls.push(input);
        return {
          ok: true,
          exitCode: 0,
          signal: null,
          timedOut: false,
          outputLimitReached: false,
          stdout: "verification ok",
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
          durationMs: 1
        };
      }
    };
    const tool = createTestTool({ workspace, command });

    const result = await tool.execute();

    assert.deepEqual(calls, [{ command: "npm", args: ["test"], timeout_ms: 120000 }]);

    assert.equal(result.status, "passed");
    assert.deepEqual(result.command, ["npm", "test"]);
    assert.equal(result.exit_code, 0);
    assert.match(result.stdout, /verification ok/);
    assert.deepEqual(result.diagnostics, []);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("reports a failing test command without throwing", async () => {
  const workspace = await createWorkspace();

  try {
    await writePackage(workspace, {
      name: "fixture",
      scripts: {
        test: "node fail.js"
      }
    });
    await writeScript(workspace, "fail.js", "process.stderr.write('failure detail'); process.exit(2);");

    const calls = [];
    const command = {
      execute: async (input) => {
        calls.push(input);
        return {
          ok: false,
          exitCode: 2,
          signal: null,
          timedOut: false,
          outputLimitReached: false,
          stdout: "",
          stderr: "failure detail",
          stdoutTruncated: false,
          stderrTruncated: false,
          durationMs: 1
        };
      }
    };
    const tool = createTestTool({ workspace, command });

    const result = await tool.execute();

    assert.deepEqual(calls, [{ command: "npm", args: ["test"], timeout_ms: 120000 }]);

    assert.equal(result.status, "failed");
    // npm propagates lifecycle failures as exit code 1 on Windows, while\n    // Unix npm versions preserve the script exit code in this fixture.\n    const expectedExitCode = process.platform === "win32" ? 1 : 2;\n    assert.equal(result.exit_code, expectedExitCode);
    assert.match(result.stderr, /failure detail/);
    assert.equal(result.diagnostics.length, 2);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("reports unavailable verification when no test script exists", async () => {
  const workspace = await createWorkspace();

  try {
    await writePackage(workspace, {
      name: "fixture",
      scripts: {}
    });

    const command = { execute: async () => { throw new Error("should not execute"); } };
    const tool = createTestTool({ workspace, command });

    const result = await tool.execute();

    assert.equal(result.status, "unavailable");
    assert.match(result.reason, /does not declare a test script/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
