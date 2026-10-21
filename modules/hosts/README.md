> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.


The shared workspace-summary composition uses repository-owned scalar/identity
projections with explicit workspace and group authority. Both hosts bind it to
organization-scoped stores. Desktop uses independent model metadata readers and
local artifact metadata/storage checks; summary reads do not start model runtimes
or the Asset Studio coding model. Missing host authority stays unavailable.

Composition plan use cases and read models require the shared workspace asset
guard in both hosts. It resolves the exact persisted active workspace and applies
the existing organization/membership authorizer before protected I/O; missing
authority denies. Validation writes state and requires asset write authority.

Runtime lifecycle callbacks bind the accepting organization context. Both hosts
close task admission before worker shutdown and reconcile owned resources before
persistence closure. Image task authority outlives disposable feature UI and
requires persisted workspace authorization; a cache key grants no ownership.

Desktop image, dataset and Context controllers are lazy retained. Generic cleanup
cannot discard their pending reviews or finalization receipts; it does not query
unscoped public task listings. Other disposable providers serialize replacement
with cleanup and retain the existing owner on uncertainty. Heavy processes keep
their explicit stop/unload policies.
