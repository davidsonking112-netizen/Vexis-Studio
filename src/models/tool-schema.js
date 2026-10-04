const OPTIONAL_NAME_PATTERN = /^(?:path|query|case_sensitive|max_results|max_entries|max_files|limit|expected_replacements|old_text|new_text|expected_sha256|action)$/;

function inferType(name, description) {
  const text = `${name} ${description || ""}`.toLowerCase();
  if (/boolean|true|false|enabled|stream/.test(text)) return "boolean";
  if (/integer|number|count|limit|max_|replacements|tokens|bytes/.test(text)) return "integer";
  return "string";
}

function isSchema(value) {
  return value && typeof value === "object" && value.type === "object" && value.properties && typeof value.properties === "object";
}

export function toToolInputSchema(input = {}) {
  if (isSchema(input)) {
    return {
      type: "object",
      properties: { ...input.properties },
      ...(Array.isArray(input.required) ? { required: [...input.required] } : {}),
      additionalProperties: input.additionalProperties === true
    };
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { type: "object", properties: {}, additionalProperties: false };
  }

  const properties = {};
  const required = [];
  for (const [name, descriptor] of Object.entries(input)) {
    if (descriptor && typeof descriptor === "object" && typeof descriptor.type === "string") {
      properties[name] = { ...descriptor };
    } else {
      const description = String(descriptor ?? "");
      properties[name] = { type: inferType(name, description), ...(description ? { description } : {}) };
    }
    const descriptorText = String(descriptor ?? "").toLowerCase();
    const isOptional = descriptorText.includes("optional") || descriptorText.includes("default");
    if (!OPTIONAL_NAME_PATTERN.test(name) || !isOptional) {
      required.push(name);
    }
  }

  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false
  };
}
