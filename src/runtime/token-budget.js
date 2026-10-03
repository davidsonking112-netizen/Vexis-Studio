const DEFAULT_MAX_TOTAL_TOKENS = 160_000;
const DEFAULT_MAX_INPUT_TOKENS = 32_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 8_000;

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(name + " must be a positive integer");
}

export function estimateBudgetTokens(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  if (!text) return 0;
  return Math.max(1, Math.ceil(Buffer.byteLength(text, "utf8") / 3.5));
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
    const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
    const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
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
};export function compactMessages(messages, maxInputTokens, { recentMessages = 8, minimumMessageTokens = 256 } = {}) {
  if (!Array.isArray(messages)) throw new TypeError("messages must be an array");
  positiveInteger(maxInputTokens, "maxInputTokens");
  if (!Number.isInteger(recentMessages) || recentMessages < 1) throw new TypeError("recentMessages must be a positive integer");
  if (!Number.isInteger(minimumMessageTokens) || minimumMessageTokens < 1) throw new TypeError("minimumMessageTokens must be a positive integer");

  const originalTokens = estimateBudgetTokens(messages);
  if (originalTokens <= maxInputTokens) {
    return { messages, originalTokens, finalTokens: originalTokens, compacted: false, droppedMessages: 0, truncatedMessages: 0 };
  }

  const latestUserIndex = [...messages].map((message, index) => ({ message, index }))
    .reverse().find(item => item.message?.role === "user")?.index ?? -1;
  const firstSystemIndex = messages.findIndex(message => message?.role === "system");
  const keep = new Set();

  if (firstSystemIndex >= 0) keep.add(firstSystemIndex);
  if (latestUserIndex >= 0) keep.add(latestUserIndex);

  for (let index = Math.max(0, messages.length - recentMessages); index < messages.length; index++) {
    keep.add(index);
  }

  let compactedMessages = messages.filter((_, index) => keep.has(index));
  let droppedMessages = messages.length - compactedMessages.length;
  let truncatedMessages = 0;
  let finalTokens = estimateBudgetTokens(compactedMessages);

  while (finalTokens > maxInputTokens) {
    const candidates = compactedMessages
      .map((message, index) => ({
        index,
        tokens: estimateBudgetTokens(message.content ?? message),
        role: message?.role
      }))
      .filter(candidate => candidate.tokens > minimumMessageTokens)
      .sort((a, b) => b.tokens - a.tokens);

    if (!candidates.length) break;

    const candidate = candidates[0];
    const message = compactedMessages[candidate.index];
    const currentText = typeof message.content === "string"
      ? message.content
      : JSON.stringify(message.content ?? "");
    const currentBytes = Buffer.byteLength(currentText, "utf8");

    let targetTokens = Math.max(minimumMessageTokens, Math.floor(candidate.tokens * 0.55));
    const nonCandidateTokens = estimateBudgetTokens(
      compactedMessages.filter((_, index) => index !== candidate.index)
    );
    const requiredTokens = Math.max(1, maxInputTokens - nonCandidateTokens - 1);
    targetTokens = Math.min(targetTokens, requiredTokens);

    if (targetTokens >= candidate.tokens) {
      const removable = compactedMessages
        .map((item, index) => ({ item, index }))
        .filter(({ index, item }) =>
          index !== latestUserIndex &&
          item?.role !== "user" &&
          item?.role !== "system"
        )
        .sort((a, b) => a.index - b.index)[0];

      if (removable) {
        compactedMessages.splice(removable.index, 1);
        droppedMessages += 1;
        finalTokens = estimateBudgetTokens(compactedMessages);
        continue;
      }

      targetTokens = Math.max(1, requiredTokens);
    }

    const targetBytes = Math.max(1, Math.floor(targetTokens * 3.5));
    let text = currentText.slice(0, Math.min(currentText.length, targetBytes));
    while (Buffer.byteLength(text, "utf8") > Math.max(1, targetBytes - 32) && text.length > 1) {
      text = text.slice(0, -1);
    }

    message.content = text + "\n\n[VEXIS CONTEXT COMPACTED]";
    truncatedMessages += 1;
    finalTokens = estimateBudgetTokens(compactedMessages);

    if (currentBytes <= Buffer.byteLength(text, "utf8")) {
      const removable = compactedMessages
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item?.role !== "user")
        .sort((a, b) => a.index - b.index)[0];
      if (removable) {
        compactedMessages.splice(removable.index, 1);
        droppedMessages += 1;
        finalTokens = estimateBudgetTokens(compactedMessages);
      } else {
        break;
      }
    }
  }

  if (finalTokens > maxInputTokens) {
    const error = new Error("Unable to compact model messages within Vexis input token budget (" + finalTokens + " > " + maxInputTokens + ")");
    error.code = "VEXIS_INPUT_COMPACTION_FAILED";
    error.inputTokens = finalTokens;
    error.maxInputTokens = maxInputTokens;
    throw error;
  }

  return {
    messages: compactedMessages,
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
    const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
    const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
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
