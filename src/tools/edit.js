import { promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

function hashText(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function resolveInside(root, requestedPath) {
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absoluteRoot, requestedPath);
  const relative = path.relative(absoluteRoot, target);

  if (
    relative === ".." ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Path escapes the workspace");
  }

  return target;
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === "" ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative));
}

async function assertRealPathInside(root, target) {
  const realRoot = await fs.realpath(root);
  const realTarget = await fs.realpath(target);

  if (!isWithin(realRoot, realTarget)) {
    throw new Error("Path escapes the workspace");
  }

  return realTarget;
}

async function atomicWrite(file, content, mode) {
  const directory = path.dirname(file);
  const temporary = path.join(
    directory,
    `.vexis-edit-${process.pid}-${randomUUID()}.tmp`
  );

  try {
    await fs.writeFile(temporary, content, { encoding: "utf8", mode });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export function createEditTool({
  workspace,
  filesystem,
  maxFileBytes = 1024 * 1024
}) {
  if (!workspace) throw new TypeError("workspace is required");
  if (!filesystem?.read_file?.execute) {
    throw new TypeError("filesystem tools are required");
  }

  const root = path.resolve(workspace);

  return {
    description: "Apply an exact, hash-guarded text replacement to one workspace file.",
    input: {
      path: "relative file path",
      expected_sha256: "SHA-256 of the complete file content before editing",
      old_text: "exact text to replace",
      new_text: "replacement text",
      expected_replacements: "optional exact number of matches, default 1"
    },

    execute: async ({
      path: requestedPath,
      expected_sha256,
      old_text,
      new_text,
      expected_replacements = 1
    } = {}) => {
      if (!requestedPath || requestedPath === ".") {
        throw new Error("A file path is required");
      }

      if (
        typeof expected_sha256 !== "string" ||
        !/^[a-f0-9]{64}$/i.test(expected_sha256)
      ) {
        throw new Error("expected_sha256 must be a SHA-256 hex digest");
      }

      if (typeof old_text !== "string" || old_text.length === 0) {
        throw new Error("old_text must be a non-empty string");
      }

      if (typeof new_text !== "string") {
        throw new Error("new_text must be a string");
      }

      const replacementCount = Number(expected_replacements);
      if (!Number.isInteger(replacementCount) || replacementCount < 1) {
        throw new Error("expected_replacements must be a positive integer");
      }

      const file = resolveInside(root, requestedPath);
      const safeFile = await assertRealPathInside(root, file);
      const stat = await fs.stat(safeFile);

      if (!stat.isFile()) {
        throw new Error("Path is not a file");
      }

      if (stat.size > maxFileBytes) {
        throw new Error(`File exceeds the ${maxFileBytes} byte edit limit`);
      }

      const current = await fs.readFile(safeFile, "utf8");
      const beforeSha = hashText(current);

      if (beforeSha.toLowerCase() !== expected_sha256.toLowerCase()) {
        throw new Error("File content changed; refusing stale edit");
      }

      let matches = 0;
      let offset = 0;

      while (true) {
        const index = current.indexOf(old_text, offset);
        if (index === -1) break;
        matches += 1;
        offset = index + old_text.length;
      }

      if (matches !== replacementCount) {
        throw new Error(
          `Found ${matches} matches; expected exactly ${replacementCount} match${replacementCount === 1 ? "" : "es"}`
        );
      }

      const updated = current.split(old_text).join(new_text);
      const afterSha = hashText(updated);

      if (updated === current) {
        return {
          path: requestedPath.split(path.sep).join("/"),
          changed: false,
          replacements: matches,
          before_sha256: beforeSha,
          after_sha256: afterSha
        };
      }

      await atomicWrite(safeFile, updated, stat.mode);

      return {
        path: requestedPath.split(path.sep).join("/"),
        changed: true,
        replacements: matches,
        before_sha256: beforeSha,
        after_sha256: afterSha
      };
    }
  };
}

export function toAgentEditTool(editTool) {
  return { edit_file: editTool.execute };
}
