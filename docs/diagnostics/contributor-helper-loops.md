> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

# Contributor helper loops

The portable helpers in `dev-tools/helpers/` group recurring repository work
into bounded processes. They are intended to reduce repeated approval prompts
without weakening the approval boundary or creating a general command runner.

These helpers are contributor infrastructure, not user-invoked agent skills.
Portable agent workflows live under `skills/`; see
`implementation-roadmap-skill.md`. Keep the roadmap state/report engine with
that skill, while generic snapshots, checks, and patch transport remain in
`dev-tools/helpers/`.

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
