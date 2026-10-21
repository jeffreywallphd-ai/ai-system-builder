# Contracts

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

This module contains shared boundary contracts used across application, hosts,
and adapters.

Current contract families include:

- `shared` result/error backbone
- `transport` plus `api` and `ipc` specializations
- `artifact-browser` read-side operation and read-model contracts
- `runtime`, `persistence`, `storage`, and `ingestion`
- `system-builder` for workspace-owned composed-system design records that specialize Asset Kernel compositions
- `asset-authoring` for safe authored records plus exact-base layered
  customizations, typed semantic sections, bounded source overlays, review
  evidence, distinct publication lineage, and shared operation identities used
  by typed server API and desktop IPC contracts
- `asset-implementation` for drafts, releases, facets, bindings, and immutable
  implementation backing-resource bundles kept outside Asset Kernel metadata
- `asset-package` for the bounded package lifecycle contract and deterministic,
  inspector-valid, non-executing `.aisb-package` starter
- `artifact`, `transform`, `lineage`, and `dataset` for ELT-style data flow
- `host` context metadata
- `logging` vocabulary
- `config` typed configuration concerns

## Terminology Guardrails

- Use **asset** terminology for composable system parts and built-system units.
- Use **System Builder** and **composed system** for workspace-owned system construction; use **software status**, **host status**, or **runtime status** for operational builder-application state.
- Use **artifact** terminology for ELT-side stored/flowing data objects.
- Use **ingestion** for the intake semantic layer.
- Use **staged artifact** for inbound content that has entered ingestion/staging.
- Do not use **staged-data** terminology as a contract or architecture term.

## Public Surface Discipline

- Import contracts from family barrels (`modules/contracts/<family>`), not deep
  internal files.
- The root contracts entry (`modules/contracts`) exposes family namespaces only
  so boundaries stay explicit instead of flattened.

Readiness and composition diagnostic/blocker boundaries admit only their declared
plain-record fields and reconstruct the public shape. Unknown fields and
accessors deny without evaluation. Metadata uses a pure shared contracts helper:
at most8 nesting levels,1024 visited values,64 keys per object,2048 characters
per string,80 characters per key and64KiB aggregate encoded key/string bytes.
Composition permits nested arrays of at most128 items; readiness retains its
no-array metadata schema. Cycles, sparse arrays, nonJSON/prototype objects,
non-finite numbers, dangerous structural keys and compound credential/raw-data
keys deny. Safe false/zero/null and nested summaries retain their meanings.
Actual filesystem/URL/credential/payload representations cannot enter these
passive diagnostic details. Composition keeps generic outward redaction for
unsafe message strings; readiness rejects them. Errors do not echo rejected
content. Existing family restrictions remain in force. These metadata controls
are not applied indiscriminately to typed DTO identities or declared graph
summary fields, and do not establish native/runtime/release qualification.

Diagnostic code, severity and identity inputs must be primitive strings before
any schema string method runs; nested trim/toString getters cannot execute.
Windows root-relative and drive-relative forms are rejected in metadata and
redacted from composition messages alongside Unix, UNC and drive-absolute paths.

Passive execution plan/run records and commands use explicit field schemas for every
nested record and provenance entry. The whole DTO is descriptor-inspected before
normalization: at most12 nesting levels,4096 values,1024 array items,128 fields
per object,80 characters per key,2048 characters per string and256KiB aggregate
UTF-8 key/string bytes. Unknown fields, accessors, sparse/extra-property arrays,
cycles, exotic prototypes, malformed supplied collections and nonfinite numbers
deny without echoing content or invoking coercion. Free text rejects protected
representations; typed identities and enums use their own primitive-string parsers.
Flags require booleans, percentages are finite0..100, attempts are positive safe
integers, timestamps must represent actual canonical instants and provenance kinds
are finite. Declared conversation/output/cancellation/retry references roundtrip.
Missing run collections retain existing empty defaults; malformed supplied values
never become empty success. Unsafe stored records fail reads without migration or
rewriting. This adds no execution authority or host/transport composition; controlled
qualification and previously uncomposed families remain pending/default-denied.
Recognizable credential representations (including short provider-token prefixes)
are rejected in public free text and nested metadata; a length-only encoded-data
check cannot establish non-disclosure. Typed identities retain their own schemas.

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
Duplicated target workspace identities must agree across command/record source,
target and provenance. Root and target effective references agree exactly on
kind/id/version, and an optional target projection ID matches the record.
Source workspace provenance may legitimately differ for library/import sources;
intended policy may differ from the actual blocked policy. Contradictory records
deny before persistence or progression, rather than selecting a convenient identity.

Image-generation request bounds are pure shared contracts used by the application
and ComfyUI runtime/mapper. Effective selected host defaults are checked before
supervisor startup, reference preparation or prompt submission. Existing limits
remain:10000-character positive/negative text,64..4096 dimensions,16777216 pixels,
1..200 steps,1..8 images, finite CFG(0,50] and denoise[0,1], at most3 face references.
Invalid batches are rejected rather than floored. Primitive/descriptor checks reject
coercion and accessors; engine hints are bounded JSON data, and seeds are safe
integers. Workspace authority, queue/history limits, deadlines and truthful
cancellation remain intact. These caps do not prove combined workload GPU capacity,
per-actor fairness or physical model qualification; those remain pending.
Admission consumes one detached descriptor-safe request snapshot before authority,
model, runtime-start or reference-preparation awaits. Nested reference collections,
reference identities and hint data cannot change through caller-owned aliases after
validation. Prompts retain their exact allowed content; display sanitization is not
used to construct runtime input.
