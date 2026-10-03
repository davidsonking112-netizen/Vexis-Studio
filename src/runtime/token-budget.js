const DEFAULT_MAX_TOTAL_TOKENS = 48_000;
const DEFAULT_MAX_INPUT_TOKENS = 20_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 6_000;

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
};
