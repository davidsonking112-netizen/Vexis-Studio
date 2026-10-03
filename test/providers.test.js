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
    messages: [{ role: "user", content: "inspect" }],
    toolDefinitions: [{ name: "inspect_codebase", description: "inspect", input: { type: "object", properties: { path: { type: "string" } } } }]
  });
  assert.equal(result.type, "tool_call");
  assert.equal(result.provider, "anthropic");
  assert.equal(result.name, "inspect_codebase");
  assert.deepEqual(result.input, { path: "src" });
  assert.equal(request.url, "https://api.anthropic.com/v1/messages");
  assert.equal(request.body.tools[0].name, "inspect_codebase");
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
