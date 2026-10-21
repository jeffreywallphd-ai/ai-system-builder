> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

# Runtime adapters

Runtime repair preserves explicit host authority: both ComfyUI and Git reject
missing/false `allowUpdate` before I/O, and `forceRepair` never grants permission.
Targeted and full fallbacks retain host flags and source. Automatic no-update
repair requires operator recovery; initial installation and unmanaged provenance
remain separately governed (see `docs/architecture/runtime-model.md`).

Python and ComfyUI supervisors retain an owned child until exit/close or terminal
process properties confirm termination. The shared bounded termination helper
registers listeners before signalling; errors, refused signals and deadlines
reject without granting cleanup authority. Starts/stops are single-flight and
identity/generation guards prevent stale health/preparation callbacks from
reviving an exited worker. An unconfirmed stop keeps host task inputs and
persistence owned for retry.

An externally attached Python worker has no owned process handle. Stop therefore
reports that external termination remains required, including for an idle
attachment; host shutdown can remain pending until that coordination occurs.
Health or capability failure cannot clear that classification or authorize a
replacement; a subsequently healthy external attachment can recover readiness.
Direct-child proof does not qualify descendant/launcher-tree termination or
physical CPU/GPU behavior. Keep those supported-platform checks pending.

Python startup failure remains failed after the asynchronous child close retires
its handle. Explicit confirmed stop and subsequent valid retry remain supported;
process absence alone does not erase the startup diagnostic.

Nonempty unmanaged Git install roots are never adopted from editable origin
configuration. Managed reuse requires matching target, normalized install root
and requested canonical repository URL. ComfyUI repair checks installed/missing
status and exact target/root before fallback or targeted Python/pip effects;
unknown or failed authority denies. Explicit update approval remains necessary.
Missing/empty roots can use the separate initial installation operation.
These marker consistency checks are not proof of current tree bytes, immutable
source provenance or native filesystem identity; those qualifications remain
pending. Recovery must not relabel or overwrite an unmanaged tree in place.

Only ENOENT establishes a missing filesystem entry. Permission, I/O, invalid
directory and indeterminate read failures return unavailable/failed authority
and cannot enter initial clone, directory creation or metadata-write effects.
Repair preflight also requires the canonical repository identity returned by
the installer; absent or substituted source identity denies before execution.

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

Python dependency setup persists `python-dependency-outcomes-v1`: operation,
finite platform/backend/stage identities, explicit overall success, safe exit
codes and grouped attempt/failure counts. Repeated retries replace the last stage
outcome and increment counters instead of retaining transcripts. Commands,
arguments, paths, index URLs, Python environment values, output and exceptions
are omitted; raw subprocess data remains local to operational parsing and retry.
Diagnostics I/O is best effort and cannot replace setup success or failure.
Shared temporary storage ownership/ACLs, link-safe publication, retention and
supported-platform qualification remain pending. Minimal content is not a claim
that the default diagnostic file is privately stored or integrity protected.
