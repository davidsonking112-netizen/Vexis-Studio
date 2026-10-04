const DEFAULT_MAX_TOTAL_TOKENS = 160_000;
const DEFAULT_MAX_INPUT_TOKENS = 32_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 8_000;
const CONTEXT_COMPACTED_MARKER = "\n\n[VEXIS CONTEXT COMPACTED]";

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(name + " must be a positive integer");
}

export function estimateBudgetTokens(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  if (!text) return 0;
  return Math.max(1, Math.ceil(Buffer.byteLength(text, "utf8") / 3.5));
}

function cloneMessage(message) {
  if (!message || typeof message !== "object") return message;
  return { ...message };
}

function messageText(message) {
  if (typeof message?.content === "string") return message.content;
  return JSON.stringify(message?.content ?? "");
}

function truncateUtf8(text, maxBytes) {
  const buffer = Buffer.from(text, "utf8");
  return buffer.subarray(0, Math.max(1, maxBytes)).toString("utf8");
}

export function compactMessages(messages, maxInputTokens, { recentMessages = 2, minimumMessageTokens = 256 } = {}) {
  if (!Array.isArray(messages)) throw new TypeError("messages must be an array");
  positiveInteger(maxInputTokens, "maxInputTokens");
  if (!Number.isInteger(recentMessages) || recentMessages < 1) throw new TypeError("recentMessages must be a positive integer");
  if (!Number.isInteger(minimumMessageTokens) || minimumMessageTokens < 1) throw new TypeError("minimumMessageTokens must be a positive integer");

  const originalTokens = estimateBudgetTokens(messages);
  if (originalTokens <= maxInputTokens) {
    return { messages, originalTokens, finalTokens: originalTokens, compacted: false, droppedMessages: 0, truncatedMessages: 0 };
  }

  const records = messages.map((message, originalIndex) => ({
    originalIndex,
    message: cloneMessage(message)
  }));
  const latestUserIndex = [...records].reverse().find(record => record.message?.role === "user")?.originalIndex ?? -1;
  const firstSystemIndex = records.find(record => record.message?.role === "system")?.originalIndex ?? -1;
  const keep = new Set();

  if (firstSystemIndex >= 0) keep.add(firstSystemIndex);
  if (latestUserIndex >= 0) keep.add(latestUserIndex);
  for (let index = Math.max(0, records.length - recentMessages); index < records.length; index += 1) {
    keep.add(index);
  }

  let selected = records.filter(record => keep.has(record.originalIndex));
  let droppedMessages = records.length - selected.length;
  let truncatedMessages = 0;
  let finalTokens = estimateBudgetTokens(selected.map(record => record.message));

  while (finalTokens > maxInputTokens) {
    const removable = selected
      .filter(record => record.originalIndex !== firstSystemIndex && record.originalIndex !== latestUserIndex)
      .sort((a, b) => a.originalIndex - b.originalIndex)[0];

    if (removable) {
      selected = selected.filter(record => record !== removable);
      droppedMessages += 1;
      finalTokens = estimateBudgetTokens(selected.map(record => record.message));
      continue;
    }

    const candidates = selected
      .map((record, index) => ({
        record,
        index,
        tokens: estimateBudgetTokens(record.message?.content ?? record.message)
      }))
      .filter(candidate => candidate.tokens > minimumMessageTokens)
      .sort((a, b) => b.tokens - a.tokens || a.record.originalIndex - b.record.originalIndex);

    if (!candidates.length) break;

    const candidate = candidates[0];
    const message = candidate.record.message;
    const currentText = messageText(message);
    const nonCandidateTokens = estimateBudgetTokens(
      selected.filter((_, index) => index !== candidate.index).map(record => record.message)
    );
    const requiredTokens = Math.max(1, maxInputTokens - nonCandidateTokens - 1);
    const targetTokens = Math.min(
      Math.max(1, Math.min(minimumMessageTokens, candidate.tokens - 1)),
      requiredTokens
    );
    const targetBytes = Math.max(1, Math.floor(targetTokens * 3.5) - Buffer.byteLength(CONTEXT_COMPACTED_MARKER, "utf8"));
    const truncated = truncateUtf8(currentText, targetBytes);

    if (truncated === currentText && candidate.record.originalIndex !== firstSystemIndex && candidate.record.originalIndex !== latestUserIndex) {
      selected.splice(candidate.index, 1);
      droppedMessages += 1;
      finalTokens = estimateBudgetTokens(selected.map(record => record.message));
      continue;
    }

    message.content = truncated + CONTEXT_COMPACTED_MARKER;
    truncatedMessages += 1;
    const nextTokens = estimateBudgetTokens(selected.map(record => record.message));
    if (nextTokens >= finalTokens && candidate.record.originalIndex !== firstSystemIndex && candidate.record.originalIndex !== latestUserIndex) {
      selected.splice(candidate.index, 1);
      droppedMessages += 1;
    }
    finalTokens = estimateBudgetTokens(selected.map(record => record.message));
  }

  if (finalTokens > maxInputTokens) {
    const error = new Error("Unable to compact model messages within Vexis input token budget (" + finalTokens + " > " + maxInputTokens + ")");
    error.code = "VEXIS_INPUT_COMPACTION_FAILED";
    error.inputTokens = finalTokens;
    error.maxInputTokens = maxInputTokens;
    throw error;
  }

  return {
    messages: selected.map(record => record.message),
    originalTokens,
    finalTokens,
    compacted: true,
    droppedMessages,
    truncatedMessages
  };
}

export class TokenBudget {
  constructor({
    maxTotalTokens = DEFAULT_MAX_TOTAL_TOKENS,
    maxInputTokens = DEFAULT_MAX_INPUT_TOKENS,
    maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS
  } = {}) {
    positiveInteger(maxTotalTokens, "maxTotalTokens");
    positiveInteger(maxInputTokens, "maxInputTokens");
    positiveInteger(maxOutputTokens, "maxOutputTokens");
    if (maxInputTokens + maxOutputTokens > maxTotalTokens) {
      throw new TypeError("maxInputTokens + maxOutputTokens must not exceed maxTotalTokens");
    }
    this.maxTotalTokens = maxTotalTokens;
    this.maxInputTokens = maxInputTokens;
    this.maxOutputTokens = maxOutputTokens;
    this.usedInputTokens = 0;
    this.usedOutputTokens = 0;
    this.requests = 0;
  }

  prepare(messages, requestedOutputTokens) {
    const inputTokens = estimateBudgetTokens(messages);
    if (inputTokens > this.maxInputTokens) {
      const error = new Error("Model request exceeds Vexis input token budget (" + inputTokens + " > " + this.maxInputTokens + ")");
      error.code = "VEXIS_INPUT_TOKEN_BUDGET";
      error.inputTokens = inputTokens;
      error.maxInputTokens = this.maxInputTokens;
      throw error;
    }

    const remainingTotal = this.maxTotalTokens - this.usedInputTokens - this.usedOutputTokens;
    const remainingOutput = Math.min(this.maxOutputTokens - this.usedOutputTokens, remainingTotal - inputTokens);
    const outputTokens = Math.min(
      Number.isInteger(requestedOutputTokens) && requestedOutputTokens > 0 ? requestedOutputTokens : this.maxOutputTokens,
      remainingOutput
    );

    if (outputTokens < 1) {
      const error = new Error("Vexis token budget exhausted before model request");
      error.code = "VEXIS_TOKEN_BUDGET_EXHAUSTED";
      throw error;
    }

    return { inputTokens, outputTokens };
  }

  record(usage = {}) {
    const normalizedUsage = usage && typeof usage === "object" ? usage : {};
    const inputTokens = Number(normalizedUsage.prompt_tokens ?? normalizedUsage.input_tokens ?? 0);
    const outputTokens = Number(normalizedUsage.completion_tokens ?? normalizedUsage.output_tokens ?? 0);
    if (Number.isFinite(inputTokens) && inputTokens > 0) this.usedInputTokens += Math.floor(inputTokens);
    if (Number.isFinite(outputTokens) && outputTokens > 0) this.usedOutputTokens += Math.floor(outputTokens);
    this.requests += 1;
  }

  snapshot() {
    return {
      maxTotalTokens: this.maxTotalTokens,
      maxInputTokens: this.maxInputTokens,
      maxOutputTokens: this.maxOutputTokens,
      usedInputTokens: this.usedInputTokens,
      usedOutputTokens: this.usedOutputTokens,
      requests: this.requests,
      remainingTokens: Math.max(0, this.maxTotalTokens - this.usedInputTokens - this.usedOutputTokens)
    };
  }
}

export const DEFAULT_TOKEN_BUDGET = {
  maxTotalTokens: DEFAULT_MAX_TOTAL_TOKENS,
  maxInputTokens: DEFAULT_MAX_INPUT_TOKENS,
  maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS
};
