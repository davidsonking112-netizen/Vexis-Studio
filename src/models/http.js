import { normalizeModelEvent, normalizeModelResponse } from "./model.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-5";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 2;

function trimSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function parseJson(text, { status = null, contentType = "" } = {}) {
  try { return JSON.parse(text); }
  catch {
    const preview = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
    const details = [
      status == null ? "" : "status " + status,
      contentType ? "content-type " + contentType : "",
      preview ? "body: " + preview : "empty body"
    ].filter(Boolean).join(", ");
    throw new Error("Model provider returned invalid JSON" + (details ? " (" + details + ")" : ""));
  }
}

function providerError(response, body, provider = "openai-compatible") {
  const detail = body?.error?.message || body?.message || response.statusText || "Unknown provider error";
  const error = new Error("Model provider request failed (" + response.status + "): " + detail);
  error.status = response.status;
  error.provider = provider;
  error.retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
  return error;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Model request cancelled"));
    const timer = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("Model request cancelled"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function readJsonResponse(response) {
  const text = await response.text();
  return text ? parseJson(text, {
    status: response.status,
    contentType: response.headers.get("content-type") || ""
  }) : {};
}

function toProviderMessages(messages) {
  return messages.map(message => {
    if (message.role === "user") return { role: "user", content: String(message.content ?? "") };

    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId || message.name,
        content: String(message.content ?? "")
      };
    }

    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      return {
        role: "assistant",
        content: message.content == null ? null : String(message.content),
        tool_calls: message.tool_calls.map(call => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) }
        }))
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
      description: definition.description || "",
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
    const calls = message.tool_calls.map(call => {
      if (call.type !== "function" || !call.function?.name) {
        throw new Error("Model provider returned an unsupported tool call");
      }
      let input = {};
      try { input = call.function.arguments ? JSON.parse(call.function.arguments) : {}; }
      catch { throw new Error("Model returned invalid JSON arguments for tool " + call.function.name); }
      return { id: call.id || call.function.name, name: call.function.name, input };
    });
    return calls.length === 1 ? { type: "tool_call", ...calls[0] } : { type: "tool_calls", calls };
  }

  return {
    type: "final",
    content: typeof message.content === "string" ? message.content : ""
  };
}

async function* parseSse(response) {
  if (!response?.body?.getReader) throw new TypeError("Streaming response body is required");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const lf = buffer.indexOf("\n\n");
        const crlf = buffer.indexOf("\r\n\r\n");
        let boundary = -1;
        let size = 0;

        if (lf >= 0 && (crlf < 0 || lf < crlf)) {
          boundary = lf;
          size = 2;
        } else if (crlf >= 0) {
          boundary = crlf;
          size = 4;
        }

        if (boundary < 0) break;

        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + size);
        const data = frame.split(/\r?\n/)
          .filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).replace(/^ /, ""))
          .join("\n");

        if (!data) continue;
        if (data === "[DONE]") return;
        yield parseJson(data);
      }
    }

    buffer += decoder.decode();
    const data = buffer.split(/\r?\n/)
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).replace(/^ /, ""))
      .join("\n");

    if (data && data !== "[DONE]") yield parseJson(data);
  } finally {
    try { await reader.cancel(); } catch {}
  }
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
    capabilities = null,
    maxTokens = 8192
  } = {}) {
    if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");
    if (!model || typeof model !== "string") throw new TypeError("model must be a non-empty string");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError("timeoutMs must be a positive integer");
    if (!Number.isInteger(maxRetries) || maxRetries < 0) throw new TypeError("maxRetries must be a non-negative integer");
    if (!Number.isInteger(maxTokens) || maxTokens < 1) throw new TypeError("maxTokens must be a positive integer");

    this.apiKey = apiKey;
    this.baseUrl = trimSlash(baseUrl);
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.maxTokens = maxTokens;
    this.fetch = fetchImpl;
    this.provider = provider;
    this.capabilities = capabilities || {
      toolCalling: true,
      structuredOutput: false,
      vision: false,
      streaming: true,
      parallelToolCalls: true
    };
  }

  describe() {
    return {
      provider: this.provider,
      model: this.model,
      baseUrl: this.baseUrl,
      capabilities: { ...this.capabilities }
    };
  }

  async next({ messages, toolDefinitions = [], signal, maxTokens = this.maxTokens }) {
    if (!Array.isArray(messages)) throw new TypeError("messages must be an array");
    if (!Number.isInteger(maxTokens) || maxTokens < 1) throw new TypeError("maxTokens must be a positive integer");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });

    try {
      let lastError;

      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        if (signal?.aborted) throw new Error("Model request cancelled");

        try {
          const response = await this.fetch(this.baseUrl + "/chat/completions", {
            method: "POST",
            headers: {
              "accept": "application/json",
              "content-type": "application/json",
              ...(this.apiKey ? { authorization: "Bearer " + this.apiKey } : {})
            },
            body: JSON.stringify({
              model: this.model,
              messages: toProviderMessages(messages),
              temperature: 0,
              max_tokens: maxTokens,
              ...(toolDefinitions.length ? {
                tools: toProviderTools(toolDefinitions),
                tool_choice: "auto"
              } : {})
            }),
            signal: controller.signal
          });

          const payload = await readJsonResponse(response);
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
          if (error?.name === "AbortError") throw new Error("Model request timed out after " + this.timeoutMs + "ms");
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

  async *nextStream({ messages, toolDefinitions = [], signal }) {
    if (!Array.isArray(messages)) throw new TypeError("messages must be an array");

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (signal?.aborted) throw new Error("Model request cancelled");

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });

      try {
        const response = await this.fetch(this.baseUrl + "/chat/completions", {
          method: "POST",
          headers: {
            "accept": "text/event-stream",
            "content-type": "application/json",
            ...(this.apiKey ? { authorization: "Bearer " + this.apiKey } : {})
          },
          body: JSON.stringify({
            model: this.model,
            messages: toProviderMessages(messages),
            temperature: 0,
            max_tokens: this.maxTokens,
            stream: true,
            ...(toolDefinitions.length ? {
              tools: toProviderTools(toolDefinitions),
              tool_choice: "auto"
            } : {})
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          const payload = await readJsonResponse(response);
          const error = providerError(response, payload, this.provider);
          if (error.retryable && attempt < this.maxRetries) {
            clearTimeout(timeout);
            signal?.removeEventListener("abort", abort);
            await sleep(Math.min(250 * 2 ** attempt, 2_000), signal);
            continue;
          }
          throw error;
        }

        const text = [];
        const calls = new Map();
        let usage = null;
        let finishEmitted = false;

        for await (const chunk of parseSse(response)) {
          usage = chunk.usage ?? usage;
          const choice = chunk.choices?.[0];
          const delta = choice?.delta || {};

          if (delta.content) {
            text.push(delta.content);
            yield normalizeModelEvent({
              type: "text_delta",
              delta: delta.content,
              provider: this.provider,
              model: this.model
            });
          }

          for (const call of delta.tool_calls || []) {
            const index = call.index ?? 0;
            const current = calls.get(index) || { id: "", name: "", arguments: "" };
            current.id = current.id || call.id || "";
            current.name += call.function?.name || "";
            current.arguments += call.function?.arguments || "";
            calls.set(index, current);

            yield normalizeModelEvent({
              type: "tool_call_delta",
              index,
              id: current.id || null,
              name: current.name || null,
              argumentsDelta: call.function?.arguments || "",
              provider: this.provider,
              model: this.model
            });
          }

          if (choice?.finish_reason && !finishEmitted) {
            finishEmitted = true;
            yield normalizeModelEvent({
              type: "finish",
              reason: choice.finish_reason,
              usage,
              provider: this.provider,
              model: this.model
            });
          }
        }

        const normalizedCalls = [...calls.values()].map(call => {
          let input = {};
          try { input = call.arguments ? JSON.parse(call.arguments) : {}; }
          catch { throw new Error("Model returned invalid JSON arguments for tool " + call.name); }
          return { id: call.id || call.name, name: call.name, input };
        });

        const responseModel = normalizedCalls.length
          ? { type: "tool_calls", calls: normalizedCalls, usage, provider: this.provider, model: this.model }
          : { type: "final", content: text.join(""), usage, provider: this.provider, model: this.model };

        yield normalizeModelEvent({
          type: "complete",
          response: responseModel,
          provider: this.provider,
          model: this.model
        });
        return;
      } catch (error) {
        if (signal?.aborted) throw new Error("Model request cancelled");
        if (error?.name === "AbortError") throw new Error("Model request timed out after " + this.timeoutMs + "ms");
        throw error;
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
      }
    }
  }
}

export function createModel(options = {}) {
  return new OpenAICompatibleModel(options);
}
