import test from "node:test";
import assert from "node:assert/strict";
import { ContextEngine, compressText, estimateTokens, scoreCandidate } from "../src/context/engine.js";
import { createFilesystemTools } from "../src/tools/filesystem.js";
import { createTaskStateTool } from "../src/tools/task_state.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

async function tempWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "vexis-context-"));
}

test("token estimation is deterministic and compression preserves boundaries", () => {
  const text = "HEAD ".repeat(1000) + "TAIL ".repeat(1000);
  assert.ok(estimateTokens(text) > 0);
  const result = compressText(text, 80);
  assert.equal(result.truncated, true);
  assert.match(result.text, /context compressed/);
  assert.match(result.text, /HEAD/);
  assert.match(result.text, /TAIL/);
});

test("candidate scoring rewards explicit and relevant context", () => {
  const explicit = scoreCandidate({
    type: "file", path: "src/agent.js", content: "agent context loop", explicit: true, priority: 50
  }, "agent context");
  const unrelated = scoreCandidate({
    type: "file", path: "docs/random.md", content: "unrelated prose", priority: 50
  }, "agent context");
  assert.ok(explicit > unrelated);
});

test("context engine selects focused files within a hard token budget", async () => {
  const workspace = await tempWorkspace();
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.writeFile(path.join(workspace, "src", "agent.js"), "export function agent() { return 'context engine'; }\n".repeat(30));
  await fs.writeFile(path.join(workspace, "src", "other.js"), "unrelated content\n".repeat(30));
  await fs.writeFile(path.join(workspace, "package.json"), JSON.stringify({ name: "fixture", scripts: { test: "node --test" } }));

  const filesystem = createFilesystemTools({ workspace });
  const taskState = createTaskStateTool({ workspace });
  const engine = new ContextEngine({
    workspace,
    filesystem,
    taskState,
    maxTokens: 180,
    maxFiles: 4,
    refreshMs: 0
  });

  const context = await engine.build({
    task: "improve the agent context loop",
    focusPaths: ["src/agent.js"]
  });

  assert.ok(context.tokens <= 180);
  assert.match(context.content, /src\/agent\.js/);
  assert.ok(context.candidates.some(candidate => candidate.path === "src/agent.js"));
  assert.equal(context.version, 1);

  await fs.rm(workspace, { recursive: true, force: true });
});

test("context snapshot refreshes after invalidation", async () => {
  const workspace = await tempWorkspace();
  await fs.writeFile(path.join(workspace, "README.md"), "one");
  const filesystem = createFilesystemTools({ workspace });
  const engine = new ContextEngine({ workspace, filesystem, refreshMs: 60_000 });

  const first = await engine.refresh();
  await fs.writeFile(path.join(workspace, "new.js"), "two");
  engine.invalidate();
  const second = await engine.refresh();

  assert.equal(first.files.includes("new.js"), false);
  assert.equal(second.files.includes("new.js"), true);

  await fs.rm(workspace, { recursive: true, force: true });
});
