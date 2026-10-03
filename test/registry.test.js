import test from "node:test";
import assert from "node:assert/strict";
import {
  ToolRegistry,
  SkillRegistry,
  createToolRegistry
} from "../src/tools/registry.js";

function tool(description, value) {
  return {
    description,
    input: { value: "test value" },
    execute: async () => value
  };
}

test("registers, lists, discovers, and exposes tools to the agent", async () => {
  const registry = createToolRegistry({
    beta: tool("Inspect project files", 2),
    alpha: tool("Run verification", 1)
  });

  assert.deepEqual(registry.list().map(item => item.name), ["alpha", "beta"]);
  assert.deepEqual(registry.discover("inspect").map(item => item.name), ["beta"]);

  const tools = registry.toAgentTools();
  assert.equal(await tools.alpha({}), 1);
  assert.equal(await tools.beta({}), 2);
});

test("rejects invalid tool definitions and accidental collisions", () => {
  const registry = new ToolRegistry();

  assert.throws(
    () => registry.register("Bad Name", tool("bad", 1)),
    /name must match/
  );

  assert.throws(
    () => registry.register("good", { description: "missing execute" }),
    /execute function/
  );

  registry.register("good", tool("valid", 1));
  assert.throws(
    () => registry.register("good", tool("replacement", 2)),
    /already registered/
  );

  registry.register("good", tool("replacement", 2), { replace: true });
});

test("registers skills without installing them until requested", async () => {
  const tools = new ToolRegistry();
  const skills = new SkillRegistry(tools);

  skills.register("testing", {
    description: "Test and verify projects",
    tools: {
      run_checks: tool("Run project checks", "passed")
    }
  });

  assert.deepEqual(skills.list().map(skill => skill.name), ["testing"]);
  assert.equal(tools.has("run_checks"), false);
  assert.deepEqual(skills.discover("verify").map(skill => skill.name), ["testing"]);

  const installed = skills.install("testing");
  assert.equal(installed.name, "testing");
  assert.equal(await tools.get("run_checks").execute({}), "passed");
});

test("rejects skill tool conflicts before registration", () => {
  const tools = new ToolRegistry();
  tools.register("run_checks", tool("Existing checks", "existing"));
  const skills = new SkillRegistry(tools);

  assert.throws(
    () => skills.register("testing", {
      description: "Testing skill",
      tools: {
        run_checks: tool("Conflicting checks", "skill")
      }
    }),
    /conflicts with existing tool/
  );
});

test("unregisters tools and skills", () => {
  const tools = new ToolRegistry();
  const skills = new SkillRegistry(tools);

  tools.register("one", tool("One", 1));
  skills.register("skill", {
    description: "Skill",
    tools: { two: tool("Two", 2) }
  });

  assert.equal(tools.unregister("one"), true);
  assert.equal(tools.has("one"), false);
  assert.equal(skills.unregister("skill"), true);
  assert.equal(skills.get("skill"), undefined);
});
