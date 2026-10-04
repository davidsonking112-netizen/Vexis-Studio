import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSearchTool } from "../src/tools/search.js";
import { createRuntime } from "../src/runtime.js";

async function fixture() {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "vexis-search-"));
  await fs.mkdir(path.join(workspace, "src"));
  await fs.mkdir(path.join(workspace, "node_modules"));
  await fs.mkdir(path.join(workspace, ".hidden"));
  await fs.writeFile(path.join(workspace, "src", "b.txt"), "Alpha here\nalpha again\n");
  await fs.writeFile(path.join(workspace, "src", "a.txt"), "nothing\nAlpha last\n");
  await fs.writeFile(path.join(workspace, "node_modules", "ignored.txt"), "Alpha ignored\n");
  await fs.writeFile(path.join(workspace, ".hidden", "ignored.txt"), "Alpha hidden\n");
  await fs.writeFile(path.join(workspace, "binary.bin"), Buffer.from([65, 0, 66]));
  await fs.symlink(path.join(workspace, "src"), path.join(workspace, "linked-src"));
  return workspace;
}

test("search finds deterministic literal matches with line locations", async () => {
  const workspace = await fixture();
  const search = createSearchTool({ workspace }).execute;
  const result = await search({ query: "alpha" });
  assert.deepEqual(result.matches, [
    { path: "src/a.txt", line: 2, column: 1, text: "Alpha last" },
    { path: "src/b.txt", line: 1, column: 1, text: "Alpha here" },
    { path: "src/b.txt", line: 2, column: 1, text: "alpha again" }
  ]);
  assert.equal(result.files_scanned, 2);
  assert.equal(result.truncated, false);
});

test("search supports case sensitivity and result limits", async () => {
  const workspace = await fixture();
  const search = createSearchTool({ workspace, maxResults: 10 }).execute;
  const sensitive = await search({ query: "alpha", case_sensitive: true });
  assert.equal(sensitive.matches.length, 1);
  const limited = await search({ query: "alpha", max_results: 2 });
  assert.equal(limited.matches.length, 2);
  assert.equal(limited.truncated, true);
  const exact = await search({ query: "alpha", max_results: 10 });
  assert.equal(exact.matches.length, 3);
  assert.equal(exact.truncated, false);
});

test("search rejects escapes and malformed input", async () => {
  const workspace = await fixture();
  const search = createSearchTool({ workspace }).execute;
  await assert.rejects(() => search({ query: "x", path: "../" }), /escapes the workspace/);
  await assert.rejects(() => search({ query: "" }), /non-empty/);
  await assert.rejects(() => search({ query: "x", case_sensitive: "yes" }), /case_sensitive/);
  await assert.rejects(() => search({ query: "x", max_results: 0 }), /positive integer/);
  await assert.rejects(() => search({ query: "Alpha", path: "linked-src" }), /Symlink/);
  await assert.rejects(() => search({ query: "Alpha", path: ".hidden" }), /Hidden or ignored/);
  await assert.rejects(() => search({ query: "Alpha", path: "node_modules" }), /Hidden or ignored/);
});

test("runtime registers search_workspace", async () => {
  const workspace = await fixture();
  const runtime = createRuntime({
    workspace,
    model: { describe: () => ({ provider: "test", model: "test" }), next: async () => ({ type: "final", content: "ok" }) },
    enablePlanning: false
  });
  assert.ok(runtime.registry.has("search_workspace"));
  const result = await runtime.registry.get("search_workspace").execute({ query: "Alpha" });
  assert.equal(result.matches.length, 3);
});
