import test from "node:test";
import assert from "node:assert/strict";
import { createDesktop } from "../src/desktop.js";

function registry() {
  return {
    list: () => [{ name: "run_tests", description: "Run project tests" }],
    discover: query => query ? [{ name: "run_tests", description: "Run project tests" }] : []
  };
}

async function json(url, options) {
  const response = await fetch(url, options);
  return { response, body: await response.json() };
}

test("desktop serves a local UI and tool endpoints", async () => {
  const desktop = createDesktop({
    agent: { run: async task => ({ status: "completed", output: `completed: ${task}` }) },
    registry
  });
  const address = await desktop.start();
  try {
    const page = await fetch(address.url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Vexis Studio/);

    const tools = await json(address.url + "api/tools");
    assert.equal(tools.response.status, 200);
    assert.equal(tools.body.tools[0].name, "run_tests");

    const discovered = await json(address.url + "api/discover?q=tests");
    assert.equal(discovered.response.status, 200);
    assert.equal(discovered.body.tools.length, 1);
  } finally {
    await desktop.stop();
  }
});

test("desktop sends tasks through the shared agent", async () => {
  const tasks = [];
  const desktop = createDesktop({
    agent: {
      run: async task => {
        tasks.push(task);
        return { status: "completed", output: "done" };
      }
    },
    registry
  });
  const address = await desktop.start();
  try {
    const result = await json(address.url + "api/task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: "inspect auth" })
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.output, "done");
    assert.deepEqual(tasks, ["inspect auth"]);
  } finally {
    await desktop.stop();
  }
});

test("desktop rejects invalid and oversized task requests", async () => {
  const desktop = createDesktop({
    agent: { run: async () => ({ output: "unused" }) },
    registry
  });
  const address = await desktop.start();
  try {
    const empty = await json(address.url + "api/task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: "   " })
    });
    assert.equal(empty.response.status, 400);

    const oversized = await fetch(address.url + "api/task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: "x".repeat(70 * 1024) })
    });
    assert.equal(oversized.status, 413);
  } finally {
    await desktop.stop();
  }
});

test("desktop serializes concurrent task execution", async () => {
  const active = { count: 0, max: 0 };
  const desktop = createDesktop({
    agent: {
      run: async task => {
        active.count += 1;
        active.max = Math.max(active.max, active.count);
        await new Promise(resolve => setTimeout(resolve, 10));
        active.count -= 1;
        return { output: task };
      }
    },
    registry
  });
  const address = await desktop.start();
  try {
    const requests = ["one", "two", "three"].map(task => json(address.url + "api/task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task })
    }));
    const results = await Promise.all(requests);
    assert.deepEqual(results.map(result => result.body.output), ["one", "two", "three"]);
    assert.equal(active.max, 1);
  } finally {
    await desktop.stop();
  }
});
