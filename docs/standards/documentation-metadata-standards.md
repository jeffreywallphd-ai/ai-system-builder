# Documentation Metadata Standards

- Status: accepted
- Verification: `npm run docs:check`

## Purpose

Metadata must help a contributor decide whether a document is authoritative and how its claims are verified. It must not become a second inventory that duplicates titles, paths, or implementation detail.

## Required Metadata

Every substantive canonical architecture or standards document, excluding directory README files and templates, must place these fields immediately after its top-level title:

- `Status`: the document's authority state.
- `Verification`: a repository-relative evidence path or command.

Architecture documents must also include:

- `Related decisions`: one or more ADR paths, or `none` when the document only maps accepted repository behavior and no ADR governs it.

ADRs use `docs/adr/template.md`; their required decision metadata remains `Status`, with `Date`, `Deciders`, and `Related` recorded when known. Do not invent missing historical values during mechanical cleanup.

## Status Values

| Document type | Allowed values | Meaning |
| --- | --- | --- |
| Architecture | `current`, `proposed`, `superseded`, `deprecated` | Whether the system-shape guidance is current authority. |
| Standard | `accepted`, `proposed`, `superseded`, `deprecated` | Whether the working rule is mandatory. |
| ADR | `proposed`, `accepted`, `superseded`, `deprecated` | Decision lifecycle defined by `docs/adr/README.md`. |
| Current-state register | `current` | The register is an active routing aid, not an architectural decision. |

Use lowercase values so automation and readers do not need to interpret formatting variants.

## Verification Values

Verification may name:

- an exact test or test family,
- a checked verification map,
- a repository command,
- `manual: <specific procedure>` only when automation is not practical.

Do not claim complete enforcement when tests cover only examples. The architecture verification map uses three coverage levels:

- `direct`: a check explicitly owns the stated invariant,
- `representative`: tests cover important instances but not every possible occurrence,
- `gap`: no automated fitness function currently owns the invariant.

## Optional Metadata

- `Last reviewed: YYYY-MM-DD` may be added only after a person or agent compares the full document with implementation and tests during that change.
- `Owner` may be added only when it identifies a real, maintained repository role. Prefer a valid `.github/CODEOWNERS` rule over free-form names.

Do not auto-refresh review dates, infer owners from Git history, or use an agent run date as evidence of content review.

## Maintenance Rules

- Change metadata in the same change that alters document authority or verification.
- A successor ADR must update affected architecture metadata and the decision-readiness register.
- A renamed or removed check must update every verification pointer that names it.
- Context packs may summarize metadata but do not need to repeat it; they link canonical sources.
- Metadata validation belongs in `npm run docs:check` and CI.
