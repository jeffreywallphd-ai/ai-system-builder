# Context Pack: Index (Baseline)

- Pack name: `index`

## Purpose

- Provide the always-included baseline context for repository work.
- Establish minimum-sufficient context assembly and repository-wide guardrails.

## Use When

- Include this pack first for every automated prompt and implementation task.
- Add narrower packs only when the task materially involves their concern.

## Do Not Use When

- Never omit it for repository work.
- Do not treat it as a replacement for canonical ADRs, architecture docs, or standards.

## Core Guidance

- Preserve clean architecture boundaries: domain/application stay free of host, transport, UI, runtime, filesystem, and infrastructure leakage.
- Prefer the smallest useful context set. Do not include packs or canonical docs "just in case."
- Apply the mandatory security impact screen in `docs/standards/security-by-design-standards.md` to every task. Record `not-security-relevant` with a concrete rationale or route `security-relevant` work to the security pack and applicable canonical threat-model sources.
- Keep contracts and transports aligned through shared operation identity helpers and family barrels.
- Keep application orchestration behind explicit ports in `modules/application/ports/**`.
- Use role-revealing names and avoid vague catch-all files, packages, or symbols.
- Update canonical docs in the same change when behavior, architecture, standards, or boundaries change.
- Add regression tests for meaningful bug fixes when practical; prioritize deterministic behavioral coverage.
- Use structured logs with safe diagnostics for long-running or failure-prone operations.
- Treat workspace context as explicit request/host/UI context, not global mutable state or display-name-derived identity.
- Treat the Asset Kernel as the canonical vocabulary for composable assets; do not invent parallel asset/resource/workflow/UI/generated-output models.

## Current Architecture Routing Notes

- Workspace-owned operations must carry explicit workspace context through contracts, clients, transports, use cases, ports, providers, and persistence.
- System Foundation is system-owned and made available to a workspace through a `system.foundation@1.0.0` activation reference.
- Resource-backed Asset Registry views are computed, sanitized, descriptor-only, and read-only unless an explicit controlled mutation workflow is in scope.
- Systems is the workspace-scoped System Builder area for composed systems; builder-application and runtime status belongs to Settings / Software status.
- Executable implementations, package bytes, build evidence, and system releases are separate from Asset Kernel semantic records; route implementation/package work through ADR-0030 through ADR-0034.
- Imported/authored code never runs in product, Electron main/preload, API server, or database processes; require the accepted sandbox and capability-broker boundary.
- Runtime readiness is host-owned capability availability; it does not start/install/repair runtimes during read operations.
- Data Management uses the staged-artifact model and a shared capability
  registry to produce bounded, role-tagged training-dataset outputs. Route
  ingestion/preparation work through `data-management.pack.md`.
- Security is a universal design constraint and layered, adapter-based implementation concern. Use ADR-0015 and `security.pack.md` whenever the impact screen identifies a changed trust, authority, data, execution, diagnostic, or supply-chain boundary, even if the task was not labeled security work.
- Historical implementation details belong in issues, PRs, or release notes, not in this reusable baseline.

## Key Constraints

- This pack is a routing baseline, not a second source of truth.
- Canonical docs win if this pack conflicts with ADRs, architecture docs, or standards.
- This pack is never sufficient by itself for architecture-, standards-, structure-, or boundary-changing work.
- The security impact screen is baseline context; loading the full security pack is proportional and required only for `security-relevant` work.
- Context packs should stay under 200 lines; split or summarize packs before they become implementation-history logs.

## Canonical Source Docs

Use only the docs needed for the current task:

- `docs/adr/README.md` - ADR workflow and decision-record discipline.
- `docs/architecture/module-dependency-rules.md` - dependency direction and boundary constraints.
- `docs/architecture/system-overview.md` - repository shape and packaging posture.
- `docs/architecture/asset-kernel.md` - canonical Asset Kernel terminology and boundaries.
- `docs/architecture/asset-implementations-and-packages.md` - implementation releases, package trust, compatibility, and functional defaults.
- `docs/architecture/asset-authoring-and-execution-security.md` - coding-model and sandbox/capability boundaries.
- `docs/architecture/system-builder.md` - composed-system records, vocabulary, and product-area placement.
- `docs/architecture/system-build-and-release.md` - revision, build, release, policy, and workflow boundaries.
- `docs/architecture/workspace-model.md` - workspace identity, selection, scoping, and activation semantics.
- `docs/architecture/persistence-and-storage.md` - persistence/storage separation and artifact storage rules.
- `docs/architecture/runtime-model.md` - runtime ownership, capability, and execution model.
- `docs/architecture/data-management.md` - source capability, staging,
  preparation, split-integrity, and result boundaries.
- `docs/architecture/host-model.md` - host composition and transport placement.
- `docs/standards/coding-standards.md` - implementation discipline and abstraction restraint.
- `docs/standards/naming-standards.md` - role-revealing naming requirements.
- `docs/standards/documentation-standards.md` - canonical documentation update rules.
- `docs/standards/logging-standards.md` - structured logging and safe diagnostics.
- `docs/standards/testing-standards.md` - testing expectations and regression policy.
- `docs/standards/security-by-design-standards.md` - universal impact screen, proportional threat review, secure rollback, and evidence requirements.
- `docs/adr/ADR-0015-security-architecture-and-policy-boundaries.md` - accepted layered security architecture and policy boundaries.

## Common Over-Inclusions to Avoid

- Loading every architecture or standards doc for narrow tasks.
- Including both desktop and server packs when the task only touches one host.
- Copying canonical docs into prompt payloads.
- Keeping milestone-by-milestone implementation history in this baseline pack.

## Prompt Assembly Notes

- Always include this pack first.
- Record the security impact disposition before editing and revisit it when scope reveals another boundary.
- Use `docs/context/pack-catalog.json` and `docs/context/prompt-routing.md` to choose companion packs.
- Typical order: `index` -> one primary pack -> at most one evidenced adjacent pack -> targeted canonical docs.
- For debugging, add `debugging-error-handling` first, then the affected host/runtime/storage/UI pack.
- For Asset Kernel, workspace, user-library, authoring, projection, composition, readiness, execution-plan, or conversational-execution work, select the owning pack and only the immediate neighbor proven relevant by repository inspection.
- For work spanning projection, composition, readiness, planning, and execution, retrieve and validate one boundary at a time instead of preloading the entire chain.

Frequently adjacent late-stage planning packs remain explicitly discoverable here while the catalog
stays authoritative for the complete inventory:

- `docs/context/packs/runtime-readiness-binding.pack.md`
- `docs/context/packs/execution-plan-preparation.pack.md`
- `docs/context/packs/controlled-conversational-system-execution.pack.md`
