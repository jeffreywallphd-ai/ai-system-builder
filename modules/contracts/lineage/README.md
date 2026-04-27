# Lineage Contracts

Lineage contracts define lightweight graph-oriented vocabulary for describing how
sources, artifacts, transforms, datasets, and storage instances relate.

This family is contract-only (not a graph engine):

- lineage node kinds and normalized references
- lineage edge kinds and edge records
- lineage record container (`nodes`, `edges`) for viewer-ready inspection

Lineage stays generic while aligning with typed identity from artifact, transform,
and dataset families.
