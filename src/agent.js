import { TokenBudget, DEFAULT_TOKEN_BUDGET } from "./runtime/token-budget.js";

export class Agent {
  constructor({ model, tools = {}, toolDefinitions = null, contextEngine = null, planningEngine = null, memory = null, repositoryIntelligence = null, maxSteps = 20, tokenBudget = DEFAULT_TOKEN_BUDGET, onEvent = () => {} }) {
    if (!model || typeof model.next !== "function") {
      throw new TypeError("model.next must be a function");
    }
    if (!Number.isInteger(maxSteps) || maxSteps < 1) {
      throw new TypeError("maxSteps must be a positive integer");
    }

    this.model = model;
    this.tools = tools;
    this.toolDefinitions = toolDefinitions || Object.keys(tools).map(name => ({ name, description: "" }));
    if (contextEngine && typeof contextEngine.build !== "function") {
      throw new TypeError("contextEngine must provide build()");
    }
    this.contextEngine = contextEngine;
    if (planningEngine && typeof planningEngine.create !== "function") {
      throw new TypeError("planningEngine must provide create()");
    }
    this.planningEngine = planningEngine;
    if (memory && typeof memory.recall !== "function") throw new TypeError("memory must provide recall()");
    this.memory = memory;
    if (repositoryIntelligence && typeof repositoryIntelligence.inspect !== "function") throw new TypeError("repositoryIntelligence must provide inspect()");
    this.repositoryIntelligence = repositoryIntelligence;
    this.maxSteps = maxSteps;
    this.tokenBudgetConfig = tokenBudget;
    this.onEvent = onEvent;
  }

  async getModelResponse(messages, { task, signal, step, onEvent, budget }) {
    let modelMessages = messages;
    const memoryMessages = [];
    if (this.repositoryIntelligence) {
      const intelligence = await this.repositoryIntelligence.inspect({ query: task, limit: 16 });
      if (intelligence.symbols.length || intelligence.dependencies.length) {
        memoryMessages.push({
          role: "system",
          content: ["VEXIS REPOSITORY INTELLIGENCE", "Current indexed symbols and dependency relationships. Treat this as structural evidence and verify against files when necessary.", JSON.stringify(intelligence, null, 2)].join("\n\n")
        });
      }
      onEvent({ type: "repository_intelligence", step, symbols: intelligence.symbols.length, dependencies: intelligence.dependencies.length, truncated: intelligence.truncated });
    }
    if (this.memory) {
      const recalled = await this.memory.recall({ query: task, limit: 6, max_tokens: 1200 });
      if (recalled.entries.length) {
        memoryMessages.push({
          role: "system",
          content: [
            "VEXIS AGENT MEMORY",
            "Durable workspace-local memories for this task. Treat them as evidence, not unquestionable truth; prefer current repository state and verification when they conflict.",
            JSON.stringify(recalled.entries, null, 2)
          ].join("\n\n")
        });
      }
      onEvent({ type: "memory_recall", task, entries: recalled.entries, tokens: recalled.tokens, total: recalled.total });
    }

    if (this.contextEngine) {
      const observations = messages
        .filter(message => message?.role === "tool")
        .slice(-8)
        .map(message => ({
          type: "observation",
          path: message.name || "",
          content: message.content || ""
        }));

      const context = await this.contextEngine.build({
        task,
        messages,
        observations
      });

      modelMessages = [
        ...memoryMessages,
        { role: "system", content: context.content },
        ...messages
      ];

      onEvent({
        type: "context_update",
        step,
        tokens: context.tokens,
        budget: context.budget,
        candidates: context.candidates,
        truncated: context.truncated
      });
    } else {
      modelMessages = [...memoryMessages, ...messages];
    }

    const requestBudget = budget.prepare(modelMessages, null);
    onEvent({ type: "token_budget", step, ...requestBudget, budget: budget.snapshot() });
    onEvent({ type: "model_start", step, messages: modelMessages });

    if (typeof this.model.nextStream === "function") {
      let response = null;
      for await (const event of this.model.nextStream({
        messages: modelMessages,
        toolDefinitions: this.toolDefinitions,
        maxTokens: requestBudget.outputTokens,
        signal
      })) {
        onEvent(event);
        if (event.type === "complete") response = event.response;
      }
      if (!response) throw new Error("Streaming model ended without a complete response");
      budget.record(response.usage);
      return response;
    }

    const response = await this.model.next({
      messages: modelMessages,
      tools: Object.keys(this.tools),
      toolDefinitions: this.toolDefinitions,
      maxTokens: requestBudget.outputTokens,
      signal
    });
    budget.record(response?.usage);
    return response;
  }

  normalizeCalls(response) {
    if (response?.type === "tool_call") return [response];
    if (response?.type === "tool_calls") return response.calls;
    return null;
  }

  async executeToolCalls(calls, messages, { signal, step, onEvent }) {
    const assistantCalls = calls.map(call => ({
      id: call.id || call.name,
      name: call.name,
      input: call.input ?? {}
    }));

    messages.push({
      role: "assistant",
      content: "",
      tool_calls: assistantCalls
    });

    const results = await Promise.all(calls.map(async (call, index) => {
      if (signal?.aborted) throw new Error("Task cancelled");

      const callId = call.id || call.name;
      const tool = this.tools[call.name];

      onEvent({
        type: "tool_start",
        step,
        index,
        id: callId,
        name: call.name,
        input: call.input ?? {}
      });

      if (!tool) {
        const observation = { ok: false, error: "Unknown tool: " + call.name };
        onEvent({ type: "tool_error", step, index, id: callId, name: call.name, error: observation });
        if (this.memory) await this.memory.remember({ type: "failure", content: `Tool ${call.name} was unavailable: ${observation.error}`, tags: ["tool", call.name, "failure"], source: "agent", confidence: 0.9 });
        return { call, observation };
      }

      try {
        const value = await tool(call.input ?? {});
        const observation = { ok: true, result: value };
        onEvent({ type: "tool_result", step, index, id: callId, name: call.name, observation });
        return { call, observation };
      } catch (error) {
        const observation = {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        };
        onEvent({ type: "tool_error", step, index, id: callId, name: call.name, error: observation });
        if (this.memory) await this.memory.remember({ type: "failure", content: `Tool ${call.name} failed: ${observation.error}`, tags: ["tool", call.name, "failure"], source: "agent", confidence: 0.9 });
        return { call, observation };
      }
    }));

    for (const { call, observation } of results) {
      messages.push({
        role: "tool",
        name: call.name,
        toolCallId: call.id || call.name,
        content: JSON.stringify(observation)
      });
    }

    if (this.contextEngine?.invalidate) this.contextEngine.invalidate();
    if (this.repositoryIntelligence?.invalidate) this.repositoryIntelligence.invalidate();
  }

  async run(task, { signal, onEvent = this.onEvent } = {}) {
    if (signal?.aborted) throw new Error("Task cancelled");
    let plan = null;
    const budget = new TokenBudget(this.tokenBudgetConfig);
    onEvent({ type: "token_budget_start", budget: budget.snapshot() });
    if (this.planningEngine) {
      plan = await this.planningEngine.create(task, { signal, budget });
      onEvent({
        type: "plan_created",
        plan: {
          plan_id: plan.plan_id,
          summary: plan.summary,
          goals: plan.goals,
          risks: plan.risks,
          completion: plan.completion,
          steps: plan.steps.map(step => ({
            id: step.id,
            title: step.title,
            objective: step.objective,
            dependencies: step.dependencies,
            files: step.files,
            verification: step.verification,
            acceptance: step.acceptance,
            priority: step.priority
          }))
        }
      });
    }

    const planMessage = plan ? {
      role: "system",
      content: [
        "VEXIS EXECUTION PLAN",
        JSON.stringify({
          plan_id: plan.plan_id,
          summary: plan.summary,
          goals: plan.goals,
          completion: plan.completion,
          steps: plan.steps
        }, null, 2),
        "Execute the plan in dependency order. Do not skip verification criteria. If repository reality invalidates the plan, adapt carefully and report the deviation."
      ].join("\n\n")
    } : null;
    const messages = [
      ...(planMessage ? [planMessage] : []),
      { role: "user", content: task }
    ];

    for (let step = 0; step < this.maxSteps; step++) {
      if (signal?.aborted) throw new Error("Task cancelled");

      const response = await this.getModelResponse(messages, { task, signal, step, onEvent, budget });
      onEvent({ type: "model_response", step, response });

      if (!response || typeof response !== "object") {
        throw new Error("Model returned an invalid response");
      }

      if (response.type === "final") {
        if (this.memory) await this.memory.remember({ type: "success", content: `Task completed: ${task}`, tags: ["task", "completed"], source: "agent", confidence: 0.75 });
        return {
          status: "completed",
          output: response.content ?? "",
          steps: step + 1,
          usage: response.usage ?? null,
          provider: response.provider ?? null,
          model: response.model ?? null,
          token_budget: budget.snapshot()
        };
      }

      const calls = this.normalizeCalls(response);
      if (!calls?.length) throw new Error("Model returned an invalid tool response");

      await this.executeToolCalls(calls, messages, { signal, step, onEvent });
    }

    return {
      status: "max_steps",
      output: "",
      steps: this.maxSteps,
      token_budget: budget.snapshot()
    };
  }
}
