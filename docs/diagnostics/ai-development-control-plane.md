# Contributor Control Plane

For user-directed superseded-proposal cleanup, retain exact history, map every
former criterion to its real successor, freeze old execution with the existing
blocker event and use only the registered bounded retirement manifest. Do not
reintroduce the removed Run & Test surface. Mixed legacy human acceptance uses
the explicit scope event and independent classification. Technical qualification
and product approval remain.

- Status: current
- Verification: `dev-tools/helpers/tests/`, `npm run agent-support:check`

## Start a work request

Read `AGENTS.md` and the usual repository context, then start or safely reuse the
JSON-backed review server and provide its returned link to the user:

```text
python dev-tools/helpers/development_control_plane.py review-site start
python dev-tools/helpers/development_control_plane.py status
```

The default port is 8766; a verified instance for the same repository is reused,
or a nearby available port is chosen. Use the returned URL, not a guessed port.
If the host sandbox isolates loopback, use its ordinary approval mechanism to
start the same bounded command in a permitted local environment. Do not expose
the site remotely. Server status and explicit shutdown are available through
`review-site status` and `review-site stop`. An identity mismatch refuses shutdown.

The site reads versioned JSON and `/api/review` returns `development-review-v1`.
Markdown is generated documentation and is never parsed into the site database.
The UI refreshes every five seconds. It has no approval or mutation controls.

Dark mode is the initial display. The top Light mode / Dark mode action remembers
only an explicit validated local preference; missing, invalid or blocked storage
cannot disable the review. This action changes no workflow records or authority.

Expand an increment to inspect its ordered work chunks and acceptance criteria.
Chunks show their planned/completed state, next planned work, linked criterion
outcomes, recorded completion summary and verification notes. "View these work
items" opens that increment's chunks in the Work items tab; each item links back
to its parent increment. Work items also includes actual scoped execution
records, labeled separately. Passing criteria never marks a planned chunk
complete. Legacy roadmap declarations retain their evidence label and never
gain invented receipts or review attestations.

The Roadmaps view shows Open Roadmaps first and Completed Roadmaps afterward.
Completion uses only the roadmap's top-level completion status, never increment
or work-item progress. The canonical status is `completed`; legacy `complete` and
`final-approved` records remain readable with the same displayed badge. Explicit
legacy conversion uses the skill engine's `completion-status-normalized` event,
which preserves final approval, history and evidence without new qualification.
Each section and
the Work items view sort by original creation time, newest first. Completion and
updates do not move older records above newer ones in a section. Chunk creation follows
the recorded plan time (legacy fallback: increment start, then roadmap creation);
equal-date chunks keep plan order and undated records appear last.

## Define bounded work

For the explicitly consolidated security plans, execute only
`security-findings-refresh`. Its **Merged history** preserves the legacy roadmap,
completed increments, original criteria/chunks and primary/companion ownership
mapping. The machine-readable concern review is
`docs/security/security-roadmap-consolidation.json`; historical baseline assertions
are not newly scheduled defects. Recheck current implementation and qualification
gaps before coding. No criterion or scanner closure follows from consolidation.
An invalid, incomplete or stale mapping leaves both records visible with a safe
diagnostic; repair that mapping through scoped work rather than hiding data.

Copy `dev-tools/helpers/control-plane-work.example.json` into ignored
`.local-codex/`, edit it for the actual request, and use an opaque invocation ID.
Use no names, private prompts, credentials or raw chat text. An established fix
uses `kind: lightweight`; substantial work follows the existing roadmap skill
and binds its active approved increment through `roadmap.state_path` and
`roadmap.increment_id`.

```text
python dev-tools/helpers/development_control_plane.py start --from .local-codex/work.json --invocation author-run
python dev-tools/helpers/development_control_plane.py plan-checks example-work
python dev-tools/helpers/development_control_plane.py verify example-work --invocation author-run --claim <returned-claim-id>
```

The plan shows changed paths, per-path coverage, selected/deferred checks and
digests. Every acceptance criterion references registered check IDs. The current
catalog includes documentation, agent-support, control-plane, roadmap,
architecture, source-owned focused tests, dependency security and evaluation.
Unknown impact needs a bounded catalog rule and regression test; do not replace
it with arbitrary shell text or an early aggregate run.
The automatically selected `review-site` profile owns exact HTML, JavaScript,
CSS and DOM-test paths and executes the complete fixed Node DOM/controller file.
It substitutes coarse focused ownership only when all focused impact is explicitly
covered; uncovered paths and an explicit `focused-tests` requirement keep the
generic gate. The receipt must show actual execution. This UI qualification does
not claim a desktop closure, model result or native security pass.
Focused Node/Vitest routing follows actual test imports, rather than words in
test descriptions or fixture strings; controlled AI tests remain opt-in.

Claims last at most four hours. Use `renew` while working, `release` to hand off,
and `recover-claim` explicitly after expiry/release. Recovery issues a new claim
identity and retains contributor history. One source-writing claim is admitted
per checkout, including disjoint scopes: source snapshots cover the whole
candidate. Serialize work here or use separately authorized isolated checkouts.
Live-owner takeover is refused. `status` is read-only; `recover` finishes an interrupted local
publication. Roadmap `apply` and `render` recover their own publication journals.

Back up `.local-codex/control-plane/snapshots/` with the record index and journal.
Baselines are immutable content-addressed JSON; repeated work records reference
the same snapshot. Existing inline records migrate during the next mutation and
retain their original receipts, reviews and events. Both the index and each
snapshot keep an8MiB bound. Missing or corrupted snapshot bytes fail qualification
and are preserved for recovery; restore only verified original bytes. Do not
delete snapshots to free index space or replace missing evidence with a pass.

## Review and complete

A separate invocation reviews the actual candidate, every criterion and its
qualifying receipt. Store the request only under ignored `.local-codex/`:

```json
{
  "schema_version": "technical-review-v1",
  "work_id": "example-work",
  "invocation_id": "separate-review-run",
  "assurance": "operator-attested",
  "disposition": "accepted",
  "receipt_digest": "replace-with-current-receipt-digest",
  "reviewed_criteria": ["outcome-works"],
  "findings": [],
  "closures": []
}
```

```text
python dev-tools/helpers/development_control_plane.py review --from .local-codex/review.json
python dev-tools/helpers/development_control_plane.py complete example-work --invocation author-run --claim <returned-claim-id>
```

`operator-attested` and `host-attested` describe the record's source; neither is
cryptographic identity proof. A contributor invocation cannot review itself.
Do not fabricate a second invocation to satisfy the gate. Request a separate
review through an authorized host, agent or operator. Delegation still needs its
existing authorization.

Findings name `id`, `criterion_id`, `description`, boolean `blocking`, and
`kind: substantive|cleanup`. `changes-requested` requires a substantive blocker;
cleanup cannot block. Correct the source, verify again, and close each finding
with `{ "finding_id": "...", "receipt_digest": "fresh receipt" }` in a new
review round. New verification cannot erase an open finding. Completed work
requires a successor task for corrections.

## Checkpoint reviewed work

Use the roadmap skill's scoped commit procedure for coherent completed, tested
and reviewed chunks. A separately reviewed local component can checkpoint while
parent work or qualification stays pending; status alone is insufficient. Finish
the candidate's check/review recording and release every source claim in the
checkout before changing Git. Stage only owned paths or reviewed hunks with a
verified dependency closure, preserve unrelated changes and report the commit.
Later work starts from a fresh baseline; existing receipts remain historical.
Local checkpoint authority does not include push, history rewrite, main advancement,
parent completion or release.

## Roadmaps and qualification

Before requesting roadmap approval, publish the complete unapproved draft through
the skill engine and verify the live JSON projection against the canonical
roadmap: expected nonzero increments, objectives, criterion IDs/counts and full
details must be reviewable. A discovery-only 0/0 record is insufficient. Repair
missing or stale projection and share the verified site link before asking. The
site remains read-only and publication supplies no approval or implementation
authority.

An explicit user-authorized technical-policy change uses the roadmap skill's
replacement-only `technical-acceptance-revised` event. It preserves criterion
identity/qualification, original evidence/chunks/blockers and completion policy,
archives exact old/new definitions and policy identity/digest, and invalidates old
approval/bindings. Independently review actual authority and retained obligations,
record the actual narrow reapproval and obtain fresh current checks/review. An
opaque reference/digest is an operator assertion, never authenticated permission
or passing hardware evidence. Human-only scope events are separate.

For agent-only acceptance on a started governed roadmap, use the skill's
`acceptance-scope-revised` event after independently reviewing the exact human-only
classification. It removes pure human criteria or revises pending mixed controlled
criteria under the same IDs/qualification, archives originals and invalidates
approval. It never closes work or supplies a pass. The user-authorized narrow
reapproval still needs fresh checks/review; old receipt bindings are stale.
Historical human instructions are superseded/offline, while automated UI,
accessibility and actual performance/model/native/security checks remain active.
Governed evidence declarations do not automatically complete pending increments.
An overall review alone cannot supply target-specific controlled qualification;
retain noncompleted status until actual target-specific qualification passes.
After all implementation is complete, record passing evidence and immutable
reports, create fresh work bound to the pending target with every criterion,
execute fixed checks, obtain separate accepted review and complete it. Consume
exact references with the skill's `increment-qualified` event. Pending-target
authority binds plan/chunks, criterion semantics, latest evidence and report bytes;
changes require successor work. No active increment is invented or displaced.
Consumption makes the target completed and its pending-only receipt historical.
Other targets and final overall qualification retain separate authority.

User-directed offline human acceptance is recorded by the roadmap skill's
`human-acceptance-transferred` event. It may close an implemented increment only
when every remaining technical criterion passed. The site separates the archived
offline user-owned criteria from active criteria and chunk links; no human pass is
invented. Original evidence and plans remain historical. Mixed technical checks
stay pending, and current source-bound closure requirements still apply.
The metadata transfer event is limited to legacy roadmaps. It refuses receipt-
governed roadmaps, which need separately qualified scope changes and fresh evidence.

New roadmaps require control-plane completion for each approved increment, with
the work acceptance IDs matching that increment's IDs. Pre-existing roadmaps
retain their original declarations and fingerprints. A successor roadmap adopts
the current policy; no old pass is silently converted into a verified receipt.

Governed state uses `.implementation-roadmaps/<slug>/state.json`; unsupported
custom state paths are refused during initialization. Choose `completionSuite:
all` in the initialization JSON for AI-related roadmaps, or `standardande2e`
for other work. This choice is bound to roadmap approval. After every planned
implementation chunk is recorded, create an overall work item bound to
`increment_id: overall`, with one
acceptance ID `overall-validation` and check ID `completion-all` or
`completion-standardande2e` matching that configuration. Execute verification,
obtain separate review and complete that item before `roadmap-completed`.
The final increment may still be verifying, provided all predecessors are
implemented, every nonempty planned chunk set exactly matches completed chunks,
approval is current and no blocker is open. Release the source claim before the
serial overall claim and recover it afterward. Earlier aggregate checks are
refused. Pending controlled criteria remain pending and block final closure.
Source edits after qualification
require fresh overall evidence before final closure.

Run focused tests while work remains. After all approved increments are
implemented, run the existing combined suite once, using `test:all` for AI-related
work, and applicable repository gates. Preserve the final temporary report until
the human explicitly approves the complete overall result.

## Execute coding evaluations

`dev-tools/agent-evals/coding-tasks.json` versions five task types: workspace
isolation defect, contract-to-repository context, recoverable UI journey,
authorization denial and decision escalation. Prepare a new immutable trial:

```text
python dev-tools/helpers/development_control_plane.py prepare-trial authorization-denial denial-one
python dev-tools/helpers/development_control_plane.py grade-trial denial-one
```

Preparation returns the task and allowed files in an ignored workspace. An
authorized operator or agent host edits those files under its existing
permissions. Grading executes fixed trusted graders outside that workspace.
Initial fixtures deliberately fail; grade the actual correction again and retain
both attempts. Extra files, missing files, symlinks, changed grader/task policy,
timeouts and stale source fail qualification. The UI grader exercises an actual
failure-to-retry-to-success DOM journey; it is not a visual or production test.

Copy `dev-tools/helpers/control-plane-run.example.json` to ignored storage and
replace the identity placeholders with actual input digests. Record metadata with `record-run --from
.local-codex/run.json`. Required `agent-run-v1` fields are `trial_id`, `model`,
`harness`, SHA-256 `instruction_digest` and `context_digest`, `permission_profile`,
`duration_ms`, `retries`, `input_tokens`, `output_tokens`, `cost_usd`,
`evidence_kind` and `infrastructure_status`. Measurements may be `null`; retries
are an integer. Evidence kind is `operator-hosted-live`,
`deterministic-conformance`, `replay` or `unavailable`; infrastructure is `ok`,
`failed` or `unavailable`. These are immutable operator-supplied declarations,
not automatic provider telemetry. Do not store the underlying private inputs.
Admission requires an executed stable grade and freezes that exact attempt and
source. Later grading or corrections need a new trial; old cheap measurements
cannot be applied to a later successful candidate.
An optional `work_id` counts accepted work only after current reviewed completion.

```text
python dev-tools/helpers/development_control_plane.py record-run --from .local-codex/run.json
python dev-tools/helpers/development_control_plane.py compare-trials denial-one denial-two
```

Comparison requires matching task, policy, environment, harness, instructions,
context, permissions and evidence kind. It retains every trial and grader
attempt, separates infrastructure failures, and charges all attempted delivery
against distinct accepted work items. Missing cost stays unknown. Safety and
correctness failures remain explicit even when a run is cheaper. These small
versioned conformance tasks qualify the harness; measuring coding-agent quality
requires separately authorized repeated live trials and reviewed trajectories.

## Turn feedback into regression evidence

Copy `dev-tools/helpers/control-plane-feedback.example.json` and adapt it to the
active work scope. Use `open-feedback --from .local-codex/feedback.json` with
`schema_version: outcome-feedback-v1`, unique `id`, active `work_id`, its
`criterion_id`, a bounded `summary`, `kind` (`defect`, `usability`, `accessibility`
or `performance`), a `trial_id` with an actually executed failing regression,
and a scoped durable executable test `regression_path`. Run candidate verification
with that newly added regression failing before opening feedback. Admission
also executes the designated test alone; an unrelated owner-suite failure cannot
supply its failing baseline. A timeout or unavailable check cannot
stand in for a reproduced defect. Completed work needs a successor correction.

Correct the trial and implementation, preserving that regression's assertions,
grade the same trial successfully under unchanged policy, verify the candidate
and obtain its independent acceptance. `close-feedback <id>` binds the failed
and passing attempts, current receipt, review and regression artifact digest.
Closure executes that same repository test alone and requires it to pass. Changing
the regression itself needs new failing evidence. Open feedback prevents work completion. Optional `quality_evidence` entries name
`kind` (`accessibility` or `performance`), `environment`, `evidence_ref` and
`qualification` (`operator-attested-measurement`, `pending` or `unavailable`).
References do not invent measured user success or production qualification.

The site's Work view shows check duration, retries and review corrections;
Evaluations shows actual grading attempts and declared measurements; Feedback
shows regression links and closure. All are allowlisted JSON summaries. Provider
cost and tokens remain unavailable for work without run metadata.

See `docs/architecture/ai-development-control-plane.md` and the owning threat
model for the trust boundary and evidence limitations.


For a substantial slice that exceeds coarse ownership bounds, use a named
source-owned qualification profile in
`dev-tools/config/contributor-check-profiles.json`. Profiles contain exact test
paths only (at most 100), never commands, arguments, globs or controlled AI tests.
The trusted catalog registers the profile's fixed runner invocation; its source
and profile data are part of the verification policy digest. `security-authority`
qualifies the first security slice across model, authentication, persistence,
staging and host/client consumers. This does not substitute for the final all-suite
qualification. Unknown, unsafe, missing or non-test paths fail closed.

`functionality-browse` qualifies the responsive workspace/Composer increment with
exact contract, repository, host, transport, shared UI and owned-probe tests.
Its source coverage is explicit; unrelated or uncovered changes retain ordinary
focused qualification. An explicitly required `focused-tests` check is never
removed by selecting a profile. Completed implementation can use a successor
qualification work item, preserving the original claim and its full change plan.

A registered profile declares exact `source_paths` alongside `test_paths`. It
replaces coarse focused ownership only when every affected source path is covered;
uncovered changes retain the ordinary focused gate. AI suite markers are rejected.
Vitest uses exact include configuration and verifies its collected file set;
positional substring filters cannot add an unselected sibling.

The remaining approved slices use fixed profiles `functionality-tasks`,
`functionality-context`, `functionality-outcomes`, `security-runtime`,
`security-records` and `security-tooling`. Extend their exact test and source
declarations with the corresponding implementation. They grant no new command,
test-suite or resource authority. This is security-relevant verification policy:
unknown paths, controlled AI tests and uncovered changes retain existing denial
or focused qualification; the catalog and declarations remain policy-bound.

## Read implementation progress correctly

The site displays reviewed local support separately from parent qualification.
Maintain the fixed JSON supporting-work map with actual completion receipt/review
references, selected component criterion IDs and explicit partial-scope limits.
Never link an active/failed work record as completed evidence. The projection
validates recorded lineage but does not run tests or infer currentness from an old
completion. Missing local records remain unavailable on another checkout.

"Qualification not recorded" means the parent has no recorded acceptance outcome;
it does not mean every linked component is unimplemented. "Technical check pending"
identifies an agent-executable requirement with remaining declared environment or
automated assertions. Human acceptance is offline. Expand local support to see
recorded work and limits, and follow successor navigation for superseded delivery
plans. Keep canonical failed/pending evidence, native/security/reference gaps and
stronger governed completion guards intact.

For unavailable technical evidence, record the exact limitation and the agent work that remains. Use `blocker-recorded` only when a named person must take a concrete action. Use `blocker-reclassified` to correct an old assignment without resolving unfinished work. A status change is neither a pass nor a claim that independent tasks are complete. Preserve completed increments, technical criteria/chunks, evidence, approvals and all failed attempts. The crosswalk and supporting-work registry must follow current approved agent-only scope; historical evidence keys containing `manual` do not require a human operator. User acceptance stays offline.

## Complete proposal presentation

Maintain precise criterion blocker associations in
`docs/operations/roadmap-blocker-presentation.json`, schema
`roadmap-criterion-blockers-v1`. Rows identify the roadmap/increment/criterion,
bind `source_description_sha256` to raw canonical UTF-8 wording and list
`blocker_id`, `source_blocker_digest` from `control_plane.common.digest` and an
operation explanation in `prevents`. Never associate every criterion merely
because its parent is blocked. Independently review the actual pending target
and authoritative obstacle. Current canonical JSON supplies summary/action;
resolved or changed obstacles cannot be shown through an old map. Bounds are
1 MiB, 1,000 rows, 20 references per criterion and 800 explanation characters.
Mapping failure retains parent obstacle visibility with a diagnostic.

The review site's increment proposal details show dependencies, work packages, deliverables,
verification, rollback and exclusions independently from executed chunks. Draft
review and approved-but-not-started increments explain when chunk planning occurs;
no zero-chunk record is presented as missing implementation work or as a pass.

Maintain readable acceptance formatting in the fixed versioned
`docs/operations/roadmap-criterion-presentation.json` document. Each row names the
roadmap, increment and criterion and binds `source_description_sha256` to the
canonical public description. Its `requirements` array contains `text` and
optional nested `children`. Retain exact ordered wording, including conditions,
connectors, alternatives and numerical requirements; group shared context above
its children. Arrays are presentation only and never independent acceptance
records. All entries are limited to 64 nodes / 3 levels and the document to 1000 rows
and 1 MiB. Missing or stale formatting shows original sanitized wording. Update the
matching row after a governed description amendment; this cannot amend acceptance.

The status key also explains Technical check pending, missing evidence,
passed/failed checks, scoped reviewed support and intermediate skill
states. Pending verification is distinct from a recorded blocker.
Execution records are sorted by original creation before the finite
1,000-record display limit and a byte admission limit below the unchanged
2 MiB response bound. The API exposes total/shown/truncated facts
and a diagnostic if either limit is exceeded; current work beyond the old
200-record cap remains visible without exposing private record fields.
Linked work resolves complete criterion details by exact roadmap/increment/criterion
identity in the same response; it does not duplicate long requirement/evidence
trees or change their qualification.

## Plain-language blocker explanations

An existing issue reference can carry reviewed `plain_language` copy. Legacy
three-field copy remains readable: `needed` (400 characters), `prevents` (800)
and `action` (800). New complete explanations also require `responsible_role`
(160), `user_action` (800) and `done_when` (800). The exact current criterion and
unresolved issue digests govern every explanation. Shared copies must agree.
Invalid, conflicting or stale copy produces a diagnostic; the page requests clear
instructions instead of displaying technical source text or inventing an action.
All text stays sanitized and inert. Presentation grants no authority or test pass.

Parent and affected-criterion views show the responsible role, the user's action,
the remaining work and its completion check. Technical summary/action text stays
in versioned JSON for agents. No technical-details accordion appears in these
issue cards. Distinguish supplied access from successful tests. Do not request
credentials again after the user supplied them.

## Human actions and agent work

**Blocked** means a person must do a specific action before the affected work can
continue. Unfinished agent implementation and available automated checks stay
pending. Record who must act, the action, where to do it and the result needed.
Use the roadmap engine's `blocker-reclassified` event to correct an old label. It
archives the old responsibility without resolving or qualifying technical work.

The review site separates human-action **Blockers** from agent-owned **Pending
work** under the affected roadmap and criterion. Its user explanation states the
responsible role, the user's action, the remaining work and the completion check.
The technical definition stays in JSON for agents. Simplifying text or changing
responsibility cannot supply credentials, grant restricted authority, bypass a
safety guard, approve new scope or close a technical acceptance check.
