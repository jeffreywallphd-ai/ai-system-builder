# AI Development Control Plane

Stable stories reuse the approved increment `workPackages`; expandable tasks keep
the existing chunk IDs, plan and completion ledger. The portable engine's optional
`storyTaskTracking` is an audited relationship map, not another planning authority.
It binds complete task ownership to exact story/task/plan definitions and ordered
history. Adoption preserves approval, evidence, fixed restriction archives and
completed definitions. Refinement cannot reparent existing tasks or publish
ownership while an unrelated/source candidate claim is live. Exact governing v1
metadata Work can retain its own active pre-check claim through explicit
`metadataWork`, strict target/file scope and current ownership. Acquire the
roadmap publication lock, then the Records mutation lock, and hold both through
the state write. Work state reads acquire no roadmap lock. Recovery rechecks the
guard. Pending Records journals and explicit bootstrap recovery ownership refuse
until ordinary recovery completes. Work start revalidates authority under Records
admission without taking the roadmap lock. Read-time inconsistencies fail closed.
Task/story implementation counts remain separate from technical qualification.

The review projection validates adopted ownership through the canonical engine.
Complete tasks remain single records; stories hold exact task references and
implementation counts. Paged Work views narrow only visible task references,
mark that view partial and retain explicitly original story totals. Missing or
tampered ownership never becomes a guessed relationship. Completed task proofs
can show reviewed local Work snapshots, with no current parent qualification.
The browser rejects incomplete/duplicate/foreign joins before replacing a view.
Plain story/task copy uses the fixed bounded task-description companion; exact
definition hashes and existing joined-text redaction apply. Missing/stale copy
shows neutral maintenance guidance. Legacy unadopted wire fields stay compatible.

Optional `development-work-v2` task targets separately bind exact task/story and
definition/tracking hashes while preserving the old increment binding. Work
acceptance explicitly selects scoped task criteria, outcome/support coverage,
scope and limitations. Parent criterion links do not require local tasks to
claim controlled parent qualification. Governed adopted task completion consumes
a completed current task-bound Work, qualifying receipt and accepted independent
review; stored proof binds exact completion history. One Work can support several
tasks without duplicating elapsed time or token attribution. Old v1 Work remains
immutable and cannot acquire targets. Increment and overall completion retain
their existing whole-candidate qualification and exclude task-targeted Work.

The browser description adapter is a read-only final projection. It replaces
criterion prose and headings with independently reviewed, exact-source JSON copy;
the technical projection/CLI and canonical state are unchanged. Local support
descriptions bind their exact existing text. It cannot assign action authority,
change outcome/qualification or complete work. Strict schema, row/text/file bounds,
joined-text redaction and source freshness apply before display. Missing or invalid
copy uses neutral agent-owned recovery guidance. The existing2MiB HTTP response
limit and text-only DOM rendering remain. Generated technical narratives are not
duplicated into a second complete tree in the HTTP response.

The optional `roadmap-chunk-refs-v1` wire representation stores each complete
chunk once in its canonical roadmap. Exact work-list references retain identity,
parent, order and creation metadata; Python and browser consumers reconstruct
the former full work row from that same snapshot. Unknown formats and missing,
duplicate, ambiguous or altered joins fail closed before display replacement.
This is a transport representation, not a new authority or persistence model.
The legacy no-header representation remains available. The browser selects the
finite format through one exact header on the existing fixed read-only route.
The browser uses bounded server paging on that route; no caller path or new
endpoint is introduced. Exact encoded-byte
limits, complete canonical history, source-bound plain copy, qualification and
truthful execution-record admission remain unchanged. Wire digests identify the
transmitted object; reconstructed display rows grant no technical pass.

The optional query contract admits only fixed `view`/positive `page` arguments
and exact bounded `roadmap`/`increment` navigation selectors. Sizes are fixed at
three roadmaps or 25 work/evaluation/feedback records. Derive counts and order
from one complete bounded-source snapshot, format source-bound user descriptions,
then select pages before the unchanged final 2 MiB admission. Open roadmaps come
first, retaining creation order within open/completed sections. A page contains
complete selected roadmap history, criteria and support. Work pages carry exact
selected canonical chunks with complete owning criteria under `work_item_roadmaps`;
references join only that same-page canonical set. No row may be trimmed after
page selection. Unknown/duplicate/encoded/incompatible selectors, corrupt joins
and oversized pages fail closed. Explicit page/totals metadata distinguishes a
selected empty set or clamped last page from a missing record. Legacy no-query
responses keep their original contract and whole-response admission. The local
CLI supports explicit technical pages; operator status bypasses HTTP byte
admission while retaining bounded canonical source reads and redaction.
An exact `work` selector opens one scoped supporting execution directly and is
mutually exclusive with parent selectors. Paged executions, trials and feedback
retain every row admitted by bounded canonical source reads before page selection;
legacy unpaged display caps remain separate. Each page binds a global digest of
public disclosure identities/counts. Browser-local choices reset on observed
identity changes, including ambiguity changes on other pages; page and status
changes alone preserve choices. Same-page parent joins reject duplicate or empty
parent/increment shadows before evidence resolution.

The fixed superseded Run & Test draft may fold beneath the completed Publish
lifecycle owner only with an exact frozen unapproved/unstarted source, dedicated
open handoff blocker, current canonical successor approval and complete criterion
mapping. Retain all history. This exception never admits other legacy successors,
completes the old draft or grants current qualification. Invalid mappings leave
both visible. Mixed legacy human acceptance uses a separate metadata-only event
and archive; technical evidence/pending status and product approval remain.

User-directed security consolidation has one execution owner. A fixed versioned
JSON crosswalk maps every unfinished legacy criterion to one existing primary
owner plus required companion acceptance, and assesses every current criterion
against code/tests. The frozen legacy state digest, current acceptance-definition
digest, existing handoff blocker, canonical current approval and complete finding identities
must match before projection folds the original card/chunks beneath the successor's
merged history. The original state and completed history remain unchanged except
serialized clarification events. Invalid or stale mapping restores both visible
records with a diagnostic. This projection cannot transfer approval, execution
receipts, passes or completion, and preserves the configured overall all-suite
and applicable build/release/security qualification.
The fixed roadmap engine validates the successor state and approval; the complete
successor graph rejects cycles and chains through folded records, including
ordinary links without consolidation metadata.

Explicit user-directed offline human acceptance may leave technical closure through
the roadmap skill's bounded transfer event. The archive preserves original
criteria, plan, approval and evidence; the active scope needs explicit reapproval.
Only solely human-blocked implemented increments qualify. Semantic classification
is reviewed operator attestation, not an inferred authority or a passed test.
The JSON projection displays offline ownership separately and filters archived
criteria out of active chunk links. Other technical and current-receipt gates stay.
This metadata-only event is legacy-only; any evidence policy is refused. It cannot
close receipt-governed increments using stale or merely declarative technical checks.

- Status: current
- Related decisions: `docs/adr/ADR-0042-integrated-ai-development-control-plane.md`, `docs/adr/ADR-0015-security-architecture-and-policy-boundaries.md`
- Verification: `dev-tools/helpers/tests/`, `skills/manage-implementation-roadmaps/tests/test_roadmap.py`, `npm run agent-support:check`

## Entry and authority

`AGENTS.md` is the discovery entry point. For a governed work request, start or
safely reuse the local review site, share its verified URL, then use
`dev-tools/helpers/development_control_plane.py`. The site is a read-only
projection, never an approval surface. A question about the repository alone
does not require creating a work record.

Established bounded fixes use a lightweight work specification. Substantial,
decision-bearing work uses the existing implementation-roadmap skill and its
explicit approvals. Work specifications bind observable outcomes, exact scope,
acceptance and named checks. They supplement user authority; they cannot grant
credentials, network access, spending, publication, production access or Git
mutation. Existing architecture and security decision gates still apply.

## Boundaries

### Roadmap record storage

The portable engine preserves small indented and larger compact plain JSON. When
those encodings cannot fit, its fixed sibling codec can use
`roadmap-record-tree-v1` for the entire state or recovery journal. This is storage
compatibility, not a new authority, workflow or approval. Configs and event inputs
remain plain JSON. Existing roadmap approval and predecessor fingerprints still
hash the exact logical Python value, including integer/float distinctions.

The closed envelope contains `storageVersion`, `contentSha256`, `root` and `nodes`.
Each unique object or array is a postorder node. Object entries use sorted Unicode
codepoint keys and arrays retain order. Atoms are strings, booleans, null, backward
references, canonical decimal integer strings or finite binary64 hexadecimal
float strings. Numbers are tagged to preserve negative zero, integer precision and
Python numeric types across storage. The content hash covers canonical ASCII JSON
of `nodes` and `root`; it is not a roadmap authority fingerprint. Encoded physical
bytes must be canonical, with at most one LF or CRLF suffix. Duplicate keys,
forward references, unused/duplicate nodes, unknown fields and invalid numbers
are refused before reconstruction.

State and the whole recovery journal keep the existing one-MiB physical bound.
Before expanding a graph, the decoder checks an occurrence-weighted eight-MiB
JSON allocation charge, at most 65,536 pool nodes, 262,144 expanded containers and
depth 64. The charge conservatively budgets each float as 32 bytes. It is not a
process memory limit. The logical JSON is emitted and parsed once so repeated
historical records do not share mutable containers. No record is trimmed and no
limit is raised to fit a new event. Dry-run, apply, render and interrupted recovery
use the same actual publication admission.

Python authority, completion guards, review projection, user descriptions,
support/consolidation and model-qualification metadata use the canonical reader.
Node qualification decodes with the same bounded format and preserves legacy
`JSON.parse` numeric behavior. A Node reader retains raw file digests where that
consumer already binds physical input; it never substitutes JavaScript
reserialization for Python approval authority. Both runtimes test shared typed,
Unicode and malformed-input vectors. The Node catalog check is exact and retains
generic coverage for unknown impact or missing required files.

Missing or unsafe codecs still permit legacy plain records, but encoded input
fails closed with original bytes retained. Reverting to a reader that lacks the
codec can make encoded history unreadable. Restore a compatible reader before
mutation; do not manually adopt an unpacked record that exceeds the old cap.
Installation includes the engine, sibling codec and fixtures. Storage tests cover
current approval, whole-journal recovery, corruption and independent aliases.

- The portable roadmap engine owns approved intent, increment sequencing,
  declarative evidence and generated documents. Its publication uses a
  roadmap-specific OS-released lock, predecessor fingerprint and recovery journal.
- The bounded helper owns source snapshots, work claims, check selection,
  execution receipts, review dispositions and local completion. It uses adapted
  upstream storage primitives; product code must not import contributor tooling.
- A source snapshot binds tracked and non-ignored untracked files. Deletions and
  rename sides follow from the before/after content maps. Explicitly managed
  lifecycle projections are excluded from source identity and roadmap approval
  is bound separately, avoiding recursive evidence invalidation.
- Every changed path requires a catalog rule. Fixed check IDs resolve to trusted
  commands; source-owned tests are derived from bounded repository paths.
  Unknown impact fails closed. Catalog/executor changes invalidate receipts.
- Executions stream bounded output to digests, preserve actual exit and timeout
  status, and check source stability afterward. They run under the caller's
  existing sandbox. Check catalogs do not isolate malicious test code.
- A separate invocation attests review of every criterion. Findings and explicit
  correction closures bind the receipt and source. Operator/host attestations
  are labeled as such; distinct IDs do not authenticate independent identities.
- Local state is versioned JSON under ignored `.local-codex/control-plane/`.
  Atomic publication, revisions and recoverable journals preserve conflicts and
  failure evidence. Claims coordinate cooperative writers; expiry requires
  explicit recovery and a new fencing identity.
  Claims serialize source-writing work within each checkout; separate checkouts
  are needed for concurrent disjoint candidates.
- Immutable source baselines live in bounded content-addressed JSON files under
  ignored local snapshot storage. Work records retain digest references, so
  repeated full file maps do not consume the8MiB record-index budget. Existing
  inline baselines migrate on mutation without changing evidence or approvals.
  Qualification checks both the snapshot envelope and file-map digests.
  Snapshots publish before journaled references, preserving interrupted recovery.

## Adoption

New roadmaps created in this repository carry `evidencePolicy: control-plane-v1`.
Closing an increment requires a completed work item bound to the same approved
increment, all its acceptance IDs, a current execution receipt and an accepted
separate-invocation review. The engine validates these through the local adapter;
it never executes an evidence command string.

Final closure also requires current reviewed overall qualification, using the
approved `completionSuite` (`standardande2e`, or `all` for AI-related work).
The `overall` binding becomes available after all implementation chunks are
recorded, including a final verifying increment with implemented predecessors.
The roadmap engine owns the shared readiness predicate: current approval, no
open blockers, exact nonempty chunk completion and valid lifecycle state.
Earlier aggregate check IDs remain unavailable. Controlled qualification and
strict final closure are unchanged; missing external evidence never passes. Governed state paths are canonical
and unsupported custom paths fail before creation.

## Evaluation and feedback

Numeric usage v2 adds fixed implementation phases, independent of activity,
measurement and provider assurance. v1 read-time migration preserves numbers,
stream/epoch/sequence/baseline identity and latest replay digests. Old
implementation cells become legacy unknown in memory; only a successful mutation
publishes v2. Lifetime, periods and agents use the same phase cells. Work/review
IDs never become rollup dimensions. Raw purpose remains an activity total; the
user-facing Implementation metric is exclusively pre-review. Subsets stay subsets.

`usage_phases.py` owns bounded usage-only context/markers under the existing
writer lock. Context hashes owning checkout, exact Work/spec and candidate/ref
identity and binds explicitly selected host threads. Imports revalidate live
context refs under that lock. The first response after an observed source-position
fence stays mixed/unknown because it may have been in flight. Later bounded
cutpoints support declared attribution, without wall-time proportions or epoch
resets. Conflicting Work associations stay mixed; unavailable fences unknown.
Work hooks run after normal mutations and never mutate Work during verification
or supply approval. One existing summary and local UI filter preserve paging.

Optional contributor token accounting uses a separate versioned numeric sidecar,
not Work qualification or trial run admission. Its normalized host import has no
provider connection, transcript reader or background poller. Atomic publication
owns sequence deduplication and epoch baselines with recent detail and UTC
day/ISO-week/calendar-quarter aggregates. Rotation retains lifetime totals,
older-quarter rollups and bounded permanent replay cursors; capacity refusal
preserves prior totals rather than silently dropping imports. Own usage stays
separate from inclusive/unknown scope; numeric status, source assurance, coarse
purpose and missing coverage remain explicit. Optional projection failure does
not affect Work. See the [schema and retention rules](../diagnostics/token-usage-tracking.md).

`usage_capture.py` is a strict numeric Codex-v2 export receiver into that same
atomic importer. It has no host process, connection, transcript discovery or
second durable cursor store. Explicit bounded config binds session, selected
thread ancestry, scope, purpose, producer version and reset epoch. The first
cumulative sample is always uncounted; subsequent monotonic counters yield deltas.
Identical snapshots never refresh freshness. Source/version reset requires a new
baseline and permanently retires the prior family epoch. Unverified counter
scope remains unknown rather than joining own subtotals.

Coding-session initialization invokes `usage session-start` once and reports
adapter readiness separately from selected-thread missing/baseline/stale/recent
actual deltas. Missing/invalid feeds are nonblocking fixed diagnostics, with no
placeholder imports. The external receiver does not make the desktop host expose
its counters: that route requires a selected-session numeric-only callback/export.
The selected local route below supplies an independently bounded source.
Declared export provenance is cooperative, not authenticated billing proof.

`usage_local.py` supplies the selected desktop numeric boundary when a public
counter callback is unavailable. It inspects only filename metadata for exact
known UUIDs, validates canonical first-header/workspace/source identity and reads
bounded numeric response tails. Message/tool rows never enter its decoder and
no raw row archive is retained. Exact `record.thread_id` identifies own reported
response usage; shared session/root-turn IDs do not aggregate descendants.
Inherited first thread totals are uncounted, with a fixed initial byte boundary;
subsequent monotonic cumulative deltas use the sole existing atomic cursor store.
Context-oriented `token_count` events are not an accounting fallback.

Startup pins at most sixteen selections in one 32 KiB ignored configuration plus
a one-byte selection lock. Existing successful Work start/verify/complete paths
poll only configured selections once, returning optional nonblocking capture
status. They do not change Work records, source, authority or claim ownership.
An explicit usage-only destination must share the canonical Git repository;
atomic cumulative dedup allows linked checkouts to feed one primary dashboard.
Missing sources, replacement/reset, partial append, tail limits, unknown agents
and stale data remain explicit. No automatic full-team or account coverage follows.

The dedicated Token usage dashboard reuses that global summary on the existing
bounded Work-items first-page read, preserving all four collection paging
contracts and the compact Work disclosure. It adds no endpoint, capture loop or
storage write. Agent relation labels derive only from reported parent links;
unclassified/missing relationships remain unknown. Fixed row/count/date/enum
validation and inert tables preserve numeric status, subset and coverage meanings.

The functionality qualification assessor reads a versioned requirements crosswalk
and canonical owner JSON without changing either. It binds its ignored report to
all bounded Git-listed files in the product/tooling roots, including UI assets,
and owner-state digests, checks
complete controlled-criterion coverage and emits allowlisted identifiers and
references. Historical evidence remains declarative; missing environments and
even historical passed declarations remain unqualified for the current source
until the actual owner records appropriate controlled evidence. The assessor
never grants approval, executes listed harnesses or completes a roadmap.

Versioned JSON tasks prepare bounded ignored workspaces. Fixed external graders
execute assertions against actual Python artifacts, a DOM recovery journey and
decision JSON. Python artifact execution happens in child observation processes;
the separate trusted grader asserts their bounded results. Early exit or a
forged stdout completion message cannot substitute for those assertions.
Task, grader and controller policy digests freeze grading.
Operator-supplied run manifests keep model/harness/permission identity, unknown
usage, infrastructure status and evidence kind explicit. Comparisons refuse
incompatible inputs and stale artifacts; all attempts count against distinct
accepted work. The framework never invokes a provider or accepts an imported
score as a substitute for executed grading.

Outcome feedback links active acceptance to a reproduced failing trial. Closure
requires a changed passing trial under the same policy, updated durable regression
artifact, current candidate verification and accepted independent review.
The named repository test executes separately at admission and closure, retaining
its failing and passing verdicts with the same assertion-source digest.
Performance/accessibility references retain environment and qualification.
These records inform contributors without automatically changing product scope.

Pre-existing state remains readable with its original approval fingerprint and
declarative evidence. It is labeled legacy in review output; it does not acquire
verified status retroactively. To adopt it, create a successor roadmap through
the current skill, preserving the old history and links. Completion of the
current control-plane implementation itself follows its previously approved
legacy roadmap and reports the actual executed checks.

## Dynamic review data

Implemented-pending targets admit qualification-only work once all implementation
is complete, approval is current and no blocker remains. This preserves the active
increment pointer. Authority additionally binds target criterion semantics,
plan/chunks, latest evidence and bounded report hashes. The explicit
`increment-qualified` event consumes exact current completed work/receipt/review
references and requires all target criteria passed. Partial, overall-only or stale
records cannot substitute. Consumed pending-only work is historical; final overall
qualification remains independently required.

Technical acceptance is agent-executable; human studies/manual acceptance are
user-owned offline. A started governed roadmap may use the skill's narrowly
attested `acceptance-scope-revised` event. It archives original removed/mixed
criteria, plan and approval, supersedes only human portions of historical
instructions and invalidates approval. It cannot change evidence, statuses,
blockers or completion policy. Retained mixed IDs stay active/pending and only
retired IDs leave chunk projections. Actual user narrow reapproval and fresh
fingerprint-bound receipts/separate review remain required for technical closure.

`dev-tools/review-site/server.py` projects canonical roadmap JSON and the local
JSON record store into `development-review-v1` at `/api/review`. The buildless
browser polls the API; editing JSON updates the next response without Markdown
parsing or rebuilding. The allowlisted projection exposes bounded outcomes,
statuses and counts, omitting approval notes, raw execution output and private
run records. Text is rendered inertly with `textContent`.

The JSON projection includes ordered planned chunks, actual completion markers,
criterion references and bounded recorded verification notes. Work items combines
these `roadmap-chunk` projections with separately labeled `execution` records;
it never creates local execution authority from historical plans. Parent/child
navigation follows roadmap/increment/chunk identities. Criterion qualification
and chunk completion remain independent dimensions.

Increment delivery metrics are derived from complete execution records with exact
canonical roadmap-state/increment bindings. Each work identity contributes once;
overall, unknown and ambiguous targets contribute nothing. Only finite nonnegative
durations enter the sum, preserving a measured zero. Separate measured, pending and
unavailable counts prevent missing durations from becoming zero measurements.
Aggregation precedes execution display limits. The response exposes only numeric
facts, never the binding path. Summed durations can overlap and do not represent
exclusive elapsed time. Existing records have no execution-to-chunk timing link,
so chunk timing remains Not recorded without changing completion or qualification.

Increment disclosure defaults to closed. The JSON projection adds only an
`actively_worked` boolean, mapped from one active, unexpired roadmap source claim
to its exact canonical state path and increment identity. Missing, malformed,
expired, released, completed, overall, foreign or ambiguous targets cannot select
an increment. Saved current-increment pointers and workflow status do not imply
live work. This advisory field exposes no claim IDs, invocation IDs or state paths
and grants no authority. Expiry changes the public digest on the next poll.
Identity uniqueness includes completed rows and public text normalization. If a
source exceeds the 100-increment display bound, all advisory activity stays false;
the projection does not scan beyond its bound or assume the hidden rows are unique.
The browser keeps explicit disclosure choices in memory, keyed by repository,
roadmap, history and increment. Choices survive polling, filtering and navigation;
linked parent navigation records an explicit open. Automatic-only opening ends
with activity. A manual close overrides activity. Reload resets these choices,
repository changes clear them, and removed records are pruned. Merged history
uses manual disclosure only. Programmatic render events cannot become user choices.
Before filtering the page, the browser counts all disclosure keys in the complete
incoming view, including history containers. Only unique keys can retain manual
choices, automatic opening or linked navigation focus. Removed or ambiguous keys
are pruned. Ambiguous rows can be toggled locally, but no remembered choice can
open another row after refresh. This changes no canonical identity or history.

The projection orders roadmaps and work items by normalized creation time,
descending. The Roadmaps view partitions that order into Open Roadmaps first,
then Completed Roadmaps, using only top-level completion. The canonical roadmap
status remains `completed` after final approval; the separate `finalApproval`
fact governs immutability and report removal. A narrow user-authorized legacy
normalization event preserves all prior facts and appends history. The site also
reads legacy `complete` and `final-approved` statuses and displays completion
badges as `completed`, including internal execution `complete` badges. It never
infers a parent pass from child increments or local support. Within each section, original
creation time governs; completion and update times do not reorder records.
Work uses its initial event and chunks use plan recording time with
legacy increment/roadmap fallbacks. Unknown dates sort last and equal timestamps
retain deterministic identity/plan order; source modification time is not used.

The buildless page defaults to dark colors before JavaScript runs. Its header
action stores only a validated explicit dark/light preference in browser storage;
storage failure is nonfatal and no server mutation or approval is introduced.
Explicit palette tokens preserve text, badge, error, focus and control contrast.

The server binds numeric loopback only, accepts exact same-origin Host/Origin,
provides fixed GET/HEAD routes, bounds clients and output, and serves no arbitrary
repository paths. Startup validates repository identity before reuse. Local
same-user process impersonation is outside this cooperative boundary; do not
expose the server through a remote tunnel or treat it as authenticated hosting.

## Qualification

Focused behavioral tests cover actual fixture check execution, stale evidence,
uncovered paths, scope escape, correction closure, races, crash recovery,
timeout/output bounds, JSON refresh and HTTP denial. CI runs the same tests.
Provider-backed coding performance, authenticated review hosts and dedicated
performance evidence remain distinguishable from local harness conformance.

See `docs/diagnostics/ai-development-control-plane.md` for contributor commands
and `docs/security/ai-development-control-plane-threat-model.md` for trust limits.

## Supporting implementation evidence

A fixed bounded JSON document, `docs/operations/roadmap-supporting-work.json`, maps
known roadmap criteria to scoped completed component work. The projection verifies
receipt integrity/passing attempts, source stability at execution, accepted
separate-review coverage/digest and exact completion references before labeling
reviewed local support. This is historical support at a recorded snapshot; current
whole-candidate qualification is not asserted. Missing/invalid/active/failed records
remain unverified. Decoration never changes canonical outcomes, status, approvals,
chunks or qualification policy. Agent-executable labels and approved successor
links clarify current technical scope while preserving original histories.

## Lossless acceptance and proposal display

The fixed `docs/operations/roadmap-blocker-presentation.json` map annotates only
explicitly associated affected criteria. Exact identities, raw canonical
description SHA-256 and the current canonical open blocker digest bind every
association. Projection builds that index anew for each response, not from a
stale display snapshot. It exposes sanitized canonical summary/action and a
bounded reviewed operation explanation under a visible criterion Blockers list.
No criterion outcome or authority changes. Invalid/foreign/duplicate/stale or
resolved mappings diagnose and fall back to the always-preserved current parent
obstacle display. The 1 MiB/1,000-row/20-reference/800-character limits and fixed
source path prevent arbitrary reads and unbounded display expansion. Semantic
review verifies the association; digests alone cannot prove which work it blocks.

Review projection decorates each criterion with bounded explicit requirement
nodes before supporting-work and merged-history enrichment, so parent, linked
work and archived-owner views share the same presentation. The one fixed
versioned presentation file is identity/hash bound to the already sanitized
canonical description; its ordered tree must reproduce that description after
whitespace normalization. Up to 1000 rows,64nodes per criterion, 3 levels and 1 MiB
are admitted. Unknown fields, duplicate/foreign identities, stale hashes and
changed/omitted/reordered text fall back to the complete safe original with a
generic diagnostic. Missing data also falls back safely. Rendering uses nested
semantic lists and textContent with one parent result and an original-wording
disclosure; no subpass, approval or state mutation is introduced.

Increment proposal projection allowlists only dependency IDs, work-package id/title/outcome,
deliverables, verification, rollback and exclusions. Collections are capped at 40
items and strings use existing safe-text bounds (80/240/1600/4000 characters).
Research, approval/authority notes, raw local records and arbitrary fields remain
private. Proposal packages never become executed chunks. Pending increments
without a plan explain either approval-first or start-time planning according
to their canonical review/approval state; existing active missing plans retain
their diagnostic wording.

Roadmap display labels show Pending for canonical ready, In progress for
executing and Awaiting approval for roadmap-review. Actual open blockers
remain Blocked; a blocked record with an explicit zero blocker count
keeps its source status and shows a needs-review note. The accessible
status key above Open Roadmaps explains these labels and pending
qualification without changing criteria or granting authority. Labels never change
canonical workflow state, ordering, approval or start authority.

The status key also explains Technical check pending, missing evidence,
passed/failed checks, scoped reviewed support and intermediate skill
states. Pending verification is distinct from a recorded blocker.
Execution records are sorted by original creation before the finite
1,000-record display limit. The API exposes total/shown/truncated facts
and a diagnostic if this limit is exceeded; current work beyond the old
200-record cap remains visible without exposing private record fields.

## Plain-language blocker explanations

Optional `plain_language` copy on an existing blocker reference contains exactly
`needed` (400 characters), `prevents` (800) and `action` (800). The same current
criterion-description and still-open canonical blocker digest checks govern this
copy. Shared blocker explanations must agree; conflicting or invalid copy falls
back to canonical facts with a diagnostic. Sanitization and inert text rendering
remain mandatory. No copy changes status, authority or qualification.

Parent and affected-criterion views show **What’s needed**, **Why it matters** and
**What to do**, followed by expandable **Technical details** retaining the original
canonical summary/action and criterion-specific operation explanation. Historical
technical wording can predate newly supplied access; primary copy must accurately
distinguish authorized access from successful verification. Do not ask for access
again when it has been supplied, or imply it works before an actual check passes.

Public execution summaries allowlist only bounded sanitized success and problem
text. Agent context, quality notes and unknown outcome fields remain in canonical
work records. The existing count and 2 MiB response limits, latest-first admission
and inventory diagnostic remain unchanged. The browser distinguishes intentional
history limits from unavailable records; neither changes qualification or recovery
state. Mixed diagnostics retain each applicable explanation without raw errors.

## Owned Windows qualification commands

The bounded launcher in `dev-tools/helpers/native-qualification/` is separate
from the closed two-process Python fixture. Its public entry accepts only fixed,
model-free self-test roles. A real package or UI consumer needs a separately
reviewed fixed operator, exact executable/source identities, a fresh candidate
and separate output paths. No public arbitrary-command or existing-process
adoption interface is provided.

An unnamed, noninherited Windows job owns the new tree at process creation.
The root starts suspended with both the job-list and explicit standard-handle
attributes. Only private output pipes and null input can be inherited. Read back
membership, handle flags and finite limits before resuming. The prospective
limits are 32 active processes. Standard fixtures and package jobs retain
1 GiB process commit and 2 GiB aggregate commit. The fixed Standard ingestion
UI role retains 1 GiB per process and a 3 GiB job ceiling. Only issued fixed OCR
package/UI intents, the OCR budget fixture and the v2 startup diagnostic use
the approved 2 GiB process and 4 GiB job ceilings. The historical v1 startup
diagnostic retains its original 1 GiB process and 2 GiB job limits.
An exact issued immutable intent selects the profile; no caller numeric quota,
environment override or public budget flag is allowed.
These are hard ceilings, not reservations or guaranteed workload capacity. Failed admission or
an observed limit failure cannot qualify a workload.

Lifecycle completion requires the exact root's native exit, zero active job
members, completed bounded streams and acknowledged handle closure. Timeout,
stream overflow, failed native calls or uncertain retirement must retain a
failure record. A known nonzero result with proven retirement remains a failed
product test; it does not establish product correctness. Missing retirement
proof fences that new attempt. An independent model-free lifecycle review must
precede real package/UI qualification.

This mechanism proves only the newly owned tree. It cannot prove retirement of
older processes, recover a fenced run, protect retained offload files, qualify
disk accounting or establish machine-wide resource isolation. Earlier failures
and their outputs remain intact. Cooperative local trust and the existing
roadmap approval and candidate-bound verification rules still apply.

Pipe-only roots and fixed fixture children use `DETACHED_PROCESS`, with explicit
standard handles and no console. Keep exact fixture counts; do not accept an
unexplained extra process. Microsoft documents the
[creation flags](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags)
and [console initialization](https://github.com/microsoft/terminal/blob/main/doc/specs/%23492%20-%20Default%20Terminal/spec.md).
A corrected source revision uses a separately reviewed fixed self-test family.
Prior failed journals and fences remain intact; a new pass cannot identify an
unobserved old process or turn the previous failure into a pass.

The earlier fixed `native-ui-budget-command-selftests-v3` family retains its
eight-case mechanics evidence and the two prior 2 GiB UI-limit failures. The
approved OCR profile uses the separate fixed
`native-ocr-budget-command-selftests-v4` family. Its nine cases add an OCR budget
readback at exactly 2 GiB per process and 4 GiB per job. The Standard UI case
still reads back 3 GiB. Existing lifetime assertions remain unchanged. A fresh
family refuses a prior family fence; it does not adopt old processes or remove
earlier failures. These cases calibrate the bounded test topology. Native limit
readback proves neither physical allocation nor successful app behavior.

The fixed v2 model-free startup diagnostic pins the direct base interpreter,
venv interpreter and configuration. Its fixed launcher context must establish
the intended venv and isolation settings before Torch import. Eleven exact
identity checks must pass; every safe fact must identify the newly owned root.
Using a descendant or a reported process number instead is not permitted.
Raw supplier output is discarded, while byte counts and overflow checks stay
active. Startup results are limited to three small typed fact files. Actual and
parent-level v1/v2 run fences prevent admission. The v1 failure remains failed.
A successful v2 import and accelerator query qualifies only this diagnostic;
production dependency preparation, both app journeys, model quality, retained
offload recovery and parent roadmap qualification require separate evidence.

## Completed-work archival representation

Exact completed unclaimed work can move from the hot wire representation to
immutable content-addressed objects. This is storage externalization within the
existing cooperative local model, not retention deletion or new qualification.
Specs, events, receipts, reviews, completion facts and baseline representations
stay unchanged. Active and pending work remains inline. `Records.load()` returns
the same complete logical v1 state and historical work objects.

A closed `development-state-storage-v1` envelope binds the physical representation
with `storage_digest`. Its state retains the original logical integrity field: a
digest of the logical object excluding that field. The existing index/journal
identity remains the digest of the entire logical state including its integrity
field. These identities have different purposes and are not interchangeable.
Archive references bind an exact work ID and canonical object digest beneath one
fixed private root. Normal mutation cannot change archived work.

Publication preserves the existing lock and predecessor check. Objects publish
before their references. A v2 journal binds aligned full-logical and physical
predecessor identities; recovery accepts only the exact predecessor pair or
already-published successor pair, and checks the index before and after repair.
Legacy v1 state/journals remain supported. All physical JSON/journal bounds stay
8 MiB. Archive input has its own aggregate 8 MiB and 1,024-object bound, so full
loading has at most 16 MiB of encoded input across both tiers. Requests cap at
128 IDs and audit history at 64 events. Missing or invalid history fails closed.

A capacity bootstrap is a disclosed exceptional recovery, not a fabricated normal
work claim. It requires exact before-source/store/index/branch/roadmap proof, an
exclusive cooperative marker, isolated failure/interruption tests and independent
review before source/migration steps. A separately reviewed one-use effect must
prove lossless history and adequate next-work headroom. Genuine normal admission,
current checks, separate review and owned commit follow. No source/parent approval,
release, model/native resource policy or destructive cleanup authority changes.
The long-lived review server must load the new reader before physical migration.

### Private training qualification composition

The existing native executor adds literal private training roles alongside its
unchanged generic dataset/OCR forms and default selftests. Private host witnesses
bind installed Node, the fixed managed Python/base context, exact source and
consumer files, generated input and fresh package identities. They are cooperative
trusted-source attestations, not authenticated identities or public JSON execution
capabilities. Commands, working directories, environment, deadlines and the
existing 2 GiB process/4 GiB Job grade are fixed by the issued role. Atomic Job and
handle assignment, guardian, exit/drain/zero-count and retirement remain shared.

Source-only descendant packaging reuses installed dependencies through ancestry.
A fresh empty regular candidate `node_modules` prevents Vite's temporary config
cache from selecting the original dependency directory. Copied configs and their
relative resource helpers, an explicit offline ZIP and fresh output/temp roots
are required. Input/readiness use owned phase directories; the readiness adapter
reuses production dependency ports with a read-only spawn adapter. UI keeps its
existing repository resolution while actual runtime work uses the fresh package.

Only explicit generated-tiny qualification context selects the fresh worker root.
The fixed original wrapper identity is represented by a verified relative argument
so repository spaces work with the existing host parser. Node validates the exact
root/argument, and Python independently validates profile, manifest-hash shape and
bounded stable worker-main/source equality before imports. Default model paths,
the legacy argument constant and real single-training dispatch remain unchanged.
Bounded reference hashes do not replace native filesystem custody or supplier
ownership. Physical input/readiness/package/UI outcomes and complete owned cleanup
need their own reviewed execution evidence; no source pass supplies them.

### Fixed Headless testing restriction

The roadmap engine's existing technical-policy event has one finite active
restriction profile for the user's Headless increment-7 instruction. Its exact
original approval, controlled criterion, plan and completed-prefix witnesses,
accepted feedback, pending review and versioned policy identify the supported
case. The engine owns the revised criterion and test-plan clauses; callers cannot
supply another active plan. The optional evaluation software remains while real
model scoring is outside this increment's tests.

The event archives both plans and the old approval, preserves evidence and
completed work, and invalidates current approval/bindings. Read validation links
the known restricted scope, unique archive and unique event using event/archive
digests; deleting a whole record cannot silently remove the plan guard. This is
cooperative-local consistency rather than authenticated storage. Separate actual narrow
reapproval and fresh qualification remain required. Every non-quality actual
execution, security, resource, native ownership and cleanup requirement stays.
This declarative profile grants no task, test, retry or parent pass. The generic
fully-implemented technical-policy route and other roadmap guards are unchanged.
