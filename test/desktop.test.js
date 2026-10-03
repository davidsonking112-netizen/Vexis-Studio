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
    registry: registry()
  });
  const address = await desktop.start();
  try {
    const page = await fetch(address.url);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Vexis Studio/);
    assert.match(html, /\/api\/discover\?q=/);
    assert.match(html, /Discover/);

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
    registry: registry()
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
    registry: registry()
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
    registry: registry()
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

test("desktop continues accepting tasks after an agent failure", async () => {
  let calls = 0;
  const desktop = createDesktop({
    agent: {
      run: async task => {
        calls += 1;
        if (task === "fail") throw new Error("boom");
        return { output: task };
      }
    },
    registry: registry()
  });
  const address = await desktop.start();
  try {
    const failed = await json(address.url + "api/task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: "fail" })
    });
    assert.equal(failed.response.status, 500);
    assert.equal(failed.body.error, "boom");

    const recovered = await json(address.url + "api/task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: "recover" })
    });
    assert.equal(recovered.response.status, 200);
    assert.equal(recovered.body.output, "recover");
    assert.equal(calls, 2);
  } finally {
    await desktop.stop();
  }
});

test("desktop exposes a health endpoint and security headers", async () => {
  const desktop = createDesktop({
    agent: { run: async () => ({ output: "unused" }) },
    registry: registry()
  });
  const address = await desktop.start();
  try {
    const health = await fetch(address.url + "api/health");
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok", service: "vexis-desktop" });

    const page = await fetch(address.url);
    assert.equal(page.headers.get("x-content-type-options"), "nosniff");
    assert.match(page.headers.get("content-security-policy"), /default-src 'none'/);
  } finally {
    await desktop.stop();
  }
});

test("desktop returns structured errors for malformed JSON", async () => {
  const desktop = createDesktop({
    agent: { run: async () => ({ output: "unused" }) },
    registry: registry()
  });
  const address = await desktop.start();
  try {
    const response = await fetch(address.url + "api/task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid"
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "Request body must be valid JSON.");
  } finally {
    await desktop.stop();
  }
});

test("desktop converts unexpected handler failures into HTTP 500 responses", async () => {
  const desktop = createDesktop({
    agent: { run: async () => ({ output: "unused" }) },
    registry: {
      list: () => { throw new Error("registry unavailable"); },
      discover: () => []
    }
  });
  const address = await desktop.start();
  try {
    const response = await fetch(address.url + "api/tools");
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error, "registry unavailable");
  } finally {
    await desktop.stop();
  }
});


test("desktop rejects unsupported HTTP methods", async () => {
  const desktop = createDesktop({
    agent: { run: async () => ({ output: "unused" }) },
    registry: registry()
  });
  const address = await desktop.start();
  try {
    const response = await fetch(address.url + "api/tools", { method: "DELETE" });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, POST, HEAD");
    assert.equal((await response.json()).error, "Method not allowed");
  } finally {
    await desktop.stop();
  }
});


test("desktop streams agent events and supports cancellation", async () => {
  let release;
  const started = new Promise(resolve => { release = resolve; });
  const desktop = createDesktop({
    agent: {
      run: async (task, { signal, onEvent }) => {
        onEvent({ type: "model_start", step: 0 });
        release();
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 1000);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("Task cancelled"));
          }, { once: true });
        });
        return { output: task };
      }
    },
    registry: registry()
  });
  const address = await desktop.start();
  try {
    const id = "cancel-test";
    const stream = await fetch(address.url + "api/events/" + id);
    const reader = stream.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /Task not found|/);

    const request = json(address.url + "api/task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, task: "long task" })
    });
    await started;
    const cancelled = await json(address.url + "api/task/" + id, { method: "DELETE" });
    assert.equal(cancelled.response.status, 202);
    const result = await request;
    assert.equal(result.response.status, 200);
    assert.equal(result.body.status, "cancelled");
  } finally {
    await desktop.stop();
  }
});

test("agent run supports per-run events and abort signals", async () => {
  const { Agent } = await import("../src/agent.js");
  const events = [];
  const controller = new AbortController();
  const agent = new Agent({
    model: { next: async () => ({ type: "final", content: "done" }) },
    onEvent: () => { throw new Error("global event should not run"); }
  });
  const result = await agent.run("task", {
    signal: controller.signal,
    onEvent: event => events.push(event.type)
  });
  assert.equal(result.output, "done");
  assert.deepEqual(events, ["model_start", "model_response"]);
});
