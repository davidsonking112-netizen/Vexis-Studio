import { normalizeModelResponse } from "./model.js";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_MODEL = "claude-sonnet-4-5";
const API_VERSION = "2023-06-01";

function trimSlash(value) { return String(value).replace(/\\/+$/, ""); }

function parseJson(text) {
  try { return JSON.parse(text); } catch { throw new Error("Model provider returned invalid JSON"); }
}

function providerError(response, body) {
  const detail = body?.error?.message || body?.message || response.statusText || "Unknown provider error";
  const error = new Error(`Anthropic request failed (${response.status}): ${detail}`);
  error.status = response.status;
  error.provider = "anthropic";
  error.retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
  return error;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Model request cancelled"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("Model request cancelled")); }, { once: true });
  });
}

function convertMessages(messages) {
  const system = [];
  const result = [];
  for (const message of messages) {
    if (message.role === "user") result.push({ role: "user", content: String(message.content ?? "") });
    else if (message.role === "assistant") {
      const blocks = [];
      if (message.content) blocks.push({ type: "text", text: String(message.content) });
      if (message.tool_call) blocks.push({ type: "tool_use", id: message.tool_call.id, name: message.tool_call.name, input: message.tool_call.input || {} });
      result.push({ role: "assistant", content: blocks.length ? blocks : [{ type: "text", text: "" }] });
    } else if (message.role === "tool") {
      result.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: message.toolCallId || message.name, content: String(message.content ?? "") }]
      });
    }
  }
  return { system, messages: result };
}

function toTools(definitions = []) {
  return definitions.map(def => ({
    name: def.name,
    description: def.description || "",
    input_schema: def.input && typeof def.input === "object" && Object.keys(def.input).length
      ? def.input
      : { type: "object", properties: {}, additionalProperties: false }
  }));
}

function extract(payload) {
  const blocks = Array.isArray(payload.content) ? payload.content : [];
  const tool = blocks.find(block => block.type === "tool_use");
  if (tool) return normalizeModelResponse({ type: "tool_call", id: tool.id, name: tool.name, input: tool.input || {} });
  const text = blocks.filter(block => block.type === "text").map(block => block.text || "").join("");
  return normalizeModelResponse({ type: "final", content: text });
}

export class AnthropicModel {
  constructor({
    apiKey = process.env.ANTHROPIC_API_KEY || "",
    baseUrl = DEFAULT_BASE_URL,
    model = process.env.VEXIS_MODEL || DEFAULT_MODEL,
    timeoutMs = 120_000,
    maxRetries = 2,
    fetchImpl = globalThis.fetch
  } = {}) {
    if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
    if (!model) throw new TypeError("model must be a non-empty string");
    this.apiKey = apiKey;
    this.baseUrl = trimSlash(baseUrl);
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.fetch = fetchImpl;
  }

  describe() {
    return {
      provider: "anthropic",
      model: this.model,
      baseUrl: this.baseUrl,
      capabilities: { toolCalling: true, structuredOutput: false, vision: true, streaming: false, parallelToolCalls: true }
    };
  }

  async next({ messages, toolDefinitions = [], signal }) {
    if (!Array.isArray(messages)) throw new TypeError("messages must be an array");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });

    try {
      let lastError;
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          if (signal?.aborted) throw new Error("Model request cancelled");
          const converted = convertMessages(messages);
          const body = {
            model: this.model,
            max_tokens: 4096,
            messages: converted.messages,
            tools: toTools(toolDefinitions)
          };
          const response = await this.fetch(`${this.baseUrl}/v1/messages`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": this.apiKey,
              "anthropic-version": API_VERSION
            },
            body: JSON.stringify(body),
            signal: controller.signal
          });
          const text = await response.text();
          const payload = text ? parseJson(text) : {};
          if (!response.ok) throw providerError(response, payload);
          const normalized = extract(payload);
          return {
            ...normalized,
            provider: "anthropic",
            model: this.model,
            usage: payload.usage ?? null,
            requestId: response.headers.get("request-id") || null
          };
        } catch (error) {
          if (signal?.aborted) throw new Error("Model request cancelled");
          if (error?.name === "AbortError") throw new Error(`Model request timed out after ${this.timeoutMs}ms`);
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
