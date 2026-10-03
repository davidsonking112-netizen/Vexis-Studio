import test from "node:test";
import assert from "node:assert/strict";
import { analyzeDocument, languageForPath } from "../src/tools/editor_intelligence.js";

test("editor intelligence detects language and common symbols", () => {
  assert.equal(languageForPath("src/app.js"), "javascript");
  const result = analyzeDocument("const answer = 42;\nfunction greet(name) { return name; }\nclass Agent {}", "src/app.js");
  assert.equal(result.language, "javascript");
  assert.equal(result.symbols.map(symbol => symbol.name).join(","), "answer,greet,Agent");
  assert.equal(result.diagnostics.filter(d => d.severity === "error").length, 0);
});

test("editor intelligence reports structural diagnostics", () => {
  const result = analyzeDocument("function broken() {\n  return (1;\n", "broken.js");
  assert.ok(result.diagnostics.some(d => d.severity === "error" && d.message.startsWith("Unclosed")));
  assert.ok(result.diagnostics.some(d => d.severity === "error" && d.message.startsWith("Unclosed")));
});

test("editor intelligence reports deferred markers and whitespace", () => {
  const result = analyzeDocument("const value = 1;  // TODO: revisit\n", "note.js");
  assert.ok(result.diagnostics.some(d => d.severity === "hint"));
  assert.ok(result.diagnostics.some(d => d.severity === "info"));
});

test("editor intelligence supports python and json symbols", () => {
  const python = analyzeDocument("def build():\n  return 1\nclass Agent:\n  pass\n", "agent.py");
  assert.deepEqual(python.symbols.map(s => s.name), ["build", "Agent"]);
  const json = analyzeDocument('{"name": "vexis", "version": 1}', "package.json");
  assert.deepEqual(json.symbols.map(s => s.name), ["name", "version"]);
});

test("editor intelligence enforces bounded analysis", () => {
  assert.throws(() => analyzeDocument("x".repeat(257 * 1024), "large.js"), /256 KiB/);
});
