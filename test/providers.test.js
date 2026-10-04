import test from "node:test";
import assert from "node:assert/strict";
import { AnthropicModel } from "../src/models/anthropic.js";
import { createDefaultProviderRegistry, normalizeProviderConfig } from "../src/models/providers.js";
import { createConfiguredModel } from "../src/models/config.js";

function response(payload, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", ...headers } });
}

test("provider registry exposes stable provider metadata", () => {
  const registry = createDefaultProviderRegistry();
  assert.deepEqual(registry.list().map(x => x.name), ["anthropic", "local", "openai", "openai-compatible", "qwen"]);
  assert.equal(registry.has("anthropic"), true);
  assert.equal(registry.has("missing"), false);
});

test("provider config resolves provider defaults and explicit overrides", () => {
  const config = normalizeProviderConfig({ provider: "qwen", model: "qwen-max", apiKey: "key" });
  assert.equal(config.provider, "qwen");
  assert.equal(config.model, "qwen-max");
  assert.equal(config.apiKey, "key");
  assert.equal(config.capabilities.toolCalling, true);
});

test("configured model creates the selected provider without coupling the agent", () => {
  const registry = createDefaultProviderRegistry();
  const model = createConfiguredModel({
    provider: "openai",
    model: "test-model",
    apiKey: "key",
    fetchImpl: async () => response({ choices: [{ message: { content: "ok" } }] })
  });
  assert.equal(model.describe().provider, "openai");
});

test("anthropic adapter converts tool calls into the common model contract", async () => {
  let request;
  const model = new AnthropicModel({
    apiKey: "key",
    model: "claude-test",
    fetchImpl: async (url, options) => {
      request = { url, body: JSON.parse(options.body), headers: options.headers };
      return response({
        id: "msg_1",
        content: [{ type: "tool_use", id: "tool_1", name: "inspect_codebase", input: { path: "src" } }],
        usage: { input_tokens: 8, output_tokens: 3 }
      }, { headers: { "request-id": "req_a" } });
    }
  });
  const result = await model.next({
    messages: [
      { role: "system", content: "Follow the execution plan." },
      { role: "user", content: "inspect" }
    ],
    maxTokens: 1234,
    toolDefinitions: [{ name: "inspect_codebase", description: "inspect", input: { path: "relative file path", max_files: "optional maximum number of files" } }]
  });
  assert.equal(result.type, "tool_call");
  assert.equal(result.provider, "anthropic");
  assert.equal(result.name, "inspect_codebase");
  assert.deepEqual(result.input, { path: "src" });
  assert.equal(request.url, "https://api.anthropic.com/v1/messages");
  assert.equal(request.body.system, "Follow the execution plan.");
  assert.equal(request.body.max_tokens, 1234);
  assert.equal(request.body.tools[0].name, "inspect_codebase");
  assert.deepEqual(request.body.tools[0].input_schema, {
    type: "object",
    properties: {
      path: { type: "string", description: "relative file path" },
      max_files: { type: "integer", description: "optional maximum number of files" }
    },
    required: ["path"],
    additionalProperties: false
  });
  assert.equal(request.headers["anthropic-version"], "2023-06-01");
});

test("profile selection resolves named model configurations", () => {
  const model = createConfiguredModel({
    profile: "local",
    profiles: { local: { provider: "local", model: "qwen3", baseUrl: "http://127.0.0.1:11434/v1" } },
    fetchImpl: async () => response({ choices: [{ message: { content: "ok" } }] })
  });
  assert.equal(model.describe().provider, "local");
});


test("anthropic streaming adapter emits text and tool events", async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      const events = [
        'data: {"type":"message_start","message":{"usage":{"input_tokens":4}}}\n\n',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
        'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool_1","name":"inspect","input":{}}}\n\n',
        'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"src\\"}"}}\n\n',
        'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":3}}\n\n',
        'data: {"type":"message_stop"}\n\n'
      ];
      for (const event of events) controller.enqueue(encoder.encode(event));
      controller.close();
    }
  });

  const model = new AnthropicModel({
    apiKey: "key",
    model: "claude-test",
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      assert.equal(request.stream, true);
      assert.equal(request.max_tokens, 2345);
      assert.equal(request.system, "Use the current repository context.");
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
  });

  const events = [];
  for await (const event of model.nextStream({
    messages: [
      { role: "system", content: "Use the current repository context." },
      { role: "user", content: "inspect" }
    ],
    maxTokens: 2345,
    toolDefinitions: [{ name: "inspect" }]
  })) events.push(event);

  assert.equal(events.filter(event => event.type === "text_delta").map(event => event.delta).join(""), "Hello");
  const complete = events.at(-1);
  assert.equal(complete.type, "complete");
  assert.equal(complete.response.type, "tool_calls");
  assert.deepEqual(complete.response.calls[0].input, { path: "src" });
});


test("all built-in provider adapters advertise the capabilities they implement", () => {
  const registry = createDefaultProviderRegistry();
  for (const provider of registry.list()) {
    assert.equal(provider.capabilities.streaming, true, provider.name + " should support streaming");
    assert.equal(provider.capabilities.toolCalling, true, provider.name + " should support tool calling");
  }
});
