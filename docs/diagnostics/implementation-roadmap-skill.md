> AI documentation reminder: when behavior in this area changes, update the
> skill, tests, agent entry points, and installation guidance in the same
> change.

# Implementation roadmap skill

The canonical cross-agent workflow is
`skills/manage-implementation-roadmaps/SKILL.md`. It prepares, approves,
executes, reviews, and resumes substantial implementation roadmaps as ordered
increments. It also maintains repository-based progress so work can be reviewed
or resumed without depending on one AI task's conversation state.

## Automatic routing

The repository's contributor control plane extends this workflow through
`docs/diagnostics/ai-development-control-plane.md`. For workflow work requests,
start or reuse its local JSON review site and provide the verified URL. New
roadmaps require current candidate-bound helper completion; pre-existing
roadmap history stays explicitly declarative. The planning engine never executes
commands from an evidence string.

Pending governed increments close via `increment-qualified` after complete
implementation, exact passing evidence/reports, fresh target-bound checks covering
every criterion and separate accepted review. Other active work remains intact;
overall review cannot substitute for target-specific qualification.

Explicit user changes to a pending technical policy use the governed
`technical-acceptance-revised` event. It replaces one controlled nonsecurity
criterion under the same identity/qualification after implementation, archives
the original definition/plan/approval and policy reference/digest, and invalidates
old approval and semantic receipt bindings. Actual narrow reapproval may rely on
the user's already explicit direction. Independent semantic review and fresh
checks remain mandatory. Neither amendment nor reapproval clears blockers or
qualifies a measurement; human-only scope events cannot change model targets.

Agents must route to the skill by intent, not only by exact name. Use it when a
user:

- asks for an implementation roadmap;
- asks to implement, continue, review, or resume roadmap increments;
- asks to use a skill if one is available for roadmap work;
- requests durable progress tracking for a substantial multi-increment change.

For example, this is a complete invocation:

> Please use a skill if available to create an implementation roadmap for this
> feature. Please follow the guidance in AGENTS.md and docs/README.md.

The user does not need to remember `manage-implementation-roadmaps`. The
natural-language trigger does not waive the skill's approval checkpoints.

## Approval and execution model

The workflow requires:

1. repository and primary-source discovery;
2. two or three options for each high-level choice with one recommendation;
3. explicit user approval of the selected high-level option;
4. an ordered increment roadmap with acceptance criteria and rollback;
5. explicit user approval of the completed roadmap;
6. increment-specific research and a written plan before each increment;
7. coherent work chunks with tests, documentation, feedback, and evidence;
8. final verification that distinguishes local checks from
   controlled-environment qualification.
9. a mandatory security impact disposition in discovery and per-increment security
   review acceptance evidence, with proportional threat/control, denial-path,
   rollback, and residual-risk coverage.

When implementation is explicitly requested and the completed roadmap is approved,
the default is continuous execution through every ordered increment to an end-to-end
production-ready result. Routine increment completion, research, planning, report,
and focused-test checkpoints do not require another approval. Agents still stop for
changed scope or high-level decisions, new authority, destructive or production
actions, credentials, unresolved security choices, genuine blockers or external
qualification, an explicit user checkpoint, and final overall approval.

Security is not an optional increment or a late release gate. Every increment uses
`security-impact-reviewed` or a more specific criterion. A
`not-security-relevant` result requires review evidence and a concrete rationale;
a `security-relevant` result requires mapped controls, abuse/failure cases, focused
negative tests, safe rollback, and residual-risk evidence. Roadmap artifacts use
sanitized summaries and never store secrets, protected prompts, raw private
payloads, personal data, or exploitable production details.
The state engine enforces a structured discovery disposition and rejects new or
revised increments without `security-impact-reviewed` or a specific `security-*`
criterion while retaining compatibility with existing stored roadmap state.

Use **increment**, not phase, in roadmap and status artifacts.

Commit coherent completed, tested and reviewed chunks before continuing, using
the skill's owned-change checkpoint procedure. Pending parent work, increment or
roadmap qualification does not defer a safe checkpoint. Inspect actual scoped
evidence and dependency closure, preserve unrelated index/worktree changes,
release source claims before Git changes and start later work from a fresh
baseline. Report the actual commit identity. This grants no parent pass, push,
history rewrite, main advancement or release authority.

## Economical increment sizing

Use the fewest substantial increments that preserve meaningful approval,
integration, rollback, and verification boundaries. An increment is not a file,
component, tab, layer, test category, or documentation task. Closely related work
such as a shared UI primitive plus its first consumers, or tabs, cards, filters,
modals, labels, instructions, and responsive behavior on one user experience,
belongs in one increment as internal work packages.

Before roadmap approval, audit every boundary between adjacent increments. Keep a
boundary only when it separates independently useful behavior or a material
architecture, compatibility, migration, security, operational, rollback, or
controlled-qualification concern. Otherwise merge the work. Run only focused checks
as internal chunks land and only change-relevant completion checks after an
increment is implemented. Batch report updates around meaningful outcomes. Run the
combined standard and end-to-end coverage and costly repository-wide gates once
after every roadmap increment is implemented. For AI-related work, use the all-suite
command so the AI suite is included. Do not run AI or all-suite coverage for non-AI
work unless explicitly requested. Use focused risk regressions instead of an early
broad suite.

If execution reveals that the pending roadmap is too fine-grained, record the
feedback, preserve completed increments and their evidence, replace the pending
suffix through `roadmap-revised`, render the consolidated proposal, and obtain
renewed roadmap approval before continuing.

## Durable tracking and temporary reports

Mixed legacy criteria use `legacy-acceptance-scope-revised` to archive human
acceptance portions while preserving technical IDs/qualification, pending
evidence, chunks and blockers. It cannot close an increment or amend governed
state. The governed event keeps its strict policy gate. Independently review
classification and record actual narrow user reapproval. Product data/publishing
approval controls remain intact.

If the user takes human acceptance offline, review all open increments and use
`human-acceptance-transferred` only where that is the sole remaining qualification.
The event archives original criteria/plan/approval and preserves evidence, then
requires the actual narrowly authorized `roadmap-approved` event. The JSON review
site shows offline user ownership separately from active technical criteria.

Technical roadmap criteria should be executable by AI agents, including automated
UI testing. For started governed roadmaps use `acceptance-scope-revised` instead:
independently classify pure/mixed human scope, archive originals, retain technical
requirements and pending evidence, record actual user narrow reapproval, then
obtain fresh candidate checks/review. The event never closes an increment or
changes a test result. Original human plan instructions are historical/offline.
Performance, provider, security, hardware and runtime checks remain technical.
The attestation is operator supplied; independent review checks semantic scope.
This metadata handoff is legacy-only and refuses any receipt-governed roadmap;
current candidate-bound completion requirements cannot be replaced by a transfer.

By default the skill creates:

- `docs/<slug>-implementation-roadmap.md` for approved intent;
- `docs/tmp/<slug>-implementation-report.md` for a concise local progress
  summary and the next checkpoint;
- `.implementation-roadmaps/<slug>/state.json` as deterministic render state.

The roadmap and state are durable repository artifacts. `docs/tmp/` is ignored;
the report must not be committed or pushed. It summarizes status, increment
progress, current/next work, recent chunks, unresolved feedback, and blockers;
full evidence and history stay in JSON state. The AI updates the report after a
coherent chunk or natural checkpoint and gives the user a clickable link. It
does not update the report after every individual file change.

The Markdown files are generated from JSON state. Direct edits are detected as
drift. `report-relocated` migrates legacy reports into `docs/tmp/`. After all
increments pass, the AI records roadmap completion, presents the temporary
report, and waits for explicit final overall approval. Only then does
`final-approval-recorded` remove the generated report. The standard-library
Python engine validates events, confines output paths to the repository, writes
files atomically, refuses to delete non-generated content, and never executes a
recorded command.

Final approval retains the canonical `completed` status and records its separate
`finalApproval` fact, which also governs immutability and report removal. An
explicitly authorized legacy conversion uses `completion-status-normalized`;
it preserves creation time, approvals, history, criteria, chunks, evidence and
the approved fingerprint. It cannot qualify incomplete work or recreate reports.

## Skill and helper boundary

- `skills/manage-implementation-roadmaps/` owns the user-invoked workflow,
  state engine, references, examples, and skill tests.
- `dev-tools/helpers/` owns generic contributor snapshots, repository check
  orchestration, and patch transport.

The skill can direct an agent to a bounded helper, but the helper must remain
useful without the skill. Generic developer tools should not move into the skill
solely because roadmap execution may call them.

## Installation

GitHub CLI 2.90 or later can discover `skills/*/SKILL.md` and install a
repository skill for supported agents:

```text
gh skill preview <owner>/<repository> manage-implementation-roadmaps
gh skill install <owner>/<repository> manage-implementation-roadmaps --agent codex --scope user
gh skill install <owner>/<repository> manage-implementation-roadmaps --agent claude-code --scope user
gh skill install <owner>/<repository> manage-implementation-roadmaps --agent github-copilot --scope user
```

For a trusted local checkout:

```text
gh skill install . manage-implementation-roadmaps --from-local --agent codex --scope project
```

Codex users may alternatively ask `$skill-installer` to install the published
`skills/manage-implementation-roadmaps` GitHub directory. See the skill's
`references/installation.md` for supported hosts, native locations, source
links, and publishing checks.

## Verification

Run:

```text
python -m unittest discover -s skills/manage-implementation-roadmaps/tests -p "test_*.py" -v
npm run docs:check
npm run agent-support:check
npm run test:standardande2e
# For AI-related skill changes or an explicit request:
npm run test:all
```

Use the creating host's skill validator and preview the repository package before
publishing.

## Maintenance and extension

When roadmap work exposes a repeated failure mode, decide whether it belongs to
the workflow, the bounded developer helpers, or product implementation:

- update the skill for approval, research, planning, feedback, tracking, resume,
  or evidence behavior;
- update a helper for a portable, bounded repository operation;
- update product code for application behavior.

Skill changes require:

- exact-name and natural-language trigger tests;
- positive workflow and resume tests;
- negative tests for path escape, malformed events, drift, and arbitrary command
  injection;
- no credentials, personal names, absolute local paths, or private task text;
- synchronized `AGENTS.md`, `docs/README.md`, skill references, and
  installation guidance.
- positive and negative tests that keep the security impact screen, per-increment
  security criterion, safe evidence rules, and repository security standard links
  synchronized across skill releases.

Review future repetitive interactions for new skills or bounded helpers, but do
not combine unrelated authority or destructive behavior merely to reduce
prompts.
