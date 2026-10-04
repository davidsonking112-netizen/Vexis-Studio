import test from "node:test";
import assert from "node:assert/strict";
import { TokenBudget } from "../src/runtime/token-budget.js";

test("token budget rejects oversized input before a provider request", () => {
  const budget = new TokenBudget({ maxTotalTokens: 1000, maxInputTokens: 100, maxOutputTokens: 200 });
  assert.throws(
    () => budget.prepare([{ role: "user", content: "x".repeat(500) }], 100),
    error => error.code === "VEXIS_INPUT_TOKEN_BUDGET"
  );
});

test("token budget clamps output and records provider usage", () => {
  const budget = new TokenBudget({ maxTotalTokens: 1000, maxInputTokens: 400, maxOutputTokens: 200 });
  const prepared = budget.prepare([{ role: "user", content: "hello" }], 500);
  assert.equal(prepared.outputTokens, 200);
  budget.record({ prompt_tokens: 30, completion_tokens: 40 });
  assert.equal(budget.snapshot().usedInputTokens, 30);
  assert.equal(budget.snapshot().usedOutputTokens, 40);
  assert.equal(budget.snapshot().requests, 1);
});

test("token budget accepts missing provider usage", () => {
  const budget = new TokenBudget({ maxTotalTokens: 1000, maxInputTokens: 400, maxOutputTokens: 200 });
  budget.record(null);
  budget.record();
  assert.equal(budget.snapshot().usedInputTokens, 0);
  assert.equal(budget.snapshot().usedOutputTokens, 0);
  assert.equal(budget.snapshot().requests, 2);
});

test("token budget exhausts cleanly instead of sending an unbounded request", () => {
  const budget = new TokenBudget({ maxTotalTokens: 300, maxInputTokens: 150, maxOutputTokens: 100 });
  budget.record({ prompt_tokens: 200, completion_tokens: 100 });
  assert.throws(() => budget.prepare([{ role: "user", content: "x".repeat(50) }], 100), error => error.code === "VEXIS_TOKEN_BUDGET_EXHAUSTED");
});
