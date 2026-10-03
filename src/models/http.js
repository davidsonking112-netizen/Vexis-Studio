import { normalizeModelResponse } from "./model.js";

function streamEvents(response) {
  if (!response?.body?.getReader) throw new TypeError("Streaming response body is required");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return (async function* () {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let split;
        while ((split = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, split).replace(/\r/g, "");
          buffer = buffer.slice(split + 2);
          const data = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
          if (data === "[DONE]") return;
          if (data) yield JSON.parse(data);
        }
      }
      buffer += decoder.decode();
      const frame = buffer.trim().replace(/\r/g, "");
      const data = frame.startsWith("data:") ? frame.slice(5).trimStart() : "";
      if (data && data !== "[DONE]") yield JSON.parse(data);
    } finally { try { await reader.cancel(); } catch {} }
  })();
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-5";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 2;

function trimSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Model provider returned invalid JSON");
  }
}

function providerError(response, body, provider = "openai-compatible") {
  const detail = body?.error?.message || body?.message || response.statusText || "Unknown provider error";
  const error = new Error(`Model provider request failed (${response.status}): ${detail}`);
  error.status = response.status;
  error.provider = provider;
  error.retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
  return error;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Model request cancelled"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("Model request cancelled"));
    }, { once: true });
  });
}

function toProviderMessages(messages) {
  return messages.map(message => {
    if (message.role === "user") {
      return { role: "user", content: String(message.content ?? "") };
    }
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId || message.name,
        content: String(message.content ?? "")
      };
    }
    if (message.role === "assistant" && message.tool_call) {
      return {
        role: "assistant",
        content: message.content == null ? null : String(message.content),
        tool_calls: [{
          id: message.tool_call.id,
          type: "function",
          function: {
            name: message.tool_call.name,
            arguments: JSON.stringify(message.tool_call.input ?? {})
          }
        }]
      };
    }
    return {
      role: message.role || "assistant",
      content: String(message.content ?? "")
    };
  });
}

function toProviderTools(toolDefinitions = []) {
  return toolDefinitions.map(definition => ({
    type: "function",
    function: {
      name: definition.name,
      description: definition.description,
      parameters: definition.input && typeof definition.input === "object" && Object.keys(definition.input).length
        ? definition.input
        : { type: "object", properties: {}, additionalProperties: false }
    }
  }));
}

function extractChoice(choice) {
  const message = choice?.message;
  if (!message) throw new Error("Model provider response did not contain a message");

  if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
    const call = message.tool_calls[0];
    if (call.type !== "function" || !call.function?.name) {
      throw new Error("Model provider returned an unsupported tool call");
    }
    let input = {};
    try {
      input = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      throw new Error(`Model returned invalid JSON arguments for tool ${call.function.name}`);
    }
    return {
      type: "tool_call",
      id: call.id || call.function.name,
      name: call.function.name,
      input
    };
  }

  return {
    type: "final",
    content: typeof message.content === "string" ? message.content : ""
  };
}

export class OpenAICompatibleModel {
  constructor({
    apiKey = process.env.VEXIS_MODEL_API_KEY || process.env.OPENAI_API_KEY || "",
    baseUrl = process.env.VEXIS_MODEL_BASE_URL || DEFAULT_BASE_URL,
    model = process.env.VEXIS_MODEL || process.env.OPENAI_MODEL || DEFAULT_MODEL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    fetchImpl = globalThis.fetch,
    provider = "openai-compatible",
    capabilities = null
  } = {}) {
    if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
    if (!model || typeof model !== "string") throw new TypeError("model must be a non-empty string");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError("timeoutMs must be a positive integer");
    if (!Number.isInteger(maxRetries) || maxRetries < 0) throw new TypeError("maxRetries must be a non-negative integer");

    this.apiKey = apiKey;
    this.baseUrl = trimSlash(baseUrl);
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.fetch = fetchImpl;
    this.provider = provider;
    this.capabilities = capabilities || { toolCalling: true, structuredOutput: false, vision: false, streaming: false, parallelToolCalls: true };
  }

  describe() {
    return {
      provider: this.provider,
      model: this.model,
      baseUrl: this.baseUrl,
      capabilities: { ...this.capabilities }
    };
  }

  async *nextStream({ messages, toolDefinitions = [], signal }) {\n    if (!Array.isArray(messages)) throw new TypeError("messages must be an array");\n    const controller = new AbortController();\n    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);\n    const abort = () => controller.abort();\n    signal?.addEventListener("abort", abort, { once: true });\n    try {\n      const headers = { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) };\n      const body = { model: this.model, messages: toProviderMessages(messages), temperature: 0, stream: true, tools: toProviderTools(toolDefinitions), tool_choice: toolDefinitions.length ? "auto" : undefined };\n      const response = await this.fetch(`${this.baseUrl}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });\n      if (!response.ok) { const text = await response.text(); const payload = text ? parseJson(text) : {}; throw providerError(response, payload, this.provider); }\n      let text = ""; const calls = new Map(); let usage = null;\n      for await (const chunk of streamEvents(response)) {\n        usage = chunk.usage ?? usage;\n        const choice = chunk.choices?.[0]; const delta = choice?.delta || {};\n        if (delta.content) { text += delta.content; yield { type: "text_delta", delta: delta.content, provider: this.provider, model: this.model }; }\n        for (const call of delta.tool_calls || []) {\n          const index = call.index ?? 0; const current = calls.get(index) || { id: "", name: "", arguments: "" };\n          current.id += call.id || ""; current.name += call.function?.name || ""; current.arguments += call.function?.arguments || ""; calls.set(index, current);\n          yield { type: "tool_call_delta", index, id: current.id || null, name: current.name || null, argumentsDelta: call.function?.arguments || "", provider: this.provider, model: this.model };\n        }\n        if (choice?.finish_reason) yield { type: "finish", reason: choice.finish_reason, usage, provider: this.provider, model: this.model };\n      }\n      for (const [index, call] of calls) { let input = {}; try { input = call.arguments ? JSON.parse(call.arguments) : {}; } catch { throw new Error(`Model returned invalid JSON arguments for tool ${call.name}`); } yield { type: "tool_call", index, id: call.id || call.name, name: call.name, input, provider: this.provider, model: this.model }; }\n      yield { type: "complete", response: normalizeModelResponse(calls.size ? { type: "tool_calls", calls: [...calls.values()].map(call => ({ id: call.id || call.name, name: call.name, input: call.arguments ? JSON.parse(call.arguments) : {} })) , usage, provider: this.provider, model: this.model } : { type: "final", content: text, usage, provider: this.provider, model: this.model }) };\n    } catch (error) {\n      if (signal?.aborted) throw new Error("Model request cancelled");\n      if (error?.name === "AbortError") throw new Error(`Model request timed out after ${this.timeoutMs}ms`);\n      throw error;\n    } finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }\n  }\n\n  async next({ messages, toolDefinitions = [], signal }) {
    if (!Array.isArray(messages)) throw new TypeError("messages must be an array");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });

    try {
      let lastError;
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        if (signal?.aborted) throw new Error("Model request cancelled");
        try {
          const headers = {
            "content-type": "application/json",
            ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
          };
          const body = {
            model: this.model,
            messages: toProviderMessages(messages),
            temperature: 0,
            tools: toProviderTools(toolDefinitions),
            tool_choice: toolDefinitions.length ? "auto" : undefined
          };

          const response = await this.fetch(`${this.baseUrl}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: controller.signal
          });
          const text = await response.text();
          const payload = text ? parseJson(text) : {};

          if (!response.ok) throw providerError(response, payload, this.provider);

          const normalized = normalizeModelResponse(extractChoice(payload.choices?.[0]));
          return {
            ...normalized,
            provider: this.provider,
            model: this.model,
            usage: payload.usage ?? null,
            requestId: response.headers.get("x-request-id") || response.headers.get("request-id") || null
          };
        } catch (error) {
          if (signal?.aborted) throw new Error("Model request cancelled");
          if (error?.name === "AbortError") {
            throw new Error(`Model request timed out after ${this.timeoutMs}ms`);
          }
          lastError = error;
          if (!error?.retryable || attempt >= this.maxRetries) throw error;
          await sleep(Math.min(250 * 2 ** attempt, 2_000), signal);
        }
      }
      throw lastError || new Error("Model request failed");
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}

export function createModel(options = {}) {
  return new OpenAICompatibleModel(options);
}
