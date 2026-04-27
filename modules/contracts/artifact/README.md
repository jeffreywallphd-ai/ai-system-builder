# Artifact Contracts

Artifact contracts define boundary-safe metadata for stored and flowing ELT-side data objects.

Use this family for artifact-level semantics that sit above storage operations:

- lifecycle/derivation kind (`raw-staged`, `transformed`, `materialized`)
- typed artifact references shared across transform and dataset families
- format/media metadata
- provenance links to ingestion source, parent artifacts, and transforms
- normalized artifact descriptors keyed by storage artifact key

This family complements (and does not replace) storage operation contracts.
