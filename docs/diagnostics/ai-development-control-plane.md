# Contributor Control Plane

For clear user wording, update the versioned
`docs/operations/roadmap-user-descriptions.json` with the technical source in the
same change. Independently compare every clause before publication. The production
HTTP view uses admitted user copy; `review-data` stays technical for agents.
Source/qualification mismatches produce a description-update diagnostic and an
agent action, never a human blocker or a raw technical fallback. Keep original
definitions, results, scope, human approval controls and historical evidence.

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

The `settings-ui` profile owns the exact Settings renderer, client and API paths.
It runs four fixed synthetic panel, page, request-ownership and API test files.
It covers failed secret save/clear, explicit refresh, late responses, duplicate
admission and fixed public errors. Unknown impact and an explicitly required
generic test gate retain their coverage. It starts no app or model and uses no
real credential store or provider. Actual host restart and final combined
qualification remain separate.

The `security-status-ui` profile runs six fixed thin-client status, rendered
recovery, API, credential-comparison and error tests. It uses synthetic browser
storage and fetch clients. It preserves public/authenticated routing, exact
credential replacement, safe failure copy and intentionally unmounted controls.
Unknown or explicitly requested generic impact keeps its checks. It starts no
server, browser, model or provider and grants no TLS, identity, native or parent
qualification.

The fixed `operational-ui` profile runs 40 literal runtime, notification,
task-family, shell, dashboard and readiness files. Automatic selection uses its
nineteen specific runtime, notification and host-definition source/test paths.
Shared README files and borrowed regressions do not activate it for another
feature's profile.
Node and Vitest files keep
their actual imported test runner. Held replies cover current-view/action
ownership and safe recovery. Rendered notification actions preserve active tasks
and other workspaces. The production-message guard includes current contextual
panels and excludes colocated tests with explicit counterexamples. Unknown or
explicit generic impact keeps its checks. The profile starts no actual app,
worker, model or provider and grants no native, offload, real-host or parent pass.
Its two additional unit files qualify closed observation facts and the fixed
operational desktop slot. The named `packaged-desktop-operational-ui` and
`thin-client-operational-ui` Playwright cases remain unexecuted until the separate
host qualification run. They preserve current disclosure/navigation and existing
setup/cleanup, use a read-only synthetic503 for Security recovery, disable capture,
and attach only bounded fixed phase facts. UI Stop/ready facts do not establish
physical process termination, model accuracy or provider/TLS qualification.
Refresh records only its settled display; exact foreground-read dispatch is
proved by focused footer tests. Restart requires new stopped/spawned log entries.
Clear log keeps the canonical confirmation and removes prior lifecycle entries.
The report oracle snapshots only dense own data fields and rejects custom
iteration, accessors, sparse observations and extra fields. Proxy values are
refused before reflection so their traps cannot execute.
The added accessibility test checks strict rule/count/retry accounting and the
browser-local contrast callback with synthetic DOM fixtures. The v2 accessibility
report stores no selectors, raw audit messages or user agent. Its fixed failure
stages preserve unresolved checks. Contrast scroll/retry stays in the browser;
actual computed host accessibility, native zoom and timing remain pending.
Retry targets retain positive finite bounding boxes. Setup failures have fixed
stages, and browser scale is validated before publication. Media restoration
precedes passed publication; failed attachment/storage finalization writes failed
evidence when storage permits. The actual failed test receipt always prevents a
pass, including when evidence storage is unavailable.
The critical-surface core adds closed Settings, thin Security and Notifications
audit definitions at 1440 px and 320 px. Both widths, named profile/scale, motion,
reflow and actual computed rule/count outcomes are required. The fixed document
collector admits no caller selector. Current operational journeys call it only
after their mounted-state assertions. Reports use a bounded hashed test context
and exclusive initial creation; an existing entry is refused without overwrite.
This is ordinary owned-run hygiene; hostile filesystem/native identity is still
unqualified. The definition restores the declared 1440 px/no-preference base, not
an unknown prior OS window state. Synthetic callback tests qualify no real host.
Data and Context add ten closed surface IDs for file selection, preparation,
version history, row review/editing, output structure, RAG/Context pack review
and saved Context detail. Audits run at stable initial states outside timed
imports and repeated rebuilds. Required TestInfo follows both initial host
callers. Approval, exact bytes/lineage/workspace and restart checks remain.
These borrowed consumers have explicit Operational coverage without becoming
automatic Operational triggers. Other critical consumers, OCR-specific views
and startup/responsiveness definitions remain separate.

The fixed `control-plane` unittest command has a ten-minute execution ceiling.
Its growing filesystem and Node fixture matrix exceeded the earlier three-minute
ceiling while making successful progress. The earlier timeout remains failed
evidence; the new ceiling is prospective and is not a passing result. The exact
command, two-MiB output bound, test membership and all other check deadlines stay
unchanged. This is an ordinary contributor-test ceiling. It changes no app,
model, memory, native-job or retained-data guard, and provides no caller override.
Focused Node/Vitest routing follows actual test imports, rather than words in
test descriptions or fixture strings; controlled AI tests remain opt-in.

The `host-memory-fixture` profile runs the two fixed synthetic worker/fixture
test files and the shared, desktop and thin-client output-mode renderer tests.
It also runs the fixed runtime protocol, worker-capacity, worker-app and deployed
entrypoint tests.
It checks memory notifications, stable initial recommendations and explicit
choices during readiness loss. It does not run models, accuracy, physical-resource
or native/offload qualification. Execute and retain the actual packaged-desktop
and thin-client Playwright journeys separately before claiming host delivery.
The `ingestion-publication` profile runs fourteen fixed ordinary file-ingestion tests:
publication and task repositories, bounded byte storage, desktop and server
composition, dataset source staging, website compatibility and HTTP boundaries.
Its host fixtures use owned synthetic files with no model or provider calls.
It covers only its declared source paths. Unknown impact and an explicitly
required focused gate retain generic coverage. This component check grants no
controlled-provider, scale, native-race, offload or parent-roadmap qualification.

The `native-host-policy` profile runs only the fixed native-launcher policy
test file. It checks exact private package, combined UI, web-only and desktop-only
commands, unchanged limit selection, source/environment witnesses and injected
owner retirement refusals. Normal execution leaves actual Windows qualification
skipped. An explicit physical run still needs its separate review and authority.
This profile does not start an app, run a model or prove memory savings. Keep
actual native readback, serial app setup, per-host measurements and parent
qualification pending until separately executed. Unknown impact and an explicit
`focused-tests` requirement retain generic coverage.

The `host-setup-policy` profile runs one fixed Node lifecycle/binding test file.
It checks the pure thirteen-key environment projection, normal and provided-data
plans, invalid values, exact argument preservation, input/ambient immutability,
credential exclusion and existing injected lifecycle cases. It opens no app,
browser or model. The shared setup still reads actual source identity before
applying runtime bindings. A separately reviewed desktop-only consumer can use
the pure projection without calling the combined service-starting setup; it must
still validate its source/package and prove actual native retirement and app
results. Unknown impact and explicit generic focused checks remain selected.

The same focused file checks standalone desktop identity preparation with inert
files and an injected runner. Trusted serial callers can reuse
`preparePackagedDesktopQualificationIdentity` after actual source/package checks
and pure environment binding. Its default seed command, data root, timeout and
failure behavior remain the existing ones. Normal shared setup still builds
before seeding. The export neither starts browser services nor grants permission
to use an unverified package; real serial/native/app evidence remains pending.

The broader `functionality-outcomes` profile remains intact; a narrow profile
cannot cover unrelated changed paths or grant a parent qualification.

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

An execution-record display limit is not record corruption. The site reports the
number of recent records shown; older records remain saved. Its public summaries
include only success and problem text used by the browser. Use the technical
status command for full saved work context and actual recovery guidance. The agent
handles display maintenance. A limit notice must not hide a simultaneous genuine
record error or turn unavailable qualification into a pass.

## Windows qualification process lifetime

Use the separate launcher documented in
`dev-tools/helpers/native-qualification/README.md` only for fixed local test
workloads. Qualify its model-free native self-tests before a separately reviewed
package/UI operator uses the private composition. The older
`control_plane/qualification_job.py` remains a closed Python fixture; its pass
does not qualify another command or larger limits.

Do not treat a completed root process and drained output as complete cleanup.
The new job must report the exact native root exit, zero active members and
acknowledged stream/handle retirement. A known failed command with proven
retirement is still a failed test. Unknown retirement prevents a successor
phase and retains the new run's failure record. No PID/name-based cleanup,
old-fence override or partial-package reuse is permitted.

The limits are 32 active job processes, 1 GiB commit per process and 8 MiB saved
output per stream. Fixture/package jobs retain 2 GiB aggregate commit. Only the
fixed combined ingestion UI role has a 3 GiB job ceiling, selected by an exact
issued immutable intent. No caller quota, environment override or CLI budget
exists. These are ceilings, not reservations. Use finite
reviewed deadlines and a short fresh confined temporary path. Keep earlier
attempts and their logs intact. This local support does not pass a parent
roadmap, model, offload, native file-protection or disk-accounting criterion.

Fixed pipe-only tests use detached creation without a console. Keep exact
expected counts. If a test fails, inspect its actual native journal and obtain
independent review before a corrected source revision starts a separate family.
Preserve old failures and fences. A possible Windows console helper is an
explanation to test, not authority to loosen counts or adopt an old process.

Two actual thin UI attempts hit the earlier 2 GiB job ceiling before desktop
started. A fixed 256 MiB Node old-space sub-budget lowered a single-process peak
but did not make the combined topology fit. Keep those failed observations.
The role-budget revision uses the separate fixed
`native-ui-budget-command-selftests-v3` family: the seven lifetime cases plus
exact native 3 GiB UI-budget readback. Readback allocates no such amount and
grants no UI pass. A new separately reviewed actual host run is still required.
No product, model, retained-file or offload guard changes with this test profile.

## Bounded semantic curation checks

The `dataset-semantic-curation` profile runs three fixed ordinary Python unit
files for semantic curation, advanced content lineage and dataset quality. Exact
semantic source, test and worker README changes select it automatically. Its
declared controller/configuration paths do not cover unrelated runtime changes;
those retain generic focused verification. The profile loads no model or native
supplier and makes no provider call. It does not qualify real host delivery,
physical memory, the separate native identity profile or a parent roadmap.
Broader functionality and native checks remain separate and retain their results.

## Portable OCR provider checks

`ocr-provider-contract` is a fixed source-owned profile for the bounded request,
readiness, result, strict private framing, resource identity and process failure
semantics inside the managed Python runtime. Changes in `worker/ocr/`, its exact
portable tests or its explicit native qualification operator select it automatically. Its explicit
coverage never suppresses unknown source impact or a required generic check.
The profile executes six standard-library test modules and one Node test file; it does not load models,
launch Windows OCR, access provider credentials or qualify the Data roadmap.
Use actual native/provider and product checks for the later implementation.
The model-free Windows operator creates only fresh synthetic test resources and
new owned jobs, using the installed compiler and SDK. It is not an ordinary test,
a compiler fallback in the app, a model test or a parent qualification pass.

The `ocr-provider-contract` profile includes portable provider source/readiness/
page binding and cancellation/error checks. The explicit Windows synthetic
document operator remains a separate controlled check, never an implicit profile
command. Preserve its actual result and source hashes separately. It cannot
grant product OCR availability, packaging, normalization, host or parent closure.

The OCR profile also selects the fixed Python builder, Node hook, their portable
tests and Forge configuration. It runs six standard-library test modules and one
Node test file without compiling or launching OCR. Build changes additionally
require the dependency gate. The explicit development build uses isolated Python,
fixed installed SDK inputs and bounded compiler output/time. Actual fixed-path
readiness, document smoke and copied-resource identity are separate controlled
evidence. Preserve their raw source/build hashes; neither a portable pass nor a
build alone grants application OCR availability or Data-roadmap completion.

The same OCR profile owns provider-neutral complete-PDF recognition and explicit
scanned-PDF normalization. It runs nine Python modules and one Node file,
including existing Standard extraction regressions with installed worker
dependencies. No model, native engine, credentials or downloads run in that
profile. The separate native document operator adds actual fixed-product-resource
normalization after the trusted build. Its source/resource identity, exact spans
and strict retirement support this adapter only. Public capability/task/staging
and actual desktop/browser delivery still need their own evidence.

## Controlled OCR delivery scenario

The fixed native package/UI composition also permits exact `ocr-documents`.
It retains the existing command forms, source/environment hashes and
retirement guards. It does not permit arbitrary Python, commands, roots or
parameters. Its fixed approved OCR limits are described below. The owning
reviewed composition launches the actual newly packaged
worker and substitutes only bounded synthetic generation. Both host dependency
preparers remain real. Validate copied OCR resources independently of package
exit status, since optional OCR build failure preserves Standard startup.

The portable OCR profile now covers the fixed fixture and launch-plan regressions
plus existing host lifecycle/preparation checks. It does not run the actual app
journeys, OCR supplier, native lifetime self-tests or models. Those controlled
checks keep separate current-source observations and independent review. See
[OCR qualification](../../dev-tools/scripts/qualification/visual-composer/ocr-qualification.md).

Native limit reports include bounded advisory message/process numbers and the
created root's number so a reviewer can correlate saved test evidence. Missing
or invalid process numbers are `null`. These numbers do not identify a current
process and must never be used to open or act on one. Collection shares the
existing 4,096-event and 128-message-per-poll bounds. All memory, time, handle,
retirement and failure rules stay unchanged. A limit hit is still a failed
workload; a missing notification is not evidence of success.

The separate private `ocr-runtime-import` diagnostic checks installed Torch import
and its accelerator query under the unchanged 1 GiB process and 2 GiB job limits.
It uses a fixed existing Python environment, fixed script, new confined directory,
minimal offline environment, 32-process ceiling and 20-second deadline. It does
not run a model, an accuracy check or the production dependency-preparation flow.
Its new directory, environment and minimized output are deliberate differences
from production. No earlier failed process is identified by this new run.

Only this closed role discards supplier stdout/stderr before disk retention and
the first-line queue. Observed-byte counts and the 8 MiB overflow rule remain
active. At most three exclusive, synced, bounded JSON facts record startup stages,
the child's own process numbers and typed results or error class. No supplier
exception text is retained. Check those actual facts together with the native
root, limit and retirement observations; exit zero alone is insufficient.
Current source review and one-use execution approval are required separately.
This diagnostic grants no guard waiver or OCR, host, model or parent pass.

### Approved OCR startup profile

The fixed OCR test profile is capped at 2 GiB per process and 4 GiB per job.
Only issued `ocr-documents` package/UI intents, the new direct-interpreter
`ocr-runtime-import-v2` diagnostic and the closed `ocr-budget` fixture select it.
Standard profiles retain their 1 GiB process, 2 GiB package and 3 GiB UI limits.
All profiles keep 32 members and the existing time, output, ownership,
retirement and fencing controls. The approval defines a bounded calibration;
it is not a reservation or proof that a workload fits.

The v2 diagnostic pins the base executable and existing venv/config. It uses
the fixed CPython venv launcher context while directly starting the base image.
Its child uses `-I -B` and retains Python 3.12 site activation. Before Torch
import, the first safe fact checks the exact executable, venv and base prefixes,
isolation flags and guidance-distribution context. These are fixed booleans;
paths and supplier exception text are not published. The separately reviewed
consumer must match every fact PID to the retained created root. It must not
accept an arbitrary descendant, parent match or advisory limit-message PID.

New native evidence uses the v4 family with nine lifecycle and profile-readback
cases. A previous v3 fence prevents execution. The diagnostic uses a fresh v2
family and refuses `runs/FENCED.json` in either diagnostic family, as well as
parent-level fences. Preserve the original v1 failure, all old
limits and actual app failures. Only current native evidence plus completed
identity/import/query facts and strict retirement can qualify this startup
probe. Real production preparation and both OCR app journeys remain separate;
no model accuracy checks are reopened.

The local state writer checks both the exact state bytes and exact recovery
journal bytes against the unchanged 8 MiB bound before publishing either. The
journal uses compact JSON whitespace so wrapping a near-limit state does not
add another indentation level to every saved line. State encoding, parsed-value
digests, revision/conflict checks, atomic writes and recovery remain unchanged.
Readable older indented journals remain supported. A genuinely full state or
journal is refused before publication; formatting is not permission to remove
history or enlarge the limit. Preserve any unreadable retained journal and its
state/index for reviewed recovery. Never delete it to make a command proceed.

### Assets interface feature checks

`asset-authoring-ui` runs ten exact files through the existing fixed Node/Vitest
runners. It retains all eight Studio, package import, derived customization and
notification-publisher interface files. It also runs the desktop authoring client
and registered authoring IPC files for the Saved read boundary. These component
tests use finite client, bridge, repository and sender fixtures. They do not launch
Electron or qualify actual host authorization, storage, providers, native workers
or model accuracy. Use the profile for feature-level Assets work; retain those
separate checks and any parent qualification.

The profile replaces generic focused ownership only for its exact declared
source/test paths. Uncovered impact and an explicitly required `focused-tests`
check retain the ordinary gate. Existing path confinement, controlled-AI
exclusion, fixed argv, exact Vitest collection and policy digest rules apply.
Selecting this profile does not erase failed broader receipts or close parent
roadmap qualification. Adding an unrelated path requires its own coverage.

### Desktop startup feature checks

`desktop-startup-ui` runs the exact desktop lazy-page interface and Forge
packaging-boundary test files through the fixed Node runner. These cover finite
rendering, relative renderer/preload packaging and owned loopback Vite fixtures.
The profile declares only the desktop bootstrap, startup display, main window,
area guidance and configuration surfaces needed by the startup work. Some
declared startup paths can be introduced by its next governed feature change;
no missing test or arbitrary command is allowed.

Use this profile for startup feedback and failure recovery. It does not launch
the actual Electron application or qualify its first cold start, providers,
models, native workers or final combined testing. Unknown impact retains the
generic focused gate, explicitly required generic checks remain selected, and
unsafe/missing/controlled-AI tests retain denial. Existing profiles and their
failures are unchanged. The profile is verification support, not a startup pass.

The system-management-ui profile provides bounded rendered Manage tests for request failures, retries, stale context and duplicate dispatch. It runs only its exact declared source-owned Vitest file through the fixed adapter. Its current receipts and independent review describe local fixtures, not whole-host, native, model or final roadmap qualification.

The system-build-publication-ui profile runs the two exact Build/Publish and published lifecycle interaction files through the fixed Vitest adapter. Source-owned routing covers these three shared surfaces and preserves generic coverage for other impact. Cases cover exact target/reply identity, explicit named lock approval, retry, one-command admission, committed retirement and abandoned renders. Lifecycle checks also cover one physical status-read slot, stale-poll refusal and one authoritative reconciliation after a denied action. Local fixture receipts do not qualify actual hosts, runtime/native, models, providers or final roadmaps.

The `system-runtime-conversation-ui` profile owns only the exact published conversation renderer/preload source and test files. Its fixed Node/tsx and Vitest commands retain the existing safe IPC refusal checks and finite rendered read/turn recovery variants. A connection retry is read-only; successful tests grant no runtime launch, model execution, sender-security, durable restart, native cleanup or roadmap completion. Unknown and explicitly requested generic impact remains covered, and unsafe, missing, non-test and controlled inputs are refused.

The `system-canvas-authoring-ui` profile covers bounded meaningful-system
identity/tree/configuration oracles, protocol/draft units and four related Canvas
rendered files. Its fixed runners exclude whole-host and controlled AI tests.
Actual desktop/browser execution and restart remain separate qualification.

## Assets and System authoring accessibility definitions

The shared critical audit now has fixed points in Assets import, customization,
Studio, Saved assets and asset details. The System browse journey also checks the
compatible element picker, selected Properties, UI preview and Layers tree.
Audits run after existing content assertions and before the original actions.
First-only guards prevent duplicate records during loops and document reloads.

The original package install, asset review/publication, exact base/history checks,
Undo/Redo, save/reopen, keyboard focus, 320px control boxes and Canvas audit remain.
The shared audit returns to the declared 1440px base before later explicit reflow
checks. It adds no provider, dependency, runtime or approval authority.

The Operational profile keeps its 40 literal tests and 19 automatic paths. Two
borrowed consumers receive explicit coverage without becoming automatic triggers.
Focused checks and case collection cover source definitions only. Actual host,
zoom, accessibility, startup/paint and full qualification remain pending. Other
critical workflows still precede the original roadmap chunk's completion.

## Workspace and System lifecycle accessibility definitions

The primary lifecycle cases audit the workspace form, saved System row in Manage,
checked build dialog, ready publication form and initial publish confirmation.
They use the same closed context and fixed private-free document audit. Every
lifecycle caller now declares an initial or repeat audit mode. Missing or invalid
mode is refused before Page access. Primary callers supply the current TestInfo;
the secondary desktop workspace repeats its original lifecycle without replacing
initial audit records or using private System/workspace names in report paths.

Existing checked revision/build/release identities, explicit Build/Publish actions,
cancel/focus return, installation/runtime lifecycle and workspace isolation remain.
The Operational profile keeps 40 literal tests and 19 automatic paths; three
borrowed consumers receive coverage without becoming automatic triggers.

These are source definitions with related feature evidence. Actual host,
accessibility, native zoom, runtime/model, startup/paint and full qualification
remain pending. Standalone runtime mounting, original host diagnostic capture and
other critical consumers remain separate work before original chunk closure.

## Review-site controller check budgets

The existing full controller keeps its 600-second budget. The review-site Node
wrapper now permits that same budget. Only the review-site focused profile uses
630 seconds for each command, and its outer catalogue limit is 660 seconds. The
extra time lets the nested check report failure and exit within its outer limit.
Other focused commands keep their 270-second limit.

The regression test evaluates the actual source callback with simulated elapsed
time. It covers progress after 203 seconds, the full unchanged controller command,
and refusal after 600 seconds. It reads the actual focused and catalogue limits
to detect a shorter outer wrapper. Qualification runs every existing controller
and review UI test. The simulation alone does not qualify that full run.

These limits govern repository checks. Application timers, model and memory
limits, native controls and UI performance requirements retain their existing
requirements. Source-bound support descriptions remain required for every new
review-site evidence label; a description update never supplies parent approval
or technical qualification.

## Published conversation accessibility definitions

The primary desktop lifecycle audits the published conversation window after
ownership and empty-transcript checks. The closed runtime-conversation context
admits only the desktop host. Both initial admission and browser collection require
one fixed runtime main element. Builder checks still require their builder shell.
Callers cannot supply a selector or turn this check into a generic browser audit.

The audit checks the full document at 1440px and 320px. It retains the same reduced
motion, reflow, contrast retry, count-only reporting and failure-aware finalization
rules. It runs only on the first conversation, before input is entered. Existing
input limits, conversation turns, release identity, restart, stop and workspace
isolation assertions remain. Operational and runtime feature profiles are unchanged.

Focused synthetic tests check the definition and its refusal paths. They do not
qualify the real desktop window. Actual host, native zoom, startup/paint, model,
accessibility and full qualification remain pending. No accepted model accuracy
check is rerun, and this source checkpoint does not complete the parent increment.

## Critical display accessibility definitions

The critical audit checks individual visible controls at 1440px and 320px. It
scrolls each control into view before checking finite, positive horizontal
geometry against the viewport. Hidden and inert controls are excluded. Empty or
excessive collections cannot pass. The report contains counts and fixed statuses;
control labels, selectors, text and raw errors stay outside the evidence.

The same audit then enables forced-color mode and verifies that the browser
reports it as active. Reduced motion remains enabled. Both declared widths repeat
the unchanged computed contrast/semantic audit and control geometry check. The
original baseline audit pair remains separate. Media and the base viewport are
restored through the existing failure-aware finalizer; a failed high-contrast or
restoration step cannot leave a passed report.

These checks define bounded test behavior. They do not prove every clipping or
visual layout case, native browser zoom, actual OS display behavior, model quality
or successful execution on a real host. Those checks remain separate and pending
until executed. This source work does not qualify a parent criterion or complete
the original roadmap chunk. Operational profile membership and resource limits
are unchanged; no actual apps, models, OCR engines or full suite are run here.
