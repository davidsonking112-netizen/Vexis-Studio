export function assertModel(model) {
  if (!model || typeof model.next !== "function") {
    throw new TypeError("model.next must be a function");
  }
  if (typeof model.describe !== "function") {
    throw new TypeError("model.describe must be a function");
  }
  return model;
}

function normalizeToolCall(call) {
  if (!call || typeof call !== "object") {
    throw new TypeError("Model tool call must be an object");
  }
  if (typeof call.name !== "string" || !call.name) {
    throw new TypeError("Model tool_call requires a tool name");
  }
  return {
    type: "tool_call",
    id: call.id ?? null,
    name: call.name,
    input: call.input && typeof call.input === "object" && !Array.isArray(call.input)
      ? call.input
      : {},
    provider: call.provider ?? null,
    model: call.model ?? null
  };
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
    const normalized = normalizeToolCall(response);
    return {
      ...normalized,
      usage: response.usage ?? null
    };
  }

  if (response.type === "tool_calls") {
    if (!Array.isArray(response.calls) || response.calls.length === 0) {
      throw new TypeError("Model tool_calls requires at least one call");
    }
    const calls = response.calls.map(normalizeToolCall);
    const ids = new Set();
    for (const call of calls) {
      if (call.id) {
        if (ids.has(call.id)) throw new TypeError(`Duplicate model tool call id: ${call.id}`);
        ids.add(call.id);
      }
    }
    return {
      type: "tool_calls",
      calls,
      usage: response.usage ?? null,
      provider: response.provider ?? calls.find(call => call.provider)?.provider ?? null,
      model: response.model ?? calls.find(call => call.model)?.model ?? null
    };
  }

  throw new TypeError(`Unknown model response type: ${response.type}`);
}

export function normalizeModelEvent(event) {
  if (!event || typeof event !== "object" || typeof event.type !== "string") {
    throw new TypeError("Model emitted an invalid event");
  }

  switch (event.type) {
    case "text_delta":
      if (typeof event.delta !== "string") throw new TypeError("text_delta requires a string delta");
      return { ...event, delta: event.delta };
    case "tool_call_delta":
      if (!Number.isInteger(event.index) || event.index < 0) {
        throw new TypeError("tool_call_delta requires a non-negative index");
      }
      return {
        ...event,
        id: event.id ?? null,
        name: event.name ?? null,
        argumentsDelta: String(event.argumentsDelta ?? "")
      };
    case "finish":
      return { ...event, reason: event.reason ?? null };
    case "tool_call":
      return normalizeToolCall(event);
    case "complete":
      return {
        ...event,
        response: normalizeModelResponse(event.response)
      };
    default:
      throw new TypeError(`Unknown model event type: ${event.type}`);
  }
}
