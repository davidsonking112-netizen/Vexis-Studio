export class Agent {
  constructor({ model, tools = {}, toolDefinitions = null, maxSteps = 20, onEvent = () => {} }) {
    if (!model || typeof model.next !== "function") {
      throw new TypeError("model.next must be a function");
    }
    if (!Number.isInteger(maxSteps) || maxSteps < 1) {
      throw new TypeError("maxSteps must be a positive integer");
    }

    this.model = model;
    this.tools = tools;
    this.toolDefinitions = toolDefinitions || Object.keys(tools).map(name => ({ name, description: "" }));
    this.maxSteps = maxSteps;
    this.onEvent = onEvent;
  }

  async getModelResponse(messages, { signal, step, onEvent }) {
    onEvent({ type: "model_start", step, messages });

    if (typeof this.model.nextStream === "function") {
      let response = null;
      for await (const event of this.model.nextStream({
        messages,
        toolDefinitions: this.toolDefinitions,
        signal
      })) {
        onEvent(event);
        if (event.type === "complete") response = event.response;
      }
      if (!response) throw new Error("Streaming model ended without a complete response");
      return response;
    }

    return this.model.next({
      messages,
      tools: Object.keys(this.tools),
      toolDefinitions: this.toolDefinitions,
      signal
    });
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
  }

  async run(task, { signal, onEvent = this.onEvent } = {}) {
    if (signal?.aborted) throw new Error("Task cancelled");
    const messages = [{ role: "user", content: task }];

    for (let step = 0; step < this.maxSteps; step++) {
      if (signal?.aborted) throw new Error("Task cancelled");

      const response = await this.getModelResponse(messages, { signal, step, onEvent });
      onEvent({ type: "model_response", step, response });

      if (!response || typeof response !== "object") {
        throw new Error("Model returned an invalid response");
      }

      if (response.type === "final") {
        return {
          status: "completed",
          output: response.content ?? "",
          steps: step + 1,
          usage: response.usage ?? null,
          provider: response.provider ?? null,
          model: response.model ?? null
        };
      }

      const calls = this.normalizeCalls(response);
      if (!calls?.length) throw new Error("Model returned an invalid tool response");

      await this.executeToolCalls(calls, messages, { signal, step, onEvent });
    }

    return {
      status: "max_steps",
      output: "",
      steps: this.maxSteps
    };
  }
}
