# Contracts

This module contains shared boundary contracts used across application, hosts,
and adapters.

Current contract families include:

- `shared` result/error backbone
- `transport` plus `api` and `ipc` specializations
- `artifact-browser` read-side operation and read-model contracts
- `runtime`, `persistence`, `storage`, and `ingestion`
- `artifact`, `transform`, `lineage`, and `dataset` for ELT-style data flow
- `host` context metadata
- `logging` vocabulary
- `config` typed configuration concerns

## Terminology Guardrails

- Use **asset** terminology for composable system parts and built-system units.
- Use **artifact** terminology for ELT-side stored/flowing data objects.
- Use **ingestion** for the intake semantic layer.
- Use **staged artifact** for inbound content that has entered ingestion/staging.
- Do not use **staged-data** terminology as a contract or architecture term.

## Public Surface Discipline

- Import contracts from family barrels (`modules/contracts/<family>`), not deep
  internal files.
- The root contracts entry (`modules/contracts`) exposes family namespaces only
  so boundaries stay explicit instead of flattened.
