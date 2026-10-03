import { emitKeypressEvents } from "node:readline";

const ESC = "\u001b[";
const RESET = `${ESC}0m`;
const CLEAR = `${ESC}2J${ESC}H`;
const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function wrap(text, width) {
  const source = String(text ?? "").split("\n");
  const lines = [];
  for (const line of source) {
    if (!line) {
      lines.push("");
      continue;
    }
    for (let index = 0; index < line.length; index += width) {
      lines.push(line.slice(index, index + width));
    }
  }
  return lines;
}

function appendMessage(state, role, content) {
  return {
    ...state,
    messages: [...state.messages, { role, content: String(content ?? "") }]
  };
}

export function createTuiState({ width = 80, height = 24 } = {}) {
  return {
    width: Math.max(20, width),
    height: Math.max(8, height),
    input: "",
    cursor: 0,
    status: "idle",
    messages: [],
    exit: false,
    notice: "Ready"
  };
}

export function renderTui(state) {
  const width = Math.max(20, state.width);
  const height = Math.max(8, state.height);
  const inner = width - 4;
  const lines = [
    `${ESC}1m Vexis Studio ${RESET} ${state.status === "running" ? "● working" : "○ ready"}`,
    "─".repeat(width),
    ...state.messages.flatMap(message => [
      `[${message.role}]`,
      ...wrap(message.content, inner)
    ])
  ];

  const bodyHeight = Math.max(1, height - 5);
  const body = lines.slice(-bodyHeight);
  while (body.length < bodyHeight) body.unshift("");

  const inputLabel = state.status === "running" ? " agent working… " : " task ";
  const inputLine = `[${inputLabel}] ${state.input}`;
  const footer = `─${state.notice}  •  Enter run  •  Ctrl+C exit`;
  return [
    CLEAR,
    HIDE_CURSOR,
    ...body,
    "─".repeat(width),
    inputLine.slice(0, width),
    footer.slice(0, width),
    SHOW_CURSOR
  ].join("\n");
}

export function handleTuiKey(state, key) {
  if (!key) return { state, submit: false };

  if (key.ctrl && key.name === "c") {
    return { state: { ...state, exit: true, notice: "Exiting" }, submit: false };
  }

  if (key.name === "return" || key.name === "enter") {
    if (!state.input.trim() || state.status === "running") return { state, submit: false };
    const task = state.input.trim();
    return {
      state: {
        ...appendMessage({ ...state, input: "", cursor: 0, status: "running", notice: "Running task" }, "user", task)
      },
      submit: true,
      task
    };
  }

  if (key.name === "backspace") {
    if (state.cursor === 0) return { state, submit: false };
    return {
      state: {
        ...state,
        input: state.input.slice(0, state.cursor - 1) + state.input.slice(state.cursor),
        cursor: state.cursor - 1
      },
      submit: false
    };
  }

  if (key.name === "delete") {
    if (state.cursor >= state.input.length) return { state, submit: false };
    return {
      state: {
        ...state,
        input: state.input.slice(0, state.cursor) + state.input.slice(state.cursor + 1)
      },
      submit: false
    };
  }

  if (key.name === "left") {
    return { state: { ...state, cursor: clamp(state.cursor - 1, 0, state.input.length) }, submit: false };
  }

  if (key.name === "right") {
    return { state: { ...state, cursor: clamp(state.cursor + 1, 0, state.input.length) }, submit: false };
  }

  if (key.name === "home" || (key.ctrl && key.name === "a")) {
    return { state: { ...state, cursor: 0 }, submit: false };
  }

  if (key.name === "end" || (key.ctrl && key.name === "e")) {
    return { state: { ...state, cursor: state.input.length }, submit: false };
  }

  if (key.ctrl && key.name === "l") {
    return { state: { ...state, notice: "Screen refreshed" }, submit: false };
  }

  if (typeof key.sequence === "string" && !key.ctrl && !key.meta && key.sequence >= " ") {
    const input = state.input.slice(0, state.cursor) + key.sequence + state.input.slice(state.cursor);
    return {
      state: { ...state, input, cursor: state.cursor + key.sequence.length },
      submit: false
    };
  }

  return { state, submit: false };
}

function renderResult(state, result) {
  let next = { ...state, status: "idle", notice: "Ready" };
  if (result?.output) next = appendMessage(next, "agent", result.output);
  if (result?.status === "max_steps") next = appendMessage(next, "system", "Agent stopped at the configured step limit.");
  return next;
}

export function createTui({
  agent,
  registry,
  input = process.stdin,
  output = process.stdout
} = {}) {
  if (!agent || typeof agent.run !== "function") throw new TypeError("agent.run must be a function");
  if (!registry || typeof registry.list !== "function" || typeof registry.discover !== "function") {
    throw new TypeError("tool registry is required");
  }

  let state = createTuiState({
    width: Number.isInteger(output.columns) ? output.columns : 80,
    height: Number.isInteger(output.rows) ? output.rows : 24
  });
  let started = false;
  let keypressHandler;
  let resizeHandler;

  const write = () => output.write(renderTui(state));

  async function executeTask(task) {
    try {
      if (task === "/help") {
        state = appendMessage({ ...state, status: "idle", notice: "Ready" }, "system", "Enter a task. Commands: /help, /tools, /discover <query>, /exit");
      } else if (task === "/tools") {
        const tools = registry.list();
        state = appendMessage({ ...state, status: "idle", notice: "Ready" }, "system", tools.length
          ? tools.map(tool => `- ${tool.name}: ${tool.description}`).join("\n")
          : "No tools registered.");
      } else if (task.startsWith("/discover")) {
        const query = task.slice("/discover".length).trim();
        state = appendMessage({ ...state, status: "idle", notice: "Ready" }, "system", query
          ? (registry.discover(query).map(tool => `- ${tool.name}: ${tool.description}`).join("\n") || "No matching tools.")
          : "Usage: /discover <query>");
      } else if (task === "/exit" || task === "/quit") {
        state = { ...state, exit: true, status: "idle", notice: "Exiting" };
      } else {
        state = renderResult(state, await agent.run(task));
      }
    } catch (error) {
      state = appendMessage({ ...state, status: "idle", notice: "Error" }, "error", error.message);
    }
    write();
    if (state.exit) stop();
  }

  async function handleKey(key) {
    const result = handleTuiKey(state, key);
    state = result.state;
    write();
    if (result.submit) await executeTask(result.task);
    return result;
  }

  function stop() {
    if (!started) return;
    started = false;
    if (keypressHandler) input.off("keypress", keypressHandler);
    if (resizeHandler && typeof output.off === "function") output.off("resize", resizeHandler);
    if (input.isTTY && typeof input.setRawMode === "function") input.setRawMode(false);
    output.write(`${SHOW_CURSOR}${ESC}0m\n`);
  }

  async function start() {
    if (started) return;
    started = true;
    emitKeypressEvents(input);
    if (input.isTTY && typeof input.setRawMode === "function") input.setRawMode(true);

    keypressHandler = (_, key) => {
      void handleKey(key);
    };
    resizeHandler = () => {
      state = {
        ...state,
        width: Number.isInteger(output.columns) ? output.columns : state.width,
        height: Number.isInteger(output.rows) ? output.rows : state.height
      };
      write();
    };

    input.on("keypress", keypressHandler);
    if (typeof output.on === "function") output.on("resize", resizeHandler);
    write();

    await new Promise(resolve => {
      const finish = () => {
        stop();
        resolve();
      };
      const interval = setInterval(() => {
        if (state.exit) {
          clearInterval(interval);
          finish();
        }
      }, 25);
      if (typeof interval.unref === "function") interval.unref();
    });
  }

  return {
    getState: () => state,
    handleKey,
    render: () => renderTui(state),
    start,
    stop
  };
}
