import test from "node:test";
import assert from "node:assert/strict";
import { validatePlan, getReadySteps, getPlanProgress, PlanningEngine } from "../src/planning/engine.js";
import { createTaskStateTool } from "../src/tools/task_state.js";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

async function workspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "vexis-planning-"));
}

function samplePlan() {
  return {
    task: "Implement a feature",
    summary: "Inspect, implement, and verify the feature.",
    goals: ["Feature works without regressions."],
    completion: ["All tests pass."],
    risks: [{ risk: "Regression", mitigation: "Run the full test suite.", severity: "high" }],
    steps: [
      {
        id: "inspect",
        title: "Inspect",
        objective: "Understand the affected code.",
        dependencies: [],
        files: ["src/example.js"],
        actions: ["Inspect the implementation."],
        verification: ["Confirm the relevant boundary."],
        acceptance: ["Affected code is identified."],
        priority: "high"
      },
      {
        id: "implement",
        title: "Implement",
        objective: "Make the smallest correct change.",
        dependencies: ["inspect"],
        files: ["src/example.js"],
        actions: ["Implement the change."],
        verification: ["Run targeted tests."],
        acceptance: ["Feature behavior matches the task."],
        priority: "normal"
      }
    ]
  };
}

test("planning validation rejects dependency cycles and missing verification", () => {
  const plan = samplePlan();
  plan.steps[0].dependencies = ["implement"];
  assert.throws(() => validatePlan(plan), /dependency cycle/);

  const invalid = samplePlan();
  invalid.steps[0].verification = [];
  invalid.steps[0].acceptance = [];
  assert.throws(() => validatePlan(invalid), /requires verification or acceptance/);
});

test("planning readiness and progress are deterministic", () => {
  const plan = validatePlan(samplePlan());
  assert.deepEqual(getReadySteps(plan).map(step => step.id), ["inspect"]);
  assert.deepEqual(getPlanProgress(plan), {
    total: 2, completed: 0, blocked: 0, remaining: 2, ratio: 0
  });

  plan.steps[0].status = "completed";
  assert.deepEqual(getReadySteps(plan).map(step => step.id), ["implement"]);
  assert.deepEqual(getPlanProgress(plan), {
    total: 2, completed: 1, blocked: 0, remaining: 1, ratio: 0.5
  });
});

test("planning engine generates, validates, and persists a rich plan", async () => {
  const root = await workspace();
  try {
    const taskState = createTaskStateTool({ workspace: root });
    const model = {
      async next() {
        return {
          type: "final",
          content: JSON.stringify(samplePlan())
        };
      }
    };
    const contextEngine = {
      maxTokens: 1000,
      async build() { return { content: "repo context" }; }
    };

    const engine = new PlanningEngine({ model, contextEngine, taskState });
    const plan = await engine.create("Implement a feature");

    assert.equal(plan.steps.length, 2);
    assert.equal(plan.steps[1].dependencies[0], "inspect");

    const persisted = await taskState.execute({ action: "read" });
    assert.equal(persisted.state.task_id, plan.plan_id);
    assert.equal(persisted.state.plan[1].objective, "Make the smallest correct change.");
    assert.deepEqual(persisted.state.plan[1].verification, ["Run targeted tests."]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("planning engine rejects non-final model responses", async () => {
  const engine = new PlanningEngine({
    model: { async next() { return { type: "tool_call", name: "noop", input: {} }; } }
  });
  await assert.rejects(engine.create("bad plan"), /final JSON plan/);
});
