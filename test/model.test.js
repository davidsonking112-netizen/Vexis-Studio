import test from "node:test";
import assert from "node:assert/strict";
import { OpenAICompatibleModel } from "../src/models/http.js";

function response(payload, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

test("real model runtime normalizes a final provider response", async () => {
  let request;
  const model = new OpenAICompatibleModel({
    apiKey: "test-key",
    baseUrl: "https://example.test/v1",
    model: "test-model",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({
        choices: [{ message: { role: "assistant", content: "Hello from the model." } }],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }
      }, { headers: { "x-request-id": "req_123" } });
    }
  });

  const result = await model.next({
    messages: [{ role: "user", content: "hello" }],
    toolDefinitions: []
  });

  assert.equal(result.type, "final");
  assert.equal(result.content, "Hello from the model.");
  assert.equal(result.provider, "openai-compatible");
  assert.equal(result.model, "test-model");
  assert.deepEqual(result.usage, { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 });
  assert.equal(request.url, "https://example.test/v1/chat/completions");

  const body = JSON.parse(request.options.body);
  assert.equal(body.model, "test-model");
  assert.equal(body.messages[0].content, "hello");
  assert.equal(body.max_tokens, 8192);
  assert.equal("tools" in body, false);
  assert.equal("tool_choice" in body, false);
  assert.equal(request.options.headers.authorization, "Bearer test-key");
  assert.equal(request.options.headers.accept, "application/json");
});

test("real model runtime supports a per-request output token budget", async () => {
  let request;
  const model = new OpenAICompatibleModel({
    apiKey: "test-key", baseUrl: "https://example.test/v1", model: "test-model",
    fetchImpl: async (_url, options) => { request = JSON.parse(options.body); return response({ choices: [{ message: { role: "assistant", content: "ok" } }] }); }
  });
  await model.next({ messages: [{ role: "user", content: "plan" }], maxTokens: 4096 });
  assert.equal(request.max_tokens, 4096);
});

test("real model runtime converts tool definitions and normalizes tool calls", async () => {
  let request;
  const model = new OpenAICompatibleModel({
    apiKey: "test-key",
    baseUrl: "https://example.test/v1",
    model: "test-model",
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return response({
        choices: [{
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: "inspect_codebase", arguments: '{"path":"src","max_files":10}' }
            }]
          }
        }]
      });
    }
  });

  const result = await model.next({
    messages: [{ role: "user", content: "inspect the project" }],
    toolDefinitions: [{
      name: "inspect_codebase",
      description: "Inspect the project",
      input: {
        type: "object",
        properties: { path: { type: "string" }, max_files: { type: "integer" } },
        required: ["path"]
      }
    }]
  });

  assert.equal(result.type, "tool_call");
  assert.equal(result.id, "call_1");
  assert.equal(result.name, "inspect_codebase");
  assert.deepEqual(result.input, { path: "src", max_files: 10 });
  assert.equal(request.tools[0].function.name, "inspect_codebase");
  assert.equal(request.tool_choice, "auto");
  assert.equal(request.messages[0].role, "user");
});

test("real model runtime reports provider failures with status and retry metadata", async () => {
  let calls = 0;
  const model = new OpenAICompatibleModel({
    apiKey: "test-key",
    baseUrl: "https://example.test/v1",
    model: "test-model",
    maxRetries: 1,
    fetchImpl: async () => {
      calls += 1;
      return response({ error: { message: "temporarily unavailable" } }, { status: 503 });
    }
  });

  await assert.rejects(
    model.next({ messages: [{ role: "user", content: "retry" }] }),
    error => error.status === 503 && error.retryable === true && /temporarily unavailable/.test(error.message)
  );
  assert.equal(calls, 2);
});

test("real model runtime honors cancellation", async () => {
  const controller = new AbortController();
  const model = new OpenAICompatibleModel({
    apiKey: "test-key",
    baseUrl: "https://example.test/v1",
    model: "test-model",
    fetchImpl: async (_url, options) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 5_000);
        options.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        }, { once: true });
      });
      return response({ choices: [] });
    }
  });

  const pending = model.next({
    messages: [{ role: "user", content: "cancel me" }],
    signal: controller.signal
  });
  controller.abort();

  await assert.rejects(pending, /cancelled|timed out/i);
});


test("streaming transport requests SSE and emits text deltas", async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'));
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"lo"}}],"usage":{"total_tokens":2}}\n\n'));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    }
  });
  const model = new OpenAICompatibleModel({
    apiKey: "test-key",
    baseUrl: "https://example.test/v1",
    model: "test-model",
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      assert.equal(request.stream, true);
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
  });
  const events = [];
  for await (const event of model.nextStream({ messages: [{ role: "user", content: "hi" }] })) events.push(event);
  assert.equal(events.filter(event => event.type === "text_delta").map(event => event.delta).join(""), "Hello");
  assert.equal(events.at(-1).type, "complete");
});


test("openai-compatible runtime preserves multiple tool calls", async () => {
  const model = new OpenAICompatibleModel({
    apiKey: "test-key",
    baseUrl: "https://example.test/v1",
    model: "test-model",
    fetchImpl: async () => response({
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "a", type: "function", function: { name: "one", arguments: '{"x":1}' } },
            { id: "b", type: "function", function: { name: "two", arguments: '{"y":2}' } }
          ]
        }
      }]
    })
  });

  const result = await model.next({
    messages: [{ role: "user", content: "run both" }],
    toolDefinitions: [{ name: "one" }, { name: "two" }]
  });

  assert.equal(result.type, "tool_calls");
  assert.deepEqual(result.calls.map(call => call.id), ["a", "b"]);
  assert.deepEqual(result.calls.map(call => call.input), [{ x: 1 }, { y: 2 }]);
});

test("streaming transport handles fragmented SSE frames and fragmented tool arguments", async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      const frames = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"inspect","arguments":"{\\"path\\":\\"sr"}}]}}]}\n',
        '\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"c\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n'
      ];
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    }
  });

  const model = new OpenAICompatibleModel({
    apiKey: "test-key",
    baseUrl: "https://example.test/v1",
    model: "test-model",
    fetchImpl: async () => new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" }
    })
  });

  const events = [];
  for await (const event of model.nextStream({
    messages: [{ role: "user", content: "inspect" }],
    toolDefinitions: [{ name: "inspect" }]
  })) events.push(event);

  const complete = events.at(-1);
  assert.equal(complete.type, "complete");
  assert.equal(complete.response.type, "tool_calls");
  assert.equal(complete.response.calls[0].name, "inspect");
  assert.deepEqual(complete.response.calls[0].input, { path: "src" });
});


test("real model runtime gives actionable diagnostics for non-JSON provider responses", async () => {
  const model = new OpenAICompatibleModel({
    apiKey: "test-key",
    baseUrl: "https://example.test/v1",
    model: "test-model",
    fetchImpl: async () => new Response("<html>upstream unavailable</html>", {
      status: 502,
      headers: { "content-type": "text/html" }
    })
  });

  await assert.rejects(
    model.next({ messages: [{ role: "user", content: "hello" }] }),
    error => /invalid JSON/.test(error.message)
      && /status 502/.test(error.message)
      && /content-type text\/html/.test(error.message)
      && /upstream unavailable/.test(error.message)
  );
});
