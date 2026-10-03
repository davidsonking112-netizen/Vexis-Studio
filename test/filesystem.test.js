import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFilesystemTools } from "../src/tools/filesystem.js";

async function createWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "vexis-"));
}

test("lists workspace files deterministically", async () => {
  const workspace = await createWorkspace();

  try {
    await fs.mkdir(path.join(workspace, "src"));
    await fs.writeFile(path.join(workspace, "README.md"), "hello");
    await fs.writeFile(path.join(workspace, "src", "index.js"), "export {};");

    const tools = createFilesystemTools({ workspace });
    const result = await tools.list_files.execute({});

    assert.deepEqual(result.entries, [
      { path: "README.md", type: "file" },
      { path: "src", type: "directory" },
      { path: "src/index.js", type: "file" }
    ]);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("reads a text file", async () => {
  const workspace = await createWorkspace();

  try {
    await fs.writeFile(path.join(workspace, "hello.txt"), "hello Vexis");

    const tools = createFilesystemTools({ workspace });
    const result = await tools.read_file.execute({ path: "hello.txt" });

    assert.equal(result.content, "hello Vexis");
    assert.equal(result.bytes, 11);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("prevents workspace escape", async () => {
  const workspace = await createWorkspace();

  try {
    const tools = createFilesystemTools({ workspace });

    await assert.rejects(
      tools.read_file.execute({ path: "../outside.txt" }),
      /escapes the workspace/
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("ignores dependency and VCS directories by default", async () => {
  const workspace = await createWorkspace();

  try {
    await fs.mkdir(path.join(workspace, "node_modules"));
    await fs.writeFile(path.join(workspace, "node_modules", "hidden.js"), "");
    await fs.mkdir(path.join(workspace, ".git"));
    await fs.writeFile(path.join(workspace, ".git", "config"), "");

    const tools = createFilesystemTools({ workspace });
    const result = await tools.list_files.execute({});

    assert.deepEqual(result.entries, []);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
