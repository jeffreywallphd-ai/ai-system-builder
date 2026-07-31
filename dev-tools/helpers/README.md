> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

# Contributor helpers

These Python helpers combine recurring, bounded loops without embedding a
contributor name, home directory, executable hash, or repository checkout path.
They use only the Python standard library.

- `native_apply_patch.py` validates UTF-8 patch framing and invokes only Codex
  native apply-patch mode. Configure the executable with
  `--codex-executable`, `CODEX_NATIVE_EXECUTABLE`, or the
  `nativeApplyPatch.codexExecutable` configuration value. PATH and installed
  Codex-app discovery are fallbacks.
- `repo_snapshot.py` batches read-only status, recent-log, diff, and optional
  ignore checks. Repository, log count, and ignore paths are configurable.
- `run_repository_checks.py` runs an allowlist of formatting, focused Node
  tests, pinned Electron provisioning, docs, architecture, deployment, and full
  non-browser test gates, including the agent-support gate when instructions or
  context change. It accepts paths and enable/disable flags, not
  arbitrary shell commands, and stops on the first failed gate.

Copy `helpers.example.json` into an ignored local directory and pass it with
`--config`. Command-line values override matching configuration values.
Repository paths must resolve within the selected repository.

```text
python dev-tools/helpers/repo_snapshot.py --config .local-codex/helpers.json
python dev-tools/helpers/run_repository_checks.py --config .local-codex/helpers.json
python dev-tools/helpers/native_apply_patch.py --config .local-codex/helpers.json --patch-file change.patch
```

Use `--plan` on the snapshot and verification helpers to inspect their exact
bounded command list without executing it. Use `--dry-run` on the patch helper
to validate discovery and patch framing without applying a change.

These tools reduce consecutive prompts by grouping related commands. They do not
bypass the Codex sandbox or approval system, mutate Git history, perform
destructive cleanup, or provide a general command runner.

## Maintenance

Improve these loops when a secure action becomes repetitive or a portability
failure is discovered. Add a new loop only when its actions share one clear
authorization and can remain narrowly allowlisted. Every behavior change must
update configuration examples, documentation, positive tests, and negative
security tests. Keep destructive actions, credentials, external mutations, and
arbitrary command execution outside these helpers.
