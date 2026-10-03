# Vexis Studio

Vexis Studio is an AI coding agent built from first principles.

The goal is not to clone one existing product. We will build the system incrementally, validating each capability before adding the next.

## Product direction

Vexis should eventually be able to:

- understand a codebase
- inspect files and symbols
- reason about implementation tasks
- edit files safely
- run commands and tests
- inspect failures and iterate
- maintain task/context state
- use tools autonomously within explicit boundaries
- work interactively from a terminal and/or editor UI
- support multiple model providers
- become extensible through skills/tools

## Build principle

**One capability at a time.**

Each stage should produce a runnable, testable artifact. We do not build the entire agent framework up front.

## Initial staged roadmap

1. **Agent kernel** — a minimal model → tool → observation loop. **Implemented**
2. **Filesystem tools** — controlled listing and reading inside a workspace. **Implemented**
3. **Command execution** — run approved development commands without invoking a shell. **Implemented**
4. **Codebase understanding** — bounded structural project inspection and context selection. **Implemented**
5. **Editing loop** — propose/apply changes and verify them with hash-guarded exact replacements. **Implemented**
6. **Test/debug loop** — run tests, inspect failures, repair, repeat. **Implemented**
7. **Persistent task state** — plans, checkpoints, and resumable work. **Implemented**
8. **Tool/skill system** — extensible capabilities and tool discovery. **Implemented**
9. **Interactive CLI** — polished terminal experience. **Sectors 1, 2, and 3 implemented**
10. **Editor integration** — IDE/editor workflow. **Implemented**
11. **Real model runtime** — provider/model abstraction foundation. **Implemented**
12. **Multi-provider runtime** — native provider adapters, profiles, capabilities, and provider registry. **Implemented**
13. **Streaming + rich tool calling** — streaming events, structured outputs, and richer tool semantics.
14. **Context intelligence** — context selection, compression, and token budgeting.
15. **Planning engine** — explicit plans, decomposition, verification, and recovery.

## Stage 10 / Sector 1: Editor integration

The first editor layer integrates the existing workspace primitives into the desktop shell:

- browses the bounded workspace file tree
- opens UTF-8 text files through the existing filesystem read boundary
- presents an editable workspace surface without exposing arbitrary filesystem APIs
- saves through the existing hash-guarded exact replacement primitive
- rejects stale saves when the file changed after it was opened
- keeps editor state in the browser UI while the source of truth remains the workspace files

### Sector 2: Multi-file editor state

The editor now also supports:

- multiple simultaneously open file tabs
- independent in-memory buffers and pre-edit hashes per file
- visible dirty/unsaved indicators
- guarded switching and closing of files with unsaved changes
- per-file Save and sequential Save all
- continued stale-write protection for every individual save

This remains intentionally lighter than a full IDE. Syntax intelligence, language services, richer diffs, search/replace, and deeper editor automation remain later Stage 10 work without weakening the filesystem/editing boundaries.

## Current safety boundary

Vexis command execution currently:

- runs with the workspace as its working directory
- does not invoke a shell
- uses an executable allowlist
- supports explicit approval callbacks
- enforces execution timeouts
- bounds captured stdout/stderr
- reports exit codes, signals, timeouts, and truncation

This is a **process-level policy boundary, not an OS sandbox**. Commands such as package managers can themselves execute arbitrary project scripts. Strong isolation will be addressed in the later safety/permissions stage.

## First milestone

The first implementation milestone is deliberately tiny:

> Given a user task, the agent can call one tool, observe the result, and decide what to do next.

Everything else comes later.

## Repository status

This repository is currently being initialized.


## Editing boundary

The first editing layer is intentionally conservative:

- edits are limited to files inside the workspace
- the complete pre-edit file hash must match the model's expected hash
- replacements are exact text matches, not fuzzy edits
- exactly one match is required by default
- callers can explicitly request a different exact replacement count
- files above the configured size limit are rejected
- changes are written atomically through a temporary file and rename
- the result reports before/after SHA-256 hashes and replacement count

This gives Vexis a verifiable edit primitive before we build larger patch generation or autonomous repair behavior.


## Test verification boundary

Stage 6 adds a structured verification primitive:

- reads the workspace's `package.json` test script
- selects npm, pnpm, yarn, or bun from `packageManager` when declared
- runs the package manager's `test` command through the existing controlled command layer
- returns `passed`, `failed`, or `unavailable` without throwing for ordinary test failures
- preserves exit code, signal, timeout, output-limit, duration, and bounded stdout/stderr
- returns concise diagnostics so the agent can inspect a failure and decide whether to edit and retest

The repair/retest behavior is intentionally model-driven: the existing agent kernel already supports repeated tool calls, while this stage supplies a deterministic verification observation. Broader test discovery for Python, Rust, Go, and other ecosystems will be added as separate capabilities rather than hidden inside one oversized runner.


## Persistent task state boundary

Stage 7 adds a bounded workspace-local task state primitive:

- persists a versioned task plan to `.vexis/task-state.json`
- supports initialization, updates, reads, and resumable checkpoints
- validates task and plan status values and checkpoint step references
- writes state atomically
- enforces a workspace boundary and state-size limit
- exposes the primitive to the agent as `task_state`

The state layer is deliberately independent from model/provider logic so later stages can build richer planning and orchestration on top of a stable persistence contract.


## Tool and skill registry boundary

Stage 8 adds a capability registry without changing the existing tool execution contract:

- validates tool names and executable definitions before registration
- prevents accidental tool-name collisions, with explicit replacement when requested
- provides deterministic tool listing and text-based discovery
- converts registered tools directly into the agent's existing function map
- supports reusable skill definitions that bundle tools
- keeps skills separate from installed tools until explicitly installed
- rejects skill/tool collisions before registration
- exposes deterministic skill discovery and descriptions

The registry is an orchestration layer, not a permission boundary. Tool safety remains owned by the underlying filesystem, command, editing, test, and task-state primitives; stronger authorization and sandboxing remain part of Stage 12.


## Stage 9 interface architecture

Stage 9 is deliberately split into three interface sectors:

1. **CLI** — the primary scriptable terminal interface and the stable command/input contract.
2. **TUI** — the interactive terminal workspace built on the same runtime and CLI contracts.
3. **Desktop** — a separate desktop shell that reuses the runtime rather than duplicating agent logic.

### Stage 9 / Sector 1: CLI

The first interface layer provides:

- interactive task submission
- `/help`, `/tools`, and `/discover <query>` commands
- clean `/exit` and `/quit` handling
- reusable runtime construction for future interfaces
- testable input/output boundaries
- a `vexis` package executable and `npm run cli` entrypoint

The CLI uses Node's stable readline interface for line-oriented terminal input. citeturn0search0

### Stage 9 / Sector 2: TUI

The second interface layer adds a dependency-free terminal workspace:

- full-screen ANSI rendering with a bounded transcript
- interactive task input with cursor movement and editing
- Enter-to-run task execution against the shared runtime
- /help, /tools, /discover <query>, /exit, and /quit commands
- terminal resize handling
- Ctrl+C cleanup and terminal-mode restoration
- non-TTY fallback to the existing CLI so scripting remains usable

The TUI uses Node's keypress events and raw TTY mode rather than introducing a UI framework dependency. Node documents that keypress events on a TTY require raw mode, and TTY streams expose resize events for responsive rendering. citeturn0search0turn0search1

The Desktop sector will reuse this same runtime and keep desktop-specific concerns outside the agent kernel.

The Desktop sector is a dependency-free local application shell:

- serves a polished browser-based coding workspace on loopback only
- reuses the same `createRuntime()` agent, registry, and tool contracts
- provides a three-panel workspace with agent conversation, workspace context, tools, activity, and shortcuts
- includes responsive mobile/tablet layouts, task suggestions, keyboard shortcuts, loading/error states, and safe DOM rendering
- exposes task execution, tool listing, discovery, and health APIs without exposing filesystem APIs directly over HTTP
- serializes task execution so concurrent UI requests cannot run the agent simultaneously
- bounds request bodies and hardens HTML/JSON responses with browser security headers
- includes a `vexis-desktop` executable

This is intentionally a **desktop shell**, not a native Electron-style application and not an OS-level sandbox. The browser UI is local to the machine; stronger permissions and isolation remain part of Stage 12.


## Stage 10 editor integration

Stage 10 turns the desktop shell into a guarded multi-file development surface while keeping all writes behind the existing filesystem and edit boundaries.

The editor currently provides:

- bounded workspace file browsing that excludes hidden files and dependency directories from the UI
- UTF-8 text-file opening with binary-file rejection
- multi-file tabs with independent in-memory buffers and dirty state
- SHA-256 guarded saves that reject stale on-disk changes
- Save and Save All flows plus explicit discard protection when closing or switching dirty files
- change preview with bounded line-based diff rendering
- find, next/previous match, replace-one, and replace-all operations
- cursor-aware line/column status and symbol navigation
- lightweight built-in editor intelligence for JavaScript, TypeScript, JSX/TSX, Python, JSON, Markdown, CSS, and HTML-family files
- bounded document symbols and structural diagnostics, including unmatched delimiters, deferred-work markers, and trailing whitespace
- diagnostic navigation and live re-analysis while editing
- editor keyboard shortcuts for save and find, plus indentation on Tab
- a dependency-free implementation that does not pretend to be a full language server

The intelligence layer is intentionally lightweight and deterministic. Full LSP integration, richer semantic analysis, refactoring services, and language-server-backed completion remain later platform work rather than being hidden inside the Stage 10 editor.

Stage 10 is complete when the editor surface, intelligence boundary, guarded persistence, diff/review flow, and automated coverage remain green together.

## Stage 11 real model runtime

Stage 11 replaces the deterministic demonstration model with a real provider boundary while preserving the existing agent/tool architecture.

The runtime now provides:

- a stable model contract with normalized final responses and tool calls
- an OpenAI-compatible HTTP transport using Node's built-in fetch
- configurable model, endpoint, API key, timeout, and retry policy through runtime options or environment variables
- structured conversion of Vexis tool definitions into provider function tools
- normalization of provider tool calls back into the agent's internal contract
- provider usage and request-id metadata without exposing secrets
- bounded exponential retries for explicitly retryable provider failures
- request cancellation and timeout handling
- provider-independent runtime construction: callers may inject any model implementing the contract
- correct assistant tool-call history so real providers receive valid multi-turn tool interactions
- automated coverage for final responses, tool calls, failures/retries, and cancellation

### Model configuration

```bash
VEXIS_MODEL_API_KEY=...
VEXIS_MODEL=gpt-5
VEXIS_MODEL_BASE_URL=https://api.openai.com/v1
```

`VEXIS_MODEL_BASE_URL` can point at another OpenAI-compatible service, including a local inference server. The transport deliberately remains generic; native provider-specific adapters, streaming, richer tool-call semantics, and multi-provider discovery are Stage 12/13 work.

Vexis does not store provider credentials in the repository or task state.


## Stage 12 multi-provider runtime

Stage 12 promotes the model boundary into a real provider architecture while keeping the agent and tools provider-independent.

The runtime now provides:

- a deterministic provider registry with capability metadata
- native Anthropic message/tool translation alongside the OpenAI-compatible transport
- named providers for OpenAI, Anthropic, Qwen, local inference, and generic OpenAI-compatible endpoints
- provider-specific defaults without hard-coding credentials
- explicit model profiles through `VEXIS_MODEL_PROFILES`
- provider selection through runtime configuration or `VEXIS_PROVIDER`
- normalized provider identity, model identity, endpoint, and capabilities through `model.describe()`
- unified retry/error metadata across providers
- injectable fetch implementations for deterministic adapter tests
- provider selection without coupling the Agent to any provider SDK or wire format

### Provider configuration

Single-provider configuration remains simple:

```bash
VEXIS_PROVIDER=openai
VEXIS_MODEL_API_KEY=...
VEXIS_MODEL=gpt-5
```

Anthropic:

```bash
VEXIS_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
VEXIS_MODEL=claude-sonnet-4-5
```

Qwen through its OpenAI-compatible endpoint:

```bash
VEXIS_PROVIDER=qwen
DASHSCOPE_API_KEY=...
VEXIS_MODEL=qwen-plus
```

Local inference:

```bash
VEXIS_PROVIDER=local
VEXIS_MODEL=qwen3
VEXIS_MODEL_BASE_URL=http://127.0.0.1:11434/v1
```

Named profiles can be supplied as JSON through `VEXIS_MODEL_PROFILES`, then selected with `modelConfig.profile` when constructing the runtime.

Provider credentials are read from environment/runtime configuration and are never persisted into task state.

Stage 12 deliberately does not add streaming yet. Streaming and richer tool semantics are isolated into Stage 13 so the provider adapters remain testable and the Agent contract stays stable.


## Stage 13 streaming and rich tool calling

Stage 13 completes the model-to-agent streaming path without changing the underlying tool safety boundaries.

The runtime now provides:

- a normalized model response contract for single and multiple tool calls
- a normalized streaming event contract for text deltas, tool-call deltas, finish events, completed responses, and provider metadata
- hardened OpenAI-compatible SSE streaming with fragmented-frame handling, cancellation, timeout enforcement, and bounded retries before a stream begins
- native Anthropic Messages API streaming with text and incremental tool-input events
- multiple tool-call preservation across providers
- parallel execution of independent tool calls in the agent with deterministic result/message ordering
- a shared agent event stream consumed by the existing desktop SSE task endpoint and available to CLI/TUI integrations
- provider capability metadata aligned with the actual adapters
- provider/model/usage metadata carried through final responses

Streaming retries are intentionally limited to failures before a response stream has been consumed. Once model output has begun, Vexis does not silently replay a partially observed generation.

Stage 13 is considered complete only when the provider adapters, agent execution semantics, event contract, and automated verification remain coherent together.
