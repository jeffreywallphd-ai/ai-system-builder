---
name: manage-implementation-roadmaps
description: Prepare, review, resume, and execute implementation roadmaps as economically cohesive, approval-gated increments with research, high-level options, concise temporary Markdown progress reports, feedback reconciliation, tests, documentation, and evidence. Use when a user asks for an implementation roadmap; asks to implement, continue, review, or resume roadmap increments; requests a skill for roadmap work without naming one; or wants systematic progress tracking across a long coding task.
---

# Manage Implementation Roadmaps

Use this skill to turn a substantial change into an explicitly approved sequence of
increments and to preserve enough repository state for another contributor or AI to
resume faithfully without committing verbose progress reports.

## Start

1. Read the repository agent instructions, root README, documentation entry point,
   current worktree status, affected code, nearest README files, tests, architecture
   decisions, change-impact guidance, and
   `docs/standards/security-by-design-standards.md` before proposing work.
2. Read [workflow.md](references/workflow.md) and
   [events.md](references/events.md) completely.
3. Locate an existing roadmap, temporary report, and state file for the requested
   work. Resume those artifacts when they exist; do not silently create a competing
   roadmap.
4. Apply the repository's mandatory security impact screen before planning. Record
   `not-security-relevant` with a concrete rationale or `security-relevant` with
   protected assets, actors/authority, trust boundaries, abuse/failure cases,
   controls, verification, and residual risk.
5. Treat user feedback, CI output, interrupted work, and uncommitted changes as
   inputs to reconcile before making new edits.
6. Use the term **increment**. Do not rename increments to phases.

Resolve all script and reference paths from the directory containing this
`SKILL.md`. Do not assume an agent-specific skill environment variable.

## Choose the workflow

- **Prepare** when the user needs options or a new roadmap.
- **Execute** when an approved roadmap exists and implementation is requested.
- **Resume** when work or a prior task stopped, the worktree is dirty, a blocker was
  cleared, or feedback arrived after planning.
- **Review** when the user asks for diagnosis, status, or roadmap quality without
  authorizing implementation. Do not mutate product code during review.

The preparation and execution workflows may occur in one task, but never infer an
approval from a request to draft or inspect a roadmap.

## Prepare a roadmap

1. Research the repository and relevant primary sources. Record a concise discovery
   summary, constraints, and source links; never copy private chat transcripts or
   machine-specific paths into tracked artifacts.
2. Record the security impact disposition and sources in discovery. Load the
   repository security pack and applicable canonical threat models for
   `security-relevant` work. Re-run the screen if scope changes.
   The state engine rejects discovery without this structured disposition.
3. Identify decisions that materially affect architecture, scope, compatibility,
   security, data, operations, or user experience.
4. For each high-level decision, present two or three mutually exclusive options.
   Mark exactly one as recommended and explain tradeoffs and consequences.
5. Stop for explicit user approval of the high-level option. Record
   `decision-approved` only after the user actually selects or accepts an option.
6. Define the fewest ordered, contiguous increments that provide sensible approval,
   rollback, and verification boundaries. Each increment must include dependencies,
   an objective, deliverables, acceptance criteria, verification, rollback, and
   exclusions. Every increment includes `security-impact-reviewed` or a more
   specific security acceptance criterion, even when the expected evidence is a
   concise `not-security-relevant` review. Keep closely coupled work as chunks
   inside one cohesive vertical slice.
   The state engine rejects new or revised increments that omit this criterion.
7. Present the complete roadmap and stop for explicit user approval. Record
   `roadmap-approved` only after that approval.

Do not start implementation while an option or roadmap approval is missing or stale.

Security is a non-functional constraint and cannot be excluded as a whole. A
roadmap may exclude a specific threat or hardening item only when it names the
boundary, explains why it is outside approved scope, records residual risk, and
identifies the decision or successor work required. Never use compatibility,
rollback, or availability as a reason to restore an insecure path.

## Size increments economically

Treat an increment as a substantial integration and approval boundary, not as a
component, layer, tab, test category, or planning theme. Every increment pays the
fixed cost of research, planning, reporting, verification, and user review, so use
the fewest increments that still control material risk.

Create a separate increment only when at least one of these is true:

- it delivers independently useful or releasable behavior;
- it crosses a real approval, architecture, compatibility, migration, security,
  operational, or controlled-qualification boundary;
- a dependency must land first to unblock meaningful work outside the roadmap;
- it needs an independent rollback because failure should not roll back adjacent
  work;
- combining it would create an unreasonably large review across genuinely
  independent subsystems.

Do not split increments merely because work uses different files, UI components,
layers, hosts, tests, or documentation. In particular, keep a shared UI primitive
with its first consumers, and group closely related page changes such as tabs,
cards, filters, modals, labels, instructions, and responsive behavior into one
user-visible experience increment. Use work packages and planned chunks for those
internal outcomes.

Before presenting a roadmap, perform an adjacent-increment cohesion audit. Merge
neighbors when neither is independently valuable, they touch the same behavior or
verification surface, or the later increment exists mainly to consume foundations
from the earlier one. If an increment would contain only a small UI adjustment,
rename, helper, documentation update, test-only step, or shared primitive, merge it
unless an explicit risk boundary above justifies separation.

## Preserve plan continuity across approval turns

An approval checkpoint ends a conversation turn, not the larger roadmap task. Never
let asking for approval discard the active working plan or its pending increments.

1. Before asking for approval, persist the current discovery, decision proposal, or
   roadmap definition in the state engine and render the roadmap plus concise
   temporary report. Keep an explicit post-approval step in the active working plan.
2. When the user responds, first reload and validate the durable roadmap state and
   reconcile the response with the plan that was active before the checkpoint.
3. Continue the existing plan by marking the approval step complete and advancing
   the next pending step when the response accepts the proposal unchanged.
4. Replace the working plan only when the response changes the decision, scope,
   ordering, or acceptance criteria. Explain the reconciliation and preserve every
   still-valid pending step in the replacement.
5. If the host-side conversational planning tool was cleared between turns,
   reconstruct it from the roadmap state and report before doing more work. Do not
   proceed with an empty or unrelated plan.
6. Record the approval event only after this reconciliation, then report the next
   checkpoint. Never treat a short approval reply as a new standalone request that
   supersedes the larger roadmap objective.

## Execute each increment

For every approved increment, repeat this loop:

1. Inspect all current uncommitted changes and reconcile them with the roadmap.
2. Start only the next pending increment; do not skip dependencies.
3. Conduct increment-specific repository and primary-source research and refresh
   the security impact screen against the current scope and implementation.
4. Write the increment implementation plan before editing. Map every acceptance
   criterion to at least one coherent work chunk. Separately name focused tests
   for internal chunks and completion tests for the whole increment, plus
   documentation, assumptions, and rollback. Map the increment's security criterion
   to the chunks, threat-model or design notes, focused denial/failure-path tests,
   applicable completion gates, and a rollback at least as secure as the forward
   path.
5. Implement one coherent chunk at a time. A chunk is a reviewable outcome, not an
   individual file write.
6. Add or update tests and documentation with the behavior. For security-relevant
   work, cover relevant denial, malformed-input, isolation, bounds,
   non-disclosure, and adapter-failure behavior as well as the happy path. Run only
   the narrow tests for the current chunk while iterating. Never run a full suite while any
   planned chunk in the increment remains unimplemented. After every planned chunk
   is implemented and its focused tests pass, run the completion tests and costly
   repository-wide gates once for the whole increment, immediately before recording
   increment completion. Do not use risk or convenience as an exception to run the
   full suite early; add a focused risk test instead.
7. Record completed chunks and update the generated Markdown report in meaningful
   batches. Keep the report minimally verbose: status, increment progress, current
   or next work, recent chunks, unresolved feedback, and blockers only. Full history
   remains in JSON state and the roadmap. Provide the user a clickable report link
   after a user-visible slice or natural checkpoint, not after every file change or
   minor internal chunk.
8. Attach evidence to every acceptance criterion, including the security impact
   criterion. A `not-security-relevant` criterion uses review evidence with its
   concrete rationale; a `security-relevant` criterion cites implemented controls,
   tests, documentation, residual risk, and any controlled-environment gap.
   Distinguish local passes from controlled-environment qualification; never
   describe pending external evidence as passed.
9. Complete the increment only when all planned chunks and required evidence are
   accounted for. Then begin research and planning for the next increment.

## Reconcile feedback and interruptions

- Classify feedback as a clarification, defect, scope change, decision, environment
  issue, or verification issue.
- Keep in-scope defects within the current increment when its approved objective is
  unchanged.
- Invalidate approval and stop when feedback changes a high-level decision or scope.
- Re-run the security impact screen for feedback that changes scope, data flow,
  authority, side effects, dependencies, rollback, or an implementation boundary.
- Record blockers with the action required to clear them.
- On resume, inspect worktree and artifact drift, resolve the blocker, document the
  reconciliation, re-run affected checks, and continue from the last proven state.
- After every user approval response, perform the plan-continuity reconciliation
  above before research, implementation, or another approval request.
- Treat direct edits to generated roadmap or report Markdown as drift. Review the
  diff, update state with a valid event, or restore generated files with `render`.

## Use the state engine

The standard-library Python engine does not execute commands. It validates workflow
events and renders deterministic repository artifacts.

```text
python <skill-root>/scripts/roadmap.py init --repo <repo> --config <config.json>
python <skill-root>/scripts/roadmap.py apply --repo <repo> --state <state.json> --event-file <event.json>
python <skill-root>/scripts/roadmap.py validate --repo <repo> --state <state.json>
python <skill-root>/scripts/roadmap.py status --repo <repo> --state <state.json>
```

Start from [roadmap-config.example.json](assets/roadmap-config.example.json). Keep
the state and roadmap repository-relative and tracked. Keep the concise report under
ignored `docs/tmp/`; it is a temporary progress view, not a release artifact. Use
`report-relocated` to migrate a legacy active report. Use temporary event files and
do not commit reports, secrets, raw private conversations, credentials, protected
prompts, raw sensitive payloads, exploitable production details, personal data, or
local absolute paths. Security evidence uses synthetic fixtures and sanitized
summaries.

## Close

Before claiming completion:

1. Confirm every increment is complete and no controlled-environment evidence is
   pending.
2. Run the applicable repository gates and validate generated artifacts.
3. Reconcile documentation, feedback, blockers, assumptions, excluded work, the
   final security impact disposition, security evidence, residual risk, and any
   controlled-environment qualification.
4. Record roadmap completion, provide the temporary report link, and ask for
   explicit final approval of the completed overall work.
5. Only after the user gives that final approval, record
   `final-approval-recorded`. The engine removes only the generated temporary
   report and retains the roadmap and canonical JSON state.
6. Provide permanent roadmap/state references and report commands run, failures,
   evidence that remains external, and work not done.

Read [installation.md](references/installation.md) when installing or publishing the
skill for Codex, Claude Code, GitHub Copilot, or another Agent Skills-compatible
host.
