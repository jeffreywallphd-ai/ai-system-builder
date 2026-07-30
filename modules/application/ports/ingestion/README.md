# Ingestion Ports

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

- `WebsiteHtmlAcquisitionPort` keeps HTTP or rendered acquisition behind the
  secure-egress adapter boundary.
- `IngestionAcquisitionRepositoryPort` stores bounded workspace-scoped task
  state, immutable source snapshots, and append-only refresh outcomes. It
  atomically commits a finalized task with its matching snapshot and a changed
  refresh with its new snapshot.
- `IngestionCheckpointStoragePort` accepts only ordered, digest-verified,
  bounded chunks and streams them back without joining a whole file in memory.
- `GovernedWebsiteCapturePort` resolves only explicit pages or one bounded
  sitemap and returns robots evidence, canonical URLs, immutable raw bytes,
  separate derived text, validators, and honest removed/unchanged outcomes.

Checkpoint bytes and credentials never belong in the structured repository.
Task state contains only opaque checkpoint identities, authoritative counters,
bounded sanitized errors, and immutable artifact references.
New local-file tasks record a 24-hour checkpoint deadline. Host maintenance can
cancel and deterministically clean expired unfinished tasks; immutable completed
artifacts and source snapshots are never subject to this checkpoint cleanup.
