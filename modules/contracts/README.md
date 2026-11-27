# Contracts

The standalone `models.save-training` intent binds an exact original training
task and current candidate digest to a name and idempotency key. Its decoder
copies and freezes closed data, using the existing training name/identity
bounds. It accepts no path, actor override or approval claim. This data schema
does not enable a public plan operation, storage effect or registry mutation;
the save owner still needs separate exact consent and current source checks.

Trusted `allowModelTrainingSave` separately admits that intent into build plans.
Its v14 preview binds the exact original task, candidate digest, name and key,
and describes a bounded local copy plus Models registration with no model or
provider calls. Older plans retain their existing bytes and versions. Both
approval channels reconstruct all effect fields; neither training nor download
capabilities enable this Save. Closed saved-result replies contain only scoped
Model/task/candidate identifiers and unchecked runtime status. Unconfigured
storage and host paths refuse this family; codecs and UI enable no Root.

Training completion defaults to cached history. An explicit `current-files`
mode requires a current original-owner candidate summary: verified digests,
bounded counts/bytes and optional descriptive Model execution facts. A missing
summary cannot satisfy that mode, and a cached request rejects an unsolicited
current summary. Closed codecs exclude private inventory locators and preserve
historical verification labels, separate Save and unchecked quality/readiness.

Training display names accept ordinary producer-compatible labels such as
"Token classifier" and "Prompt safety model". This field-specific allowance
keeps safe legacy names and actual credential, assignment, bearer, path/URL,
control, private-key, oversized opaque-token and structured-payload denials.
Names are literal data, never instructions, paths, permissions or Save proof.

The private training task family defines separate `models.training-task` and
`models.cancel-training` codecs. Both use the exact task or approved-plan-step
selector, with copied host and workspace identity. Download support does not
enable them, and these codecs add no public operation catalog or transport.

Training replies carry original task/plan identity, allowlisted status and finite
numeric progress. Completed status permits only a pending-review indicator;
runtime readiness remains unchecked and output quality is not evaluated. No
paths, logs, raw training inputs, candidate details or scores are accepted.
Cancellation distinguishes a request from confirmed terminal status, and neither
grants registration or Save. Hosts must independently prove original accepted
task ownership and fresh policy; decoding alone confers no authority.

`models.review-download` uses the same exact task or approved-plan-step
selector as Model task controls. Its closed summary includes original lineage,
model revision, manifest digest, provider-declared or unknown license, selected
file count and bytes. `verified-at-completion` is historical; registration still
requires separate approval and runtime readiness stays unchecked. No path, raw
worker output, license rights or current file authority is accepted. This codec
is in the finite read catalog. Optional host bindings govern discovery and use;
unconfigured product roots cannot disclose results or activate a Model save.

The opt-in `models.download` proposal uses a distinct v11 plan preview with an
exact pinned safe-format source selection, metadata digest, declared license,
explicit HTTPS transfer sites and existing byte/time limits. Temporary disk
space is an estimate. It grants no transfer, byte/readiness result, license
rights, Model registration or loading by itself. Node preparation independently
rechecks provider metadata before any future owned proposal transaction. Both
approval channels reconstruct the exact effects and limits. Existing host
capabilities remain disabled until public composition is qualified. The internal
review owner supports exact private v3 bindings, and its opt-in executor emits
only capability-gated Model started/replayed task references or fixed non-start.
No paths, registry/save permission or runtime readiness follow. v1-v10 stay byte-exact.
The fixed transfer profile is public files without credentials. Saved provider
access can check metadata; private/gated transfer has no qualified credential
seam here. A duration limit is not a claim of confirmed physical IO stop.

Headless `models.preview-source` is a separate provider metadata selector on a
paired plan-review connection. Strict target/result codecs keep exact host,
workspace, qualified model ID and optional commit. They retain the normalized
source and a metadata-only `manifestDigest`, with `downloadApprovalRequired:true`.
Node host/API/SDK boundaries independently recompute that digest. This grants no
download, loading, byte integrity, license rights or model-readiness result.

Model source-inspection codecs bind an exact Hugging Face repository/revision to
at most64 selected top-level Transformers safetensors/config/tokenizer files
within the existing20GiB default ceiling. They distinguish provider SHA256 from
Git-blob SHA1 and require exact sizes, totals and required files. License data is
provider-declared or unknown; no rights or byte/runtime verification is inferred.
The thin application port is private preparation, with no Headless operation,
download, approval, loading or save authority.

Model downloads accept an optional exact40-lowercase-hex repository `revision`.
Omission retains the ordinary unpinned request shape. A pinned result must carry
the worker-confirmed revision before registration. Recorded download provenance
does not prove weight integrity, license rights, runtime readiness or quality.
This request extension grants no Headless download operation or approval.

The Headless model-metadata family defines finite persisted-inventory
and exact-record selectors. Its copied results contain only recorded model
identities, timestamps, source/form/format, task tags and bounded numeric facts.
Runtime readiness and supply verification are explicitly `not-checked`.
The public read protocol admits only `models.inventory` (1 to 32 records with an
optional exact cursor) and `models.record`. Paired plan-review clients need
current workspace and model read permission. These reads grant no provider call,
file discovery, download, task, model execution or save. Exact approved model
acquisition and actual app/model qualification remain separate work.

`context.preview-query` accepts an exact saved RAG reference and a transient
question of at most 2,000 characters. Its strict result contains the exact UTF8
question hash, original model metadata, counts/limits and not-checked readiness.
The question is absent from results and metadata dependencies. Existing shared
passive/request limits and ordinary Context behavior stay unchanged; preview
supplies no query execution, saved-plan text or result-egress authority.

Headless `context.preview-rebuild` accepts one exact saved Context reference and
returns only verified recorded source/settings metadata. Strict codecs retain
new-approval and not-checked readiness facts and reject private/unknown fields.
It grants no old task control or rebuild execution.

An optional strict `rebuildOf` on Context generation creates a version-9 plan
preview with exact saved-parent identity. Both approval codecs bind it and reject
older preview versions carrying that field. Existing versions 1 through 8 retain
their projections. The reference grants no old task or parent mutation authority;
the host still verifies current original inputs and a new approval before effects.

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

This module contains shared boundary contracts used across application, hosts,
and adapters.

Current contract families include:

- `shared` result/error backbone
- `transport` plus `api` and `ipc` specializations
- `artifact-browser` read-side operation and read-model contracts
- `runtime`, `persistence`, `storage`, and `ingestion`
- `system-builder` for workspace-owned composed-system design records that specialize Asset Kernel compositions
- `headless` for versioned, finite read requests and bounded read projections
  from an existing host. Request validation does not grant access or
  advertise a supported capability. Desktop pairing IPC is separate and never
  returns the one-time code through its status or action results.
  The internal semantic batch contract binds edits to the exact workspace,
  system, saved record revision and composition revision.
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
- Give values consumed by native ESM explicit named exports at the family barrel
  when the source TypeScript loader exposes that family through CommonJS.
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

The opt-in version-10 `context.query` plan binds a saved RAG, original model,
question hash and explicit query bounds. Approved execution carries text only
in its transient envelope. Passive preview separately hashes its input; neither
stores the question in the plan. The retained query owner records exact acceptance once; fresh task
reads require current artifact and model permission and return citation-only
summaries. Query tasks cannot grant a generation save. See
`docs/architecture/context-management.md` and the portable Context skill guide
for request lifetime, owned policy, uncertainty and pending qualification limits.

The separate `show-context-query` window selector displays an exact accepted
query's fixed status/count/settings/hash/cleanup summary. Current artifact AND
model read and existing window consent guard display and fresh context. Accepted
same-actor/workspace/host lineage precedes cached Browser access; no lazy feature,
new query/save, source sharing or task adoption follows. Context shares only the
selector and view IDs. Generation-task display retains its artifact-only policy
and rejects query DTOs. Controlled feature checks leave physical and actual-host
qualification separate. See the Context architecture and portable skill guide.

## Private fine-tuning approval preview

The existing shared build-plan parser accepts `models.train` only when a trusted
caller explicitly enables `allowModelTraining`. Its version-13 preview preserves
the exact saved Model timestamp, Dataset version/digest and training settings.
Desktop and Managed approval readers reconstruct the same closed preview. The
common popup/chat view lists local training, separate result Save approval and
runtime/resource checks still required. Preview data grants no approval or task
admission. Public discovery, unconfigured storage and execution remain denied.
Versions 1–12 retain their existing previews and fingerprints.

The fixed Model-owner unit/type checks include the training approval contract and
rendered two-channel/two-mode tests. These are software workflow checks; they do
not run model-quality tests, model loads, Native retries or full-software suites.

The Model family exports `ModelTrainingExecutionHistory` and its closed `readModelTrainingExecutionHistory` decoder. The versioned report contains only original run identity, canonical UTC timestamps, monotonic elapsed time and finite reported device, precision, CPU-count and software-version facts. Explicit null facts remain unrecorded. The caller owns task/workspace/source binding and fresh authorization. The record is descriptive, not model quality, runtime readiness, resource admission, retention, Save or host qualification.
