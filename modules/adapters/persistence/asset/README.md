# Local Asset Kernel persistence

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Definition queries apply scalar and multi-value type/family predicates before
sorting and bounded paging. Alternatives within a field use OR; separate fields
use AND. Existing scalar queries stay compatible. The facade still applies final
visibility/compatibility checks, consumes no more raw definitions than output
capacity and preserves continuations through sparse filtered pages.

Organization scope comes from the host-owned structured document store. Query
filters never grant workspace or organization membership. Definition identity,
bounded exact reads, passive DTO validation and compare-and-swap registration
remain unchanged. See `docs/architecture/asset-kernel.md`.
