# AI Development Control Plane

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

The projection orders roadmaps and work items by normalized creation time,
descending. Work uses its initial event and chunks use plan recording time with
legacy increment/roadmap fallbacks. Unknown dates sort last and equal timestamps
retain deterministic identity/plan order; source modification time is not used.

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
