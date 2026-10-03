import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const VERSION = 1;
const DEFAULT_MAX_ENTRIES = 2000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_RECALL_LIMIT = 12;
const DEFAULT_RECALL_TOKENS = 2400;
const TYPES = new Set(["fact", "decision", "failure", "success", "capability", "constraint", "pattern"]);

function text(value, max = 2000) {
  return value == null ? "" : String(value).trim().slice(0, max);
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map(tag => text(tag, 80).toLowerCase()).filter(Boolean))].slice(0, 20);
}

function fingerprint(entry) {
  const canonical = JSON.stringify({
    type: entry.type,
    content: entry.content,
    tags: entry.tags,
    task_id: entry.task_id ?? null,
    source: entry.source ?? null
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 24);
}

function validateEntry(entry) {
  if (!entry || typeof entry !== "object") throw new TypeError("memory entry must be an object");
  if (!TYPES.has(entry.type)) throw new TypeError(`invalid memory type: ${entry.type}`);
  if (!entry.content || typeof entry.content !== "string") {
    throw new TypeError("memory entry requires content");
  }

  const normalized = {
    id: text(entry.id, 80) || randomUUID(),
    type: entry.type,
    content: text(entry.content, 4000),
    tags: normalizeTags(entry.tags),
    task_id: entry.task_id == null ? null : text(entry.task_id, 120),
    plan_id: entry.plan_id == null ? null : text(entry.plan_id, 120),
    step_id: entry.step_id == null ? null : text(entry.step_id, 120),
    source: entry.source == null ? "agent" : text(entry.source, 120),
    confidence: entry.confidence == null ? 0.8 : Number(entry.confidence),
    created_at: entry.created_at ?? new Date().toISOString(),
    updated_at: entry.updated_at ?? new Date().toISOString(),
    fingerprint: entry.fingerprint || fingerprint(entry)
  };

  if (!Number.isFinite(normalized.confidence) || normalized.confidence < 0 || normalized.confidence > 1) {
    throw new TypeError("memory confidence must be between 0 and 1");
  }

  return normalized;
}

function validateStore(store) {
  if (!store || typeof store !== "object" || store.version !== VERSION) {
    throw new TypeError("unsupported memory store version");
  }
  if (!Array.isArray(store.entries)) throw new TypeError("memory entries must be an array");
  const seen = new Set();
  const entries = store.entries.map(validateEntry);
  for (const entry of entries) {
    if (seen.has(entry.id)) throw new TypeError(`duplicate memory id: ${entry.id}`);
    seen.add(entry.id);
  }
  return { version: VERSION, entries };
}

function estimateTokens(value) {
  return Math.ceil(String(value).length / 4);
}

function terms(query) {
  return [...new Set(String(query).toLowerCase().match(/[a-z0-9_./-]{2,}/g) || [])];
}

function scoreEntry(entry, queryTerms, options) {
  const haystack = [entry.content, entry.tags.join(" "), entry.type, entry.source].join(" ").toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    if (entry.content.toLowerCase().includes(term)) score += 6;
    if (entry.tags.some(tag => tag.includes(term))) score += 4;
    if (haystack.includes(term)) score += 2;
  }
  if (options.taskId && entry.task_id === options.taskId) score += 5;
  if (options.planId && entry.plan_id === options.planId) score += 4;
  if (options.types?.has(entry.type)) score += 3;
  const ageDays = Math.max(0, (Date.now() - Date.parse(entry.updated_at)) / 86400000);
  score += 1 / (1 + ageDays / 30);
  score += entry.confidence;
  return score;
}

function compactEntry(entry) {
  return {
    id: entry.id,
    type: entry.type,
    content: entry.content,
    tags: entry.tags,
    task_id: entry.task_id,
    plan_id: entry.plan_id,
    step_id: entry.step_id,
    source: entry.source,
    confidence: entry.confidence,
    created_at: entry.created_at,
    updated_at: entry.updated_at
  };
}

async function atomicWrite(file, content) {
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(temporary, content, "utf8");
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export function createAgentMemory({
  workspace,
  memoryPath = ".vexis/agent-memory.json",
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxBytes = DEFAULT_MAX_BYTES,
  recallLimit = DEFAULT_RECALL_LIMIT,
  recallTokens = DEFAULT_RECALL_TOKENS
}) {
  if (!workspace) throw new TypeError("workspace is required");
  if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new TypeError("maxEntries must be positive");
  if (!Number.isInteger(maxBytes) || maxBytes < 1024) throw new TypeError("maxBytes must be at least 1024");
  const root = path.resolve(workspace);
  const file = path.resolve(root, memoryPath);
  const relative = path.relative(root, file);
  if (relative.startsWith(".."+path.sep) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error("Memory path escapes the workspace");
  }

  async function assertSafePath() {
    const realRoot = await fs.realpath(root);
    const parent = path.dirname(file);
    await fs.mkdir(parent, { recursive: true });
    const realParent = await fs.realpath(parent);
    const parentRel = path.relative(realRoot, realParent);
    if (parentRel.startsWith(".."+path.sep) || parentRel === ".." || path.isAbsolute(parentRel)) {
      throw new Error("Memory path escapes the workspace");
    }
  }

  async function readStore() {
    await assertSafePath();
    try {
      const content = await fs.readFile(file, "utf8");
      if (Buffer.byteLength(content, "utf8") > maxBytes) throw new Error("Agent memory exceeds the size limit");
      return validateStore(JSON.parse(content));
    } catch (error) {
      if (error?.code === "ENOENT") return { version: VERSION, entries: [] };
      throw error;
    }
  }

  async function writeStore(store) {
    const normalized = validateStore(store);
    const content = JSON.stringify(normalized, null, 2) + "\n";
    if (Buffer.byteLength(content, "utf8") > maxBytes) throw new Error("Agent memory exceeds the size limit");
    await atomicWrite(file, content);
    return normalized;
  }

  async function remember(input = {}) {
    const store = await readStore();
    const entry = validateEntry(input);
    const existing = store.entries.findIndex(item => item.fingerprint === entry.fingerprint);
    if (existing >= 0) {
      const merged = {
        ...store.entries[existing],
        ...entry,
        id: store.entries[existing].id,
        created_at: store.entries[existing].created_at,
        updated_at: new Date().toISOString()
      };
      store.entries[existing] = merged;
    } else {
      store.entries.push(entry);
    }

    if (store.entries.length > maxEntries) {
      store.entries.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
      store.entries.length = maxEntries;
    }
    await writeStore(store);
    return compactEntry(existing >= 0 ? store.entries[existing] : entry);
  }

  async function recall(input = {}) {
    const store = await readStore();
    const queryTerms = terms(input.query ?? "");
    const options = {
      taskId: input.task_id == null ? null : String(input.task_id),
      planId: input.plan_id == null ? null : String(input.plan_id),
      types: Array.isArray(input.types) ? new Set(input.types) : null
    };
    const limit = Math.min(Number.isInteger(input.limit) ? input.limit : recallLimit, recallLimit);
    const budget = Math.min(Number.isInteger(input.max_tokens) ? input.max_tokens : recallTokens, recallTokens);

    const ranked = store.entries
      .map(entry => ({ entry, score: scoreEntry(entry, queryTerms, options) }))
      .filter(item => queryTerms.length === 0 || item.score > 1)
      .sort((a, b) => b.score - a.score || Date.parse(b.entry.updated_at) - Date.parse(a.entry.updated_at) || a.entry.id.localeCompare(b.entry.id));

    const entries = [];
    let tokens = 0;
    for (const item of ranked) {
      if (entries.length >= limit) break;
      const cost = estimateTokens(item.entry.content) + estimateTokens(item.entry.tags.join(" "));
      if (entries.length && tokens + cost > budget) continue;
      entries.push({ ...compactEntry(item.entry), score: Number(item.score.toFixed(4)) });
      tokens += cost;
    }

    return { query: String(input.query ?? ""), entries, tokens, total: store.entries.length };
  }

  async function forget(input = {}) {
    const store = await readStore();
    const ids = new Set(Array.isArray(input.ids) ? input.ids.map(String) : []);
    const before = store.entries.length;
    store.entries = store.entries.filter(entry => !ids.has(entry.id));
    await writeStore(store);
    return { removed: before - store.entries.length, remaining: store.entries.length };
  }

  async function clear() {
    await writeStore({ version: VERSION, entries: [] });
    return { removed: true };
  }

  return {
    description: "Bounded, workspace-local structured memory for durable agent facts, decisions, failures, successes, capabilities, constraints, and patterns.",
    remember,
    recall,
    forget,
    clear,
    async stats() {
      const store = await readStore();
      return {
        entries: store.entries.length,
        max_entries: maxEntries,
        bytes: Buffer.byteLength(JSON.stringify(store), "utf8"),
        max_bytes: maxBytes
      };
    },
    execute: async (input = {}) => {
      const action = input.action ?? "recall";
      if (action === "remember") return { status: "ok", entry: await remember(input) };
      if (action === "recall") return { status: "ok", ...(await recall(input)) };
      if (action === "forget") return { status: "ok", ...(await forget(input)) };
      if (action === "clear") return { status: "ok", ...(await clear()) };
      if (action === "stats") return { status: "ok", ...(await this.stats()) };
      throw new Error(`Unknown memory action: ${action}`);
    }
  };
}

export function toAgentMemoryTool(memory) {
  if (!memory || typeof memory.execute !== "function") throw new TypeError("memory must provide execute()");
  return { agent_memory: memory.execute };
}
