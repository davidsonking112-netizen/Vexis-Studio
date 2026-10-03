import { randomUUID } from "node:crypto";

const PLAN_VERSION = 1;
const STEP_STATUSES = new Set(["pending", "in_progress", "completed", "blocked", "skipped"]);
const PRIORITIES = new Set(["critical", "high", "normal", "low"]);
const MAX_STEPS = 100;
const MAX_DEPENDENCIES = 20;
const MAX_TEXT = 4_000;

function text(value, name, { required = false, max = MAX_TEXT } = {}) {
  const valueText = String(value ?? "").trim();
  if (required && !valueText) throw new TypeError(name + " is required");
  if (valueText.length > max) throw new TypeError(name + " exceeds " + max + " characters");
  return valueText;
}

function array(value, name) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError(name + " must be an array");
  return value;
}

function normalizeId(value, fallback) {
  const id = text(value, "step.id") || fallback;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id)) {
    throw new TypeError("invalid plan step id: " + id);
  }
  return id;
}

function validateAcyclic(steps) {
  const byId = new Map(steps.map(step => [step.id, step]));
  const visiting = new Set();
  const visited = new Set();

  function visit(id, stack = []) {
    if (visiting.has(id)) {
      throw new TypeError("plan dependency cycle: " + [...stack, id].join(" -> "));
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).dependencies) visit(dependency, [...stack, id]);
    visiting.delete(id);
    visited.add(id);
  }

  for (const step of steps) visit(step.id);
}

export function validatePlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw new TypeError("plan must be an object");
  }

  const rawSteps = array(plan.steps, "plan.steps");
  if (rawSteps.length < 1) throw new TypeError("plan must contain at least one step");
  if (rawSteps.length > MAX_STEPS) throw new TypeError("plan contains too many steps");

  const ids = new Set();
  const steps = rawSteps.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new TypeError("plan step " + index + " must be an object");

    const id = normalizeId(raw.id, "step-" + String(index + 1).padStart(2, "0"));
    if (ids.has(id)) throw new TypeError("duplicate plan step id: " + id);
    ids.add(id);

    const dependencies = [...new Set(array(raw.dependencies, "step.dependencies").map(value => text(value, "dependency", { max: 80 })))];
    if (dependencies.length > MAX_DEPENDENCIES) throw new TypeError("too many dependencies for " + id);

    const status = raw.status ?? "pending";
    if (!STEP_STATUSES.has(status)) throw new TypeError("invalid step status: " + status);

    const priority = raw.priority ?? "normal";
    if (!PRIORITIES.has(priority)) throw new TypeError("invalid step priority: " + priority);

    return {
      id,
      title: text(raw.title, "step.title", { required: true, max: 240 }),
      objective: text(raw.objective, "step.objective", { required: true, max: 1_500 }),
      rationale: text(raw.rationale, "step.rationale", { max: 1_500 }),
      dependencies,
      files: [...new Set(array(raw.files, "step.files").map(value => text(value, "file", { max: 500 })))].slice(0, 50),
      actions: array(raw.actions, "step.actions").map(value => text(value, "action", { max: 1_000 })).slice(0, 20),
      verification: array(raw.verification, "step.verification").map(value => text(value, "verification", { max: 1_000 })).slice(0, 20),
      acceptance: array(raw.acceptance, "step.acceptance").map(value => text(value, "acceptance", { max: 1_000 })).slice(0, 20),
      rollback: text(raw.rollback, "step.rollback", { max: 1_000 }),
      priority,
      status,
      notes: text(raw.notes, "step.notes", { max: 2_000 })
    };
  });

  const idsArray = new Set(steps.map(step => step.id));
  for (const step of steps) {
    for (const dependency of step.dependencies) {
      if (!idsArray.has(dependency)) {
        throw new TypeError("step " + step.id + " depends on unknown step " + dependency);
      }
      if (dependency === step.id) throw new TypeError("step " + step.id + " cannot depend on itself");
    }
    if (step.verification.length === 0 && step.acceptance.length === 0) {
      throw new TypeError("step " + step.id + " requires verification or acceptance criteria");
    }
  }

  validateAcyclic(steps);

  const goals = array(plan.goals, "plan.goals").map(value => text(value, "goal", { max: 1_000 })).slice(0, 20);
  const risks = array(plan.risks, "plan.risks").map(risk => ({
    risk: text(risk?.risk, "risk", { required: true, max: 1_000 }),
    mitigation: text(risk?.mitigation, "risk.mitigation", { required: true, max: 1_000 }),
    severity: ["critical", "high", "medium", "low"].includes(risk?.severity) ? risk.severity : "medium"
  })).slice(0, 20);

  return {
    version: PLAN_VERSION,
    plan_id: text(plan.plan_id, "plan_id") || randomUUID(),
    task: text(plan.task, "plan.task", { required: true, max: 4_000 }),
    summary: text(plan.summary, "plan.summary", { required: true, max: 2_000 }),
    goals,
    assumptions: array(plan.assumptions, "plan.assumptions").map(value => text(value, "assumption", { max: 1_000 })).slice(0, 20),
    risks,
    completion: array(plan.completion, "plan.completion").map(value => text(value, "completion", { max: 1_000 })).slice(0, 20),
    steps,
    created_at: plan.created_at || new Date().toISOString()
  };
}

function extractJson(value) {
  if (typeof value === "object" && value !== null) return value;
  const raw = String(value ?? "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error("planner returned invalid JSON");
  }
}

function topologicalOrder(steps) {
  const byId = new Map(steps.map(step => [step.id, step]));
  const indegree = new Map(steps.map(step => [step.id, step.dependencies.length]));
  const dependents = new Map(steps.map(step => [step.id, []]));
  for (const step of steps) for (const dep of step.dependencies) dependents.get(dep).push(step.id);

  const ready = steps.filter(step => indegree.get(step.id) === 0).map(step => step.id).sort();
  const result = [];

  while (ready.length) {
    const id = ready.shift();
    result.push(id);
    for (const dependent of dependents.get(id).sort()) {
      indegree.set(dependent, indegree.get(dependent) - 1);
      if (indegree.get(dependent) === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }
  if (result.length !== steps.length) throw new TypeError("plan dependency graph is cyclic");
  return result;
}

export function getReadySteps(plan) {
  const completed = new Set(plan.steps.filter(step => step.status === "completed").map(step => step.id));
  return plan.steps.filter(step =>
    step.status === "pending" &&
    step.dependencies.every(dependency => completed.has(dependency))
  );
}

export function getPlanProgress(plan) {
  const total = plan.steps.length;
  const completed = plan.steps.filter(step => step.status === "completed").length;
  const blocked = plan.steps.filter(step => step.status === "blocked").length;
  return {
    total,
    completed,
    blocked,
    remaining: total - completed,
    ratio: total === 0 ? 1 : Number((completed / total).toFixed(4))
  };
}

export function buildPlanPrompt({ task, context = "", previousPlan = null }) {
  return [
    "You are Vexis Planner, a precise software-engineering planning subsystem.",
    "Produce an executable plan for the user's task. Do not implement code.",
    "Reason from the supplied repository context only; mark uncertain assumptions explicitly.",
    "Prefer the smallest complete sequence of atomic steps. Avoid speculative refactors.",
    "Every step must have a concrete objective, dependencies, target files when known, actions, and at least one verification or acceptance criterion.",
    "Dependencies must form a directed acyclic graph.",
    "Include risks and mitigations, completion criteria, and a concise summary.",
    "Return ONLY valid JSON matching this shape:",
    JSON.stringify({
      plan_id: "stable-or-new-id",
      task: "task",
      summary: "summary",
      goals: ["goal"],
      assumptions: ["assumption"],
      risks: [{ risk: "risk", mitigation: "mitigation", severity: "medium" }],
      completion: ["completion criterion"],
      steps: [{
        id: "step-01",
        title: "short title",
        objective: "measurable objective",
        rationale: "why this step exists",
        dependencies: [],
        files: ["src/example.js"],
        actions: ["inspect...", "implement..."],
        verification: ["run..."],
        acceptance: ["observable result..."],
        rollback: "safe rollback",
        priority: "normal",
        status: "pending",
        notes: ""
      }]
    }, null, 2),
    "\nUSER TASK:\n" + task,
    "\nREPOSITORY CONTEXT:\n" + context,
    previousPlan ? "\nPREVIOUS PLAN TO REVISE:\n" + JSON.stringify(previousPlan) : ""
  ].join("\n");
}

export class PlanningEngine {
  constructor({ model, contextEngine = null, taskState = null, maxSteps = MAX_STEPS } = {}) {
    if (!model || typeof model.next !== "function") throw new TypeError("model.next is required");
    if (contextEngine && typeof contextEngine.build !== "function") throw new TypeError("contextEngine must provide build()");
    if (taskState && typeof taskState.execute !== "function") throw new TypeError("taskState must provide execute()");
    this.model = model;
    this.contextEngine = contextEngine;
    this.taskState = taskState;
    this.maxSteps = Math.min(MAX_STEPS, Math.max(1, maxSteps));
  }

  async create(task, { signal, previousPlan = null, messages = [] } = {}) {
    if (signal?.aborted) throw new Error("Planning cancelled");
    const context = this.contextEngine
      ? await this.contextEngine.build({ task, messages, maxTokens: Math.min(12_000, this.contextEngine.maxTokens * 2) })
      : { content: "" };

    const response = await this.model.next({
      messages: [{ role: "system", content: buildPlanPrompt({ task, context: context.content, previousPlan }) }],
      toolDefinitions: [],
      signal
    });

    if (response?.type !== "final") {
      throw new Error("Planner model must return a final JSON plan");
    }

    const plan = validatePlan(extractJson(response.content));
    if (plan.steps.length > this.maxSteps) {
      throw new Error("Planner produced too many steps");
    }
    topologicalOrder(plan.steps);

    if (this.taskState) {
      const current = await this.taskState.execute({ action: "read" });
      if (!current.state) {
        await this.taskState.execute({
          action: "initialize",
          task: plan.task,
          task_id: plan.plan_id,
          plan: plan.steps,
          status: "pending"
        });
      } else {
        // A new planning pass must never silently execute a plan that was not persisted.
        // Replace stale state atomically at the task-state contract level and clear
        // checkpoints because their step identities belong to the previous plan.
        await this.taskState.execute({
          action: "update",
          task: plan.task,
          task_id: plan.plan_id,
          plan: plan.steps,
          status: "pending",
          current_step: null,
          checkpoint: null
        });
      }
    }

    return plan;
  }

  async replan(task, currentPlan, { signal, reason = "", messages = [] } = {}) {
    return this.create(task, {
      signal,
      messages,
      previousPlan: {
        ...currentPlan,
        replan_reason: reason
      }
    });
  }

  static validate(plan) { return validatePlan(plan); }
  static ready(plan) { return getReadySteps(plan); }
  static progress(plan) { return getPlanProgress(plan); }
  static order(plan) { return topologicalOrder(plan.steps); }
}

export function createPlanningEngine(options) {
  return new PlanningEngine(options);
}
