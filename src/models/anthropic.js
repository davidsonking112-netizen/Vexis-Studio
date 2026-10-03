import { normalizeModelEvent, normalizeModelResponse } from "./model.js";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_MODEL = "claude-sonnet-4-5";
const API_VERSION = "2023-06-01";

function trimSlash(value) { return String(value).replace(/\/+$/, ""); }

function parseJson(text) {
  try { return JSON.parse(text); }
  catch { throw new Error("Model provider returned invalid JSON"); }
}

function providerError(response, body) {
  const detail = body?.error?.message || body?.message || response.statusText || "Unknown provider error";
  const error = new Error("Anthropic request failed (" + response.status + "): " + detail);
  error.status = response.status;
  error.provider = "anthropic";
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

function convertMessages(messages) {
  const result = [];
  let pendingToolResults = [];

  const flushToolResults = () => {
    if (!pendingToolResults.length) return;
    result.push({ role: "user", content: pendingToolResults });
    pendingToolResults = [];
  };

  for (const message of messages) {
    if (message.role === "tool") {
      pendingToolResults.push({
        type: "tool_result",
        tool_use_id: message.toolCallId || message.name,
        content: String(message.content ?? "")
      });
      continue;
    }

    flushToolResults();

    if (message.role === "user") {
      result.push({ role: "user", content: String(message.content ?? "") });
    } else if (message.role === "assistant") {
      const blocks = [];
      if (message.content) blocks.push({ type: "text", text: String(message.content) });
      const calls = Array.isArray(message.tool_calls)
        ? message.tool_calls
        : message.tool_call ? [message.tool_call] : [];
      for (const call of calls) {
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.input || {}
        });
      }
      result.push({ role: "assistant", content: blocks.length ? blocks : [{ type: "text", text: "" }] });
    }
  }

  flushToolResults();
  return { system: [], messages: result };
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
  const calls = blocks
    .filter(block => block.type === "tool_use")
    .map(block => ({
      id: block.id,
      name: block.name,
      input: block.input || {}
    }));

  if (calls.length) {
    return calls.length === 1
      ? normalizeModelResponse({ type: "tool_call", ...calls[0] })
      : normalizeModelResponse({ type: "tool_calls", calls });
  }

  return normalizeModelResponse({
    type: "final",
    content: blocks.filter(block => block.type === "text").map(block => block.text || "").join("")
  });
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
        if (lf >= 0 && (crlf < 0 || lf < crlf)) { boundary = lf; size = 2; }
        else if (crlf >= 0) { boundary = crlf; size = 4; }
        if (boundary < 0) break;

        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + size);
        const event = frame.split(/\r?\n/)
          .filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (event) yield parseJson(event);
      }
    }

    buffer += decoder.decode();
    const event = buffer.split(/\r?\n/)
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (event) yield parseJson(event);
  } finally {
    try { await reader.cancel(); } catch {}
  }
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
      provider: "anthropic",
      model: this.model,
      baseUrl: this.baseUrl,
      capabilities: {
        toolCalling: true,
        structuredOutput: false,
        vision: true,
        streaming: true,
        parallelToolCalls: true
      }
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
          const converted = convertMessages(messages);
          const response = await this.fetch(this.baseUrl + "/v1/messages", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-api-key": this.apiKey,
              "anthropic-version": API_VERSION
            },
            body: JSON.stringify({
              model: this.model,
              max_tokens: 4096,
              system: converted.system,
              messages: converted.messages,
              tools: toTools(toolDefinitions)
            }),
            signal: controller.signal
          });

          const payload = await response.text();
          const parsed = payload ? parseJson(payload) : {};
          if (!response.ok) throw providerError(response, parsed);

          const normalized = extract(parsed);
          return {
            ...normalized,
            provider: "anthropic",
            model: this.model,
            usage: parsed.usage ?? null,
            requestId: response.headers.get("request-id") || null
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
        const converted = convertMessages(messages);
        const response = await this.fetch(this.baseUrl + "/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": API_VERSION,
            "accept": "text/event-stream"
          },
          body: JSON.stringify({
            model: this.model,
            max_tokens: 4096,
            system: converted.system,
            messages: converted.messages,
            tools: toTools(toolDefinitions),
            stream: true
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          const payload = await response.text();
          const error = providerError(response, payload ? parseJson(payload) : {});
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

        for await (const event of parseSse(response)) {
          if (event.type === "message_start") {
            usage = event.message?.usage ?? usage;
          } else if (event.type === "content_block_start") {
            const block = event.content_block;
            if (block?.type === "tool_use") {
              calls.set(event.index, {
                id: block.id || "",
                name: block.name || "",
                inputJson: ""
              });
              yield normalizeModelEvent({
                type: "tool_call_delta",
                index: event.index,
                id: block.id || null,
                name: block.name || null,
                argumentsDelta: "",
                provider: "anthropic",
                model: this.model
              });
            }
          } else if (event.type === "content_block_delta") {
            const delta = event.delta || {};
            if (delta.type === "text_delta" && delta.text) {
              text.push(delta.text);
              yield normalizeModelEvent({
                type: "text_delta",
                delta: delta.text,
                provider: "anthropic",
                model: this.model
              });
            } else if (delta.type === "input_json_delta") {
              const call = calls.get(event.index);
              if (call) {
                call.inputJson += delta.partial_json || "";
                yield normalizeModelEvent({
                  type: "tool_call_delta",
                  index: event.index,
                  id: call.id || null,
                  name: call.name || null,
                  argumentsDelta: delta.partial_json || "",
                  provider: "anthropic",
                  model: this.model
                });
              }
            }
          } else if (event.type === "message_delta") {
            usage = event.usage ?? usage;
            if (event.delta?.stop_reason && !finishEmitted) {
              finishEmitted = true;
              yield normalizeModelEvent({
                type: "finish",
                reason: event.delta.stop_reason,
                usage,
                provider: "anthropic",
                model: this.model
              });
            }
          }
        }

        const normalizedCalls = [...calls.values()].map(call => {
          let input = {};
          try { input = call.inputJson ? JSON.parse(call.inputJson) : {}; }
          catch { throw new Error("Anthropic returned invalid JSON arguments for tool " + call.name); }
          return { id: call.id || call.name, name: call.name, input };
        });

        const responseModel = normalizedCalls.length
          ? { type: "tool_calls", calls: normalizedCalls, usage, provider: "anthropic", model: this.model }
          : { type: "final", content: text.join(""), usage, provider: "anthropic", model: this.model };

        yield normalizeModelEvent({
          type: "complete",
          response: responseModel,
          provider: "anthropic",
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
