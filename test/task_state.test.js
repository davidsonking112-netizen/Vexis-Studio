import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTaskStateTool } from "../src/tools/task_state.js";

async function createWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "vexis-task-state-"));
}

test("initializes and persists a task plan", async () => {
  const workspace = await createWorkspace();

  try {
    const tool = createTaskStateTool({ workspace });
    const result = await tool.execute({
      action: "initialize",
      task_id: "task-1",
      task: "Implement feature",
      plan: [
        { id: "inspect", title: "Inspect repository" },
        { id: "implement", title: "Implement feature" }
      ]
    });

    assert.equal(result.status, "created");
    assert.equal(result.state.task_id, "task-1");
    assert.equal(result.state.plan[0].status, "pending");

    const resumed = await createTaskStateTool({ workspace });
    const read = await resumed.execute({ action: "read" });
    assert.equal(read.state.task, "Implement feature");
    assert.equal(read.state.plan.length, 2);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("records a resumable checkpoint", async () => {
  const workspace = await createWorkspace();

  try {
    const tool = createTaskStateTool({ workspace });
    await tool.execute({
      action: "initialize",
      task: "Debug tests",
      plan: [{ id: "tests", title: "Run tests" }]
    });

    const result = await tool.execute({
      action: "checkpoint",
      step_id: "tests",
      summary: "Tests ran successfully"
    });

    assert.equal(result.status, "checkpointed");
    assert.equal(result.state.status, "in_progress");
    assert.equal(result.state.current_step, "tests");
    assert.deepEqual(result.state.checkpoint, {
      step_id: "tests",
      summary: "Tests ran successfully"
    });
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("rejects invalid checkpoints and unsafe state paths", async () => {
  const workspace = await createWorkspace();

  try {
    assert.throws(
      () => createTaskStateTool({ workspace, statePath: "../task-state.json" }),
      /escapes the workspace/
    );

    const tool = createTaskStateTool({ workspace });
    await tool.execute({
      action: "initialize",
      task: "Task",
      plan: [{ id: "step", title: "Step" }]
    });

    await assert.rejects(
      tool.execute({ action: "checkpoint", step_id: "missing", summary: "Nope" }),
      /checkpoint step_id must reference a plan step/
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});


test("rejects state paths redirected outside the workspace", async t => {
  const workspace = await createWorkspace();
  const outside = await createWorkspace();

  try {
    await fs.mkdir(path.join(workspace, ".vexis"));
    try {
      await fs.symlink(outside, path.join(workspace, ".vexis", "state"));
    } catch (error) {
      if (error?.code === "EPERM" || error?.code === "EACCES") {
        t.skip("Windows symlink creation requires the required OS privilege");
        return;
      }
      throw error;
    }

    const tool = createTaskStateTool({
      workspace,
      statePath: ".vexis/state/task-state.json"
    });

    await assert.rejects(
      tool.execute({
        action: "initialize",
        task: "Unsafe path",
        plan: [{ id: "step", title: "Step" }]
      }),
      /escapes the workspace/
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("rejects duplicate plan step ids", async () => {
  const workspace = await createWorkspace();

  try {
    const tool = createTaskStateTool({ workspace });

    await assert.rejects(
      tool.execute({
        action: "initialize",
        task: "Task",
        plan: [
          { id: "same", title: "First" },
          { id: "same", title: "Second" }
        ]
      }),
      /duplicate plan step id/
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
