const MAX_ANALYSIS_BYTES = 256 * 1024;

function languageForPath(path = "") {
  const lower = path.toLowerCase();
  if (/\.(js|mjs|cjs)$/.test(lower)) return "javascript";
  if (/\.ts$/.test(lower)) return "typescript";
  if (/\.tsx$/.test(lower)) return "tsx";
  if (/\.jsx$/.test(lower)) return "jsx";
  if (/\.py$/.test(lower)) return "python";
  if (/\.json$/.test(lower)) return "json";
  if (/\.(md|mdx)$/.test(lower)) return "markdown";
  if (/\.(css|scss)$/.test(lower)) return "css";
  if (/\.(html|htm)$/.test(lower)) return "html";
  return "text";
}

function positionAt(content, offset) {
  const before = content.slice(0, Math.max(0, offset));
  const lines = before.split("\n");
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function analyzeDocument(content, path = "") {
  if (typeof content !== "string") throw new TypeError("content must be a string");
  if (Buffer.byteLength(content, "utf8") > MAX_ANALYSIS_BYTES) throw new Error("Editor intelligence is limited to 256 KiB per analysis.");
  const language = languageForPath(path);
  const lines = content.split("\n");
  const symbols = [];
  const diagnostics = [];
  const addSymbol = (name, kind, offset) => { const p = positionAt(content, offset); symbols.push({ name, kind, line: p.line, column: p.column }); };
  const patterns = language === "python"
    ? [/^\s*(?:async\s+)?def\s+([A-Za-z_$][\w$]*)/gm, /^\s*class\s+([A-Za-z_$][\w$]*)/gm]
    : language === "json" ? []
    : [/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm, /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/gm, /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm];
  const kinds = language === "python" ? ["function", "class"] : ["function", "class", "variable"];
  for (let i = 0; i < patterns.length; i++) for (const match of content.matchAll(patterns[i])) addSymbol(match[1], kinds[i], match.index + match[0].indexOf(match[1]));
  if (language === "json") for (const match of content.matchAll(/^\s*"([^"\n]+)"\s*:/gm)) addSymbol(match[1], "property", match.index + match[0].indexOf(match[1]));
  const stack = []; const pairs = { "(": ")", "[": "]", "{": "}" }; const closing = new Set(Object.values(pairs));
  let offset = 0;
  lines.forEach((line, lineIndex) => {
    const trailing = /[ \t]+$/.exec(line);
    if (trailing) diagnostics.push({ severity: "info", message: "Trailing whitespace", line: lineIndex + 1, column: trailing.index + 1 });
    const marker = /\b(?:TODO|FIXME)\b/.exec(line);
    if (marker) diagnostics.push({ severity: "hint", message: "Deferred work marker", line: lineIndex + 1, column: marker.index + 1 });
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (pairs[char]) stack.push({ char, offset: offset + i });
      else if (closing.has(char)) {
        const expected = Object.entries(pairs).find(([, value]) => value === char)?.[0]; const top = stack.at(-1);
        if (!top || top.char !== expected) { const p = positionAt(content, offset + i); diagnostics.push({ severity: "error", message: "Unexpected " + char, line: p.line, column: p.column }); } else stack.pop();
      }
    }
    offset += line.length + 1;
  });
  for (const item of stack) { const p = positionAt(content, item.offset); diagnostics.push({ severity: "error", message: "Unclosed " + item.char, line: p.line, column: p.column }); }
  diagnostics.sort((a, b) => a.line - b.line || a.column - b.column);
  symbols.sort((a, b) => a.line - b.line || a.column - b.column);
  return { path, language, lines: lines.length, bytes: Buffer.byteLength(content, "utf8"), symbols, diagnostics };
}

export { MAX_ANALYSIS_BYTES, analyzeDocument, languageForPath };