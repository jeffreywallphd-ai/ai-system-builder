# Context Pack: Index (Baseline)

- Pack name: `index`

## Purpose

- Provide the always-included baseline context for all automation and implementation prompts.
- Establish repository-wide guardrails while keeping context payloads minimal.

## Use When

- Every automated prompt and implementation task in this repository.
- Any task that needs baseline standards before adding specialized packs.

## Do Not Use When

- Never omit for repository work.
- Do not treat this as a replacement for canonical docs when a task needs deeper detail.

## Core Guidance

- Respect architectural boundaries: keep domain/application free of host, transport, UI, and infrastructure leakage.
- Prefer minimum-sufficient context: include only additional packs required for the current task.
- Avoid speculative abstraction, package proliferation, and folder/package duplication without concrete need.
- Use role-revealing names; avoid vague catch-all naming for files, folders, and symbols.
- Use shared operation identity helpers/patterns for contract operations (lowercase dotted names) to prevent ad hoc drift.
- Treat API and IPC contracts as specializations of shared transport contracts, not parallel response/error systems.
- Use best practices in code commenting in all code files.
- Keep IPC channels operation-derived (`ipc.<operation>.<kind>`) via shared helpers.
- Update canonical docs in the same change when documented behavior/architecture/standards change.
- Use structured, meaningful logs with configurable verbosity and stage-level timing for long operations.
- Keep runtime diagnostics as a strict specialization of shared structured logging contracts (`runtime.*` events, mechanical mapping).
- Keep persistence and storage contract families mechanically distinct (record-aligned operations vs key-based artifact operations).
- Use ingestion/staged-artifact contracts for inbound-content semantics; treat upload flows as specialized intake paths rather than isolated file-operation worlds.
- Import contracts via family barrels (`modules/contracts/<family>`); avoid deep internal contract imports and flattened catch-all usage.
- For non-contract modules, avoid root `modules/contracts` imports; consume contracts from specific family barrels.
- Keep contract anti-drift tests explicit: family invariants in `modules/contracts/<family>/tests` and cross-family invariants in `modules/contracts/tests`.
- Keep application orchestration on explicit port seams in `modules/application/ports/**`; do not bypass ports by coupling application code directly to adapters.
- Keep application ports thin and role-revealing, with family seam tests in `modules/application/ports/<family>/tests` and minimal cross-family seam checks in `modules/application/ports/tests`.
- Add regression tests for meaningful bug fixes when practical; prioritize behavioral value and deterministic tests.

## Key Constraints

- This pack is a routing baseline, not a second source of truth.
- Canonical rules remain in ADR, architecture, and standards docs.
- This pack is never sufficient by itself for architecture-, standards-, structure-, or boundary-changing work.
- If pack summaries conflict with ADRs/architecture/standards docs, canonical docs win.
- Prompt builders must add only targeted companion packs (not all packs by default).

## Canonical Source Docs

Only use these when needed. Do not overload the context window with uncessary information.

- `docs/adr/README.md` — ADR workflow and decision-record discipline.
- `docs/architecture/module-dependency-rules.md` — boundary and dependency direction constraints.
- `docs/architecture/system-overview.md` — repository shape and packaging restraint posture.
- `docs/standards/coding-standards.md` — implementation discipline and abstraction restraint.
- `docs/standards/naming-standards.md` — role-revealing naming requirements.
- `docs/standards/documentation-standards.md` — canonical documentation responsibilities and update rules.
- `docs/standards/logging-standards.md` — structured logging, verbosity, and diagnostics expectations.
- `docs/standards/testing-standards.md` — behavior-focused testing expectations and regression policy.

## Common Over-Inclusions to Avoid

- Loading every architecture/standards doc for routine, narrow tasks.
- Including host-specific packs for non-host work.
- Copying full canonical docs into prompt payloads.

## Prompt Assembly Notes

- Always include this pack first.
- Add only the smallest set of specialized packs required by the task.
- When a task affects canonical rules or boundaries, read and update the relevant canonical docs directly.
- Typical order: `index` → task-specific pack(s) → targeted canonical doc links when needed.
- For desktop renderer/main/preload implementation work, pair `desktop-host` with `desktop-implementation` instead of broad unrelated packs.
- For debugging/error-fix prompts, pair this baseline with `debugging-error-handling` first, then add boundary-specific packs (`runtime`, `desktop-host`, `server-host`, `desktop-implementation`) as needed.
- For desktop renderer styling tasks, pair `desktop-implementation` with `desktop-styling` and include only style-relevant canonical docs.
