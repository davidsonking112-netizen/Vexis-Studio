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

test("prevents lexical workspace escape", async () => {
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

test("does not follow symlinks while listing", async t => {
  const workspace = await createWorkspace();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "vexis-outside-"));

  try {
    await fs.writeFile(path.join(outside, "secret.txt"), "outside");
    try {
      await fs.symlink(outside, path.join(workspace, "linked"));
    } catch (error) {
      if (error?.code === "EPERM" || error?.code === "EACCES") {
        t.skip("Windows symlink creation requires the required OS privilege");
        return;
      }
      throw error;
    }

    const tools = createFilesystemTools({ workspace });
    const result = await tools.list_files.execute({});

    assert.deepEqual(result.entries, [
      { path: "linked", type: "symlink" }
    ]);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("rejects a symlink that points outside the workspace", async t => {
  const workspace = await createWorkspace();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "vexis-outside-"));

  try {
    await fs.writeFile(path.join(outside, "secret.txt"), "outside");
    try {
      await fs.symlink(
        path.join(outside, "secret.txt"),
        path.join(workspace, "secret.txt")
      );
    } catch (error) {
      if (error?.code === "EPERM" || error?.code === "EACCES") {
        t.skip("Windows symlink creation requires the required OS privilege");
        return;
      }
      throw error;
    }

    const tools = createFilesystemTools({ workspace });

    await assert.rejects(
      tools.read_file.execute({ path: "secret.txt" }),
      /escapes the workspace/
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("honors a caller entry limit", async () => {
  const workspace = await createWorkspace();

  try {
    await fs.writeFile(path.join(workspace, "a.txt"), "");
    await fs.writeFile(path.join(workspace, "b.txt"), "");

    const tools = createFilesystemTools({ workspace, maxEntries: 10 });
    const result = await tools.list_files.execute({ max_entries: 1 });

    assert.equal(result.entries.length, 1);
    assert.equal(result.truncated, true);
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
