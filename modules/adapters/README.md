> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

The Model source inspector accepts optional trusted currentness/policy controls
from a delegated owner. It captures callbacks before awaits, requires literal
true currentness/permission before dependency/credential access and each provider
request, and rechecks currentness through response consumption. Callers can only
narrow its existing20second duration. Headless preview uses4seconds inside the
existing5second Desktop/SDK and12second Managed route guards. Its API/SDK result
codecs correlate exact target and recompute the metadata digest; no new download
or model effect is admitted. A timed-out dependency still retains its one slot.

The configured Hugging Face Model adapter has a private source inspector. It
reuses the lazy official SDK and existing credential supplier, and requests only
bounded metadata for a captured exact repository/revision. Same-origin endpoint
and pagination checks precede credential-bearing fetch; redirects refuse.
One active attempt, five requests,256 rows,512KiB per response,2MiB total metadata and20seconds bound
each attempt. At most64 selected safe-format files fit the existing20GiB default;
unsafe/alternate files remain excluded. Recorded SHA256/Git-blob-SHA1 metadata
does not prove local bytes, license rights or runtime readiness. No model, task,
runtime or filesystem operation occurs. Ordinary browse/details remain separate;
lazy import failure diagnostics now omit raw exception text.
Timed-out dependencies retain their one slot until they settle; abort fences
late I/O, and a replacement cannot overlap their unresolved work.

Model inventory pages use the existing normalized list request and capture its
workspace, filters, tags, limits and discovery flags before awaiting I/O. The
returned cursor names the first omitted record; the next page includes it.
Continue with the same workspace and filters. An unknown, removed, foreign or
ambiguous cursor fails with a fixed message; restart from the first page.
Each request reads the current inventory, not a snapshot across requests.
Recorded-only queries retain both discovery flags as false and do not start a
runtime. Pagination does not rewrite model records or qualify Headless downloads.

In-memory structured stores and SQLite connection wrappers serialize operations
under an adapter-owned asynchronous transaction context. Ordinary reads/writes
cannot join a foreign transaction; callback stores expire on exit. Typed repository
callbacks use their supplied transaction store and copy caller values before any
queue wait. This preserves record isolation; it grants no filesystem or publication
authority and does not qualify a managed PostgreSQL deployment.
An unconfirmed SQLite rollback fences that connection, including queued requests,
while preserving the original callback error; it has no automatic reset.

Generated-model storage never recursively replaces an existing snapshot. Observed
targets or unknown filesystem status deny; fresh output uses exclusive staging,
root/child-link checks and cooperative staging identity checks. These checks do
not provide native parent/race protection or protected ownership. Shared caches
remain reference-only for physical deletion under ADR-0043.

The shared package inspector validates/captures semantics before canonical
hashing and verifies semantic-v2 claims. Valid-body identity failures remain
quarantinable and ineligible; malformed/deep declarations return static errors.
Package byte identity, evidence exclusions and independent trust gates retain
their meaning. This does not qualify all nonsemantic resource bounds.

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

The private model-local Windows file-identity adapter and native source are an
uncomposed read-only prerequisite. Fixed local building and real disposable
fixtures are described in `dev-tools/README.md`; boundaries and pending production
authority are in `docs/architecture/runtime-model.md`. Keep it out of the public
model barrel and host composition until protected ownership/publication and
destructive-effect qualification exist. Read-only facts never authorize deletion,
reveal, adoption of shared caches or recovery of an unknown offload slot.

`persistence/asset-publication` binds an exact organization/workspace review to its
definition and private commit receipt in one structured transaction. It verifies
review bytes before opening the transaction, then rechecks the persisted record,
snapshot and implementation draft; derived copies also recheck current base and
revocation truth. UUIDs, clocks and artifact I/O stay outside retryable callbacks.
Existing or foreign identities are never overwritten or adopted. Transaction
failures roll back all three records; lost acknowledgements permit read-only
reconciliation of the exact existing commit. The original reviewed revision or
current published revision may request this read-only check; actor/time remain
those of the committed record. This does not qualify filesystem
publication, legacy authoring, live PostgreSQL or complete Assets security.

The in-memory structured-document adapter serializes root operations and
organization views through one FIFO queue. A callback uses only its supplied
transaction store; nested calls reuse that owner without creating a savepoint.
Foreign, expired and captured-root calls deny. Queued writes capture nested
values, revision conditions and timestamps before waiting, and returned records
are detached from stored state.


### Private Windows file-identity prerequisite

The model-local native helper and its TypeScript protocol/adapter inspect an
expected Windows x64 NTFS root and strict handle-relative children. They retain
read-only identity handles, deny observed redirects, mismatches, multiple links
and share conflicts, and require confirmed helper exit before reuse. The helper
is deliberately absent from production model composition and public exports.
Owner/DACL facts are private observations, not ownership or effect authority.
New child creation remains possible. Delete/reveal, protected publication,
stable retained-tree accounting and safe offload restart remain unavailable.
