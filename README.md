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
4. **Codebase understanding** — structured project inspection and context selection.
5. **Editing loop** — propose/apply changes and verify them.
6. **Test/debug loop** — run tests, inspect failures, repair, repeat.
7. **Persistent task state** — plans, checkpoints, and resumable work.
8. **Tool/skill system** — extensible capabilities and tool discovery.
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
