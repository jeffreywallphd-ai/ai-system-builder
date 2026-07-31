# Dataset Contracts

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Dataset contracts define structured derived-output vocabulary for ELT progression.

This family includes:

- dataset references
- schema summary contracts for field-oriented dataset shape
- dataset materialization descriptors that point to artifact keys
- normalized dataset descriptors that reference source artifacts and transforms via typed references
- immutable dataset-version records that bind complete outputs, source lineage,
  preparation recipes, quality evidence, and documentation by exact SHA-256
  digest
- append-only evidence for successful external publication without mutating the
  dataset version

Dataset-version records contain metadata only. Dataset rows, recipe snapshots,
reports, cards, and Croissant documents remain in artifact storage. A record is
visible only after all of its referenced artifacts have been durably written and
validated; callers must never persist a partial version.
