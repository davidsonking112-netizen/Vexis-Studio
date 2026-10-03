import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFilesystemTools } from "../src/tools/filesystem.js";
import { createCodebaseTool } from "../src/tools/codebase.js";

async function createWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "vexis-codebase-"));
}

test("produces a bounded structural codebase summary", async () => {
  const workspace = await createWorkspace();

  try {
    await fs.mkdir(path.join(workspace, "src"));
    await fs.writeFile(
      path.join(workspace, "package.json"),
      JSON.stringify({
        name: "sample-project",
        version: "1.2.3",
        scripts: { test: "node --test", build: "node build.js" }
      })
    );
    await fs.writeFile(path.join(workspace, "src", "index.js"), "console.log('hello');");

    const filesystem = createFilesystemTools({ workspace });
    const tool = createCodebaseTool({ workspace, filesystem });
    const result = await tool.execute({});

    assert.equal(result.files, 2);
    assert.equal(result.directories, 1);
    assert.deepEqual(result.entryPoints, [{ path: "src/index.js" }]);
    assert.deepEqual(result.manifests, [{
      path: "package.json",
      type: "package.json",
      name: "sample-project",
      version: "1.2.3",
      packageManager: null,
      scripts: ["build", "test"]
    }]);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("respects the workspace boundary", async () => {
  const workspace = await createWorkspace();

  try {
    const filesystem = createFilesystemTools({ workspace });
    const tool = createCodebaseTool({ workspace, filesystem });

    await assert.rejects(
      tool.execute({ path: "../outside" }),
      /escapes the workspace/
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("respects the file inspection limit", async () => {
  const workspace = await createWorkspace();

  try {
    await fs.writeFile(path.join(workspace, "a.js"), "");
    await fs.writeFile(path.join(workspace, "b.js"), "");

    const filesystem = createFilesystemTools({ workspace });
    const tool = createCodebaseTool({ workspace, filesystem, maxFiles: 1 });
    const result = await tool.execute({});

    assert.equal(result.truncated, true);
    assert.equal(result.entries.length, 1);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("discovers entry points relative to a requested subdirectory", async () => {
  const workspace = await createWorkspace();

  try {
    await fs.mkdir(path.join(workspace, "src"));
    await fs.writeFile(path.join(workspace, "src", "index.js"), "export default 1;");

    const filesystem = createFilesystemTools({ workspace });
    const tool = createCodebaseTool({ workspace, filesystem });
    const result = await tool.execute({ path: "src" });

    assert.deepEqual(result.entryPoints, [{ path: "src/index.js" }]);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
