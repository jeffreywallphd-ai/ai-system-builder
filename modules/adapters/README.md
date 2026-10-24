> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Effective projection records, snapshots, commands, references and provenance are
explicitly reconstructed with the shared bounded passive DTO schemas. Declared
labels/metadata, canonical timestamps, revision identities and finite graph-summary
counts/actual boolean flags are validated. Projected metadata retains safe nested
arrays, false/zero/null and existing field rules with bounded recursion; credential
representations, paths, accessors, cycles and unknown payload fields deny.
Diagnostic messages remain generic. Snapshot identity is required for snapshots.
The fixed local projection/snapshot collections validate on read, before writes,
and before/after mutation callbacks. Invalid stored records deny without rewriting
bytes or invoking a mutation callback. This does not grant source authority, add
transport admission, enable uncomposed runtime families or satisfy controlled
qualification. Rollback must preserve the stronger record denial.

Image resource views use the private organization/workspace identity port backed by
structured persistence. Public image/output/artifact/cursor aliases are random and
persisted; exact source reauthorization is required on every detail read. Reserved
CAS publication is private until both indexes agree and the source revision commits.
Unassigned/legacy JSON storage and old source-derived references never trigger a
compatibility identity fallback. See ADR-0043 and the asset/package threat model.

Asset definition repositories optionally support bounded atomic batch registration
with aligned expected original bodies. Validate/capture before awaits, bind owner
context, and recheck every expectation inside each retryable collection mutation.
Never turn this optimization into an unguarded bulk overwrite or schema migration.

The in-memory structured-document adapter serializes root operations and
organization views through one FIFO queue. A callback uses only its supplied
transaction store; nested calls reuse that owner without creating a savepoint.
Foreign, expired and captured-root calls deny. Queued writes capture nested
values, revision conditions and timestamps before waiting, and returned records
are detached from stored state.
