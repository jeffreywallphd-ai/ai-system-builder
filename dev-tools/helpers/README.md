> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

# Contributor helpers

Optional [token tracking](../../docs/diagnostics/token-usage-tracking.md) uses
`usage enable`, `usage import --from` and `usage summary` through the control
plane. Authorized numeric exports retain bounded day/week/quarter/lifetime
aggregates; missing counters never block delivery. No provider connection is added.

The existing `security-runtime` profile includes model-free dependency-preparation
observer, Context/Worker, shared-helper, host-composition and private journal
regressions. Select it explicitly for that boundary; it adds no automatic broad
runtime trigger. Its explicit sources/tests can combine with other selected valid
profiles. Missing ownership, unknown impact and an explicit generic request retain
the generic focused gate. Source/test limits remain 200/100. The fixed profile
configuration file is also classified for control-plane checks; sibling config
files do not acquire that classification.

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
  Its optional [deterministic support commands](../../docs/diagnostics/deterministic-contributor-support.md)
  prepare bounded evidence, progress replay, checkpoints and handoffs. They add
  no mandatory stage, retry loop, approval or execution authority.
- `run_repository_checks.py` runs an allowlist of formatting, focused Node
  tests, pinned Electron provisioning, docs, architecture, deployment, and full
  non-browser test gates, including the agent-support gate when instructions or
  context change. It accepts paths and enable/disable flags, not
  arbitrary shell commands, and stops on the first failed gate.

Copy `helpers.example.json` into an ignored local directory and pass it with
`--config`. Command-line values override matching configuration values.
The fixed `model-training-worker-unit` check retains the complete inert training
test file with a 180-second outer ceiling. Its measured 374-case batch exceeded
the old 120 seconds. This changes no test selector, model/runtime resource limit,
Native execution permission or controlled qualification allowance.
For the exact complete five-file bound-calibration scope, run the existing
training-worker and focused-controller modules. They execute the full text and
image commands plus routing/environment denials. Missing/nonregular support,
mixed/unknown/incomplete scopes and explicit generic checks keep broad coverage.
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

Roadmap state is separate from that local store. Its unchanged one-MiB physical
limit can use `roadmap-record-tree-v1` JSON for repeated full plans. Read it through
`control_plane.roadmap_state.read_roadmap_state`, not raw `json.loads`. The portable
codec belongs beside the roadmap engine. Node qualification uses the matching
`dev-tools/scripts/qualification/roadmap-record-storage.mjs` reader and shared test
vectors. Storage never changes logical authority, results or history. The exact
`roadmap-storage-node` catalog check runs model-free cross-language regression
cases; missing files and unrelated paths retain generic coverage. See
[storage rules](../../docs/architecture/ai-development-control-plane.md#roadmap-record-storage).
For an exact storage-only scope, the controller check runs the fixed related
authority, Work, snapshots, read/projection/site, publication and fallback suites.
It records the actual command in the plan and receipt. Mixed, unknown or empty
scope and missing/nonregular support retain the full controller command. This
avoids running unrelated product-route tests on a storage change; it does not
extend time limits, skip a failed case or grant technical acceptance.

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
