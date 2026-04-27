# Architecture Documentation Guide

This directory defines the **intended architecture and operating boundaries** for `ai-system-builder`.

These documents are the practical reference for contributors (human and AI) when deciding:

- where code belongs,
- what should depend on what,
- how runtime, host, and infrastructure concerns are separated,
- and what is intentionally **not yet standardized**.

## How this relates to other docs

- `docs/architecture/` explains the target system shape and boundary model.
- `docs/adr/` records specific architectural decisions and their rationale over time.
- `docs/context/` captures implementation context, current state, and situational notes.

In short:

- Architecture docs = operating model and dependency boundaries.
- ADRs = individual decisions (accepted, superseded, proposed).
- Context docs = where we are right now.

## Scope and intent

This repository is a restart with explicit constraints:

- TypeScript-first, Node-native implementation.
- Clean architecture discipline in the core.
- Electron/Electron Forge as the desktop host/build path.
- Planned support for desktop, server, and later hybrid host modes.
- Postgres as default persistence adapter.
- Strong docs with clear boundaries and low ambiguity.

These docs intentionally avoid fake precision. Where implementation details are still evolving, they are called out as **not yet finalized**.

## How contributors should use this folder

1. Read `system-overview.md` first for system shape.
2. Use `module-dependency-rules.md` before creating imports or moving files.
3. Use host/runtime/persistence docs before adding host wiring or adapter logic.
4. If you need to change a major boundary rule, update architecture docs and add/update an ADR.

## Review rule of thumb

When adding or changing code, verify:

- Is this business logic in `domain`/`application`, or is it leaking into adapter/host/UI code?
- Is transport code doing orchestration that belongs in application use cases?
- Is host lifecycle code being confused with transport adapter code?
- Are persistence and storage concerns mixed together?
- Are we introducing package/build boundaries without a concrete need?

If any answer is "yes", stop and adjust before the pattern spreads.

## Current maturity statement

The architecture is deliberately ahead of implementation detail, but not ahead of decisions:

- Major direction is set.
- Exact protocols and some enforcement mechanisms are still emerging.
- Documentation should guide with confidence where decisions exist, and explicitly mark open areas where they do not.
