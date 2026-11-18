# Dataset Version Ports

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

- `DatasetVersionRepositoryPort` stores immutable complete versions and
  append-only successful publication evidence in an organization-scoped
  structured repository.
- `DatasetVersionHasherPort` supplies exact SHA-256 identities without coupling
  application services to one cryptography runtime.
- `DatasetVersionCommitAdmission` is an internal, exact actor/workspace admission
  for an approved local save. Its adapter commits immutable version metadata and
  the causal approval receipt together. File IO stays outside the transaction.
  An unconfirmed commit preserves artifacts; it grants no retry or adoption.
- `DatasetVersionPublisherPort` publishes one already-finalized version as a
  bounded multi-file provider commit and returns its immutable revision. It
  receives no credentials; provider adapters resolve credentials at their own
  boundary.

Publication commands remain application-owned. They must authorize the exact
workspace operation, verify every local artifact digest, default the UI choice
to private, require explicit confirmation, and record evidence only after the
provider returns an immutable commit identifier.
