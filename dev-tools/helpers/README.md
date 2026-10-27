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
- `development_control_plane.py` is the common entry for outcome-scoped work,
  ownership, bounded verification receipts, separate-invocation review, local
  recovery and the dynamic JSON review site. Start with
  `docs/diagnostics/ai-development-control-plane.md`.
- `run_repository_checks.py` runs an allowlist of formatting, focused Node
  tests, pinned Electron provisioning, docs, architecture, deployment, and full
  non-browser test gates, including the agent-support gate when instructions or
  context change. It accepts paths and enable/disable flags, not
  arbitrary shell commands, and stops on the first failed gate.

Copy `helpers.example.json` into an ignored local directory and pass it with
`--config`. Command-line values override matching configuration values.
Repository paths must resolve within the selected repository.
Verification paths must also remain positional after normalization: option-like,
absolute and drive-relative selections are refused during planning. Focused
targets are existing `.test.ts`, `.test.tsx`, `.test.js`, `.test.mjs` or
`.test.cjs` files. Fixed Node and Prettier arguments end options with `--` before
the selected paths. Selecting a test still authorizes executing that test's code;
these helpers do not sandbox repository code.
Formatting launches the installed pinned Prettier CLI directly through Node,
avoiding Windows command-script parsing and implicit package installation.

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

The local control-plane state keeps its existing 8 MiB file limit. If JSON
indentation alone exceeds the limit, publication and journal recovery use compact
JSON for that state file. Parsed history, authority and evidence digests stay
unchanged. Snapshots and normal small state keep their canonical formatting.
State or journals that still exceed the limit are refused before publication;
formatting does not grant qualification or remove old work. Capacity and
interrupted-recovery regressions are in
`tests/test_control_plane_journal_capacity.py`.

## Maintenance

Improve these loops when a secure action becomes repetitive or a portability
failure is discovered. Add a new loop only when its actions share one clear
authorization and can remain narrowly allowlisted. Every behavior change must
update configuration examples, documentation, positive tests, and negative
security tests. Keep destructive actions, credentials, external mutations, and
arbitrary command execution outside these helpers.

The `control_plane/` library records reused primitives, adaptations and their
license notices in `control_plane/UPSTREAM.md`. It has no dependency on another
checkout. Its local coordination and attestations do not replace host sandbox
permissions or authenticate independent actors.

Work history keeps compact references to immutable source snapshots under
ignored `.local-codex/control-plane/snapshots/`. The next mutation migrates old
inline baselines without changing receipts or reviews. Preserve snapshot files
alongside the record index and journal; missing or changed bytes refuse evidence
qualification. Index and individual snapshot bounds remain8MiB. Atomic writers
use exclusive unpredictable temporary files; OS-native parent identity and
private Windows ACL qualification remain separate supported-platform obligations.

Overall qualification begins after all implementation chunks are recorded,
including a final verifying increment with implemented predecessors. Current
approval, no open blockers and the configured suite remain required. Pending
controlled evidence still blocks roadmap closure. See the contributor guide.

The scoped Vitest adapter supports the pinned Vitest 4 API with one worker,
isolation and an exact include set. It rejects missing, extra, failed or unhandled
test results; CLI substring matching cannot admit an unselected sibling. The
retired minWorkers option is omitted. Its source and owning regression remain
part of contributor verification policy.

Control-plane state and recovery journals retain the same 8 MiB read limit.
The writer checks both exact encodings before publication. Journals use compact
JSON whitespace. State formatting can use the bounded compact fallback above;
parsed-value digests keep their canonical encoding.
This prevents nested journal indentation from making a valid state unreadable.
It changes no workflow, qualification, approval or history-retention policy.
