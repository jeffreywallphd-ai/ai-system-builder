# Documentation Map

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

This directory separates canonical system guidance from downstream task context and operational support material.

## Canonical Areas

- `docs/adr/`
  - Architecture Decision Records (ADRs): major architectural decisions and rationale.
- `docs/architecture/`
  - Current intended system structure, module boundaries, and operating model.
  - `docs/architecture/user-library-and-cross-workspace-reuse.md` defines User Library reuse, explicit promote/link/copy/import relationships, provenance, and propagation constraints.
  - `docs/architecture/asset-authoring-customization-and-overrides.md` defines workspace-scoped asset authoring, customization, and override architecture.
- `docs/asset-package-authoring-guide.md`
  - User and contributor instructions for creating, inspecting, and safely
    admitting bounded `.aisb-package` files from the downloadable starter.
- `docs/standards/`
  - Canonical implementation and documentation rules.
  - `docs/standards/security-by-design-standards.md` requires a security impact disposition for every change and proportional threat, control, rollback, and evidence review for security-relevant work.
  - `docs/standards/dependency-supply-chain-standards.md` defines lockfile,
    advisory, SBOM, and workflow-integrity requirements.
- `docs/context/`
  - Downstream context-assembly support for implementation work; it summarizes canonical sources but does not replace them.

## Supporting Areas

- `docs/security/`
  - Canonical threat models plus security-oriented operational checks and manual verification guidance.
- `docs/diagnostics/`
  - Focused diagnostic and regression-check procedures.
  - `contributor-helper-loops.md` documents the configurable, bounded helper
    loops under `dev-tools/helpers/`.
  - `implementation-roadmap-skill.md` documents the cross-agent repository
    skill, durable roadmap/report artifacts, installation, and maintenance.
- `docs/tmp/`
  - Ignored local-only implementation report summaries. Roadmap state keeps the
    complete evidence history; generated reports are removed after explicit
    final approval and must never be committed.
- `docs/operations/`
  - Persistence operations, schema compatibility, recovery, rollout, and
    deployment qualification procedures.
- `docs/docs-mismatch-register.md`
  - Visible record of unresolved conflicts between code and documentation.
- `docs/deployment-readiness-implementation-roadmap.md`
  - Supporting delivery plan for database migration and multi-shape operational
    readiness; canonical decisions remain in ADRs and architecture docs.
- `docs/asset-system-composition-implementation-roadmap.md`
  - Supporting delivery plan for executable assets, Catalog and Studio
    workflows, System Builder composition, functional system defaults, system
    builds/releases, and multi-shape execution; successor decisions are required
    before crossing currently deferred import or execution boundaries.
- `docs/system-builder-slot-composer-implementation-roadmap.md`
  - Successor delivery plan for canonical named slots and ordered placements,
    predefined interactive layouts, the shared visual Compose experience,
    immutable legacy upgrades, build adoption, and controlled qualification.
- `docs/security-vulnerability-remediation-implementation-roadmap.md`
  - Severity-ordered delivery plan for closing the audited API, authorization,
    storage, network, runtime, IPC, diagnostic, and development-host security
    boundaries without removing supported workflows.
- `docs/security-vulnerability-remediation-finding-register.md`
  - Permanent issue-level traceability for the 78 supplied findings, including
    baseline state, owning increment, required control, and closure evidence.
- `docs/context/templates/`
  - Templates for durable epic, feature, and story context artifacts.

## Start by Task

- Any repository task: read the root `AGENTS.md`, then `docs/context/packs/index.pack.md`, and record the mandatory security impact disposition from `docs/standards/security-by-design-standards.md`.
- Implementation roadmap preparation, review, execution, continuation, or
  resumption: use `skills/manage-implementation-roadmaps/SKILL.md`. Invoke it
  from intent even without the exact skill name; a request such as "use a skill
  if available to create an implementation roadmap" is sufficient.
- Narrow implementation task: use `docs/context/prompt-routing.md` to add only materially relevant packs.
- Architecture or dependency change: read `docs/architecture/system-overview.md`, `docs/architecture/module-dependency-rules.md`, and related ADRs.
- Persistence or deployment work: read `docs/architecture/persistence-and-storage.md`, `docs/architecture/host-model.md`, ADR-0003, and ADR-0004.
- Database deployment implementation: also read ADR-0025 and the supporting
  `docs/deployment-readiness-implementation-roadmap.md`.
- End-to-end asset and system composition delivery: use
  `docs/asset-system-composition-implementation-roadmap.md`, then load the one
  owning Asset/System context pack for the increment being implemented.
- Slot-based System Builder composition, predefined interactive layouts, or
  migration from flat Compose revisions: use
  `docs/system-builder-slot-composer-implementation-roadmap.md` and the System
  Builder context pack.
- Organization tenancy, managed identity, or deployment placement: read
  ADR-0029 and `docs/architecture/organization-tenancy-and-identity.md`.
- Database operation or release qualification: use
  `docs/operations/persistence-operations.md` and
  `docs/operations/deployment-qualification.md`.
- Asset/system release support, compatibility, performance, security,
  accessibility, revocation, or recovery qualification: use
  `docs/operations/asset-system-support-qualification.md`; for controlled Assets
  UI security/accessibility evidence, use `docs/operations/asset-experience-controlled-review.md`.
- Documentation work: read `docs/standards/documentation-standards.md` and use the canonical templates listed there.
- Automated or repository-scale implementation: read `docs/standards/ai-agent-development-standards.md`, apply `docs/standards/change-impact-matrix.md`, and check `docs/adr/decision-readiness.md`.
- Architecture verification: use `docs/architecture/architecture-verification.md` to distinguish direct fitness functions from representative coverage and known gaps.
- Agent-support evaluation: use `docs/context/pack-catalog.json`, `dev-tools/agent-evals/scenarios.json`, and `docs/standards/agent-support-evaluation-standards.md`.
- Security-relevant work: add `docs/context/packs/security.pack.md`, read ADR-0015 and the applicable canonical security/threat-model sources, and include denial/failure-path evidence. The universal impact screen applies even when the user did not label the task as security work.
- Security vulnerability remediation from the supplied audit: use
  `docs/security-vulnerability-remediation-implementation-roadmap.md` and keep
  every row current in `docs/security-vulnerability-remediation-finding-register.md`.

If context guidance conflicts with an ADR, architecture document, or standard, the canonical source takes precedence and the conflict must be corrected or recorded.

## Current Architecture Pointers

- Data ingestion and training-dataset preparation: docs/architecture/data-management.md, docs/architecture/runtime-model.md, and docs/security/data-management-threat-model.md.
- Workspace model: `docs/architecture/workspace-model.md`, including reference-only `system.foundation@1.0.0` activation and the no-hidden-workspace/no-auto-migration rule.
- Organization tenancy and identity: `docs/architecture/organization-tenancy-and-identity.md`; pooled placement is the managed default and dedicated one-organization placement is the premium profile.
- User Library reuse: `docs/architecture/user-library-and-cross-workspace-reuse.md` and ADR-0017.
- Asset authoring, customization, and overrides: `docs/architecture/asset-authoring-customization-and-overrides.md`, ADR-0018, and ADR-0035.
- Effective asset projections: `docs/architecture/effective-asset-projections.md` and ADR-0019.
- Asset composition planning: `docs/architecture/asset-composition-planning.md` and ADR-0020.
- Asset implementations, packages, trust, and functional defaults: `docs/architecture/asset-implementations-and-packages.md` and ADR-0030, ADR-0031, and ADR-0034.
- Asset package creation and import: `docs/asset-package-authoring-guide.md`; use
  the Assets **Import Assets** tab to download the canonical starter.
- Asset authoring/execution security: `docs/architecture/asset-authoring-and-execution-security.md`, `docs/security/asset-package-authoring-and-execution-threat-model.md`, and ADR-0032.
- System Builder, Publish lifecycle, and advanced workflow boundary: `docs/architecture/system-builder.md`, `docs/architecture/system-build-and-release.md`, `docs/architecture/system-run-workflows.md`, ADR-0024, ADR-0033, and ADR-0038; Systems is workspace-scoped while builder-application status belongs to Settings / Software status.
- Runtime readiness binding: `docs/architecture/runtime-readiness-binding.md` and ADR-0021.
- Execution plan preparation: `docs/architecture/execution-plan-preparation.md` and ADR-0022.
- Controlled conversational execution and its dedicated runtime data plane: `docs/architecture/controlled-conversational-system-execution.md`, `docs/architecture/persistence-and-storage.md`, ADR-0023, ADR-0039, and `docs/security/system-runtime-data-plane-threat-model.md`.
- Cross-cutting secure design: `docs/standards/security-by-design-standards.md`, ADR-0015, and the boundary-specific threat models under `docs/security/`.

## Agent Context

- Start prompt assembly from `docs/context/packs/index.pack.md`.
- Use `docs/context/prompt-routing.md` to choose only additional packs that are materially relevant.
- Include `docs/context/packs/persistence-storage.pack.md` for DB-vs-file/blob boundary work.

## Execution Context References

- Execution plan preparation pack: `docs/context/packs/execution-plan-preparation.pack.md`.
- Controlled conversational execution pack: `docs/context/packs/controlled-conversational-system-execution.pack.md`.
- Execution requires explicit approval plus supported runtime invocation boundaries.

## Verification

- During roadmap execution, run focused tests for each internal chunk and only
  change-relevant tests after an increment. Once every increment is implemented,
  run `npm run test:standardande2e` for non-AI work or `npm run test:all` for
  AI-related work.
- Run `npm run docs:check` after documentation or context changes.
- Run `npm run agent-support:check` after agent guidance, context routing, skill, or evaluation changes.
- Run `npm run security:dependencies` when dependency, lockfile, workflow, container, SBOM, or release dependency inputs change.
- Run `npm test` for the standard unit and interaction suite.
- Run `npm run test:e2e` for integration and end-to-end coverage.
- Run `npm run test:ai` only for AI-related work or an explicit request.
- Run `npm run test:standardande2e` for combined non-AI completion coverage.
- Run `npm run test:all` for combined standard, end-to-end, and AI coverage
  only when the work is AI-related or the user explicitly requests it.
- Continuous integration enforces both gates for pull requests and changes to the default branch.
