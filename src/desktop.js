import { createServer } from "node:http";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 0;
const MAX_BODY_BYTES = 64 * 1024;

const DESKTOP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Vexis Studio</title>
<style>
:root {
  color-scheme: dark;
  --bg: #080a0f;
  --panel: #0e1118;
  --panel-2: #121620;
  --panel-3: #171c27;
  --line: rgba(255,255,255,.08);
  --line-strong: rgba(255,255,255,.14);
  --text: #f4f6fb;
  --muted: #8d96a8;
  --soft: #b7bfcd;
  --accent: #8b7cff;
  --accent-2: #a79cff;
  --success: #55d69b;
  --danger: #ff6f82;
  --shadow: 0 24px 70px rgba(0,0,0,.32);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  overflow: hidden;
  background:
    radial-gradient(900px 500px at 70% -10%, rgba(139,124,255,.13), transparent 60%),
    radial-gradient(700px 500px at 0% 100%, rgba(71,180,255,.06), transparent 65%),
    var(--bg);
  color: var(--text);
}
button, input, textarea { font: inherit; }
button { color: inherit; }
button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.app { height: 100%; display: grid; grid-template-columns: 248px minmax(0,1fr) 280px; }
.sidebar, .rail { background: rgba(10,12,18,.86); backdrop-filter: blur(18px); }
.sidebar { border-right: 1px solid var(--line); padding: 18px 14px; display:flex; flex-direction:column; min-width:0; }
.rail { border-left: 1px solid var(--line); padding: 18px 14px; min-width:0; overflow:auto; }
.brand { display:flex; align-items:center; gap:10px; padding: 3px 7px 22px; }
.logo { width:32px; height:32px; display:grid; place-items:center; border-radius:10px; background:linear-gradient(135deg,var(--accent),#55b8ff); box-shadow:0 8px 28px rgba(139,124,255,.25); font-weight:800; }
.brand strong { font-size:15px; letter-spacing:-.02em; }
.brand span { display:block; color:var(--muted); font-size:11px; margin-top:2px; }
.section-label { color:#687184; font-size:10px; text-transform:uppercase; letter-spacing:.12em; padding:0 8px 8px; }
.nav { display:grid; gap:4px; }
.nav button {
  border:1px solid transparent; background:transparent; text-align:left; border-radius:9px;
  padding:9px 10px; color:var(--soft); cursor:pointer; display:flex; gap:9px; align-items:center;
}
.nav button:hover, .nav button.active { background:var(--panel-3); border-color:var(--line); color:var(--text); }
.nav .dot { width:7px; height:7px; border-radius:50%; background:#596276; }
.nav .active .dot { background:var(--accent); box-shadow:0 0 12px var(--accent); }
.workspace { margin-top:auto; border-top:1px solid var(--line); padding-top:14px; }
.workspace-card { padding:11px; background:var(--panel); border:1px solid var(--line); border-radius:11px; }
.workspace-card .label { color:var(--muted); font-size:10px; text-transform:uppercase; letter-spacing:.08em; }
.workspace-card .path { margin-top:5px; font-size:12px; color:var(--soft); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

.main { min-width:0; display:grid; grid-template-rows:58px minmax(0,1fr) auto; }
.topbar { border-bottom:1px solid var(--line); display:flex; align-items:center; justify-content:space-between; padding:0 20px; background:rgba(8,10,15,.52); backdrop-filter:blur(18px); }
.breadcrumb { display:flex; align-items:center; gap:8px; min-width:0; }
.breadcrumb strong { font-size:13px; }
.breadcrumb span { color:var(--muted); font-size:12px; }
.status { display:flex; align-items:center; gap:7px; color:var(--muted); font-size:11px; }
.status-dot { width:7px; height:7px; border-radius:50%; background:var(--success); box-shadow:0 0 12px rgba(85,214,155,.7); }
.status-dot.busy { background:#f4c95d; box-shadow:0 0 12px rgba(244,201,93,.65); animation:pulse 1s infinite; }
.status-dot.error { background:var(--danger); box-shadow:0 0 12px rgba(255,111,130,.65); }
@keyframes pulse { 50% { opacity:.35; } }

.conversation { overflow:auto; scroll-behavior:smooth; }
.empty { max-width:760px; margin:0 auto; min-height:100%; display:grid; place-items:center; padding:55px 24px; }
.hero { text-align:center; }
.hero .mark { width:58px; height:58px; margin:0 auto 18px; display:grid; place-items:center; border:1px solid var(--line-strong); border-radius:17px; background:linear-gradient(145deg,#181c2a,#10131b); box-shadow:var(--shadow); font-size:25px; }
.hero h1 { margin:0; font-size:27px; letter-spacing:-.04em; }
.hero p { margin:9px auto 24px; max-width:520px; color:var(--muted); line-height:1.55; font-size:13px; }
.suggestions { display:flex; flex-wrap:wrap; justify-content:center; gap:8px; }
.suggestion { border:1px solid var(--line-strong); background:rgba(18,22,32,.7); border-radius:999px; color:var(--soft); padding:8px 11px; cursor:pointer; font-size:11px; }
.suggestion:hover { border-color:rgba(139,124,255,.55); color:var(--text); background:rgba(139,124,255,.08); }

.messages { max-width:900px; margin:0 auto; padding:28px 24px 32px; display:grid; gap:18px; }
.message { display:grid; grid-template-columns:30px minmax(0,1fr); gap:11px; }
.avatar { width:30px; height:30px; border-radius:9px; display:grid; place-items:center; font-size:10px; font-weight:700; border:1px solid var(--line); background:var(--panel-2); }
.message.user .avatar { background:#191d29; color:var(--accent-2); }
.message.agent .avatar { background:rgba(139,124,255,.12); color:var(--accent-2); }
.message.error .avatar { color:var(--danger); }
.message-body { min-width:0; }
.message-meta { color:var(--muted); font-size:10px; margin:2px 0 6px; }
.message-content { color:#e7eaf0; white-space:pre-wrap; overflow-wrap:anywhere; font-size:13px; line-height:1.65; }
.message.user .message-content { color:var(--text); }
.message.error .message-content { color:#ffb1bb; }

.composer-wrap { padding:12px 20px 18px; }
.composer { max-width:900px; margin:auto; border:1px solid var(--line-strong); background:rgba(17,21,30,.92); border-radius:15px; box-shadow:0 14px 45px rgba(0,0,0,.25); overflow:hidden; }
.composer textarea { width:100%; resize:none; min-height:54px; max-height:180px; border:0; outline:0; background:transparent; color:var(--text); padding:14px 15px 5px; line-height:1.45; }
.composer textarea::placeholder { color:#687184; }
.composer-actions { display:flex; align-items:center; justify-content:space-between; padding:7px 9px 9px 13px; }
.hint { color:#697285; font-size:10px; }
.run { border:1px solid rgba(139,124,255,.5); background:linear-gradient(135deg,#7566ed,#8b7cff); color:white; border-radius:9px; padding:8px 14px; font-size:11px; font-weight:650; cursor:pointer; box-shadow:0 6px 20px rgba(139,124,255,.2); }
.run:hover { filter:brightness(1.08); }
.run:disabled { opacity:.45; cursor:wait; }

.rail h2 { font-size:12px; margin:3px 7px 15px; letter-spacing:-.01em; }
.panel { border:1px solid var(--line); background:rgba(14,17,24,.72); border-radius:11px; margin-bottom:10px; overflow:hidden; }
.panel-title { padding:10px 11px; color:var(--soft); font-size:10px; text-transform:uppercase; letter-spacing:.08em; border-bottom:1px solid var(--line); }
.tool { padding:9px 11px; border-bottom:1px solid var(--line); }
.tool:last-child { border-bottom:0; }
.tool strong { display:block; font-size:11px; }
.tool span { display:block; color:var(--muted); font-size:10px; margin-top:3px; line-height:1.4; }
.search { margin:0 0 10px; width:100%; border:1px solid var(--line-strong); background:var(--panel); color:var(--text); border-radius:9px; padding:9px 10px; font-size:11px; }
.activity { padding:11px; color:var(--muted); font-size:10px; line-height:1.55; }
.activity strong { color:var(--soft); }
.shortcut { display:flex; justify-content:space-between; padding:8px 11px; border-bottom:1px solid var(--line); color:var(--muted); font-size:10px; }
kbd { border:1px solid var(--line-strong); background:var(--panel-3); color:var(--soft); padding:2px 5px; border-radius:4px; font-size:9px; }

@media (max-width: 1050px) { .app { grid-template-columns:210px minmax(0,1fr); } .rail { display:none; } }
@media (max-width: 700px) {
  .app { grid-template-columns:1fr; }
  .sidebar { display:none; }
  .topbar { padding:0 14px; }
  .composer-wrap { padding:10px 10px 12px; }
  .messages { padding:20px 14px 25px; }
  .empty { padding:35px 18px; }
}
</style>
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="brand"><div class="logo">V</div><div><strong>Vexis Studio</strong><span>AI coding workspace</span></div></div>
    <div class="section-label">Workspace</div>
    <nav class="nav">
      <button id="agent-nav" class="active" type="button"><span class="dot"></span>Agent</button>
      <button id="tools-nav" type="button"><span class="dot"></span>Tools</button>
      <button id="discover-nav" type="button"><span class="dot"></span>Discover</button>
    </nav>
    <div class="workspace">
      <div class="workspace-card"><div class="label">Connected workspace</div><div class="path" title="Local Vexis workspace">Local workspace</div></div>
    </div>
  </aside>

  <section class="main">
    <header class="topbar">
      <div class="breadcrumb"><strong>Agent</strong><span>•</span><span>Workspace session</span></div>
      <div class="status"><span id="status-dot" class="status-dot"></span><span id="status">Ready</span></div>
    </header>

    <main id="conversation" class="conversation">
      <section id="empty" class="empty">
        <div class="hero">
          <div class="mark">✦</div>
          <h1>Build with Vexis</h1>
          <p>Ask Vexis to understand the codebase, make a safe change, run tests, or investigate a failure. The workspace stays behind one consistent agent runtime.</p>
          <div class="suggestions">
            <button class="suggestion" data-task="Inspect this codebase and summarize its architecture">Inspect the codebase</button>
            <button class="suggestion" data-task="Run the test suite and explain any failures">Run the tests</button>
            <button class="suggestion" data-task="Find the main application entrypoint">Find the entrypoint</button>
          </div>
        </div>
      </section>
      <section id="messages" class="messages" hidden></section>
    </main>

    <div class="composer-wrap">
      <form id="task-form" class="composer">
        <textarea id="task" rows="2" autocomplete="off" placeholder="Ask Vexis to work on your code…"></textarea>
        <div class="composer-actions">
          <span class="hint"><kbd>Enter</kbd> run · <kbd>Shift</kbd>+<kbd>Enter</kbd> newline · <kbd>Esc</kbd> clear</span>
          <button id="run" class="run" type="submit">Run task ↵</button>
        </div>
      </form>
    </div>
  </section>

  <aside class="rail">
    <h2>Workspace context</h2>
    <div class="panel">
      <div class="panel-title"><span id="tools-title">Tools</span><span id="tool-count"></span></div>
      <input id="tool-search" class="search" placeholder="Filter tools…" aria-label="Filter tools">
      <div id="tools"></div>
    </div>
    <div class="panel">
      <div class="panel-title">Activity</div>
      <div id="activity" class="activity">Ready for a task.</div>
    </div>
    <div class="panel">
      <div class="panel-title">Shortcuts</div>
      <div class="shortcut"><span>Focus composer</span><kbd>⌘ / Ctrl K</kbd></div>
      <div class="shortcut"><span>Run task</span><kbd>Enter</kbd></div>
      <div class="shortcut"><span>Clear input</span><kbd>Esc</kbd></div>
    </div>
  </aside>
</div>

<script>
const messages = document.getElementById("messages");
const empty = document.getElementById("empty");
const conversation = document.getElementById("conversation");
const form = document.getElementById("task-form");
const input = document.getElementById("task");
const button = document.getElementById("run");
const status = document.getElementById("status");
const statusDot = document.getElementById("status-dot");
const activity = document.getElementById("activity");
const tools = document.getElementById("tools");
const toolSearch = document.getElementById("tool-search");
let toolList = [];
let activeView = "agent";

function setStatus(text, mode = "ready") {
  status.textContent = text;
  statusDot.className = "status-dot" + (mode === "busy" ? " busy" : mode === "error" ? " error" : "");
}

function addMessage(role, content) {
  empty.hidden = true;
  messages.hidden = false;
  const article = document.createElement("article");
  article.className = "message " + role;
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "YOU" : role === "error" ? "!" : "VX";
  const body = document.createElement("div");
  body.className = "message-body";
  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = role === "user" ? "You" : role === "error" ? "Vexis · error" : "Vexis · agent";
  const contentEl = document.createElement("div");
  contentEl.className = "message-content";
  contentEl.textContent = String(content ?? "");
  body.append(meta, contentEl);
  article.append(avatar, body);
  messages.appendChild(article);
  conversation.scrollTop = conversation.scrollHeight;
}

function renderTools(filter = "", source = toolList) {
  const query = filter.trim().toLowerCase();
  const visible = source.filter(tool => !query || tool.name.toLowerCase().includes(query) || tool.description.toLowerCase().includes(query));
  document.getElementById("tool-count").textContent = visible.length ? " " + visible.length : "";
  tools.replaceChildren();
  if (!visible.length) {
    const emptyTool = document.createElement("div");
    emptyTool.className = "activity";
    emptyTool.textContent = "No matching tools.";
    tools.appendChild(emptyTool);
    return;
  }
  for (const tool of visible) {
    const item = document.createElement("div");
    item.className = "tool";
    const name = document.createElement("strong");
    name.textContent = tool.name;
    const description = document.createElement("span");
    description.textContent = tool.description;
    item.append(name, description);
    tools.appendChild(item);
  }
}

async function loadTools() {
  try {
    const response = await fetch("/api/tools");
    if (!response.ok) throw new Error("Unable to load tools");
    const data = await response.json();
    toolList = Array.isArray(data.tools) ? data.tools : [];
    renderTools();
  } catch (error) {
    activity.textContent = error.message;
  }
}

async function discoverTools(query = "") {
  try {
    const response = await fetch("/api/discover?q=" + encodeURIComponent(query));
    if (!response.ok) throw new Error("Unable to discover tools");
    const data = await response.json();
    const discovered = Array.isArray(data.tools) ? data.tools : [];
    renderTools("", discovered);
    document.getElementById("tools-title").textContent = query ? "Discover · " + query : "Discover";
    activity.innerHTML = "<strong>Discovery</strong><br>" + discovered.length + " matching tools.";
  } catch (error) {
    activity.textContent = error.message;
  }
}

function selectView(view) {
  activeView = view;
  document.querySelectorAll(".nav button").forEach(buttonEl => buttonEl.classList.remove("active"));
  document.getElementById(view + "-nav").classList.add("active");
}

function resizeInput() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 180) + "px";
}
input.addEventListener("input", resizeInput);
toolSearch.addEventListener("input", async () => {
  if (activeView === "discover") {
    await discoverTools(toolSearch.value);
    return;
  }
  document.getElementById("tools-title").textContent = "Tools";
  renderTools(toolSearch.value);
});

document.querySelectorAll(".suggestion").forEach(buttonEl => {
  buttonEl.addEventListener("click", () => {
    input.value = buttonEl.dataset.task || "";
    resizeInput();
    input.focus();
  });
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  const task = input.value.trim();
  if (!task || button.disabled) return;
  addMessage("user", task);
  input.value = "";
  resizeInput();
  button.disabled = true;
  setStatus("Working…", "busy");
  activity.innerHTML = "<strong>Agent active.</strong><br>Executing the task through the shared runtime.";
  try {
    const response = await fetch("/api/task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed");
    addMessage("agent", data.output || "Task completed.");
    activity.innerHTML = "<strong>Last task</strong><br>Completed successfully.";
    setStatus("Ready");
  } catch (error) {
    addMessage("error", error.message);
    activity.innerHTML = "<strong>Last task</strong><br>Failed. See the conversation for details.";
    setStatus("Needs attention", "error");
  } finally {
    button.disabled = false;
    input.focus();
  }
});

input.addEventListener("keydown", event => {
  if (event.key === "Escape") { input.value = ""; resizeInput(); }
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});
document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    input.focus();
  }
});
document.getElementById("agent-nav").addEventListener("click", () => {
  selectView("agent");
  input.focus();
});
document.getElementById("tools-nav").addEventListener("click", () => {
  selectView("tools");
  document.getElementById("tools-title").textContent = "Tools";
  toolSearch.value = "";
  renderTools();
  toolSearch.focus();
});
document.getElementById("discover-nav").addEventListener("click", async () => {
  selectView("discover");
  toolSearch.value = "";
  toolSearch.placeholder = "Search capabilities…";
  document.getElementById("tools-title").textContent = "Discover";
  await discoverTools("");
  toolSearch.focus();
});

loadTools();
input.focus();
</script>
</body>
</html>`;


function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}

function sendHtml(response, html) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  });
  response.end(html);
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
      sendHtml(response, DESKTOP_HTML);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, { status: "ok", service: "vexis-desktop" });
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

    if (["GET", "POST", "HEAD"].includes(request.method)) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    response.setHeader("allow", "GET, POST, HEAD");
    sendJson(response, 405, { error: "Method not allowed" });
  };

  async function start() {
    if (server?.listening) return address();
    server = createServer((request, response) => {
      void requestHandler(request, response).catch(error => {
        if (response.headersSent) {
          response.destroy();
          return;
        }
        sendJson(response, error?.statusCode || 500, {
          error: error instanceof Error ? error.message : String(error)
        });
      });
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
