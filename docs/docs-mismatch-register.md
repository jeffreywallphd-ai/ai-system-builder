# Documentation Mismatch Register

This file records documentation drift found during documentation reviews. It is a triage ledger, not a changelog and not a place to silently resolve policy questions.

Resolved findings are removed after the corresponding docs/code alignment has been implemented and verified.

## Scope

Use this register for:

- canonical docs that do not match corresponding code,
- canonical docs that conflict with other canonical docs,
- canonical docs that conflict with support docs,
- canonical docs that conflict with README files,
- context packs, treated as support docs in this review, that conflict with canonical docs, other context packs, or README files,
- repeated drift patterns that need a standards or template update.

Do not use this register for:

- implementation plans,
- phase diaries,
- review transcripts,
- resolved historical notes that no longer require a decision.

## Entry Template

```md
### DM-YYYYMMDD-###

- Status: open
- Severity: high | medium | low
- Drift type: canonical-vs-code | canonical-vs-canonical | canonical-vs-support-doc | canonical-vs-readme | support-vs-canonical | support-vs-support | support-vs-readme | documentation-shape
- Primary doc: `docs/path/to/source.md`
- Compared with: `path/to/code-or-doc.md`
- Summary: One sentence describing the mismatch.
- Evidence:
  - `docs/path/to/source.md`: concise statement of what the doc currently claims.
  - `path/to/code-or-doc.md`: concise statement of what the code or other doc currently does or claims.
- Expected decision: Identify which source should change, or what owner decision is needed.
- Notes: Optional implementation-neutral details for reviewers.
```

## Examples

### DM-EXAMPLE-001

- Status: example
- Severity: medium
- Drift type: canonical-vs-code
- Primary doc: `docs/architecture/example-feature.md`
- Compared with: `modules/application/use-cases/exampleUseCase.ts`
- Summary: The canonical doc says the use case rejects missing workspace ids, but the implementation accepts an omitted workspace id.
- Evidence:
  - `docs/architecture/example-feature.md`: states that workspace identity is required for every example operation.
  - `modules/application/use-cases/exampleUseCase.ts`: accepts requests without `workspaceId` and supplies a fallback.
- Expected decision: Decide whether the code should reject omitted workspace ids or the doc should describe the fallback.
- Notes: Do not update the doc or code from this register entry alone; owner confirmation is required.

### DM-EXAMPLE-002

- Status: example
- Severity: high
- Drift type: canonical-vs-canonical
- Primary doc: `docs/adr/ADR-9999-example.md`
- Compared with: `docs/architecture/example-boundary.md`
- Summary: The ADR assigns runtime startup to the host, while the architecture doc assigns it to the renderer.
- Evidence:
  - `docs/adr/ADR-9999-example.md`: says the host owns runtime startup and lifecycle.
  - `docs/architecture/example-boundary.md`: says renderer code starts the runtime directly.
- Expected decision: Confirm the owner of runtime startup and update the losing canonical source.
- Notes: Also check context packs after the canonical decision is made.

### DM-EXAMPLE-003

- Status: example
- Severity: low
- Drift type: support-vs-canonical
- Primary doc: `docs/context/packs/example.pack.md`
- Compared with: `docs/standards/example-standard.md`
- Summary: The context pack repeats an older rule that is stricter than the current standard.
- Evidence:
  - `docs/context/packs/example.pack.md`: says every adapter must provide a fixture.
  - `docs/standards/example-standard.md`: says fixtures are required only for adapters with persisted behavior.
- Expected decision: Update the context pack after confirming the standard is authoritative.
- Notes: This is a downstream summary drift, not a standards change.

## Findings

### DM-20260716-001

- Status: open
- Severity: medium
- Drift type: canonical-vs-code
- Primary doc: `docs/architecture/module-dependency-rules.md`
- Compared with: `modules/contracts/api/asset-registry-api-contract.ts`, `modules/contracts/ipc/desktop-asset-registry-contract.ts`
- Summary: Two transport contract files import Asset Registry read-model types owned by an application service instead of a contract family.
- Evidence:
  - `docs/architecture/module-dependency-rules.md`: contract modules must not depend on application code, and contract families are the stable cross-boundary language.
  - `modules/contracts/api/asset-registry-api-contract.ts`: imports `asset-registry-read-facade.types` from `modules/application/services/asset`.
  - `modules/contracts/ipc/desktop-asset-registry-contract.ts`: imports the same application-owned types.
- Expected decision: Relocate the transport-facing read-model types to the appropriate contract family, update application and transport consumers, then remove both exact exceptions from `dev-tools/config/architecture-boundaries.json`.
- Notes: `npm run architecture:check` permits only these two tracked source/target pairs and rejects new contract-to-application dependencies.

### DM-20260718-001

- Status: open
- Severity: high
- Drift type: canonical-vs-code
- Primary doc: `docs/asset-system-composition-implementation-roadmap.md`
- Compared with: `modules/ui/shared/system-builder/SystemBuilderWorkspace.tsx`, `modules/contracts/asset/asset-instance.ts`
- Summary: Increment 5 claims a hierarchical System Builder with schema-backed configuration, but Compose persists and edits a flat ordered list with the first item as root and raw JSON configuration.
- Evidence:
  - `docs/asset-system-composition-implementation-roadmap.md`: lines 725-730 and 756-765 require parent/child hierarchy, nested composition, and a schema-backed inspector, while lines 782-806 describe that work as implemented and verified.
  - `modules/ui/shared/system-builder/SystemBuilderWorkspace.tsx`: renders a flat ordered instance list, sets `rootInstanceRefs` from `instanceRefs.slice(0, 1)`, and exposes `selectedConfiguration` through one JSON textarea.
  - `modules/contracts/asset/asset-instance.ts`: records only `parentCompositionRef`, with no parent-instance, named-slot, or ordered-placement vocabulary.
- Expected decision: Implement the approved successor slot-composer roadmap, then reconcile the original roadmap evidence and affected architecture/context documents against verified behavior.
- Notes: `docs/system-builder-slot-composer-implementation-roadmap.md` tracks the approved architectural direction and must not be treated as implementation evidence until its increments pass.
