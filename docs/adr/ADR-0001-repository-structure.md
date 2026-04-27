# ADR-0001: Repository Structure

- Status: accepted
- Date: 2026-04-14
- Deciders: ai-system-builder maintainers
- Related: docs/adr/template.md

## Context

This repository is a fresh rebuild of `ai-system-builder` focused on reducing architectural sprawl and avoiding premature automation. The system must stay TypeScript-first, support Electron desktop and server host options, and remain straightforward for both humans and AI agents to navigate.

Key constraints:

- Node.js/TypeScript is the primary implementation center.
- Python support exists as an adapter capability, not a co-equal core.
- Desktop architecture should stay clean and host-aware.
- Server contracts are internal-first; Express is the default transport adapter.
- Postgres is the default database.
- Documentation, especially `docs/adr` and `docs/context`, must be authoritative and lightweight.

## Decision

Adopt a monorepo with clear boundaries between host applications, core modules, infrastructure adapters, and documentation.

Baseline structure:

```text
ai-system-builder/
+- apps/
  +- thin-client/
¦  +- server/
¦  +- web-thin-client/
+- modules/
¦  +- domain/
¦  +- application/
¦  +- contracts/
¦  +- adapters/
¦  ¦  +- persistence/
¦  ¦  +- runtime/
¦  ¦  +- transport/
¦  ¦  +- storage/
¦  ¦  +- observability/
¦  ¦  +- auth/
¦  +- hosts/
¦  ¦  +- desktop/
¦  ¦  +- server/
¦  +- ui/
¦  ¦  +- shared/
¦  ¦  +- desktop/
¦  ¦  +- web/
¦  +- testing/
+- docs/
¦  +- adr/
¦  +- architecture/
¦  +- context/
¦  +- templates/
¦  +- standards/
+- dev-tools/
+- config/
+- migrations/
+- root files...
```

This decision sets directory ownership only. It does not force early package publication or excessive internal abstractions.

## Consequences

### Positive

- Clear dependency boundaries for clean architecture.
- Host-specific composition remains explicit (`desktop`, `server`, hybrid-capable).
- TypeScript-first direction remains visible at the top level.
- Adapters for runtime/transport/storage are isolated from domain and application logic.
- Documentation-first governance is built into repository shape.

### Negative

- More top-level folders require discipline to prevent drift.
- Early contributors must learn the intended boundaries.

### Follow-up

- Add dependency and import rules in `docs/architecture/module-dependency-rules.md`.
- Keep `docs/context` packs small and task-oriented for AI-agent workflows.
- Revisit this ADR if host strategy or runtime balance changes materially.
