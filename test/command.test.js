import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCommandTool } from "../src/tools/command.js";

async function createWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "vexis-command-"));
}

test("runs an allowed command in the workspace", async () => {
  const workspace = await createWorkspace();

  try {
    const tool = createCommandTool({ workspace });
    const result = await tool.execute({
      command: process.execPath,
      args: ["-e", "process.stdout.write(process.cwd())"]
    });

    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.equal(path.resolve(result.stdout), workspace);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("does not invoke a shell", async () => {
  const workspace = await createWorkspace();

  try {
    const tool = createCommandTool({
      workspace,
      allowedCommands: new Set([path.basename(process.execPath)])
    });

    const result = await tool.execute({
      command: process.execPath,
      args: ["-e", "process.stdout.write('safe')"]
    });

    assert.equal(result.stdout, "safe");
    assert.equal(result.ok, true);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("rejects commands outside the allowlist", async () => {
  const workspace = await createWorkspace();

  try {
    const tool = createCommandTool({
      workspace,
      allowedCommands: new Set(["node"])
    });

    await assert.rejects(
      tool.execute({ command: "sh", args: ["-c", "echo unsafe"] }),
      /Command is not allowed/
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("requires approval before execution", async () => {
  const workspace = await createWorkspace();
  let approved = false;

  try {
    const tool = createCommandTool({
      workspace,
      approval: async () => approved
    });

    await assert.rejects(
      tool.execute({
        command: process.execPath,
        args: ["-e", "process.stdout.write('should not run')"]
      }),
      /not approved/
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("enforces the execution timeout", async () => {
  const workspace = await createWorkspace();

  try {
    const tool = createCommandTool({
      workspace,
      timeoutMs: 50
    });

    const result = await tool.execute({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 1000)"]
    });

    assert.equal(result.ok, false);
    assert.equal(result.timedOut, true);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("bounds captured output", async () => {
  const workspace = await createWorkspace();

  try {
    const tool = createCommandTool({
      workspace,
      maxOutputBytes: 32
    });

    const result = await tool.execute({
      command: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(1000))"]
    });

    assert.equal(result.ok, false);
    assert.equal(result.outputLimitReached, true);
    assert.equal(result.stdoutTruncated, true);
    assert.ok(Buffer.byteLength(result.stdout, "utf8") <= 32);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
