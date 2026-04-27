# Context Pack: Repository Overview

- Pack name: `repository-overview`

## Purpose

- Provide fast orientation to repository layout, ownership boundaries, and practical folder semantics.

## Use When

- Starting implementation in unfamiliar areas.
- Planning file placement or refactors across modules/apps.
- Reviewing whether proposed structure matches repository intent.

## Do Not Use When

- Tasks already scoped to one known subsystem with clear local context.
- Deep runtime/host/standards decisions that need specialized packs.

## Core Guidance

- `apps/` are entry points and packaging/deployment surfaces (`desktop`, `server`, `thin-client`), not architecture centers.
- `modules/` contain core architecture: domain, application, contracts, adapters, hosts, ui, and testing support.
- `docs/` hold canonical architecture, ADRs, standards, and context routing aids.
- `dev-tools/` is for development tooling/scripts; `config/` for shared configuration surfaces; `migrations/` for schema/data migration assets.
- Practical module meanings:
  - `domain/`: business rules and invariants.
  - `application/`: use-case orchestration and policies.
  - `contracts/`: stable boundary shapes.
  - `adapters/`: concrete integrations (persistence/runtime/transport/storage/etc.).
  - `hosts/`: lifecycle/composition for desktop/server environments.
  - `ui/`: shared-first UI plus thin platform-specific layers.
  - `testing/`: shared testing helpers/patterns by boundary.
- Repository shape is intentionally restrained: not every folder should become a workspace/package.
- Prefer contract family barrels (`modules/contracts/<family>`) as import surfaces; avoid deep internal contract paths.
- For non-contract modules, do not import from root `modules/contracts`; use specific family barrels so extension boundaries stay explicit.
- Do not duplicate `src/`, `package.json`, and `tsconfig.json` across folders without clear build/isolation justification.

## Key Constraints

- Preserve architectural boundaries first; package boundaries follow demonstrated need.
- Use this pack for orientation, not as sole authority for repository-structure changes.
- Structural changes must also consult `docs/adr/ADR-0001-repository-structure.md` and `docs/architecture/module-dependency-rules.md`.
- Avoid folder growth that hides ownership (for example catch-all `common`/`misc` buckets).

## Canonical Source Docs

- `docs/adr/ADR-0001-repository-structure.md` — baseline monorepo structure and intent.
- `docs/architecture/system-overview.md` — practical layer roles and repository shape.
- `docs/architecture/module-dependency-rules.md` — dependency direction and ownership boundaries.
- `docs/standards/naming-standards.md` — folder/file naming discipline.

## Common Over-Inclusions to Avoid

- Pulling full host/runtime details for simple repository orientation.
- Treating this pack as a substitute for dependency rules in architecture-sensitive tasks.
- Assuming every top-level folder implies package publication boundaries.

## Prompt Assembly Notes

- Start with `index` + this pack for most implementation prompts.
- Add `architecture`, `runtime`, `desktop-host`, `server-host`, `logging`, or `testing` only when task scope requires them.
