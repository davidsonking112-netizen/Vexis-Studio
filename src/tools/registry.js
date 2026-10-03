const NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;

function assertName(name, label = "tool") {
  if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
    throw new TypeError(`${label} name must match [a-z][a-z0-9_-]*`);
  }
}

function normalizeTool(name, definition) {
  if (!definition || typeof definition !== "object") {
    throw new TypeError(`${name} definition must be an object`);
  }
  if (typeof definition.execute !== "function") {
    throw new TypeError(`${name} must provide an execute function`);
  }
  if (typeof definition.description !== "string" || definition.description.trim() === "") {
    throw new TypeError(`${name} must provide a description`);
  }

  return Object.freeze({
    name,
    description: definition.description,
    input: definition.input ?? {},
    execute: definition.execute
  });
}

function matches(value, query) {
  return !query || value.toLowerCase().includes(query.toLowerCase());
}

export class ToolRegistry {
  constructor() {
    this.definitions = new Map();
  }

  register(name, definition, { replace = false } = {}) {
    assertName(name);

    if (this.definitions.has(name) && !replace) {
      throw new Error(`Tool already registered: ${name}`);
    }

    const normalized = normalizeTool(name, definition);
    this.definitions.set(name, normalized);
    return normalized;
  }

  registerMany(definitions, options = {}) {
    if (!definitions || typeof definitions !== "object" || Array.isArray(definitions)) {
      throw new TypeError("tool definitions must be an object");
    }

    return Object.entries(definitions).map(([name, definition]) =>
      this.register(name, definition, options)
    );
  }

  unregister(name) {
    assertName(name);
    return this.definitions.delete(name);
  }

  has(name) {
    return this.definitions.has(name);
  }

  get(name) {
    return this.definitions.get(name);
  }

  list() {
    return [...this.definitions.values()]
      .map(({ name, description, input }) => ({ name, description, input }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  discover(query = "") {
    if (typeof query !== "string") {
      throw new TypeError("tool discovery query must be a string");
    }

    return this.list().filter(definition =>
      matches(definition.name, query) || matches(definition.description, query)
    );
  }

  toAgentTools() {
    return Object.fromEntries(
      [...this.definitions.values()].map(definition => [
        definition.name,
        definition.execute
      ])
    );
  }
}

export class SkillRegistry {
  constructor(toolRegistry = new ToolRegistry()) {
    if (!(toolRegistry instanceof ToolRegistry)) {
      throw new TypeError("toolRegistry must be a ToolRegistry");
    }

    this.toolRegistry = toolRegistry;
    this.definitions = new Map();
  }

  register(name, skill) {
    assertName(name, "skill");

    if (!skill || typeof skill !== "object") {
      throw new TypeError(`${name} skill definition must be an object`);
    }
    if (typeof skill.description !== "string" || skill.description.trim() === "") {
      throw new TypeError(`${name} must provide a description`);
    }
    if (!skill.tools || typeof skill.tools !== "object" || Array.isArray(skill.tools)) {
      throw new TypeError(`${name} must provide a tools object`);
    }
    if (this.definitions.has(name)) {
      throw new Error(`Skill already registered: ${name}`);
    }

    const toolNames = Object.keys(skill.tools);
    for (const toolName of toolNames) {
      assertName(toolName);
      if (this.toolRegistry.has(toolName)) {
        throw new Error(`Skill ${name} conflicts with existing tool: ${toolName}`);
      }
      normalizeTool(toolName, skill.tools[toolName]);
    }

    const definition = Object.freeze({
      name,
      description: skill.description,
      tools: Object.freeze({ ...skill.tools }),
      toolNames: Object.freeze([...toolNames])
    });

    this.definitions.set(name, definition);
    return this.describe(name);
  }

  install(name) {
    const definition = this.definitions.get(name);
    if (!definition) throw new Error(`Unknown skill: ${name}`);

    for (const toolName of definition.toolNames) {
      if (this.toolRegistry.has(toolName)) {
        throw new Error(`Skill ${name} conflicts with existing tool: ${toolName}`);
      }
    }

    for (const toolName of definition.toolNames) {
      this.toolRegistry.register(toolName, definition.tools[toolName]);
    }

    return this.describe(name);
  }

  unregister(name) {
    assertName(name, "skill");
    return this.definitions.delete(name);
  }

  get(name) {
    return this.describe(name);
  }

  list() {
    return [...this.definitions.values()]
      .map(definition => this.describe(definition.name))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  discover(query = "") {
    if (typeof query !== "string") {
      throw new TypeError("skill discovery query must be a string");
    }

    return this.list().filter(skill =>
      matches(skill.name, query) || matches(skill.description, query)
    );
  }

  describe(name) {
    const definition = this.definitions.get(name);
    if (!definition) return undefined;

    return {
      name: definition.name,
      description: definition.description,
      tools: [...definition.toolNames]
    };
  }
}

export function createToolRegistry(definitions = {}) {
  const registry = new ToolRegistry();
  registry.registerMany(definitions);
  return registry;
}

export function createSkillRegistry(toolRegistry = new ToolRegistry()) {
  return new SkillRegistry(toolRegistry);
}
