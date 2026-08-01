> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

# Developer tools

Repository-owned scripts live under `dev-tools/scripts`. Portable contributor
helpers for recurring Codex and verification loops live under
`dev-tools/helpers`; see its README for configuration and safety boundaries.

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
