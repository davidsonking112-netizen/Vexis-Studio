import { promises as fs } from "node:fs";
import path from "node:path";

const MANIFESTS = [
  "package.json", "pyproject.toml", "requirements.txt", "Cargo.toml",
  "go.mod", "pom.xml", "build.gradle", "build.gradle.kts"
];

const ENTRY_CANDIDATES = [
  "src/index.js", "src/main.js", "src/app.js", "index.js",
  "main.js", "main.py", "app.py", "main.go", "src/main.rs"
];

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === "" ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative));
}

export function createCodebaseTool({
  workspace,
  filesystem,
  maxFiles = 2000,
  maxManifestBytes = 128 * 1024
}) {
  if (!workspace) throw new TypeError("workspace is required");
  if (!filesystem?.list_files?.execute || !filesystem?.read_file?.execute) {
    throw new TypeError("filesystem tools are required");
  }

  const root = path.resolve(workspace);

  return {
    description: "Build a bounded structural summary of the workspace for codebase-aware reasoning.",
    input: {
      path: "relative workspace directory, default .",
      max_files: "optional maximum number of files to inspect"
    },
    execute: async ({ path: requestedPath = ".", max_files } = {}) => {
      const directory = path.resolve(root, requestedPath);

      if (!isWithin(root, directory)) {
        throw new Error("Path escapes the workspace");
      }

      const relativeRoot = path.relative(root, directory);
      await fs.stat(directory);

      const limit = Math.min(
        Number.isInteger(Number(max_files)) && Number(max_files) > 0
          ? Number(max_files)
          : maxFiles,
        maxFiles
      );

      const entriesResult = await filesystem.list_files.execute({
        path: requestedPath,
        max_entries: limit
      });

      const files = entriesResult.entries.filter(entry => entry.type === "file");
      const directories = entriesResult.entries.filter(entry => entry.type === "directory");

      const manifests = [];

      for (const entry of files) {
        const name = path.basename(entry.path);
        if (!MANIFESTS.includes(name)) continue;

        const absolute = path.resolve(root, entry.path);

        try {
          const stat = await fs.stat(absolute);
          if (stat.size > maxManifestBytes) {
            manifests.push({ path: entry.path, error: "Manifest exceeds size limit" });
            continue;
          }

          if (name === "package.json") {
            const content = await filesystem.read_file.execute({ path: entry.path });
            const parsed = JSON.parse(content.content);

            manifests.push({
              path: entry.path,
              type: "package.json",
              name: parsed.name ?? null,
              version: parsed.version ?? null,
              packageManager: parsed.packageManager ?? null,
              scripts: parsed.scripts ? Object.keys(parsed.scripts).sort() : []
            });
          } else {
            manifests.push({ path: entry.path, type: name });
          }
        } catch (error) {
          manifests.push({ path: entry.path, error: error.message });
        }
      }

      const scopedCandidates = relativeRoot
        ? ["index.js", "main.js", "app.js", "main.py", "app.py", "main.go", "main.rs"]
        : ENTRY_CANDIDATES;

      const entryPoints = scopedCandidates
        .map(candidate => path.join(relativeRoot, candidate).split(path.sep).join("/"))
        .filter(candidate => files.some(entry => entry.path === candidate))
        .map(candidate => ({ path: candidate }));

      return {
        root: requestedPath,
        files: files.length,
        directories: directories.length,
        entries: entriesResult.entries,
        truncated: entriesResult.truncated,
        manifests,
        entryPoints
      };
    }
  };
}

export function toAgentCodebaseTool(codebaseTool) {
  return { inspect_codebase: codebaseTool.execute };
}
