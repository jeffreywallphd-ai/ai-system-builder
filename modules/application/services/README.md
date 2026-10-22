> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Asset-pack semantic fingerprint helpers validate complete bounded passive input
before producing `sha256:semantic-v2` identities. They preserve authored semantics,
use explicit packaging/self-reference exclusions, and never use display redaction
as integrity input. Legacy hashes require explicit revalidation; immutable shipped
packs, package byte digests, trust and approvals are not automatically rewritten.
See `docs/architecture/asset-kernel.md` and accepted ADR-0043.

System seed/install reuse compares the complete passive stored definition with
expected content and operational enrichment. Matching legacy marker fingerprints
alone never establish already-current content. Preserve custom edits on denial;
explicit same-pack refresh remains a distinct caller-authorized operation.

Image resource views use the private organization/workspace identity port backed by
structured persistence. Public image/output/artifact/cursor aliases are random and
persisted; exact source reauthorization is required on every detail read. Reserved
CAS publication is private until both indexes agree and the source revision commits.
Unassigned/legacy JSON storage and old source-derived references never trigger a
compatibility identity fallback. See ADR-0043 and the asset/package threat model.

Foundation startup batches at most250 exact reads/validated registrations while
retaining complete stored-body checks, explicit refresh and expected-body CAS
conflict denial. Legacy/injected single registration stays supported. Foundation
startup errors keep a generic message with bounded allowlisted internal attribution.

Workspace registry detail reads use the same effective source membership as list
reads, including scoped authored/reuse records. A custom definition's metadata
alone never establishes membership; the global registry is not a fallback for a
missing workspace source.
