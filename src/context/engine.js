import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const DEFAULT_MAX_TOKENS = 8_000;
const DEFAULT_MAX_FILE_BYTES = 24 * 1024;
const DEFAULT_MAX_FILES = 24;
const DEFAULT_MAX_SCAN_ENTRIES = 2_000;
const DEFAULT_MAX_RECENT_MESSAGES = 8;

const IGNORED_DIRECTORIES = new Set([
  ".git", "node_modules", "dist", "build", "coverage", ".next", ".turbo"
]);

const SOURCE_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".go", ".rs",
  ".java", ".kt", ".swift", ".rb", ".php", ".c", ".cc", ".cpp", ".h",
  ".hpp", ".cs", ".css", ".scss", ".html", ".vue", ".svelte", ".json",
  ".yaml", ".yml", ".toml", ".md"
]);

const IMPORTANT_FILES = new Set([
  "package.json", "README.md", "tsconfig.json", "jsconfig.json",
  "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod",
  "pom.xml", "build.gradle", "build.gradle.kts"
]);

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(name + " must be a positive integer");
}

export function estimateTokens(value) {
  const text = String(value ?? "");
  if (!text) return 0;
  // Conservative deterministic estimate for mixed natural language and source.
  return Math.max(1, Math.ceil(Buffer.byteLength(text, "utf8") / 3.5));
}

function normalizeTerms(text) {
  return [...new Set(
    String(text ?? "")
      .toLowerCase()
      .match(/[a-z0-9_$][a-z0-9_$./-]{1,}/g) || []
  )].filter(term => term.length > 1);
}

function normalizePath(value) {
  return String(value || "").split(path.sep).join("/");
}

function lexicalScore(candidate, queryTerms) {
  if (!queryTerms.length) return 0;

  const pathText = String(candidate.path || "").toLowerCase();
  const contentText = String(candidate.content || "").toLowerCase();
  let score = 0;

  for (const term of queryTerms) {
    if (pathText === term || pathText.endsWith("/" + term)) score += 12;
    else if (pathText.includes(term)) score += 6;

    if (contentText) {
      const index = contentText.indexOf(term);
      if (index >= 0) score += 2 + Math.min(3, contentText.split(term).length - 1);
    }
  }

  return score;
}

function typePriority(type) {
  return ({
    task: 100,
    focus: 95,
    test_failure: 90,
    git: 85,
    task_state: 82,
    dependency: 78,
    structure: 70,
    file: 60,
    observation: 55,
    message: 40
  })[type] ?? 20;
}

export function scoreCandidate(candidate, query = "") {
  const queryTerms = normalizeTerms(query);
  const explicit = candidate.explicit ? 30 : 0;
  const recency = Math.max(0, Math.min(15, Number(candidate.recency ?? 0)));
  const priority = Math.max(0, Math.min(100, Number(candidate.priority ?? 0)));
  const relevance = lexicalScore(candidate, queryTerms);
  const sizePenalty = Math.min(12, Math.max(0, estimateTokens(candidate.content) / 2_000));
  return priority + typePriority(candidate.type) + explicit + recency + relevance - sizePenalty;
}

export function compressText(text, maxTokens, { headRatio = 0.65 } = {}) {
  assertPositiveInteger(maxTokens, "maxTokens");
  const value = String(text ?? "");
  if (estimateTokens(value) <= maxTokens) return { text: value, truncated: false };

  const targetBytes = Math.max(64, Math.floor(maxTokens * 3.5));
  const headBytes = Math.floor(targetBytes * headRatio);
  const tailBytes = Math.max(32, targetBytes - headBytes);
  const buffer = Buffer.from(value, "utf8");
  const head = buffer.subarray(0, headBytes).toString("utf8");
  const tail = buffer.subarray(Math.max(0, buffer.length - tailBytes)).toString("utf8");
  return {
    text: head + "\n\n… [context compressed] …\n\n" + tail,
    truncated: true
  };
}

function candidateId(candidate) {
  return candidate.id || createHash("sha1")
    .update(JSON.stringify([candidate.type, candidate.path || "", candidate.content || ""]))
    .digest("hex");
}

function formatCandidate(candidate, content) {
  const label = candidate.path ? candidate.type + ": " + candidate.path : candidate.type;
  return "### " + label + "\n" + content;
}

function uniquePush(target, candidate) {
  const id = candidateId(candidate);
  if (target.some(item => candidateId(item) === id)) return;
  target.push({ ...candidate, id });
}

export class ContextEngine {
  constructor({
    workspace,
    filesystem,
    taskState = null,
    maxTokens = DEFAULT_MAX_TOKENS,
    maxFiles = DEFAULT_MAX_FILES,
    maxFileBytes = DEFAULT_MAX_FILE_BYTES,
    maxScanEntries = DEFAULT_MAX_SCAN_ENTRIES,
    maxRecentMessages = DEFAULT_MAX_RECENT_MESSAGES,
    refreshMs = 1_000
  } = {}) {
    if (!workspace) throw new TypeError("workspace is required");
    if (!filesystem?.list_files?.execute || !filesystem?.read_file?.execute) {
      throw new TypeError("filesystem tools are required");
    }
    assertPositiveInteger(maxTokens, "maxTokens");
    assertPositiveInteger(maxFiles, "maxFiles");
    assertPositiveInteger(maxFileBytes, "maxFileBytes");
    assertPositiveInteger(maxScanEntries, "maxScanEntries");
    assertPositiveInteger(maxRecentMessages, "maxRecentMessages");

    this.workspace = path.resolve(workspace);
    this.filesystem = filesystem;
    this.taskState = taskState;
    this.maxTokens = maxTokens;
    this.maxFiles = maxFiles;
    this.maxFileBytes = maxFileBytes;
    this.maxScanEntries = maxScanEntries;
    this.maxRecentMessages = maxRecentMessages;
    this.refreshMs = Math.max(0, refreshMs);
    this.snapshot = null;
    this.snapshotAt = 0;
  }

  async refresh({ force = false } = {}) {
    const now = Date.now();
    if (!force && this.snapshot && now - this.snapshotAt < this.refreshMs) {
      return this.snapshot;
    }

    const listing = await this.filesystem.list_files.execute({
      path: ".",
      max_entries: this.maxScanEntries
    });

    const entries = listing.entries.filter(entry => {
      if (entry.type === "symlink") return false;
      const first = normalizePath(entry.path).split("/")[0];
      return !IGNORED_DIRECTORIES.has(first);
    });

    const files = entries.filter(entry => entry.type === "file");
    const directories = entries.filter(entry => entry.type === "directory");
    const important = files
      .filter(entry => IMPORTANT_FILES.has(path.basename(entry.path)))
      .map(entry => normalizePath(entry.path));
    const sourceFiles = files
      .filter(entry => SOURCE_EXTENSIONS.has(path.extname(entry.path).toLowerCase()))
      .map(entry => normalizePath(entry.path));

    this.snapshot = {
      entries,
      files: files.map(entry => normalizePath(entry.path)),
      directories: directories.map(entry => normalizePath(entry.path)),
      important,
      sourceFiles,
      truncated: Boolean(listing.truncated)
    };
    this.snapshotAt = now;
    return this.snapshot;
  }

  async readCandidateFile(filePath) {
    const normalized = normalizePath(filePath);
    try {
      const result = await this.filesystem.read_file.execute({ path: normalized });
      const bytes = Buffer.from(result.content, "utf8");
      const bounded = bytes.length > this.maxFileBytes
        ? bytes.subarray(0, this.maxFileBytes).toString("utf8")
        : result.content;
      const compressed = compressText(
        bounded,
        Math.max(1, Math.floor(this.maxFileBytes / 3.5))
      );
      return {
        path: normalized,
        content: compressed.text,
        truncated: compressed.truncated || bytes.length > this.maxFileBytes
      };
    } catch {
      return null;
    }
  }

  async build({
    task = "",
    messages = [],
    focusPaths = [],
    changedPaths = [],
    observations = [],
    maxTokens = this.maxTokens,
    forceRefresh = false
  } = {}) {
    assertPositiveInteger(maxTokens, "maxTokens");
    const snapshot = await this.refresh({ force: forceRefresh });
    const recentMessages = Array.isArray(messages) ? messages.slice(-this.maxRecentMessages) : [];
    const query = [
      task,
      ...focusPaths,
      ...changedPaths,
      ...recentMessages.filter(m => m?.role === "user").map(m => m.content)
    ].join(" ");

    const candidates = [];

    uniquePush(candidates, {
      type: "task",
      content: String(task || "No task supplied."),
      priority: 100,
      explicit: true
    });

    const structure = [
      "Workspace structure:",
      ...snapshot.entries.slice(0, 400).map(entry => (entry.type === "directory" ? "[dir] " : "[file] ") + entry.path),
      snapshot.truncated ? "[structure truncated]" : ""
    ].filter(Boolean).join("\n");
    uniquePush(candidates, { type: "structure", content: structure, priority: 65 });

    for (const filePath of snapshot.important) {
      const candidate = await this.readCandidateFile(filePath);
      if (candidate) uniquePush(candidates, {
        type: "dependency",
        path: candidate.path,
        content: candidate.content,
        priority: 78,
        explicit: focusPaths.includes(candidate.path)
      });
    }

    const rankedPaths = [...new Set([
      ...focusPaths.map(normalizePath),
      ...changedPaths.map(normalizePath),
      ...snapshot.sourceFiles
    ])]
      .map(filePath => ({
        path: filePath,
        type: focusPaths.map(normalizePath).includes(filePath) ? "focus" : "file",
        explicit: focusPaths.map(normalizePath).includes(filePath)
      }))
      .map(candidate => ({
        ...candidate,
        priority: candidate.explicit ? 95 : 55,
        relevance: lexicalScore(candidate, normalizeTerms(query))
      }))
      .sort((a, b) => (b.priority + b.relevance) - (a.priority + a.relevance))
      .slice(0, this.maxFiles);

    for (const item of rankedPaths) {
      const candidate = await this.readCandidateFile(item.path);
      if (!candidate) continue;
      uniquePush(candidates, {
        ...item,
        content: candidate.content,
        truncated: candidate.truncated
      });
    }

    if (this.taskState) {
      try {
        const state = await this.taskState.execute({ action: "read" });
        if (state.state) {
          uniquePush(candidates, {
            type: "task_state",
            content: JSON.stringify(state.state, null, 2),
            priority: 82
          });
        }
      } catch {}
    }

    for (const observation of observations.slice(-this.maxRecentMessages)) {
      uniquePush(candidates, {
        type: observation.type || "observation",
        path: observation.path || "",
        content: String(observation.content ?? JSON.stringify(observation)),
        priority: 58,
        recency: 15
      });
    }

    const scored = candidates
      .map(candidate => ({ ...candidate, score: scoreCandidate(candidate, query) }))
      .sort((a, b) =>
        Number(Boolean(b.explicit)) - Number(Boolean(a.explicit)) ||
        b.score - a.score ||
        String(a.id).localeCompare(String(b.id))
      );

    const selected = [];
    let usedTokens = 0;

    for (const candidate of scored) {
      if (usedTokens >= maxTokens) break;
      const separatorCost = selected.length ? 8 : 0;
      const remaining = maxTokens - usedTokens - separatorCost;
      if (remaining < 16) break;

      const label = candidate.path
        ? "### " + candidate.type + ": " + candidate.path + "\n"
        : "### " + candidate.type + "\n";
      let contentBudget = Math.max(1, remaining - estimateTokens(label) - 2);
      let compressed = compressText(candidate.content, contentBudget);
      let rendered = formatCandidate(candidate, compressed.text);
      let tokens = estimateTokens(rendered);

      if (tokens > remaining) {
        contentBudget = Math.max(1, contentBudget - (tokens - remaining) - 2);
        compressed = compressText(candidate.content, contentBudget);
        rendered = formatCandidate(candidate, compressed.text);
        tokens = estimateTokens(rendered);
      }

      if (tokens > remaining) continue;

      selected.push({
        ...candidate,
        content: compressed.text,
        compressed: compressed.truncated || Boolean(candidate.truncated),
        tokens
      });
      usedTokens += tokens + separatorCost;
    }

    const content = selected.map(candidate => formatCandidate(candidate, candidate.content)).join("\n\n");
    return {
      version: 1,
      query,
      content,
      candidates: selected.map(candidate => ({
        id: candidate.id,
        type: candidate.type,
        path: candidate.path || null,
        score: Number(candidate.score.toFixed(3)),
        tokens: candidate.tokens,
        compressed: candidate.compressed
      })),
      tokens: estimateTokens(content),
      budget: maxTokens,
      refreshedAt: new Date().toISOString(),
      truncated: snapshot.truncated || selected.length < scored.length
    };
  }

  invalidate() {
    this.snapshot = null;
    this.snapshotAt = 0;
  }

  describe() {
    return {
      workspace: this.workspace,
      maxTokens: this.maxTokens,
      maxFiles: this.maxFiles,
      maxFileBytes: this.maxFileBytes,
      cached: Boolean(this.snapshot)
    };
  }
}

export function createContextEngine(options) {
  return new ContextEngine(options);
}
