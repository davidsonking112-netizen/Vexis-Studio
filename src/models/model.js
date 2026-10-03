export function assertModel(model) {
  if (!model || typeof model.next !== "function") {
    throw new TypeError("model.next must be a function");
  }
  if (typeof model.describe !== "function") {
    throw new TypeError("model.describe must be a function");
  }
  return model;
}

export function normalizeModelResponse(response) {
  if (!response || typeof response !== "object") {
    throw new TypeError("Model returned an invalid response");
  }

  if (response.type === "final") {
    return {
      type: "final",
      content: response.content == null ? "" : String(response.content),
      usage: response.usage ?? null,
      provider: response.provider ?? null,
      model: response.model ?? null
    };
  }

  if (response.type === "tool_call") {
    if (typeof response.name !== "string" || !response.name) {
      throw new TypeError("Model tool_call requires a tool name");
    }
    return {
      type: "tool_call",
      id: response.id ?? null,
      name: response.name,
      input: response.input && typeof response.input === "object" ? response.input : {},
      usage: response.usage ?? null,
      provider: response.provider ?? null,
      model: response.model ?? null
    };
  }

  throw new TypeError(`Unknown model response type: ${response.type}`);
}
