# Implementation roadmap workflow

## Invariants

- Repository instructions and implemented behavior remain authoritative.
- The user approves high-level product or architecture options and the roadmap.
- A request to draft, inspect, research, or review is not implementation approval.
- Implementation proceeds in ordered increments. Each increment is researched and
  planned immediately before its code changes.
- Once implementation is explicitly requested and the roadmap is approved,
  execution continues automatically through all approved increments. Routine
  increment boundaries are not approval gates.
- Durable roadmap/state artifacts and a temporary local report supplement
  conversation state; they do not replace user communication.
- Evidence describes what actually ran. Pending, skipped, and controlled-environment
  checks remain visibly distinct from passes.
- Every roadmap and increment records a security impact disposition. Security is a
  universal, proportional design constraint, not an optional final gate or a concern
  limited to security-named work.
- The state engine records workflow facts but never runs implementation or test
  commands.

## Artifact model

Maintain three repository-relative files:

1. A Markdown roadmap for approved intent, increment definitions, acceptance
   criteria, verification, rollback, and exclusions.
2. A concise Markdown implementation report under ignored `docs/tmp/` for current
   status, increment progress, current or next work, recent chunks, unresolved
   feedback, blockers, and the next checkpoint.
3. A JSON state file as the canonical input for deterministic rendering.

The roadmap and state are durable; the report is local-only, intentionally minimal,
and temporary. Never duplicate the full roadmap, evidence ledger, event history, or
all completed chunk detail into it. The engine adds a generated notice to both
Markdown files. Do not edit them directly. Use an event to change state. Use
`report-relocated` for a legacy report outside `docs/tmp/`, and use `render` only
to repair drift or finish an interrupted multi-file write after reviewing the
difference.

Never store secrets, credentials, protected prompts, private payloads, exploitable
production details, personal data, or raw retrieved content in any roadmap artifact,
event, evidence summary, report, or test fixture.

## Preparation loop

### 1. Discover

Inspect:

- all uncommitted changes and current branch status;
- repository and area-level agent instructions;
- the repository and documentation entry points;
- affected code, tests, adapters, hosts, and user interfaces;
- accepted architecture decisions and explicit open decisions;
- relevant issue, review, CI, and prior roadmap evidence supplied by the user;
- primary external sources when behavior is current, specialized, or high risk.

Record summaries and source links, not raw retrieved content. Make code/documentation
conflicts visible under repository policy.

Apply `docs/standards/security-by-design-standards.md` during discovery and record one
of these dispositions in the structured `securityImpact` field:

- `not-security-relevant` with a concrete reason the work changes no trust,
  authority, sensitive-data, execution, dependency, side-effect, or public
  diagnostic boundary;
- `security-relevant` with protected assets/data, actors and authority, entry
  points/trust boundaries, abuse/failure cases, controls, verification, rollback,
  and residual risk.

Load the security pack and applicable canonical threat models for
`security-relevant` work. Uncertainty or a material identity, tenancy, secret,
sandbox, public exposure, encryption, retention, audit, or trust choice is a
decision gate, not permission to assume a permissive default.

### 2. Decide

A high-level decision is one whose alternatives materially change architecture,
public behavior, persisted data, migration, compatibility, security boundaries,
operational ownership, scope, or roadmap shape.

Present two or three options. Exactly one must be recommended. For each option state:

- the outcome;
- tradeoffs;
- foreseeable consequences;
- why the recommendation best fits the discovered constraints.

Wait for a real user response. If the response modifies an option, update the
proposal and ask again rather than recording an approval for stale text.

### 3. Define economically cohesive increments

Use the fewest substantial vertical slices that remain independently useful,
reviewable, reversible, and verifiable. An increment is a high-value integration
boundary with fixed research, planning, reporting, test, and approval cost; it is
not a synonym for component, layer, page section, or work package. Every increment
contains:

- a stable id and contiguous number;
- objective and dependencies;
- work packages and deliverables;
- acceptance criteria with local or controlled-environment qualification;
- `security-impact-reviewed` or a more specific security acceptance criterion;
- verification methods;
- rollback strategy;
- explicit exclusions.

Dependencies may point only to earlier increments. Make deferred work and external
qualification visible.

Security cannot be excluded as a whole. A specific deferred threat or hardening
item names the boundary, rationale, residual risk, and successor decision/work.
Rollback, migration, recovery, compatibility, and legacy paths must remain at
least as secure as the forward path.

Audit every boundary between adjacent increments before requesting approval:

1. State the independently useful outcome on each side.
2. State why separate approval, dependency ordering, rollback, migration, security,
   operations, or controlled qualification is necessary.
3. Merge the increments when that rationale is absent, when they touch the same
   user behavior and verification surface, or when one mainly creates foundations
   consumed only by the next.

Use work packages and per-increment chunks for closely coupled internal outcomes.
Shared UI primitives and their first page consumers normally belong together.
Related tabs, cards, grids, filters, modals, labels, import instructions, and
responsive work on one experience normally belong in one increment. Different
files, layers, hosts, tests, or documentation do not alone justify another
increment.

### 4. Obtain roadmap approval

Present the full roadmap with its recommendation and important assumptions. Wait for
explicit approval before recording the approval event or editing implementation
code. Approval is fingerprinted; changed decisions or increment definitions require
new approval.

### 5. Reconcile plan continuity after approval

Approval boundaries may split the interaction into multiple conversation turns, but
they do not reset the roadmap task.

Before requesting approval:

- persist the proposal and render the roadmap/concise temporary report;
- leave the active working plan with a specific post-approval continuation step;
- make the durable report link available to the user.

Immediately after the user responds:

1. Load status, validate generated artifacts, and inspect any worktree changes.
2. Compare the response with the exact proposal that was presented.
3. Continue the prior working plan when the proposal was accepted unchanged: mark
   the approval gate complete and make the next pending step active.
4. Replace the plan only when the response changes scope, ordering, decisions, or
   acceptance criteria. State why replacement is required and carry forward all
   still-valid work.
5. Reconstruct a missing host-side conversational plan from the JSON state and
   generated report before any further task action.
6. Apply the approval event and confirm the next checkpoint.

Never drop the broader objective or remaining increments merely because the user
approval reply is short. Never proceed with no active plan when the larger request
still has pending work.

## Per-increment execution loop

### 1. Reconcile

Before starting or resuming an increment:

- inspect the current worktree;
- compare existing changes with the approved intent;
- check outstanding feedback, failures, and blockers;
- verify the roadmap approval is current;
- run narrow diagnostics needed to establish the baseline.

Do not delete or rewrite unrelated work. If reconciliation requires new scope or a
high-level choice, record feedback, invalidate approval, and ask the user.

### 2. Research

Research the specific increment even when roadmap-level research exists. Inspect the
nearest implementation, tests, documentation, contracts, boundaries, and current
primary sources. Record conclusions, risks, and links. Research must precede the
increment plan.

Refresh the security impact screen against current code and scope. For
`security-relevant` work, record the abuse/failure cases and control owners that the
increment must prove. If the disposition changes, reconcile scope and approval
before editing.

### 3. Plan

Write an implementation plan with:

- ordered steps;
- coherent work chunks;
- acceptance criteria covered by each chunk;
- focused tests mapped to internal chunks;
- completion tests and gates limited to the completed increment's changed surfaces;
- combined standard and end-to-end coverage plus repository-wide gates reserved
  until every roadmap increment is implemented, with the AI suite added only for
  AI-related roadmaps or an explicit request;
- documentation updates;
- assumptions;
- rollback.

Map the security criterion to at least one chunk, focused denial/failure-path
checks, applicable completion gates, documentation or threat-model updates, and a
safe rollback. Positive-only testing is insufficient for a changed security
boundary.

Every criterion belongs to at least one chunk. A chunk should be reviewable and
produce an observable outcome, commonly a contract/use-case slice, adapter/host
slice, UI slice, migration slice, or verification/documentation slice. Do not make
each file its own chunk.

### 4. Implement and report

After a meaningful chunk or a useful batch of closely related chunks:

1. Run its narrow checks.
2. Record files or areas changed, tests, documentation, and feedback addressed.
3. Update state so the concise Markdown report is regenerated.
4. Give the user a clickable report link and a concise outcome/update.

Reasonable report checkpoints include completion of a vertical slice, a resolved
defect, a host integration, a significant UI outcome, or a gate/review boundary.
Batch minor internal chunks into the next such checkpoint. While any planned chunk
remains unimplemented, run only the focused tests for the chunk being changed. Once
an increment is implemented, run only tests and gates relevant to its changed
surfaces. Do not run the complete standard suite, complete end-to-end suite, AI
suite, or aggregate matrix while roadmap increments remain; add or run a focused
regression instead.

### 5. Verify and complete

Only after every planned chunk is implemented and its focused tests pass, run the
plan's increment-relevant completion tests and gates. Record their results as
increment evidence before applying `increment-completed`. If an increment check
fails, return to focused diagnosis and focused regression tests; rerun only the
relevant completion set after the repair is ready for another increment
qualification.

Record evidence separately for each acceptance criterion. The latest evidence is
authoritative. A controlled-environment criterion may remain pending only when the
increment explicitly permits it; the increment then becomes
`implemented-pending-qualification`, not complete. Later passing evidence promotes
it to complete.

Security evidence states the disposition and uses sanitized summaries. A
`not-security-relevant` criterion records review evidence and rationale. A
`security-relevant` criterion identifies controls, denial/failure-path results,
residual risk, and any controlled-environment evidence without copying secrets,
private content, provider-native payloads, paths, or exploitable production detail.

After every increment is implemented and its relevant checks pass, run the
repository-defined combined standard and end-to-end coverage, followed by the
applicable repository-wide gates, once for a non-AI roadmap. For an AI-related
roadmap, run the all-suite command instead so the AI suite is included. Do not run
AI or all-suite coverage for non-AI work unless explicitly requested. Record these
overall results before `roadmap-completed`; do not infer controlled-environment
passes from them.

An increment closes only when every planned chunk is recorded and every criterion
has passing or explicitly permitted pending evidence. A roadmap closes only when all
criteria, including controlled-environment qualification, pass.

After an increment closes, start the next approved increment without asking for
routine confirmation. Pause only for stale approval caused by changed scope or a
high-level decision, newly required authority, destructive or production action,
credentials or external coordination, an unresolved security policy choice, a
genuine blocker or controlled-environment gap, or an explicit user-requested
checkpoint. This continuation rule does not infer initial implementation approval,
expand scope, or remove final overall approval.

After recording `roadmap-completed`, present the concise temporary report and wait
for explicit user approval of the overall completed work. Record
`final-approval-recorded` only after that response. That transition removes the
generated report from `docs/tmp/` while retaining the durable roadmap and JSON
state. New scope after final approval requires a successor roadmap.

## Feedback loop

Classify each feedback item:

| Category      | Typical handling                                                      |
| ------------- | --------------------------------------------------------------------- |
| clarification | Apply within the increment if approved intent is unchanged.           |
| defect        | Fix in the current or targeted increment and add regression evidence. |
| verification  | Update checks or evidence without rewriting product scope.            |
| environment   | Record a blocker or controlled-environment qualification.             |
| decision      | Stop and obtain a new high-level option approval.                     |
| scope         | Stop, revise or replace the roadmap, and obtain roadmap approval.     |

When scope feedback changes only roadmap granularity, preserve completed increments
and evidence, replace the still-pending suffix with fewer cohesive increments through
`roadmap-revised`, render the proposal, and obtain renewed roadmap approval.

Record a disposition of accepted, deferred, needs-decision, or blocked plus a
specific next action. A high-level or scope-changing item invalidates roadmap
approval.

## Block and resume loop

Record the exact blocker and required external action. When it clears:

1. Inspect worktree and generated artifact drift.
2. State what changed while work was stopped.
3. Reconcile partial changes against the current plan.
4. Re-check approval fingerprints and unresolved feedback.
5. Restore or reconcile the active working plan from durable state when the host-side
   plan is missing, stale, or unrelated.
6. Record a resume audit and rerun affected baseline checks.
7. Continue at research, planning, implementation, or verification according to the
   last proven state.

Never treat a cleared operating-system or sandbox issue as evidence that product
checks now pass.

## State recovery

- `validate` detects state errors and generated Markdown drift.
- `status` identifies the next checkpoint without changing files.
- `apply --dry-run` validates a proposed event without changing files.
- `render --dry-run` previews whether state can render.
- `render` restores generated Markdown from canonical JSON state.
- After final approval, a missing temporary report is expected and `render` must
  not recreate it.

If a write is interrupted, inspect state and Markdown diffs before choosing the
canonical version. Do not overwrite hand-authored content unless the generated
notice proves the file belongs to this workflow.
