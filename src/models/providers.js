import { assertModel } from "./model.js";
import { OpenAICompatibleModel } from "./http.js";
import { AnthropicModel } from "./anthropic.js";

export const PROVIDER_CAPABILITIES = Object.freeze({
  "openai": Object.freeze({ toolCalling: true, structuredOutput: true, vision: true, streaming: false, parallelToolCalls: true }),
  "anthropic": Object.freeze({ toolCalling: true, structuredOutput: false, vision: true, streaming: false, parallelToolCalls: true }),
  "openai-compatible": Object.freeze({ toolCalling: true, structuredOutput: false, vision: false, streaming: false, parallelToolCalls: true }),
  "qwen": Object.freeze({ toolCalling: true, structuredOutput: true, vision: true, streaming: false, parallelToolCalls: true }),
  "local": Object.freeze({ toolCalling: true, structuredOutput: false, vision: false, streaming: false, parallelToolCalls: true })
});

const DEFAULTS = Object.freeze({
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-5", keyEnv: "OPENAI_API_KEY" },
  anthropic: { baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-5", keyEnv: "ANTHROPIC_API_KEY" },
  qwen: { baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", keyEnv: "DASHSCOPE_API_KEY" },
  local: { baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3", keyEnv: null }
});

function env(name, fallback = "") {
  return name ? (process.env[name] || fallback) : fallback;
}

export function normalizeProviderConfig(input = {}) {
  const provider = String(input.provider || process.env.VEXIS_PROVIDER || "openai-compatible").toLowerCase();
  if (!PROVIDER_CAPABILITIES[provider]) throw new Error(`Unsupported model provider: ${provider}`);
  const defaults = DEFAULTS[provider] || { baseUrl: "", model: "", keyEnv: null };
  const model = input.model || process.env.VEXIS_MODEL || defaults.model;
  const baseUrl = input.baseUrl || process.env.VEXIS_MODEL_BASE_URL || defaults.baseUrl;
  const apiKey = input.apiKey ?? process.env.VEXIS_MODEL_API_KEY ?? env(defaults.keyEnv);
  if (!model) throw new TypeError(`A model is required for provider ${provider}`);
  return {
    provider,
    model,
    baseUrl,
    apiKey,
    timeoutMs: input.timeoutMs ?? 120_000,
    maxRetries: input.maxRetries ?? 2,
    capabilities: { ...PROVIDER_CAPABILITIES[provider] }
  };
}

export function createProviderModel(config = {}) {
  const normalized = normalizeProviderConfig(config);
  const options = { ...normalized };
  delete options.provider;
  delete options.capabilities;

  let model;
  if (normalized.provider === "anthropic") {
    model = new AnthropicModel(options);
  } else {
    model = new OpenAICompatibleModel({
      ...options,
      provider: normalized.provider
    });
  }

  assertModel(model);
  return model;
}

export class ProviderRegistry {
  constructor({ providers = {} } = {}) {
    this.providers = new Map();
    for (const [name, factory] of Object.entries(providers)) this.register(name, factory);
  }

  register(name, factory) {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) throw new TypeError("provider name must be lowercase and URL-safe");
    if (typeof factory !== "function") throw new TypeError("provider factory must be a function");
    if (this.providers.has(name)) throw new Error(`Provider already registered: ${name}`);
    this.providers.set(name, factory);
    return this;
  }

  has(name) { return this.providers.has(name); }

  list() {
    return [...this.providers.keys()].sort().map(name => ({
      name,
      capabilities: { ...(PROVIDER_CAPABILITIES[name] || {}) },
      defaultModel: DEFAULTS[name]?.model || null,
      defaultBaseUrl: DEFAULTS[name]?.baseUrl || null
    }));
  }

  create(name, options = {}) {
    const factory = this.providers.get(name);
    if (!factory) throw new Error(`Unknown model provider: ${name}`);
    return assertModel(factory(options));
  }
}

export function createDefaultProviderRegistry() {
  return new ProviderRegistry({
    providers: {
      openai: options => createProviderModel({ ...options, provider: "openai" }),
      anthropic: options => createProviderModel({ ...options, provider: "anthropic" }),
      qwen: options => createProviderModel({ ...options, provider: "qwen" }),
      local: options => createProviderModel({ ...options, provider: "local" }),
      "openai-compatible": options => createProviderModel({ ...options, provider: "openai-compatible" })
    }
  });
}
