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

1. **Agent kernel** — a minimal model → tool → observation loop.
2. **Filesystem tools** — read, list, search, and write project files.
3. **Command execution** — run shell commands with controlled execution.
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

## First milestone

The first implementation milestone is deliberately tiny:

> Given a user task, the agent can call one tool, observe the result, and decide what to do next.

Everything else comes later.

## Repository status

This repository is currently being initialized.
