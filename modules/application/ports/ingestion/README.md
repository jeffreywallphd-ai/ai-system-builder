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
Private `IngestionFilePublicationPort` and repository records bind a local-file
task to one opaque candidate. `IngestionFileByteStoragePort` inspects bounded
checkpoint content before reservation and validates an exclusive stream before
target publication. These ports are never transport descriptors. Only an
acknowledged writing CAS permits bytes; uncertain writing cannot be adopted or
retried. After durable byte acknowledgement, one successfully acknowledged
origin-issued CAS permits one metadata attempt. Recovery reads exact complete
origin only; missing, partial or deleted metadata is never recreated. The
task/snapshot transaction then commits the private receipt. Completed retries
verify existing origin and receipt without creating either.
Task state contains only opaque checkpoint identities, authoritative counters,
bounded sanitized errors, and immutable artifact references.
New local-file tasks record a 24-hour checkpoint deadline. Host maintenance can
cancel and deterministically clean expired unfinished tasks; immutable completed
artifacts and source snapshots are never subject to this checkpoint cleanup.

The fixed `governed-ingestion-streaming.integration.test.ts` fixture exercises
the production use cases, SQLite records and filesystem adapters with serial
8 MiB and 64 MiB synthetic JSON Lines sources. It reuses one 1 MiB producer
chunk and hashes the complete saved output through 64 KiB reads. It checks exact
monotonic progress, duplicate-chunk retry, immutable finalization after closing
and reopening SQLite, wrong-digest recovery and partial cancellation cleanup.
Every case closes its database and removes only its new temporary root.

The fixture records observed test-process peak RSS and workflow time, with a
prospective 1 GiB RSS assertion and 120-second case deadlines. These are local
test observations, not enforced product memory admission or proof for maximum
4 GiB inputs, mounted UI, provider/website transfer, hostile native filesystem
races or a complete Data roadmap criterion. The source-owned
`ingestion-publication` profile runs this model-free fixture alongside its
existing checks. It does not download a model or rerun accepted accuracy tests.
