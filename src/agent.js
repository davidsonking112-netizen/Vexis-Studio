export class Agent {
  constructor({ model, tools = {}, maxSteps = 20, onEvent = () => {} }) {
    if (!model || typeof model.next !== "function") {
      throw new TypeError("model.next must be a function");
    }

    this.model = model;
    this.tools = tools;
    this.maxSteps = maxSteps;
    this.onEvent = onEvent;
  }

  async run(task, { signal, onEvent = this.onEvent } = {}) {
    if (signal?.aborted) throw new Error("Task cancelled");
    const messages = [{ role: "user", content: task }];

    for (let step = 0; step < this.maxSteps; step++) {
      if (signal?.aborted) throw new Error("Task cancelled");
      onEvent({ type: "model_start", step, messages });

      const response = await this.model.next({
        messages,
        tools: Object.keys(this.tools)
      });

      onEvent({ type: "model_response", step, response });

      if (!response || typeof response !== "object") {
        throw new Error("Model returned an invalid response");
      }

      if (response.type === "final") {
        return {
          status: "completed",
          output: response.content ?? "",
          steps: step + 1
        };
      }

      if (response.type !== "tool_call") {
        throw new Error(`Unknown model response type: ${response.type}`);
      }

      const { name, input } = response;
      const tool = this.tools[name];

      if (!tool) {
        const error = { ok: false, error: `Unknown tool: ${name}` };
        messages.push({
          role: "tool",
          name,
          content: JSON.stringify(error)
        });
        onEvent({ type: "tool_error", step, name, error });
        continue;
      }

      try {
        const result = await tool(input ?? {});
        const observation = { ok: true, result };

        messages.push({
          role: "tool",
          name,
          content: JSON.stringify(observation)
        });

        onEvent({ type: "tool_result", step, name, observation });
      } catch (error) {
        const observation = {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        };

        messages.push({
          role: "tool",
          name,
          content: JSON.stringify(observation)
        });

        onEvent({ type: "tool_error", step, name, error: observation });
      }
    }

    return {
      status: "max_steps",
      output: "",
      steps: this.maxSteps
    };
  }
}
