import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_MAX_FILES = 2000;
const DEFAULT_MAX_FILE_BYTES = 128 * 1024;
const DEFAULT_MAX_SYMBOLS = 10000;
const SOURCE_EXTENSIONS = new Set([".js",".jsx",".mjs",".cjs",".ts",".tsx",".py",".go",".rs",".java",".kt",".swift",".rb",".php",".c",".cc",".cpp",".h",".hpp",".cs"]);
const IGNORED = new Set([".git","node_modules","dist","build","coverage",".next",".turbo"]);

function normalize(p) { return String(p || "").split(path.sep).join("/"); }
function within(root, target) {
  const r = path.relative(root, target);
  return r === "" || (!r.startsWith(".." + path.sep) && r !== ".." && !path.isAbsolute(r));
}
function kindFromMatch(kind) {
  return ({function:"function",class:"class",interface:"interface",type:"type",enum:"enum",const:"constant",let:"variable",var:"variable",def:"function",func:"function",struct:"class",trait:"interface"})[kind] || kind;
}
function lineAt(content, index) { return content.slice(0,index).split("\n").length; }

function parseSymbols(content, file) {
  const out = [];
  const add = (name, kind, index, exported=false) => {
    if (!name) return;
    out.push({ name, kind: kindFromMatch(kind), file, line: lineAt(content,index), exported: Boolean(exported) });
  };
  const patterns = [
    /\bexport\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/g,
    /\bclass\s+([A-Za-z_$][\w$]*)/g,
    /\binterface\s+([A-Za-z_$][\w$]*)/g,
    /\btype\s+([A-Za-z_$][\w$]*)\s*=/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?==|:)/g,
    /\bdef\s+([A-Za-z_]\w*)\s*\(/g,
    /\b(?:async\s+)?func\s+([A-Za-z_]\w*)\s*\(/g,
    /\bstruct\s+([A-Za-z_]\w*)\b/g,
    /\btrait\s+([A-Za-z_]\w*)\b/g,
    /\benum\s+([A-Za-z_]\w*)\b/g
  ];
  const seen = new Set();
  for (const re of patterns) {
    for (const match of content.matchAll(re)) {
      const name = match[1];
      const key = name + ":" + lineAt(content, match.index);
      if (seen.has(key)) continue;
      seen.add(key);
      add(name, re.source.includes("class") ? "class" : re.source.includes("interface") ? "interface" : re.source.includes("\\btype") ? "type" : re.source.includes("def") ? "def" : re.source.includes("func") ? "func" : re.source.includes("struct") ? "struct" : re.source.includes("trait") ? "trait" : re.source.includes("enum") ? "enum" : re.source.includes("const|let|var") ? "const" : "function", match.index, /^\s*export\b/m.test(content.slice(Math.max(0, match.index-10), match.index+10)));
    }
  }
  return out;
}

function parseImports(content, file) {
  const imports = [];
  const add = (specifier, source, type="import") => imports.push({ specifier, source, type });
  for (const m of content.matchAll(/\bimport\s+(?:[^"'\n]+?\s+from\s+)?["']([^"']+)["']/g)) add(m[1], m[1], "import");
  for (const m of content.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)) add(m[1], m[1], "require");
  for (const m of content.matchAll(/\bfrom\s+["']([^"']+)["']/g)) add(m[1], m[1], "from");
  for (const m of content.matchAll(/^\s*#include\s*[<"]([^>"]+)[>"]/gm)) add(m[1], m[1], "include");
  for (const m of content.matchAll(/\b(?:use|mod)\s+([A-Za-z_][\w:]*)/g)) add(m[1], m[1], "module");
  return [...new Map(imports.map(item => [item.specifier + ":" + item.source, item])).values()];
}

function resolveImport(source, fromFile, files) {
  if (!source.startsWith(".")) return null;
  const base = normalize(path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), source)));
  const candidates = [base, ...[".js",".jsx",".mjs",".cjs",".ts",".tsx",".py",".go",".rs"].map(ext => base+ext), ...["index.js","index.ts","index.tsx"].map(x => path.posix.join(base,x))];
  return candidates.find(x => files.has(x)) || null;
}

export class RepositoryIntelligence {
  constructor({ workspace, filesystem, maxFiles=DEFAULT_MAX_FILES, maxFileBytes=DEFAULT_MAX_FILE_BYTES, maxSymbols=DEFAULT_MAX_SYMBOLS }={}) {
    if (!workspace) throw new TypeError("workspace is required");
    if (!filesystem?.list_files?.execute || !filesystem?.read_file?.execute) throw new TypeError("filesystem tools are required");
    this.workspace = path.resolve(workspace);
    this.filesystem = filesystem;
    this.maxFiles = Math.max(1, Math.min(DEFAULT_MAX_FILES, Number(maxFiles) || DEFAULT_MAX_FILES));
    this.maxFileBytes = Math.max(1024, Math.min(4*1024*1024, Number(maxFileBytes) || DEFAULT_MAX_FILE_BYTES));
    this.maxSymbols = Math.max(1, Math.min(DEFAULT_MAX_SYMBOLS, Number(maxSymbols) || DEFAULT_MAX_SYMBOLS));
    this.snapshot = null;
  }

  async index({ force=false }={}) {
    if (this.snapshot && !force) return this.snapshot;
    const listing = await this.filesystem.list_files.execute({path:".",max_entries:this.maxFiles});
    const files = listing.entries.filter(e => e.type==="file" && SOURCE_EXTENSIONS.has(path.extname(e.path).toLowerCase()) && !IGNORED.has(normalize(e.path).split("/")[0])).map(e=>normalize(e.path));
    const fileSet = new Set(files);
    const symbols=[], dependencies=[], reverse={};
    for (const file of files) {
      try {
        const result=await this.filesystem.read_file.execute({path:file});
        const content=String(result.content||"");
        if (Buffer.byteLength(content,"utf8") > this.maxFileBytes) continue;
        if (symbols.length < this.maxSymbols) {
          for (const symbol of parseSymbols(content,file)) {
            if (symbols.length >= this.maxSymbols) break;
            symbols.push(symbol);
          }
        }
        for (const item of parseImports(content,file)) {
          const target=resolveImport(item.source,file,fileSet);
          dependencies.push({from:file,to:target,specifier:item.specifier,type:item.type,external:!target});
          if (target) (reverse[target] ||= []).push(file);
        }
      } catch {}
    }
    this.snapshot={version:1,files, symbols, dependencies, reverse, truncated:listing.truncated || files.length>=this.maxFiles || symbols.length>=this.maxSymbols, indexedAt:new Date().toISOString()};
    return this.snapshot;
  }

  async inspect(input={}) {
    const index=await this.index({force:Boolean(input.refresh)});
    const query=String(input.query||"").toLowerCase().trim();
    const file=input.file ? normalize(input.file) : null;
    const symbols=index.symbols.filter(s=>(!file || s.file===file) && (!query || (s.name+" "+s.kind+" "+s.file).toLowerCase().includes(query))).slice(0, Number(input.limit)||100);
    const dependencies=file ? index.dependencies.filter(d=>d.from===file) : index.dependencies;
    const dependents=file ? (index.reverse[file]||[]).map(from=>({from,to:file})) : [];
    return {version:index.version,indexedAt:index.indexedAt,files:index.files.length,symbols:symbols.length,dependencies:dependencies.length,query,file,symbols,dependencies,dependents,truncated:index.truncated};
  }

  async searchSymbols(input={}) { return this.inspect({...input,limit:Math.min(200,Number(input.limit)||50)}); }

  async dependencies(input={}) {
    const index=await this.index({force:Boolean(input.refresh)});
    const file=normalize(input.file||"");
    if (!file) throw new TypeError("file is required");
    return {file,dependencies:index.dependencies.filter(d=>d.from===file),dependents:(index.reverse[file]||[]),indexedAt:index.indexedAt};
  }

  invalidate() { this.snapshot=null; }
  describe() { return {workspace:this.workspace,files:this.snapshot?.files.length||0,symbols:this.snapshot?.symbols.length||0,cached:Boolean(this.snapshot)}; }

  async execute(input={}) {
    const action=input.action||"inspect";
    if (action==="inspect") return {status:"ok",...(await this.inspect(input))};
    if (action==="search_symbols") return {status:"ok",...(await this.searchSymbols(input))};
    if (action==="dependencies") return {status:"ok",...(await this.dependencies(input))};
    if (action==="refresh") return {status:"ok",...(await this.index({force:true}))};
    if (action==="stats") return {status:"ok",...(this.describe())};
    throw new Error("Unknown repository intelligence action: "+action);
  }
}

export function createRepositoryIntelligence(options) { return new RepositoryIntelligence(options); }
export function toRepositoryIntelligenceTool(intelligence) { return { repository_intelligence: intelligence.execute }; }
