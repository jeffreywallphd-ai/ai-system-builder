# Contracts

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

This module contains shared boundary contracts used across application, hosts,
and adapters.

Current contract families include:

- `shared` result/error backbone
- `transport` plus `api` and `ipc` specializations
- `artifact-browser` read-side operation and read-model contracts
- `runtime`, `persistence`, `storage`, and `ingestion`
- `system-builder` for workspace-owned composed-system design records that specialize Asset Kernel compositions
- `asset-authoring` for safe authored records plus exact-base layered
  customizations, typed semantic sections, bounded source overlays, review
  evidence, and distinct publication lineage
- `asset-implementation` for drafts, releases, facets, bindings, and immutable
  implementation backing-resource bundles kept outside Asset Kernel metadata
- `asset-package` for the bounded package lifecycle contract and deterministic,
  inspector-valid, non-executing `.aisb-package` starter
- `artifact`, `transform`, `lineage`, and `dataset` for ELT-style data flow
- `host` context metadata
- `logging` vocabulary
- `config` typed configuration concerns

## Terminology Guardrails

- Use **asset** terminology for composable system parts and built-system units.
- Use **System Builder** and **composed system** for workspace-owned system construction; use **software status**, **host status**, or **runtime status** for operational builder-application state.
- Use **artifact** terminology for ELT-side stored/flowing data objects.
- Use **ingestion** for the intake semantic layer.
- Use **staged artifact** for inbound content that has entered ingestion/staging.
- Do not use **staged-data** terminology as a contract or architecture term.

## Public Surface Discipline

- Import contracts from family barrels (`modules/contracts/<family>`), not deep
  internal files.
- The root contracts entry (`modules/contracts`) exposes family namespaces only
  so boundaries stay explicit instead of flattened.
