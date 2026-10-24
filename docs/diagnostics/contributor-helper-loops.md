> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

# Contributor helper loops

For governed AI-assisted work, use the integrated
`docs/diagnostics/ai-development-control-plane.md` entry. Its bounded CLI owns
outcomes, claims, executed verification, review, recovery and the JSON review
site. The helpers below remain useful lower-level operations.

The portable helpers in `dev-tools/helpers/` group recurring repository work
into bounded processes. They are intended to reduce repeated approval prompts
without weakening the approval boundary or creating a general command runner.

These helpers are contributor infrastructure, not user-invoked agent skills.
Portable agent workflows live under `skills/`; see
`implementation-roadmap-skill.md`. Keep the roadmap state/report engine with
that skill, while generic snapshots, checks, and patch transport remain in
`dev-tools/helpers/`.

## Python test collection

The focused helper keeps class-based `unittest` discovery and uses pytest for
files with top-level test functions. This includes fixture-based files that do
not import pytest themselves. Both controlled AI files remain exclusive to the
explicit AI suite. An empty collection or failed test remains a failed check.

Install the developer test tools explicitly in the Python environment selected
for verification. Use `dev-tools/helpers/requirements-tests.txt`: pytest and its
complete conditional dependency set are pinned to reviewed original PyPI
universal wheels with SHA-256 hashes. The lock requires wheels and hashes; pip
must refuse a missing wheel or hash mismatch. These are contributor tools, not
worker or application runtime dependencies. The helper never installs packages.

For example, create an ignored virtual environment with
`python -m venv .local-codex/verification-python`, then use that environment's
Python to run `-m pip install -r dev-tools/helpers/requirements-tests.txt`.
Use the same Python for the control-plane CLI. Dependency downloads still need
the existing authorization and network controls; setup grants no extra authority.

Pytest execution uses one fixed file path after `--`, a neutral tracked config,
no conftest discovery, no cache provider and no automatic third-party plugins.
The helper removes inherited `PYTEST_*` controls and sets plugin autoload off.
It checks every applicable locked tool version before execution. Missing or
different versions fail with setup guidance. AST inspection selects the runner
without executing the test during planning. Syntax errors remain failures.
The helper refuses optimized Python and removes `PYTHONOPTIMIZE` from every
test child so plain assertions cannot be erased.
Ordinary test code still runs with the contributor's authority. This isolation
does not sandbox tests or qualify model accuracy, native offload or a roadmap.

## Local configuration

Copy `dev-tools/helpers/helpers.example.json` to an ignored location such as
`.local-codex/helpers.json`. Keep executable paths and other machine-specific
values only in that ignored copy. All repository paths are relative to the
selected repository and are rejected if they escape it.

The configuration has three independent sections:

- `nativeApplyPatch`: optional Codex executable path. The command-line option,
  `CODEX_NATIVE_EXECUTABLE`, PATH, and installed-app discovery are also
  supported.
- `repositorySnapshot`: repository, recent commit count, and ignored paths to
  verify.
- `repositoryChecks`: formatting paths, focused tests, and enable/disable
  flags for Electron provisioning, documentation, architecture, deployment,
  agent support, and the full non-browser suite.

Command-line arguments override configuration. Review `--help` for all
options.

When selected, `--install-electron` runs the fixed official
`node node_modules/electron/install.js` command before focused tests. Dependency
resolution remains script-free. Electron 42 removes the old postinstall hook, so
`npm rebuild electron` cannot provision a missing binary; do not rely on an
implicit download during the first test import. The explicit installer retains
the pinned package's bundled checksum verification and existing approval boundary.

## Safe usage

```text
python dev-tools/helpers/repo_snapshot.py --config .local-codex/helpers.json --plan
python dev-tools/helpers/repo_snapshot.py --config .local-codex/helpers.json

python dev-tools/helpers/run_repository_checks.py --config .local-codex/helpers.json --plan
python dev-tools/helpers/run_repository_checks.py --config .local-codex/helpers.json

python dev-tools/helpers/native_apply_patch.py --config .local-codex/helpers.json --patch-file reviewed.patch --dry-run
python dev-tools/helpers/native_apply_patch.py --config .local-codex/helpers.json --patch-file reviewed.patch
```

The snapshot loop is read-only. The verification loop uses a fixed allowlist and
stops on the first failed gate. The patch helper accepts only framed UTF-8
patches and invokes only Codex native apply-patch mode.

These helpers do not authorize an action, bypass the sandbox, remove the initial
elevation request, install credentials, change Git history, or perform cleanup.
Do not persistently approve a mutable local wrapper as though it were an
immutable executable.

## Maintenance and extension

Configured verification paths cross the fixed-tool argument boundary. Planning
rejects option-like paths after normalization, absolute/drive-relative paths and
unsupported Node test targets before any tool executes. Node and Prettier receive
an explicit `--` option terminator before positional paths; containment remains
mandatory. Negative fixtures are inert and exercise planning only. Repository
test code still executes with the contributor's existing authority.
Prettier runs through the fixed installed Node CLI rather than a Windows command
script, so filename metacharacters remain literal arguments. Missing local
Prettier fails normally; the helper never fetches an implicit package.

When the same secure action causes repeated approvals or duplicated orchestration,
first determine whether it fits an existing bounded loop. Improve that loop when
possible. Add a new loop only when the operations share a clear authorization,
have stable scope, can validate all paths and inputs, and can expose a plan or
dry-run before execution.

Loop changes must include:

- portable configuration with no committed contributor, checkout, credential,
  or executable-version details;
- fail-fast behavior or explicit collection semantics appropriate to the loop;
- positive behavior and configuration tests;
- negative tests for path escape, malformed input, and arbitrary command
  injection where applicable;
- updates to this document, the helper README, and `AGENTS.md`.

Do not combine destructive cleanup, Git-history mutation, credential handling,
production changes, or unrelated external mutations merely to reduce prompts.
