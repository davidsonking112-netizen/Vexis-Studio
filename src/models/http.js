import { normalizeModelResponse } from "./model.js";

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

function providerError(response, body) {
  const detail = body?.error?.message || body?.message || response.statusText || "Unknown provider error";
  const error = new Error(`Model provider request failed (${response.status}): ${detail}`);
  error.status = response.status;
  error.provider = "openai-compatible";
  error.retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
  return error;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Model request cancelled"));
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === "function") timer.unref();
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
    fetchImpl = globalThis.fetch
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
  }

  describe() {
    return {
      provider: "openai-compatible",
      model: this.model,
      baseUrl: this.baseUrl
    };
  }

  async next({ messages, toolDefinitions = [], signal }) {
    if (!Array.isArray(messages)) throw new TypeError("messages must be an array");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    if (typeof timeout.unref === "function") timeout.unref();

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

          if (!response.ok) throw providerError(response, payload);

          const normalized = normalizeModelResponse(extractChoice(payload.choices?.[0]));
          return {
            ...normalized,
            provider: "openai-compatible",
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
