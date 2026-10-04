import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_IGNORES = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".turbo"]);
const DEFAULT_MAX_RESULTS = 100;
const DEFAULT_MAX_FILES = 500;
const DEFAULT_MAX_READ_BYTES = 1024 * 1024;

function resolveInside(root, requestedPath = ".") {
  const target = path.resolve(root, requestedPath);
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Path escapes the workspace");
  }
  return target;
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function isBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return sample.includes(0);
}

function normalizeLimit(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) throw new TypeError("max_results must be a positive integer");
  return Math.min(value, maximum);
}

function assertSearchablePath(root, target, ignores) {
  const relative = path.relative(root, target);
  const parts = relative ? relative.split(path.sep) : [];
  if (parts.some(part => part.startsWith(".") || ignores.has(part))) {
    throw new Error("Hidden or ignored paths are not searchable");
  }
}

async function walk(directory, root, ignores, files, maxFiles) {
  if (files.length >= maxFiles) return;
  const entries = await fs.readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (files.length >= maxFiles) break;
    if (entry.name.startsWith(".") || ignores.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await walk(absolute, root, ignores, files, maxFiles);
    } else if (entry.isFile()) {
      files.push({ absolute, relative: path.relative(root, absolute).split(path.sep).join("/") });
    }
  }
}

export function createSearchTool({ workspace, ignores = DEFAULT_IGNORES, maxResults = DEFAULT_MAX_RESULTS, maxFiles = DEFAULT_MAX_FILES, maxReadBytes = DEFAULT_MAX_READ_BYTES } = {}) {
  if (!workspace) throw new TypeError("workspace is required");
  if (!Number.isInteger(maxResults) || maxResults < 1) throw new TypeError("maxResults must be a positive integer");
  if (!Number.isInteger(maxFiles) || maxFiles < 1) throw new TypeError("maxFiles must be a positive integer");
  if (!Number.isInteger(maxReadBytes) || maxReadBytes < 1) throw new TypeError("maxReadBytes must be a positive integer");
  const root = path.resolve(workspace);

  return {
    description: "Search UTF-8 text files inside the workspace without following symlinks.",
    input: {
      query: "literal text to search for",
      path: "optional relative directory or file path, default .",
      case_sensitive: "optional boolean, default false",
      max_results: "optional maximum number of matches"
    },
    execute: async ({ query, path: requestedPath = ".", case_sensitive: caseSensitive = false, max_results: requestedMax } = {}) => {
      if (typeof query !== "string" || query.length === 0) throw new TypeError("query must be a non-empty string");
      if (typeof caseSensitive !== "boolean") throw new TypeError("case_sensitive must be a boolean");
      const limit = normalizeLimit(requestedMax, maxResults, maxResults);
      const target = resolveInside(root, requestedPath);
      const targetLink = await fs.lstat(target);
      if (targetLink.isSymbolicLink()) throw new Error("Symlink paths are not searchable");
      assertSearchablePath(root, target, ignores);
      const realRoot = await fs.realpath(root);
      const realTarget = await fs.realpath(target);
      if (!isWithin(realRoot, realTarget)) throw new Error("Path escapes the workspace");
      const stat = await fs.stat(realTarget);
      const files = [];
      if (stat.isDirectory()) {
        await walk(realTarget, realRoot, ignores, files, maxFiles);
      } else if (stat.isFile()) {
        files.push({ absolute: realTarget, relative: path.relative(realRoot, realTarget).split(path.sep).join("/") });
      } else {
        throw new Error("Path is not a file or directory");
      }

      const needle = caseSensitive ? query : query.toLocaleLowerCase();
      const matches = [];
      let filesScanned = 0;
      let truncated = files.length >= maxFiles;
      for (const file of files) {
        if (matches.length > limit) { truncated = true; break; }
        const fileStat = await fs.stat(file.absolute);
        if (fileStat.size > maxReadBytes) { truncated = true; continue; }
        const buffer = await fs.readFile(file.absolute);
        if (isBinary(buffer)) continue;
        filesScanned += 1;
        const content = buffer.toString("utf8");
        const lines = content.split(/\r?\n/);
        for (let index = 0; index < lines.length && matches.length <= limit; index += 1) {
          const line = lines[index];
          const haystack = caseSensitive ? line : line.toLocaleLowerCase();
          let offset = haystack.indexOf(needle);
          while (offset >= 0 && matches.length <= limit) {
            matches.push({ path: file.relative, line: index + 1, column: offset + 1, text: line });
            offset = haystack.indexOf(needle, offset + Math.max(needle.length, 1));
          }
        }
      }
      if (matches.length > limit) truncated = true;
      return { query, matches: matches.slice(0, limit), truncated, files_scanned: filesScanned };
    }
  };
}
