import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createFilesystemTools } from "../src/tools/filesystem.js";
import { createEditTool } from "../src/tools/edit.js";

async function createWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "vexis-edit-"));
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

test("applies an exact text replacement with a content hash", async () => {
  const workspace = await createWorkspace();

  try {
    const file = path.join(workspace, "hello.js");
    const before = "const message = 'old';\n";
    await fs.writeFile(file, before);

    const filesystem = createFilesystemTools({ workspace });
    const tool = createEditTool({ workspace, filesystem });

    const result = await tool.execute({
      path: "hello.js",
      expected_sha256: sha256(before),
      old_text: "'old'",
      new_text: "'new'"
    });

    assert.equal(result.changed, true);
    assert.equal(result.replacements, 1);
    assert.equal(result.before_sha256, sha256(before));
    assert.equal(
      result.after_sha256,
      sha256("const message = 'new';\n")
    );
    assert.equal(
      await fs.readFile(file, "utf8"),
      "const message = 'new';\n"
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("rejects stale edits without changing the file", async () => {
  const workspace = await createWorkspace();

  try {
    const file = path.join(workspace, "hello.js");
    const current = "const value = 2;\n";
    await fs.writeFile(file, current);

    const filesystem = createFilesystemTools({ workspace });
    const tool = createEditTool({ workspace, filesystem });

    await assert.rejects(
      tool.execute({
        path: "hello.js",
        expected_sha256: sha256("const value = 1;\n"),
        old_text: "2",
        new_text: "3"
      }),
      /content changed/
    );

    assert.equal(await fs.readFile(file, "utf8"), current);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("requires exactly one replacement by default", async () => {
  const workspace = await createWorkspace();

  try {
    const file = path.join(workspace, "hello.js");
    const current = "x();\nx();\n";
    await fs.writeFile(file, current);

    const filesystem = createFilesystemTools({ workspace });
    const tool = createEditTool({ workspace, filesystem });

    await assert.rejects(
      tool.execute({
        path: "hello.js",
        expected_sha256: sha256(current),
        old_text: "x();",
        new_text: "y();"
      }),
      /expected exactly 1 match/
    );

    assert.equal(await fs.readFile(file, "utf8"), current);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("allows an explicit replacement count", async () => {
  const workspace = await createWorkspace();

  try {
    const file = path.join(workspace, "hello.js");
    const current = "x();\nx();\n";
    await fs.writeFile(file, current);

    const filesystem = createFilesystemTools({ workspace });
    const tool = createEditTool({ workspace, filesystem });

    const result = await tool.execute({
      path: "hello.js",
      expected_sha256: sha256(current),
      old_text: "x();",
      new_text: "y();",
      expected_replacements: 2
    });

    assert.equal(result.replacements, 2);
    assert.equal(await fs.readFile(file, "utf8"), "y();\ny();\n");
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("rejects workspace escapes", async () => {
  const workspace = await createWorkspace();

  try {
    const filesystem = createFilesystemTools({ workspace });
    const tool = createEditTool({ workspace, filesystem });

    await assert.rejects(
      tool.execute({
        path: "../outside.js",
        expected_sha256: "0".repeat(64),
        old_text: "a",
        new_text: "b"
      }),
      /escapes the workspace/
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("supports an explicit no-op when replacement is identical", async () => {
  const workspace = await createWorkspace();

  try {
    const file = path.join(workspace, "hello.js");
    const current = "const value = 1;\n";
    await fs.writeFile(file, current);

    const filesystem = createFilesystemTools({ workspace });
    const tool = createEditTool({ workspace, filesystem });

    const result = await tool.execute({
      path: "hello.js",
      expected_sha256: sha256(current),
      old_text: "1",
      new_text: "1"
    });

    assert.equal(result.changed, false);
    assert.equal(result.replacements, 1);
    assert.equal(result.before_sha256, result.after_sha256);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
