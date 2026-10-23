> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

# Developer tools

To run cached model tests after closing the coding agent, use
`scripts/qualification/run-model-tests.cmd` from Command Prompt, or
`scripts/qualification/run-model-tests.ps1` from PowerShell. Both preserve incremental JSON
evidence for later review without changing roadmap qualification. See
[standalone model testing](../docs/operations/standalone-model-testing.md) for
commands, runtime requirements, safety controls and evidence locations.

The legacy `--all-blocked` option requires a reviewed remaining-only plan.
Completed Standard model accuracy is closed under the accepted 30%/80%
requirements; do not repeat those checks. The inventory keeps every registered
incomplete qualification owner, even when it has no open human-action issue.
It rejects changed registry inputs, missing targets, owners whose declared targets
are all complete, and unknown open-issue owners. The issue-only security entry requires its
unresolved issue. Pending native/offload/provider/OCR/host work stays separate.
See [model evidence testing](../docs/operations/model-blocker-testing.md) for
the retained protocol and its limits. Planning grants no execution authority.
After termination, add `--restart` (`-Restart` in PowerShell) to start one fresh
same-source/protocol trial from that reviewed template. Old evidence remains;
OS-owned Standard coordinator/worker slots prevent overlapping supported tests.
This does not resume an interrupted cohort or qualify its missing cleanup.

The review site's `review-site` source-owned check profile runs the complete fixed
Node DOM/controller test file for exact HTML/JavaScript/CSS/test ownership. It
preserves all UI assertions while avoiding unrelated directory-owned desktop
typechecks. Catalog and profile data are policy-bound; uncovered impact and an
explicit `focused-tests` requirement retain the generic gate. This scoped UI
result grants no whole-application, native, model or parent roadmap qualification.

Repository-owned scripts live under `dev-tools/scripts`. Portable contributor
helpers for recurring Codex and verification loops live under
`dev-tools/helpers`; see its README for configuration and safety boundaries.

Actual managed reference qualification uses the separate PostgreSQL/OIDC/TLS
launcher in `scripts/qualification/visual-composer/managed-reference-host.ts` and
`config/playwright.managed-reference.config.ts`. Setup is isolated, credentials
stay private, failures are retained and forced cleanup never counts as graceful
shutdown. See `docs/operations/functionality-outcome-qualification.md` for exact
profiles, finite worker scenarios, existing budgets and qualification limits.

Owned task visibility timing captures the fixture's fixed initial 10-percent
progress and timestamp before navigation. Reload/recovery time stays in the
sample; a later authoritative update cannot retimestamp older rendered progress.
Missing initial milestones and invalid/negative progress or terminal delays fail
qualification. Focused counterexamples live in `scripts/qualification/tests/`.

Installed generation comparisons admit only the two explicitly pinned Qwen
profiles documented in the outcome qualification procedure. Native precision is
fixed per profile for both variants and devices, and propagated to every fresh
child; changing a profile cannot overwrite another model's failed evidence.

User-invoked cross-agent workflows are different: their canonical definitions
live under `skills/`. The implementation-roadmap skill may describe when to
use a bounded helper, but its workflow state engine remains with the skill and
generic checks and patch transport remain here.

## Test orchestration

`npm test` runs the standard unit and interaction loop. `npm run test:e2e`
runs integration, end-to-end, and legacy explicitly marked long-duration files.
`npm run test:ai` runs only explicitly marked or enumerated tests that load or
run AI components. Use `npm run test:standardande2e` for combined non-AI
coverage. Use `npm run test:all` for standard, end-to-end, and AI coverage only
for AI-related changes or an explicit request. The Node and Vitest runners discover
their owned files independently and write duration-ranked JSON reports under
`artifacts/test-reports/`.

Qualification identities hash the present candidate, including dirty and
untracked inputs. Tracked unstaged deletions change the identity without making
it depend on index staging; unsafe files, other read errors, empty candidates
and missing explicitly referenced evidence still deny qualification. Tests of
repository HTTP exposure load the actual source server configuration when the
aggregate runner stages executable tests, retaining the production filesystem
allowlist and private-file/origin denial assertions.

`npm run test:dataset-preparation:e2e` is the opt-in dataset creation matrix.
Run it only when Dataset Preparation changes or when explicitly requested. It
reports 27 top-level training-goal/material-division cases (nine goals by an
existing dataset, combined datasets, and source material) plus the 39 detailed
preparation-method combinations. Every case uses one or two bounded sources,
writes real Parquet output, reopens it with PyArrow, and verifies non-empty task
columns plus source association. It uses
deterministic valid generation at the model boundary so it qualifies dataset
creation without repeating large-model inference for every combination. It is
intentionally outside `test:e2e` and `test:all`.

The named command `npm run test:model-training:e2e` is the opt-in physical
model-training matrix. Run it only when Model Training changes or when
explicitly requested. It trains every supported task with two synthetic rows,
one epoch, and fixed tiny Hugging Face snapshots at immutable revisions. Each
case must reach the staged generated-model candidate used by Save/Discard; the
suite never invokes model save or registration. It is intentionally outside
`test:e2e`, `test:ai`, and `test:all`.
