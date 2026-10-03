import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_IGNORES = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo"
]);

function normalizeRoot(root) {
  return path.resolve(root);
}

function resolveInside(root, requestedPath = ".") {
  const absoluteRoot = normalizeRoot(root);
  const target = path.resolve(absoluteRoot, requestedPath);
  const relative = path.relative(absoluteRoot, target);

  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Path escapes the workspace");
  }

  return target;
}

async function walk(directory, { root, ignores, results, maxEntries }) {
  if (results.length >= maxEntries) return;

  const entries = await fs.readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (results.length >= maxEntries) break;
    if (ignores.has(entry.name)) continue;

    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute) || ".";

    results.push({
      path: relative.split(path.sep).join("/"),
      type: entry.isDirectory() ? "directory" : "file"
    });

    if (entry.isDirectory()) {
      await walk(absolute, { root, ignores, results, maxEntries });
    }
  }
}

export function createFilesystemTools({
  workspace,
  ignores = DEFAULT_IGNORES,
  maxEntries = 2000,
  maxReadBytes = 1024 * 1024
}) {
  const root = normalizeRoot(workspace);

  return {
    list_files: {
      description: "List files and directories inside the workspace.",
      input: {
        path: "relative directory path, default .",
        max_entries: "optional maximum number of entries"
      },
      execute: async ({ path: requestedPath = ".", max_entries } = {}) => {
        const directory = resolveInside(root, requestedPath);
        const stat = await fs.stat(directory);

        if (!stat.isDirectory()) {
          throw new Error("Path is not a directory");
        }

        const results = [];
        await walk(directory, {
          root,
          ignores,
          results,
          maxEntries: Math.min(Number(max_entries) || maxEntries, maxEntries)
        });

        return {
          root: requestedPath,
          entries: results,
          truncated: results.length >= maxEntries
        };
      }
    },

    read_file: {
      description: "Read a UTF-8 text file inside the workspace.",
      input: {
        path: "relative file path"
      },
      execute: async ({ path: requestedPath } = {}) => {
        if (!requestedPath || requestedPath === ".") {
          throw new Error("A file path is required");
        }

        const file = resolveInside(root, requestedPath);
        const stat = await fs.stat(file);

        if (!stat.isFile()) {
          throw new Error("Path is not a file");
        }

        if (stat.size > maxReadBytes) {
          throw new Error(`File exceeds the ${maxReadBytes} byte read limit`);
        }

        return {
          path: requestedPath.split(path.sep).join("/"),
          bytes: stat.size,
          content: await fs.readFile(file, "utf8")
        };
      }
    }
  };
}

export function toAgentTools(filesystemTools) {
  return Object.fromEntries(
    Object.entries(filesystemTools).map(([name, definition]) => [
      name,
      definition.execute
    ])
  );
}
