import { createDefaultProviderRegistry, normalizeProviderConfig } from "./providers.js";

export function loadModelProfiles(env = process.env) {
  const raw = env.VEXIS_MODEL_PROFILES;
  if (!raw) return {};
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error("VEXIS_MODEL_PROFILES must be valid JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("VEXIS_MODEL_PROFILES must be an object");
  return parsed;
}

export function resolveModelConfig({ profile, profiles = loadModelProfiles(), ...input } = {}) {
  const selected = profile ? profiles[profile] : null;
  if (profile && !selected) throw new Error(`Unknown model profile: ${profile}`);
  return normalizeProviderConfig({ ...(selected || {}), ...input });
}

export function createConfiguredModel({ profile, profiles, registry = createDefaultProviderRegistry(), ...input } = {}) {
  const config = resolveModelConfig({ profile, profiles, ...input });
  return registry.create(config.provider, config);
}
