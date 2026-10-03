import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const SKIP = new Set(["index.js", "cli-entry.js", "tui-entry.js", "desktop-entry.js"]);

async function collect(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(absolute));
    else if (entry.isFile() && entry.name.endsWith(".js") && !SKIP.has(entry.name)) files.push(absolute);
  }
  return files.sort();
}

test("all non-entry source modules are importable", async () => {
  const files = await collect(root);
  assert.ok(files.length > 0);
  for (const file of files) {
    await assert.doesNotReject(import(pathToFileURL(file).href), file);
  }
});
