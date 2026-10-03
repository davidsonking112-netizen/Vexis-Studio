import { createServer } from "node:http";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 0;
const MAX_BODY_BYTES = 64 * 1024;

const DESKTOP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vexis Studio</title>
<style>
:root { color-scheme: dark; font-family: system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; background: #111318; color: #eef0f4; height: 100vh; display: grid; grid-template-rows: auto 1fr auto; }
header { padding: 14px 18px; border-bottom: 1px solid #2a2e38; display:flex; justify-content:space-between; }
main { overflow:auto; padding: 18px; }
#messages { max-width: 1000px; margin:auto; display:grid; gap:12px; }
.message { white-space:pre-wrap; padding:12px 14px; border:1px solid #2a2e38; border-radius:10px; }
.user { background:#191d25; }
.agent { background:#151820; }
.system { color:#aeb5c2; }
.error { border-color:#7d3d45; }
footer { border-top:1px solid #2a2e38; padding:12px 18px; }
form { max-width:1000px; margin:auto; display:flex; gap:10px; }
input { flex:1; min-width:0; background:#0d0f14; color:inherit; border:1px solid #343946; border-radius:8px; padding:12px; }
button { border:1px solid #4a5160; background:#1d222c; color:inherit; border-radius:8px; padding:0 18px; cursor:pointer; }
button:disabled { opacity:.5; cursor:wait; }
#status { font-size:.85rem; color:#9ca4b3; }
</style>
</head>
<body>
<header><strong>Vexis Studio</strong><span id="status">Ready</span></header>
<main><section id="messages"><div class="message system">Desktop shell ready. Enter a coding task.</div></section></main>
<footer><form id="task-form"><input id="task" autocomplete="off" placeholder="Ask Vexis to inspect or change the workspace…"><button id="run" type="submit">Run</button></form></footer>
<script>
const messages = document.getElementById("messages");
const form = document.getElementById("task-form");
const input = document.getElementById("task");
const button = document.getElementById("run");
const status = document.getElementById("status");

function addMessage(role, content) {
  const el = document.createElement("div");
  el.className = "message " + role;
  el.textContent = "[" + role + "] " + String(content ?? "");
  messages.appendChild(el);
  el.scrollIntoView({ block: "end" });
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const task = input.value.trim();
  if (!task) return;
  addMessage("user", task);
  input.value = "";
  button.disabled = true;
  status.textContent = "Working…";
  try {
    const response = await fetch("/api/task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed");
    addMessage(data.error ? "error" : "agent", data.output || "Task completed.");
  } catch (error) {
    addMessage("error", error.message);
  } finally {
    button.disabled = false;
    status.textContent = "Ready";
    input.focus();
  }
});
</script>
</body>
</html>`;

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  response.end(body);
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body is too large."), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 });
  }
}

export function createDesktop({
  agent,
  registry,
  host = DEFAULT_HOST,
  port = DEFAULT_PORT
} = {}) {
  if (!agent || typeof agent.run !== "function") throw new TypeError("agent.run must be a function");
  if (!registry || typeof registry.list !== "function" || typeof registry.discover !== "function") {
    throw new TypeError("tool registry is required");
  }

  let server;
  let taskQueue = Promise.resolve();

  const enqueueTask = task => {
    const run = taskQueue.catch(() => undefined).then(() => agent.run(task));
    taskQueue = run.catch(() => undefined);
    return run;
  };

  const requestHandler = async (request, response) => {
    const url = new URL(request.url || "/", "http://localhost");

    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(DESKTOP_HTML);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/tools") {
      sendJson(response, 200, { tools: registry.list() });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/discover") {
      sendJson(response, 200, { tools: registry.discover(url.searchParams.get("q") || "") });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/task") {
      try {
        const body = await readJson(request);
        if (typeof body.task !== "string" || !body.task.trim()) {
          sendJson(response, 400, { error: "task must be a non-empty string" });
          return;
        }
        const result = await enqueueTask(body.task.trim());
        sendJson(response, 200, {
          status: result?.status || "completed",
          output: result?.output || ""
        });
      } catch (error) {
        sendJson(response, error.statusCode || 500, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  };

  async function start() {
    if (server?.listening) return address();
    server = createServer((request, response) => {
      void requestHandler(request, response);
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, resolve);
    });
    return address();
  }

  async function stop() {
    if (!server || !server.listening) return;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }

  function address() {
    const info = server?.address();
    if (!info || typeof info === "string") return null;
    return { host, port: info.port, url: `http://${host}:${info.port}/` };
  }

  return { start, stop, address };
}

export { DESKTOP_HTML };
