import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const STATUSES = new Set(["pending", "in_progress", "blocked", "completed"]);
const STEP_STATUSES = new Set(["pending", "in_progress", "completed", "skipped"]);

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === "" ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative));
}

function validatePlan(plan) {
  if (!Array.isArray(plan)) throw new TypeError("plan must be an array");

  return plan.map((step, index) => {
    if (!step || typeof step !== "object") {
      throw new TypeError(`plan step ${index} must be an object`);
    }
    if (!step.id || !step.title) {
      throw new TypeError(`plan step ${index} requires id and title`);
    }

    const status = step.status ?? "pending";
    if (!STEP_STATUSES.has(status)) {
      throw new TypeError(`invalid plan step status: ${status}`);
    }

    return {
      id: String(step.id),
      title: String(step.title),
      status,
      notes: step.notes == null ? "" : String(step.notes)
    };
  });
}

function validateState(state) {
  if (!state || typeof state !== "object") {
    throw new TypeError("task state must be an object");
  }
  if (state.version !== 1) {
    throw new TypeError("unsupported task state version");
  }
  if (!state.task_id || !state.task) {
    throw new TypeError("task_id and task are required");
  }
  if (!STATUSES.has(state.status)) {
    throw new TypeError(`invalid task status: ${state.status}`);
  }

  const plan = validatePlan(state.plan);
  const currentStep = state.current_step == null ? null : String(state.current_step);

  if (currentStep && !plan.some(step => step.id === currentStep)) {
    throw new TypeError("current_step must reference a plan step");
  }

  if (state.checkpoint !== null && state.checkpoint !== undefined) {
    if (!state.checkpoint.step_id || !state.checkpoint.summary) {
      throw new TypeError("checkpoint requires step_id and summary");
    }
    if (!plan.some(step => step.id === state.checkpoint.step_id)) {
      throw new TypeError("checkpoint step_id must reference a plan step");
    }
  }

  return {
    version: 1,
    task_id: String(state.task_id),
    task: String(state.task),
    status: state.status,
    plan,
    current_step: currentStep,
    checkpoint: state.checkpoint ?? null,
    updated_at: state.updated_at ?? new Date().toISOString()
  };
}

async function atomicWrite(file, content) {
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(temporary, content, "utf8");
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export function createTaskStateTool({
  workspace,
  statePath = ".vexis/task-state.json",
  maxBytes = 256 * 1024
}) {
  if (!workspace) throw new TypeError("workspace is required");

  const root = path.resolve(workspace);
  const file = path.resolve(root, statePath);

  if (!isWithin(root, file)) {
    throw new Error("Task state path escapes the workspace");
  }

  async function readState() {
    try {
      const content = await fs.readFile(file, "utf8");
      if (Buffer.byteLength(content, "utf8") > maxBytes) {
        throw new Error("Task state exceeds the size limit");
      }
      return validateState(JSON.parse(content));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async function writeState(state) {
    const normalized = validateState({
      ...state,
      updated_at: new Date().toISOString()
    });
    await atomicWrite(file, JSON.stringify(normalized, null, 2) + "\n");
    return normalized;
  }

  return {
    description: "Persist a bounded task plan, current step, and resumable checkpoint inside the workspace.",
    input: {
      action: "read, initialize, update, or checkpoint",
      task: "required for initialize",
      task_id: "optional task identifier",
      status: "optional task status",
      plan: "optional complete plan array",
      current_step: "optional plan step id",
      checkpoint: "optional checkpoint object with step_id and summary"
    },

    execute: async (input = {}) => {
      const action = input.action ?? "read";
      const current = await readState();

      if (action === "read") {
        return { status: "ok", state: current };
      }

      if (action === "initialize") {
        if (current) {
          return { status: "exists", state: current };
        }

        const state = {
          version: 1,
          task_id: input.task_id ?? randomUUID(),
          task: input.task,
          status: input.status ?? "pending",
          plan: input.plan ?? [],
          current_step: input.current_step ?? null,
          checkpoint: input.checkpoint ?? null
        };

        return { status: "created", state: await writeState(state) };
      }

      if (!current) {
        throw new Error("No task state exists; initialize it first");
      }

      if (action === "update") {
        const next = {
          ...current,
          ...(input.task_id === undefined ? {} : { task_id: input.task_id }),
          ...(input.task === undefined ? {} : { task: input.task }),
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.plan === undefined ? {} : { plan: input.plan }),
          ...(input.current_step === undefined ? {} : { current_step: input.current_step }),
          ...(input.checkpoint === undefined ? {} : { checkpoint: input.checkpoint })
        };

        return { status: "updated", state: await writeState(next) };
      }

      if (action === "checkpoint") {
        if (!input.step_id || !input.summary) {
          throw new TypeError("checkpoint requires step_id and summary");
        }

        if (!current.plan.some(step => step.id === String(input.step_id))) {
          throw new TypeError("checkpoint step_id must reference a plan step");
        }

        const next = {
          ...current,
          status: input.status ?? "in_progress",
          current_step: input.step_id,
          checkpoint: {
            step_id: String(input.step_id),
            summary: String(input.summary)
          }
        };

        return { status: "checkpointed", state: await writeState(next) };
      }

      throw new Error(`Unknown task state action: ${action}`);
    }
  };
}

export function toAgentTaskStateTool(taskStateTool) {
  return { task_state: taskStateTool.execute };
}
