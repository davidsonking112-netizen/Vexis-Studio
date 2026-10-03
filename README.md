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
9. **Interactive CLI** — polished terminal experience.
10. **Editor integration** — IDE/editor workflow.
11. **Multi-model runtime** — provider/model abstraction.
12. **Safety and permissions** — approvals, sandboxing, limits, audit trail.
13. **Advanced agentic workflows** — parallel work, sub-agents, background tasks, and long-running jobs.

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
