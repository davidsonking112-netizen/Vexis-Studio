import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFilesystemTools } from "../src/tools/filesystem.js";
import { createRepositoryIntelligence } from "../src/repository/engine.js";

async function workspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vexis-repo-"));
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src", "a.js"), 'export function alpha() { return 1; }\nimport { beta } from "./b.js";\n');
  await fs.writeFile(path.join(root, "src", "b.js"), 'export const beta = 2;\nexport class Thing {}\n');
  return root;
}

test("repository intelligence indexes symbols and local dependency edges", async () => {
  const root = await workspace();
  const filesystem = createFilesystemTools({ workspace: root });
  const intelligence = createRepositoryIntelligence({ workspace: root, filesystem });
  const result = await intelligence.inspect({ query: "alpha" });
  assert.equal(result.symbols[0].name, "alpha");
  assert.ok(result.dependencies.some(d => d.from === "src/a.js" && d.to === "src/b.js"));
  const reverse = await intelligence.dependencies({ file: "src/b.js" });
  assert.deepEqual(reverse.dependents, ["src/a.js"]);
});

test("repository intelligence resolves explicit file queries and refreshes", async () => {
  const root = await workspace();
  const filesystem = createFilesystemTools({ workspace: root });
  const intelligence = createRepositoryIntelligence({ workspace: root, filesystem });
  const first = await intelligence.inspect({ file: "src/b.js" });
  assert.ok(first.symbols.some(s => s.name === "Thing" && s.kind === "class"));
  await fs.writeFile(path.join(root, "src", "b.js"), 'export const gamma = 3;\n');
  const stale = await intelligence.inspect({ file: "src/b.js" });
  assert.ok(stale.symbols.some(s => s.name === "Thing"));
  const fresh = await intelligence.inspect({ file: "src/b.js", refresh: true });
  assert.ok(fresh.symbols.some(s => s.name === "gamma"));
  assert.ok(!fresh.symbols.some(s => s.name === "Thing"));
});

test("repository intelligence excludes dependency and build directories", async () => {
  const root = await workspace();
  await fs.mkdir(path.join(root, "node_modules", "fake"), { recursive: true });
  await fs.writeFile(path.join(root, "node_modules", "fake", "bad.js"), "export function bad() {}");
  const filesystem = createFilesystemTools({ workspace: root });
  const intelligence = createRepositoryIntelligence({ workspace: root, filesystem });
  const result = await intelligence.inspect({});
  assert.ok(!result.symbols.some(s => s.name === "bad"));
});


test("repository intelligence keeps dependency coverage after the symbol budget is reached", async () => {
  const root = await workspace();
  const filesystem = createFilesystemTools({ workspace: root });
  const intelligence = createRepositoryIntelligence({ workspace: root, filesystem, maxSymbols: 1 });
  const result = await intelligence.inspect({});
  assert.equal(result.symbols, 1);
  assert.ok(result.dependencies.some(d => d.from === "src/a.js" && d.to === "src/b.js"));
});
