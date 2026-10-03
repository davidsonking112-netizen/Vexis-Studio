import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { analyzeDocument } from "./tools/editor_intelligence.js";

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
  --bg: #06070b;
  --panel: rgba(15,18,28,.78);
  --panel-2: rgba(20,24,37,.88);
  --panel-3: rgba(27,31,47,.92);
  --line: rgba(255,255,255,.075);
  --line-strong: rgba(255,255,255,.14);
  --line-bright: rgba(177,164,255,.28);
  --text: #f7f7fb;
  --muted: #858da1;
  --soft: #b9c0d0;
  --accent: #9b8cff;
  --accent-2: #c0b7ff;
  --cyan: #67d9ff;
  --success: #5fe0a6;
  --danger: #ff7188;
  --shadow: 0 30px 90px rgba(0,0,0,.42);
  --glass: blur(22px) saturate(135%);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  overflow: hidden;
  background:
    radial-gradient(800px 520px at 68% -14%, rgba(137,113,255,.23), transparent 64%),
    radial-gradient(620px 460px at 8% 105%, rgba(58,198,255,.12), transparent 68%),
    radial-gradient(520px 420px at 100% 78%, rgba(177,76,255,.07), transparent 70%),
    linear-gradient(135deg,#05060a 0%,#080a11 52%,#06070b 100%);
  color: var(--text);
}
body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  opacity: .24;
  background-image: radial-gradient(rgba(255,255,255,.8) .45px, transparent .45px);
  background-size: 5px 5px;
  mask-image: linear-gradient(to bottom, transparent, black 18%, black 82%, transparent);
}
button, input, textarea { font: inherit; }
button { color: inherit; }
button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.app { height: 100%; display: grid; grid-template-columns: 236px minmax(0,1fr) 304px; position:relative; }
.sidebar, .rail { background: rgba(8,10,16,.72); backdrop-filter: var(--glass); }
.sidebar { border-right: 1px solid var(--line); padding: 18px 13px; display:flex; flex-direction:column; min-width:0; position:relative; z-index:2; }
.sidebar::after { content:""; position:absolute; top:0; right:-1px; width:1px; height:42%; background:linear-gradient(var(--accent),transparent); opacity:.65; }
.rail { border-left: 1px solid var(--line); padding: 18px 13px; min-width:0; overflow:auto; position:relative; z-index:2; }
.rail::before { content:""; position:absolute; top:0; left:-1px; width:1px; height:35%; background:linear-gradient(var(--cyan),transparent); opacity:.5; }
.brand { display:flex; align-items:center; gap:10px; padding: 3px 7px 24px; }
.logo { width:34px; height:34px; display:grid; place-items:center; border-radius:11px; background:linear-gradient(145deg,#b9aaff 0%,#816fff 52%,#5fd9ff 100%); color:#0a0b12; box-shadow:0 0 0 1px rgba(255,255,255,.2),0 12px 36px rgba(126,103,255,.34); font-weight:900; position:relative; }
.logo::after { content:""; position:absolute; inset:-5px; border-radius:14px; border:1px solid rgba(154,140,255,.16); }
.brand strong { font-size:15px; letter-spacing:-.025em; }
.brand span { display:block; color:#727b90; font-size:10px; margin-top:3px; letter-spacing:.02em; }
.section-label { color:#697287; font-size:9px; text-transform:uppercase; letter-spacing:.16em; padding:0 8px 9px; font-weight:700; }
.nav { display:grid; gap:4px; }
.nav button {
  border:1px solid transparent; background:transparent; text-align:left; border-radius:10px;
  padding:10px 10px; color:#9199aa; cursor:pointer; display:flex; gap:10px; align-items:center;
  transition:all .18s ease; position:relative;
}
.nav button:hover { background:rgba(255,255,255,.035); color:var(--text); transform:translateX(2px); }
.nav button.active { background:linear-gradient(100deg,rgba(145,126,255,.16),rgba(145,126,255,.045)); border-color:rgba(157,142,255,.16); color:var(--text); box-shadow:inset 2px 0 var(--accent),0 8px 24px rgba(0,0,0,.12); }
.nav .dot { width:6px; height:6px; border-radius:50%; background:#4e5668; transition:.18s; }
.nav .active .dot { background:var(--accent); box-shadow:0 0 15px var(--accent); }
.workspace { margin-top:auto; border-top:1px solid var(--line); padding-top:14px; }
.workspace-card { padding:12px; background:linear-gradient(145deg,rgba(22,26,39,.88),rgba(12,15,23,.7)); border:1px solid var(--line); border-radius:13px; box-shadow:0 14px 34px rgba(0,0,0,.16); }
.workspace-card .label { color:#687186; font-size:9px; text-transform:uppercase; letter-spacing:.12em; font-weight:700; }
.workspace-card .path { margin-top:7px; font-size:11px; color:var(--soft); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:flex; align-items:center; gap:7px; }
.workspace-card .path::before { content:""; width:6px; height:6px; border-radius:50%; background:var(--success); box-shadow:0 0 10px rgba(95,224,166,.7); }

.main { min-width:0; display:grid; grid-template-rows:62px minmax(0,1fr) auto; position:relative; }
.topbar { border-bottom:1px solid var(--line); display:flex; align-items:center; justify-content:space-between; padding:0 22px; background:rgba(7,9,14,.42); backdrop-filter:var(--glass); position:relative; z-index:1; }
.breadcrumb { display:flex; align-items:center; gap:9px; min-width:0; }
.breadcrumb strong { font-size:12px; letter-spacing:-.01em; }
.breadcrumb span { color:#667084; font-size:11px; }
.workspace-chip { display:flex; align-items:center; gap:7px; padding:6px 9px; border:1px solid var(--line); border-radius:999px; background:rgba(255,255,255,.025); color:#9aa3b5; font-size:10px; }
.workspace-chip .chip-dot { width:5px; height:5px; border-radius:50%; background:var(--success); box-shadow:0 0 8px rgba(95,224,166,.65); }
.status { display:flex; align-items:center; gap:8px; color:#9ca4b6; font-size:10px; padding:6px 9px; border:1px solid var(--line); background:rgba(255,255,255,.022); border-radius:999px; }
.status-dot { width:7px; height:7px; border-radius:50%; background:var(--success); box-shadow:0 0 12px rgba(85,214,155,.7); }
.status-dot.busy { background:#f4c95d; box-shadow:0 0 12px rgba(244,201,93,.65); animation:pulse 1s infinite; }
.status-dot.error { background:var(--danger); box-shadow:0 0 12px rgba(255,111,130,.65); }
@keyframes pulse { 50% { opacity:.35; } }

.conversation { overflow:auto; scroll-behavior:smooth; position:relative; }
.empty { max-width:930px; margin:0 auto; min-height:100%; display:grid; place-items:center; padding:44px 30px 58px; }
.hero { width:min(820px,100%); text-align:center; position:relative; }
.hero::before { content:""; position:absolute; width:430px; height:260px; left:50%; top:3px; transform:translateX(-50%); background:radial-gradient(circle,rgba(139,124,255,.17),transparent 68%); filter:blur(10px); pointer-events:none; }
.hero-orbit { width:72px; height:72px; margin:0 auto 20px; display:grid; place-items:center; position:relative; }
.hero-orbit::before,.hero-orbit::after { content:""; position:absolute; inset:0; border-radius:22px; border:1px solid rgba(170,157,255,.2); transform:rotate(12deg); }
.hero-orbit::after { inset:7px; border-color:rgba(100,214,255,.2); transform:rotate(-12deg); }
.hero .mark { width:58px; height:58px; display:grid; place-items:center; border:1px solid rgba(255,255,255,.18); border-radius:18px; background:linear-gradient(145deg,rgba(38,34,67,.95),rgba(15,18,29,.95)); box-shadow:0 0 0 1px rgba(139,124,255,.08),0 20px 55px rgba(77,59,180,.25); font-size:25px; position:relative; z-index:1; }
.eyebrow { display:inline-flex; align-items:center; gap:7px; padding:5px 9px; border:1px solid rgba(160,148,255,.18); border-radius:999px; background:rgba(139,124,255,.07); color:#a69cf0; font-size:9px; font-weight:700; letter-spacing:.13em; text-transform:uppercase; }
.eyebrow .spark { font-size:10px; }
.hero h1 { margin:13px 0 0; font-size:clamp(34px,4vw,52px); line-height:1.02; letter-spacing:-.055em; background:linear-gradient(120deg,#fff 20%,#d9d3ff 58%,#83dfff 100%); -webkit-background-clip:text; background-clip:text; color:transparent; }
.hero p { margin:13px auto 26px; max-width:600px; color:#858da0; line-height:1.65; font-size:13px; }
.suggestions { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; max-width:760px; margin:0 auto; }
.suggestion { min-height:88px; border:1px solid var(--line); background:linear-gradient(145deg,rgba(22,26,39,.76),rgba(12,15,23,.7)); border-radius:14px; color:var(--soft); padding:13px; cursor:pointer; font-size:11px; text-align:left; transition:all .2s ease; box-shadow:0 12px 30px rgba(0,0,0,.12); }
.suggestion:hover { border-color:rgba(139,124,255,.4); color:var(--text); background:linear-gradient(145deg,rgba(42,37,70,.72),rgba(15,18,28,.82)); transform:translateY(-3px); box-shadow:0 18px 38px rgba(0,0,0,.24),0 0 28px rgba(139,124,255,.08); }
.suggestion .card-icon { display:block; width:25px; height:25px; display:grid; place-items:center; border-radius:8px; background:rgba(139,124,255,.11); color:#b6adff; margin-bottom:10px; font-size:12px; }
.hero-footer { display:flex; justify-content:center; align-items:center; gap:9px; margin-top:18px; color:#60697c; font-size:9px; }
.hero-footer .pulse { width:5px; height:5px; border-radius:50%; background:var(--success); box-shadow:0 0 10px rgba(95,224,166,.65); }

.messages { max-width:920px; margin:0 auto; padding:30px 26px 34px; display:grid; gap:18px; }
.message { display:grid; grid-template-columns:32px minmax(0,1fr); gap:12px; animation:message-in .25s ease both; }
@keyframes message-in { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:none; } }
.avatar { width:32px; height:32px; border-radius:10px; display:grid; place-items:center; font-size:9px; font-weight:800; border:1px solid var(--line); background:var(--panel-2); box-shadow:0 8px 20px rgba(0,0,0,.12); }
.message.user .avatar { background:#191d29; color:var(--accent-2); }
.message.agent .avatar { background:rgba(139,124,255,.12); color:var(--accent-2); }
.message.error .avatar { color:var(--danger); }
.message-body { min-width:0; }
.message-meta { color:var(--muted); font-size:10px; margin:2px 0 6px; }
.message-content { color:#e7eaf0; white-space:pre-wrap; overflow-wrap:anywhere; font-size:13px; line-height:1.7; padding:13px 15px; border:1px solid var(--line); border-radius:14px; background:rgba(14,17,25,.48); box-shadow:0 10px 26px rgba(0,0,0,.1); }
.message.user .message-content { color:var(--text); background:linear-gradient(145deg,rgba(31,28,51,.65),rgba(15,18,27,.55)); border-color:rgba(151,137,255,.16); }
.message.error .message-content { color:#ffb1bb; border-color:rgba(255,113,136,.18); background:rgba(73,24,36,.2); }

.composer-wrap { padding:10px 22px 18px; position:relative; z-index:2; }
.composer { max-width:920px; margin:auto; border:1px solid rgba(255,255,255,.14); background:linear-gradient(145deg,rgba(22,26,38,.94),rgba(11,14,22,.94)); border-radius:17px; box-shadow:0 22px 65px rgba(0,0,0,.34),0 0 0 1px rgba(139,124,255,.035); overflow:hidden; position:relative; }
.composer::before { content:""; position:absolute; inset:0 18% auto 18%; height:1px; background:linear-gradient(90deg,transparent,rgba(160,146,255,.65),transparent); }
.composer-top { display:flex; align-items:center; justify-content:space-between; padding:9px 13px 0; color:#697287; font-size:9px; }
.composer-top strong { color:#a9b1c1; font-weight:650; }
.composer textarea { width:100%; resize:none; min-height:58px; max-height:180px; border:0; outline:0; background:transparent; color:var(--text); padding:11px 15px 5px; line-height:1.5; }
.composer textarea::placeholder { color:#687184; }
.composer-actions { display:flex; align-items:center; justify-content:space-between; padding:8px 10px 10px 13px; }
.hint { color:#626b7e; font-size:9px; }
.run { border:1px solid rgba(174,160,255,.42); background:linear-gradient(135deg,#8d7cff,#6c9bff); color:white; border-radius:10px; padding:9px 14px; font-size:10px; font-weight:750; cursor:pointer; box-shadow:0 7px 22px rgba(118,100,245,.26); transition:.18s ease; }
.run:hover { filter:brightness(1.08); transform:translateY(-1px); box-shadow:0 10px 27px rgba(118,100,245,.34); }
.run:hover { filter:brightness(1.08); }
.run:disabled { opacity:.45; cursor:wait; }

.editor-shell { position:absolute; inset:62px 0 0 0; z-index:3; min-height:0; display:grid; grid-template-columns:220px minmax(0,1fr); background:rgba(7,9,14,.96); }
.editor-files { border-right:1px solid var(--line); overflow:auto; background:rgba(9,11,17,.58); }
.editor-files-head { padding:14px 13px 10px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--line); }
.editor-files-head strong { font-size:10px; letter-spacing:.08em; text-transform:uppercase; }
.editor-files-head span { color:#687184; font-size:9px; }
.file-item { width:100%; border:0; border-bottom:1px solid rgba(255,255,255,.035); background:transparent; color:#9ea7b8; padding:8px 12px; text-align:left; cursor:pointer; font-size:10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.file-item:hover { background:rgba(255,255,255,.035); color:var(--text); }
.file-item.active { background:rgba(139,124,255,.10); color:#e8e5ff; box-shadow:inset 2px 0 var(--accent); }
.editor-pane { min-width:0; display:grid; grid-template-rows:42px minmax(0,1fr) 42px; }
.editor-tabs { display:flex; align-items:stretch; min-width:0; overflow:auto; border-bottom:1px solid var(--line); background:rgba(13,16,24,.72); }
.editor-tab { min-width:150px; max-width:240px; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:0 9px 0 12px; border:0; border-right:1px solid var(--line); background:transparent; color:#858da1; cursor:pointer; }
.editor-tab:hover { background:rgba(255,255,255,.035); color:var(--text); }
.editor-tab.active { background:rgba(139,124,255,.10); color:#e8e5ff; box-shadow:inset 0 -2px var(--accent); }
.editor-tab .tab-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; }
.editor-tab .tab-dirty { color:var(--accent-2); font-size:12px; line-height:1; }
.editor-tab .tab-close { border:0; background:transparent; color:#697287; width:20px; height:20px; border-radius:5px; cursor:pointer; font-size:13px; }
.editor-tab .tab-close:hover { background:rgba(255,255,255,.07); color:var(--text); }
.editor-tab-meta { display:flex; align-items:center; gap:8px; padding:0 12px; border-bottom:1px solid var(--line); background:rgba(13,16,24,.72); }
.editor-tab-meta span { font-size:9px; color:#687184; }
.editor-code { width:100%; height:100%; resize:none; border:0; outline:0; background:#080a10; color:#dce1eb; padding:18px; font:12px/1.65 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; tab-size:2; }
.file-item.open::after { content:"•"; float:right; color:var(--accent); }
.file-item.open.active::after { color:var(--accent-2); }
.editor-status { display:flex; align-items:center; justify-content:space-between; padding:0 12px; border-top:1px solid var(--line); background:rgba(13,16,24,.8); }
.editor-status span { color:#697287; font-size:9px; }
.editor-save { border:1px solid rgba(174,160,255,.35); background:rgba(139,124,255,.12); color:#d8d2ff; border-radius:8px; padding:6px 11px; font-size:9px; cursor:pointer; }
.editor-save:hover { background:rgba(139,124,255,.2); }
.editor-preview { border:1px solid var(--line); background:rgba(255,255,255,.025); color:#aeb6c8; border-radius:8px; padding:6px 10px; font-size:9px; cursor:pointer; }
.editor-preview:hover { background:rgba(255,255,255,.06); color:var(--text); }
.editor-findbar { position:absolute; top:52px; right:14px; z-index:7; width:min(420px,calc(100% - 28px)); padding:9px; display:grid; gap:7px; border:1px solid var(--line-strong); border-radius:12px; background:rgba(15,18,27,.96); box-shadow:0 16px 42px rgba(0,0,0,.34); backdrop-filter:blur(18px); }
.editor-findbar[hidden] { display:none; }
.editor-findrow { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:7px; }
.editor-findinput { width:100%; border:1px solid var(--line); background:rgba(4,6,10,.42); color:var(--text); border-radius:8px; padding:7px 9px; outline:0; font-size:10px; }
.editor-findinput:focus { border-color:var(--line-bright); box-shadow:0 0 0 3px rgba(139,124,255,.07); }
.editor-findactions { display:flex; align-items:center; justify-content:space-between; gap:7px; }
.editor-findactions span { color:#747e92; font-size:9px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.editor-findactions div { display:flex; gap:5px; }
.editor-findbutton { border:1px solid var(--line); background:rgba(255,255,255,.025); color:#aeb6c8; border-radius:7px; padding:5px 8px; font-size:9px; cursor:pointer; }
.editor-findbutton:hover { background:rgba(255,255,255,.07); color:var(--text); }
.editor-findbutton.primary { border-color:rgba(174,160,255,.35); background:rgba(139,124,255,.12); color:#d8d2ff; }
.diff-backdrop { position:absolute; inset:0; z-index:8; display:grid; place-items:center; padding:28px; background:rgba(2,3,7,.72); backdrop-filter:blur(10px); }
.diff-backdrop[hidden] { display:none; }
.diff-dialog { width:min(980px,100%); max-height:min(82vh,760px); display:grid; grid-template-rows:auto minmax(0,1fr) auto; overflow:hidden; border:1px solid var(--line-strong); border-radius:16px; background:#0c0f17; box-shadow:var(--shadow); }
.diff-head,.diff-foot { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 14px; border-bottom:1px solid var(--line); }
.diff-foot { border-top:1px solid var(--line); border-bottom:0; }
.diff-head strong { font-size:11px; }
.diff-head span,.diff-foot span { color:#737d91; font-size:9px; }
.diff-body { overflow:auto; padding:12px 0; }
.diff-line { display:block; padding:0 14px; min-height:20px; white-space:pre-wrap; overflow-wrap:anywhere; font:11px/1.8 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
.diff-line.add { background:rgba(55,190,125,.11); color:#a9e8c8; }
.diff-line.remove { background:rgba(255,91,116,.11); color:#ffb3be; }
.diff-line.context { color:#aab2c2; }
.diff-line.meta { color:#858fff; background:rgba(139,124,255,.07); }
.diff-empty { padding:40px; text-align:center; color:#778195; font-size:11px; }
@media (max-width:700px) { .editor-shell { grid-template-columns:145px minmax(0,1fr); } .editor-code { padding:12px; font-size:11px; } }
.rail h2 { font-size:12px; margin:3px 7px 13px; letter-spacing:-.02em; }
.rail-subtitle { margin:-7px 7px 15px; color:#626b7d; font-size:9px; }
.panel { border:1px solid var(--line); background:linear-gradient(145deg,rgba(17,20,30,.78),rgba(10,13,20,.62)); border-radius:13px; margin-bottom:10px; overflow:hidden; box-shadow:0 13px 32px rgba(0,0,0,.13); }
.panel-title { display:flex; align-items:center; justify-content:space-between; padding:10px 11px; color:#aab2c2; font-size:9px; text-transform:uppercase; letter-spacing:.11em; border-bottom:1px solid var(--line); font-weight:700; }
.tool { padding:10px 11px; border-bottom:1px solid var(--line); transition:.16s ease; }
.tool:hover { background:rgba(255,255,255,.025); }
.tool:last-child { border-bottom:0; }
.tool strong { display:block; font-size:11px; }
.tool span { display:block; color:var(--muted); font-size:10px; margin-top:3px; line-height:1.4; }
.search { margin:10px 10px 0; width:calc(100% - 20px); border:1px solid var(--line); background:rgba(4,6,10,.34); color:var(--text); border-radius:9px; padding:8px 10px; font-size:10px; transition:.18s; }
.search:focus { border-color:var(--line-bright); box-shadow:0 0 0 3px rgba(139,124,255,.06); }
.activity { padding:11px; color:var(--muted); font-size:10px; line-height:1.6; min-height:44px; }
.activity strong { color:var(--soft); }
.shortcut { display:flex; justify-content:space-between; padding:9px 11px; border-bottom:1px solid var(--line); color:var(--muted); font-size:9px; }
.shortcut:last-child { border-bottom:0; }
kbd { border:1px solid var(--line-strong); background:var(--panel-3); color:var(--soft); padding:2px 5px; border-radius:4px; font-size:9px; }

@media (max-width: 1050px) { .app { grid-template-columns:210px minmax(0,1fr); } .rail { display:none; } .suggestions { max-width:680px; } }
@media (max-width: 700px) {
  .app { grid-template-columns:1fr; }
  .sidebar { display:none; }
  .topbar { padding:0 14px; }
  .composer-wrap { padding:10px 10px 12px; }
  .messages { padding:20px 14px 25px; }
  .empty { padding:35px 18px; }
  .suggestions { grid-template-columns:1fr; }
  .hero h1 { font-size:36px; }
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
      <button id="editor-nav" type="button"><span class="dot"></span>Editor</button>
      <button id="tools-nav" type="button"><span class="dot"></span>Tools</button>
      <button id="discover-nav" type="button"><span class="dot"></span>Discover</button>
    </nav>
    <div class="workspace">
      <div class="workspace-card"><div class="label">Connected workspace</div><div class="path" title="Local Vexis workspace">Local workspace</div></div>
    </div>
  </aside>

  <section class="main">
    <header class="topbar">
      <div class="breadcrumb"><strong>Agent workspace</strong><span>·</span><span>Local session</span></div>
      <div style="display:flex;align-items:center;gap:9px">
        <div class="workspace-chip"><span class="chip-dot"></span>Workspace connected</div>
        <div class="status"><span id="status-dot" class="status-dot"></span><span id="status">Ready</span></div>
      </div>
    </header>

    <main id="conversation" class="conversation">
      <section id="empty" class="empty">
        <div class="hero">
          <div class="hero-orbit"><div class="mark">✦</div></div>
          <div class="eyebrow"><span class="spark">✦</span> Intelligent development workspace</div>
          <h1>Build something<br>worth shipping.</h1>
          <p>Give Vexis a goal. It can inspect the codebase, reason through the work, make guarded changes, and verify the result—all inside this workspace.</p>
          <div class="suggestions">
            <button class="suggestion" data-task="Inspect this codebase and summarize its architecture"><span class="card-icon">⌘</span><strong>Understand the codebase</strong><br>Map the architecture and key entrypoints.</button>
            <button class="suggestion" data-task="Run the test suite and explain any failures"><span class="card-icon">✓</span><strong>Verify the project</strong><br>Run tests and surface actionable failures.</button>
            <button class="suggestion" data-task="Find the main application entrypoint"><span class="card-icon">↗</span><strong>Find an entrypoint</strong><br>Trace where the application actually starts.</button>
          </div>
          <div class="hero-footer"><span class="pulse"></span> Local workspace ready <span>·</span> Your files stay on this machine</div>
        </div>
      </section>
      <section id="messages" class="messages" hidden></section>
    <section id="editor-view" class="editor-shell" hidden>
      <div class="editor-files"><div class="editor-files-head"><strong>Files</strong><span id="file-count"></span></div><div id="file-list"></div></div>
      <div class="editor-pane"><div class="editor-tabs" id="editor-tabs"></div><div class="editor-tab-meta"><span id="editor-path">Select a file</span><span id="editor-hash"></span><span id="editor-location">Ln 1, Col 1</span><span id="editor-intelligence">Intelligence idle</span><select id="editor-symbols" class="editor-jump" aria-label="Jump to symbol" disabled><option>No symbols</option></select><button id="editor-find" class="editor-preview" type="button" disabled>Find & Replace</button></div><div id="editor-findbar" class="editor-findbar" hidden><div class="editor-findrow"><input id="editor-find-input" class="editor-findinput" placeholder="Find" aria-label="Find"><input id="editor-replace-input" class="editor-findinput" placeholder="Replace" aria-label="Replace"></div><div class="editor-findactions"><span id="editor-find-status">Ready</span><div><button id="editor-find-prev" class="editor-findbutton" type="button">Previous</button><button id="editor-find-next" class="editor-findbutton" type="button">Next</button><button id="editor-replace-one" class="editor-findbutton" type="button">Replace</button><button id="editor-replace-all" class="editor-findbutton primary" type="button">Replace all</button><button id="editor-find-close" class="editor-findbutton" type="button">Done</button></div></div></div><textarea id="editor-code" class="editor-code" spellcheck="false" disabled placeholder="Select a workspace file to begin editing…"></textarea><div class="editor-status"><span id="editor-message">Safe editor · hash guarded saves</span><select id="editor-diagnostics" class="editor-jump" aria-label="Jump to diagnostic" disabled><option>No diagnostics</option></select><div style="display:flex;gap:7px"><button id="editor-preview" class="editor-preview" type="button" disabled>Preview</button><button id="editor-save-all" class="editor-save" type="button" disabled>Save all</button><button id="editor-save" class="editor-save" type="button" disabled>Save changes</button></div></div></div>
    </section>
    <div id="diff-backdrop" class="diff-backdrop" hidden>
      <section class="diff-dialog" role="dialog" aria-modal="true" aria-labelledby="diff-title">
        <div class="diff-head"><div><strong id="diff-title">Changes</strong><span id="diff-summary"></span></div><button id="diff-close" class="editor-preview" type="button">Close</button></div>
        <div id="diff-body" class="diff-body"></div>
        <div class="diff-foot"><span>Review the pending buffer before the hash-guarded save.</span><button id="diff-save" class="editor-save" type="button">Save changes</button></div>
      </section>
    </div>

    <div class="composer-wrap">
      <form id="task-form" class="composer">
        <div class="composer-top"><strong>Vexis Agent</strong><span>Context-aware · guarded edits · verification</span></div>
        <textarea id="task" rows="2" autocomplete="off" placeholder="What should we build, fix, inspect, or verify?"></textarea>
        <div class="composer-actions">
          <span class="hint"><kbd>Enter</kbd> run · <kbd>Shift</kbd>+<kbd>Enter</kbd> newline · <kbd>Esc</kbd> clear</span>
          <button id="run" class="run" type="submit">Run task ↵</button>
        </div>
      </form>
    </div>
  </section>

  <aside class="rail">
    <h2>Workspace context</h2>
    <div class="rail-subtitle">Live view of the agent and its capabilities</div>
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
let editorFiles = [];
let editorOpenFiles = [];
let editorCurrent = null;
let activeTaskId = null;
let activeEvents = null;

function setStatus(text, mode = "ready") {
  status.textContent = text;
  statusDot.className = "status-dot" + (mode === "busy" ? " busy" : mode === "error" ? " error" : "");
}

function persistMessages() {
  const data = [...messages.querySelectorAll(".message")].map(article => ({
    role: article.classList.contains("user") ? "user" : article.classList.contains("error") ? "error" : "agent",
    content: article.querySelector(".message-content")?.textContent || ""
  }));
  localStorage.setItem("vexis-session", JSON.stringify(data.slice(-100)));
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
  persistMessages();
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

function editorIsDirty(file) { return !!file && file.content !== file.original; }
let editorIntelligenceRequest = 0;
function updateEditorLocation() {
  const code=document.getElementById("editor-code"), before=code.value.slice(0,code.selectionStart);
  const lines=before.split("\n");
  document.getElementById("editor-location").textContent="Ln "+lines.length+", Col "+(lines.at(-1).length+1);
}
function renderEditorIntelligence(result) {
  const symbolsSelect=document.getElementById("editor-symbols");
  symbolsSelect.innerHTML=result.symbols.length?result.symbols.map((s,i)=>"<option value=\"" + i + "\">" + s.kind + " · " + s.name + " · " + s.line + ":" + s.column + "</option>").join(""):"<option value=\"\">No symbols</option>";
  symbolsSelect.disabled=!result.symbols.length;
  const diagnostics=document.getElementById("editor-diagnostics");
  const errors=result.diagnostics.filter(d=>d.severity==="error").length;
  diagnostics.innerHTML=result.diagnostics.length?result.diagnostics.map((d,i)=>"<option value=\"" + i + "\">" + d.severity + " · " + d.line + ":" + d.column + " · " + d.message + "</option>").join(""):"<option value=\"\">No diagnostics</option>"; diagnostics.disabled=!result.diagnostics.length; diagnostics.title=result.diagnostics.length?(errors+" errors · "+result.diagnostics.length+" diagnostics"):"No diagnostics";
  document.getElementById("editor-intelligence").textContent=result.symbols.length+" symbols · "+result.language;
  const activityText=result.diagnostics.length ? result.diagnostics.slice(0,3).map(d=>d.severity.toUpperCase()+" · line "+d.line+" · "+d.message).join("<br>") : "<strong>Editor intelligence</strong><br>No structural issues detected.";
  activity.innerHTML=activityText;
}
document.getElementById("editor-diagnostics").addEventListener("change", event => { const diagnostic=editorCurrent?.intelligence?.diagnostics?.[Number(event.target.value)]; if(!diagnostic) return; const code=document.getElementById("editor-code"); const lines=code.value.split("\n"); let offset=0; for(let i=0;i<diagnostic.line-1;i++) offset+=lines[i].length+1; offset+=Math.max(0,diagnostic.column-1); code.focus(); code.setSelectionRange(offset,Math.min(code.value.length,offset+1)); code.scrollTop=Math.max(0,(diagnostic.line-2)*20); updateEditorLocation(); });
async function analyzeEditorCurrent() {
  if(!editorCurrent) return;
  const requestId=++editorIntelligenceRequest;
  document.getElementById("editor-intelligence").textContent="Analyzing…";
  try {
    const response=await fetch("/api/editor/intelligence",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({path:editorCurrent.path,content:editorCurrent.content})});
    const data=await response.json();
    if(requestId!==editorIntelligenceRequest) return;
    if(!response.ok) throw new Error(data.error||"Editor analysis failed");
    editorCurrent.intelligence=data; renderEditorIntelligence(data);
  } catch(error) {
    if(requestId!==editorIntelligenceRequest) return;
    document.getElementById("editor-intelligence").textContent="Intelligence unavailable";
    document.getElementById("editor-diagnostics").textContent=error.message;
  }
}

function updateEditorChrome() {
  const tabs = document.getElementById("editor-tabs"); tabs.replaceChildren();
  for (const file of editorOpenFiles) {
    const tab=document.createElement("button"); tab.className="editor-tab"+(file===editorCurrent?" active":""); tab.type="button";
    const name=document.createElement("span"); name.className="tab-name"; name.textContent=file.path;
    const dirty=document.createElement("span"); dirty.className="tab-dirty"; dirty.textContent=editorIsDirty(file)?"•":"";
    const close=document.createElement("button"); close.className="tab-close"; close.type="button"; close.textContent="×"; close.title="Close file";
    close.addEventListener("click",e=>{e.stopPropagation();closeEditorFile(file);}); tab.append(name,dirty,close); tab.addEventListener("click",()=>selectEditorFile(file)); tabs.appendChild(tab);
  }
  document.querySelectorAll(".file-item").forEach(item=>{const open=editorOpenFiles.some(f=>f.path===item.dataset.path);item.classList.toggle("active",open&&editorCurrent?.path===item.dataset.path);item.classList.toggle("open",open);});
  document.getElementById("editor-save").disabled=!editorCurrent||!editorIsDirty(editorCurrent);
  document.getElementById("editor-preview").disabled=!editorCurrent||!editorIsDirty(editorCurrent);
  document.getElementById("editor-find").disabled=!editorCurrent;
  document.getElementById("editor-save-all").disabled=!editorOpenFiles.some(editorIsDirty);
}
async function loadEditorFiles() {
  const response=await fetch("/api/editor/files"); if(!response.ok) throw new Error("Unable to load workspace files");
  const data=await response.json(); editorFiles=Array.isArray(data.entries)?data.entries.filter(e=>e.type==="file"):[];
  document.getElementById("file-count").textContent=editorFiles.length; const list=document.getElementById("file-list"); list.replaceChildren();
  for(const file of editorFiles){const buttonEl=document.createElement("button");buttonEl.className="file-item";buttonEl.dataset.path=file.path;buttonEl.type="button";buttonEl.textContent=file.path;buttonEl.addEventListener("click",()=>openEditorFile(file.path));list.appendChild(buttonEl);}
  updateEditorChrome();
}
function selectEditorFile(file) {
  editorCurrent=file; document.getElementById("editor-path").textContent=file.path; document.getElementById("editor-hash").textContent=file.sha256.slice(0,10);
  const code=document.getElementById("editor-code"); code.disabled=false; code.value=file.content;
  document.getElementById("editor-message").textContent=editorIsDirty(file)?"Unsaved changes":"Loaded · changes are protected by SHA-256"; updateEditorChrome(); updateEditorLocation(); code.focus(); void analyzeEditorCurrent();
}
async function openEditorFile(path) {
  const existing=editorOpenFiles.find(file=>file.path===path);
  if(existing){ if(editorCurrent&&editorCurrent!==existing&&editorIsDirty(editorCurrent)&&!confirm("Discard unsaved changes in "+editorCurrent.path+"?")) return; selectEditorFile(existing); return; }
  try{const response=await fetch("/api/editor/file?path="+encodeURIComponent(path));const data=await response.json();if(!response.ok)throw new Error(data.error||"Unable to open file");
    const file={path:data.path,sha256:data.sha256,original:data.content,content:data.content}; editorOpenFiles.push(file); selectEditorFile(file);
  }catch(error){document.getElementById("editor-message").textContent=error.message;}
}
function closeEditorFile(file) {
  if(editorIsDirty(file)&&!confirm("Discard unsaved changes in "+file.path+"?")) return;
  const index=editorOpenFiles.indexOf(file); if(index>=0) editorOpenFiles.splice(index,1);
  if(editorCurrent===file){editorCurrent=editorOpenFiles[index]||editorOpenFiles[index-1]||null;if(editorCurrent)selectEditorFile(editorCurrent);else{document.getElementById("editor-path").textContent="Select a file";document.getElementById("editor-hash").textContent="";const code=document.getElementById("editor-code");code.value="";code.disabled=true;document.getElementById("editor-message").textContent="Safe editor · hash guarded saves";updateEditorChrome();}}else updateEditorChrome();
}
function buildEditorDiff(before, after) {
  const oldLines=before.split("\n"), newLines=after.split("\n");
  const max=1200;
  if(oldLines.length>max||newLines.length>max) return {lines:[{type:"meta",text:"Diff preview limited to files with 1,200 lines or fewer."}],added:0,removed:0,limited:true};
  const rows=oldLines.length+1, cols=newLines.length+1;
  const matrix=Array.from({length:rows},()=>new Uint16Array(cols));
  for(let i=oldLines.length-1;i>=0;i--) for(let j=newLines.length-1;j>=0;j--) matrix[i][j]=oldLines[i]===newLines[j]?matrix[i+1][j+1]+1:Math.max(matrix[i+1][j],matrix[i][j+1]);
  const lines=[]; let i=0,j=0,added=0,removed=0;
  while(i<oldLines.length||j<newLines.length){
    if(i<oldLines.length&&j<newLines.length&&oldLines[i]===newLines[j]){lines.push({type:"context",text:"  "+oldLines[i]});i++;j++;continue;}
    if(j<newLines.length&&(i===oldLines.length||matrix[i][j+1]>=matrix[i+1][j])){lines.push({type:"add",text:"+ "+newLines[j++]});added++;continue;}
    lines.push({type:"remove",text:"- "+oldLines[i++]});removed++;
  }
  return {lines,added,removed,limited:false};
}
function showEditorDiff() {
  if(!editorCurrent||!editorIsDirty(editorCurrent)) { document.getElementById("editor-message").textContent="No changes to preview."; return; }
  const diff=buildEditorDiff(editorCurrent.original,editorCurrent.content);
  const body=document.getElementById("diff-body"); body.replaceChildren();
  if(!diff.lines.length){const empty=document.createElement("div");empty.className="diff-empty";empty.textContent="No changes.";body.appendChild(empty);}
  else for(const line of diff.lines){const row=document.createElement("div");row.className="diff-line "+line.type;row.textContent=line.text;body.appendChild(row);}
  document.getElementById("diff-title").textContent="Changes · "+editorCurrent.path;
  document.getElementById("diff-summary").textContent=diff.limited?" · preview limited":" · +"+diff.added+" / -"+diff.removed;
  document.getElementById("diff-backdrop").hidden=false;
}
function closeEditorDiff(){document.getElementById("diff-backdrop").hidden=true;}
async function saveOneEditorFile(file) {
  if(!file||!editorIsDirty(file)) return true;
  const response=await fetch("/api/editor/file",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({path:file.path,expected_sha256:file.sha256,content:file.content})});
  const data=await response.json(); if(!response.ok) throw new Error(data.error||"Save failed"); file.sha256=data.after_sha256;file.original=file.content; return true;
}
async function saveEditorFile() {
  if(!editorCurrent||!editorIsDirty(editorCurrent)){document.getElementById("editor-message").textContent="No changes to save.";return;}
  const save=document.getElementById("editor-save");save.disabled=true;document.getElementById("editor-message").textContent="Saving…";
  try{await saveOneEditorFile(editorCurrent);document.getElementById("editor-hash").textContent=editorCurrent.sha256.slice(0,10);document.getElementById("editor-message").textContent="Saved safely · "+editorCurrent.sha256.slice(0,10);}catch(error){document.getElementById("editor-message").textContent=error.message;}finally{updateEditorChrome();}
}
async function saveAllEditorFiles() {
  const dirty=editorOpenFiles.filter(editorIsDirty); if(!dirty.length){document.getElementById("editor-message").textContent="All open files are saved.";return;}
  document.getElementById("editor-save-all").disabled=true;document.getElementById("editor-message").textContent="Saving "+dirty.length+" file"+(dirty.length===1?"":"s")+"…";
  try{for(const file of dirty)await saveOneEditorFile(file);document.getElementById("editor-message").textContent="All open changes saved safely";}catch(error){document.getElementById("editor-message").textContent=error.message;}finally{updateEditorChrome();}
}

function selectView(view) {
  activeView = view;
  document.querySelectorAll(".nav button").forEach(buttonEl => buttonEl.classList.remove("active"));
  document.getElementById(view + "-nav").classList.add("active");
  const editor = document.getElementById("editor-view");
  const conversationMain = document.getElementById("conversation");
  const composer = document.querySelector(".composer-wrap");
  const showEditor = view === "editor";
  editor.hidden = !showEditor;
  conversationMain.hidden = showEditor;
  composer.style.display = showEditor ? "none" : "";
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
  if (!task || button.disabled || activeTaskId) return;
  addMessage("user", task);
  input.value = "";
  resizeInput();
  button.disabled = false;
  button.textContent = "Cancel task";
  activeTaskId = crypto.randomUUID();
  setStatus("Working…", "busy");
  activity.innerHTML = "<strong>Agent active.</strong><br>Starting the task…";
  activeEvents = new EventSource("/api/events/" + encodeURIComponent(activeTaskId));
  activeEvents.onmessage = event => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === "model_start") activity.innerHTML = "<strong>Agent active.</strong><br>Thinking at step " + (payload.step + 1) + "…";
      else if (payload.type === "tool_result") activity.innerHTML = "<strong>Tool complete</strong><br>" + payload.name;
      else if (payload.type === "tool_error") activity.innerHTML = "<strong>Tool error</strong><br>" + payload.name;
    } catch {}
  };
  activeEvents.onerror = () => {};
  try {
    const response = await fetch("/api/task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: activeTaskId, task })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed");
    if (data.status === "cancelled") {
      addMessage("agent", "Task cancelled.");
      activity.innerHTML = "<strong>Task cancelled</strong><br>The agent stopped before completing the request.";
      setStatus("Ready");
    } else {
      addMessage("agent", data.output || "Task completed.");
      activity.innerHTML = "<strong>Last task</strong><br>Completed successfully.";
      setStatus("Ready");
    }
  } catch (error) {
    addMessage("error", error.message);
    activity.innerHTML = "<strong>Last task</strong><br>Failed. See the conversation for details.";
    setStatus("Needs attention", "error");
  } finally {
    if (activeEvents) activeEvents.close();
    activeEvents = null;
    activeTaskId = null;
    button.disabled = false;
    button.textContent = "Run task ↵";
    input.focus();
  }
});

button.addEventListener("click", async event => {
  if (!activeTaskId) return;
  event.preventDefault();
  const id = activeTaskId;
  button.disabled = true;
  activity.innerHTML = "<strong>Stopping…</strong><br>Requesting task cancellation.";
  try {
    await fetch("/api/task/" + encodeURIComponent(id), { method: "DELETE" });
  } catch {}
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

document.getElementById("editor-nav").addEventListener("click", async () => {
  selectView("editor");
  try { await loadEditorFiles(); } catch (error) { document.getElementById("editor-message").textContent = error.message; }
});
document.getElementById("editor-symbols").addEventListener("change", event => { const symbol=editorCurrent?.intelligence?.symbols?.[Number(event.target.value)]; if(!symbol) return; const code=document.getElementById("editor-code"); const lines=code.value.split("\n"); let offset=0; for(let i=0;i<symbol.line-1;i++) offset+=lines[i].length+1; offset+=symbol.column-1; code.focus(); code.setSelectionRange(offset,offset); code.scrollTop=Math.max(0,(symbol.line-2)*20); updateEditorLocation(); });
document.getElementById("editor-code").addEventListener("select", updateEditorLocation);
document.getElementById("editor-code").addEventListener("click", updateEditorLocation);
document.getElementById("editor-code").addEventListener("keyup", updateEditorLocation);
document.getElementById("editor-code").addEventListener("input", event => {
  if (!editorCurrent) return;
  editorCurrent.content = event.target.value;
  document.getElementById("editor-message").textContent = editorIsDirty(editorCurrent) ? "Unsaved changes" : "No unsaved changes";
  updateEditorChrome();
  updateEditorLocation();
  void analyzeEditorCurrent();
});
function editorFindMatches(query) {
  if(!editorCurrent||!query) return [];
  const matches=[]; let from=0;
  while(from<editorCurrent.content.length){const at=editorCurrent.content.indexOf(query,from);if(at<0)break;matches.push(at);from=at+Math.max(query.length,1);}
  return matches;
}
function updateEditorFindStatus(message) { document.getElementById("editor-find-status").textContent=message; }
function selectEditorMatch(direction=1) {
  const code=document.getElementById("editor-code"), query=document.getElementById("editor-find-input").value;
  if(!query||!editorCurrent){updateEditorFindStatus("Enter text to find.");return;}
  const matches=editorFindMatches(query), current=code.selectionStart;
  if(!matches.length){updateEditorFindStatus("No matches");return;}
  let index=direction>0?matches.findIndex(at=>at>current):matches.map(at=>at).reverse().findIndex(at=>at<current);
  if(index<0) index=direction>0?0:matches.length-1;
  else if(direction<0) index=matches.length-1-index;
  const at=matches[index]; code.focus(); code.setSelectionRange(at,at+query.length);
  updateEditorFindStatus((index+1)+" of "+matches.length+" matches");
}
function replaceEditorMatch() {
  const code=document.getElementById("editor-code"), query=document.getElementById("editor-find-input").value, replacement=document.getElementById("editor-replace-input").value;
  if(!editorCurrent||!query){updateEditorFindStatus("Enter text to find.");return;}
  if(code.value.slice(code.selectionStart,code.selectionEnd)!==query){selectEditorMatch(1);return;}
  const start=code.selectionStart; editorCurrent.content=editorCurrent.content.slice(0,start)+replacement+editorCurrent.content.slice(start+query.length);
  code.value=editorCurrent.content; code.setSelectionRange(start,start+replacement.length); code.focus();
  updateEditorFindStatus(editorFindMatches(query).length+" matches remaining");
  updateEditorChrome();
}
function replaceAllEditorMatches() {
  const query=document.getElementById("editor-find-input").value, replacement=document.getElementById("editor-replace-input").value;
  if(!editorCurrent||!query){updateEditorFindStatus("Enter text to find.");return;}
  const matches=editorFindMatches(query); if(!matches.length){updateEditorFindStatus("No matches");return;}
  editorCurrent.content=editorCurrent.content.split(query).join(replacement);
  document.getElementById("editor-code").value=editorCurrent.content;
  updateEditorFindStatus("Replaced "+matches.length+" matches");
  updateEditorChrome();
}
function openEditorFind() {
  if(!editorCurrent){return;}
  const bar=document.getElementById("editor-findbar");bar.hidden=false;
  const input=document.getElementById("editor-find-input");input.focus();input.select();
  updateEditorFindStatus("Ready");
}
function closeEditorFind(){document.getElementById("editor-findbar").hidden=true;}

document.getElementById("editor-preview").addEventListener("click", showEditorDiff);
document.getElementById("editor-find").addEventListener("click", openEditorFind);
document.getElementById("editor-find-close").addEventListener("click", closeEditorFind);
document.getElementById("editor-find-prev").addEventListener("click",()=>selectEditorMatch(-1));
document.getElementById("editor-find-next").addEventListener("click",()=>selectEditorMatch(1));
document.getElementById("editor-replace-one").addEventListener("click",replaceEditorMatch);
document.getElementById("editor-replace-all").addEventListener("click",replaceAllEditorMatches);
document.getElementById("editor-find-input").addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();selectEditorMatch(event.shiftKey?-1:1);}if(event.key==="Escape")closeEditorFind();});
document.getElementById("editor-replace-input").addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();replaceEditorMatch();}if(event.key==="Escape")closeEditorFind();});
document.getElementById("editor-save").addEventListener("click", saveEditorFile);
document.getElementById("editor-code").addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void saveEditorFile();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    openEditorFind();
    return;
  }
  if (event.key === "Tab") {
    event.preventDefault();
    const code = event.currentTarget;
    const start = code.selectionStart;
    const end = code.selectionEnd;
    const indent = "  ";
    code.setRangeText(indent, start, end, "end");
    code.dispatchEvent(new Event("input", { bubbles: true }));
  }
});
document.getElementById("editor-save-all").addEventListener("click", saveAllEditorFiles);
document.getElementById("diff-close").addEventListener("click", closeEditorDiff);
document.getElementById("diff-save").addEventListener("click", async () => { closeEditorDiff(); await saveEditorFile(); });
document.getElementById("diff-backdrop").addEventListener("click", event => { if(event.target.id==="diff-backdrop") closeEditorDiff(); });
document.addEventListener("keydown", event => { if(event.key==="Escape" && !document.getElementById("diff-backdrop").hidden) closeEditorDiff(); });

loadTools();

try {
  const saved = JSON.parse(localStorage.getItem("vexis-session") || "[]");
  if (Array.isArray(saved)) for (const item of saved) addMessage(item.role, item.content);
} catch {}
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

async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("Request body is too large."), { statusCode: 413 });
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
  filesystem,
  edit,
  host = DEFAULT_HOST,
  port = DEFAULT_PORT
} = {}) {
  if (!agent || typeof agent.run !== "function") throw new TypeError("agent.run must be a function");
  if (!registry || typeof registry.list !== "function" || typeof registry.discover !== "function") {
    throw new TypeError("tool registry is required");
  }


  let server;
  let taskQueue = Promise.resolve();
  const tasks = new Map();

  const publish = (taskId, event, { close = false } = {}) => {
    const state = tasks.get(taskId);
    if (!state) return;
    state.events.push(event);
    if (state.events.length > 100) state.events.shift();
    for (const client of state.clients) {
      client.write("data: " + JSON.stringify(event) + "\n\n");
      if (close) client.end();
    }
    if (close) state.clients.clear();
  };

  const enqueueTask = (taskId, task) => {
    const state = tasks.get(taskId);
    const run = taskQueue.catch(() => undefined).then(() => {
      state.started = true;
      publish(taskId, { type: "task_start" });
      return agent.run(task, {
        signal: state.controller.signal,
        onEvent: event => publish(taskId, event)
      });
    });
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

    if (request.method === "GET" && url.pathname === "/api/editor/files") {
      if (!filesystem?.list_files?.execute) { sendJson(response, 503, { error: "Editor filesystem is unavailable" }); return; }
      const result = await filesystem.list_files.execute({ path: ".", max_entries: 1000 });
      result.entries = result.entries.filter(entry => entry.type === "file" && !entry.path.startsWith(".") && !entry.path.includes("/node_modules/"));
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/editor/file") {
      if (!filesystem?.read_file?.execute) { sendJson(response, 503, { error: "Editor filesystem is unavailable" }); return; }
      const requestedPath = url.searchParams.get("path");
      if (!requestedPath) { sendJson(response, 400, { error: "path is required" }); return; }
      const result = await filesystem.read_file.execute({ path: requestedPath });
      if (result.content.includes("\u0000")) {
        sendJson(response, 415, { error: "Binary files are not supported by the text editor." });
        return;
      }
      const { createHash } = await import("node:crypto");
      sendJson(response, 200, {
        path: result.path,
        bytes: result.bytes,
        content: result.content,
        sha256: createHash("sha256").update(result.content, "utf8").digest("hex")
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/editor/intelligence") {
      const body = await readJson(request, 256 * 1024);
      if (typeof body.path !== "string" || !body.path || typeof body.content !== "string") {
        sendJson(response, 400, { error: "path and content are required" });
        return;
      }
      try { sendJson(response, 200, analyzeDocument(body.content, body.path)); }
      catch (error) { sendJson(response, 422, { error: error instanceof Error ? error.message : String(error) }); }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/editor/file") {
      if (!filesystem?.read_file?.execute || !edit?.execute) { sendJson(response, 503, { error: "Editor is unavailable" }); return; }
      const body = await readJson(request);
      if (typeof body.path !== "string" || !body.path || typeof body.expected_sha256 !== "string" || typeof body.content !== "string") {
        sendJson(response, 400, { error: "path, expected_sha256, and content are required" });
        return;
      }
      const current = await filesystem.read_file.execute({ path: body.path });
      const { createHash } = await import("node:crypto");
      const currentSha = createHash("sha256").update(current.content, "utf8").digest("hex");
      if (currentSha.toLowerCase() !== body.expected_sha256.toLowerCase()) {
        sendJson(response, 409, { error: "File changed since it was opened; reload before saving." });
        return;
      }
      const replacement = await edit.execute({
        path: body.path,
        expected_sha256: body.expected_sha256,
        old_text: current.content,
        new_text: body.content,
        expected_replacements: 1
      });
      sendJson(response, 200, replacement);
      return;
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/api/task/")) {
      const taskId = decodeURIComponent(url.pathname.slice("/api/task/".length));
      const state = tasks.get(taskId);
      if (!state) {
        sendJson(response, 404, { error: "Task not found" });
        return;
      }
      state.controller.abort();
      publish(taskId, { type: "task_cancel_requested" });
      sendJson(response, 202, { status: "cancellation_requested", id: taskId });
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/events/")) {
      const taskId = decodeURIComponent(url.pathname.slice("/api/events/".length));
      const state = tasks.get(taskId);
      if (!state) {
        sendJson(response, 404, { error: "Task not found" });
        return;
      }
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        "connection": "keep-alive",
        "x-content-type-options": "nosniff"
      });
      for (const event of state.events) response.write("data: " + JSON.stringify(event) + "\n\n");
      state.clients.add(response);
      request.on("close", () => state.clients.delete(response));
      if (state.done) response.end();
      return;
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/api/task/")) {
      const taskId = decodeURIComponent(url.pathname.slice("/api/task/".length));
      const state = tasks.get(taskId);
      if (!state) {
        sendJson(response, 404, { error: "Task not found" });
        return;
      }
      state.controller.abort();
      publish(taskId, { type: "task_cancel_requested" });
      sendJson(response, 202, { status: "cancellation_requested", id: taskId });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/task") {
      try {
        const body = await readJson(request);
        const taskId = typeof body.id === "string" && body.id ? body.id : randomUUID();
        if (typeof body.task !== "string" || !body.task.trim()) {
          sendJson(response, 400, { error: "task must be a non-empty string" });
          return;
        }
        if (tasks.has(taskId)) {
          sendJson(response, 409, { error: "Task id is already in use" });
          return;
        }
        const state = { controller: new AbortController(), clients: new Set(), events: [], started: false, done: false };
        tasks.set(taskId, state);
        try {
          const result = await enqueueTask(taskId, body.task.trim());
          state.done = true;
          publish(taskId, { type: "task_complete", status: result?.status || "completed" }, { close: true });
          sendJson(response, 200, { id: taskId,
          status: result?.status || "completed",
          output: result?.output || ""
          });
        } catch (error) {
          state.done = true;
          if (state.controller.signal.aborted) {
            publish(taskId, { type: "task_cancelled" }, { close: true });
            sendJson(response, 200, { id: taskId, status: "cancelled", output: "" });
          } else {
            const message = error instanceof Error ? error.message : String(error);
            publish(taskId, { type: "task_error", error: message }, { close: true });
            sendJson(response, error.statusCode || 500, { id: taskId, error: message });
          }
        }
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
