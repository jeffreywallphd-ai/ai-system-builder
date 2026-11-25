> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

# Contributor helpers

Optional [token phases](../../docs/diagnostics/token-usage-tracking.md) use
`usage phase --from` at existing review handoff/correction boundaries. Work start
associates the calling known thread; source-bound markers never guess host UUIDs
from invocation labels or mutate Work during verification. The v2 reader
preserves v1 counters/replay and labels old implementation phase unknown.
Telemetry never grants qualification or approval authority.

Optional [token tracking](../../docs/diagnostics/token-usage-tracking.md) uses
`usage enable`, `usage import --from` and `usage summary` through the control
plane. Authorized numeric exports retain bounded day/week/quarter/lifetime
aggregates; missing counters never block delivery. `usage session-start` validates
the exact current session's local numeric response records, or an explicitly
configured numeric host bridge, once at coding-session initialization;
`usage capture` receives bounded Codex-v2 cumulative notifications. No host is
started and no provider connection is added. Local mode reads only bounded exact
selected numeric records and emits no conversation content.
Adapter readiness, an initial baseline and recent actual deltas are distinct states.
After explicit startup/configuration, existing Work start/verify/complete boundaries
poll the configured selections once. `usage local-enable --thread <known-uuid>`
can add known selections and `--capture-destination <same-repository-checkout>`
can centralize only usage writes; Work/source/claim ownership stays local.

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
test file with a 390-second child and 420-second outer ceiling. The 30-second
grace allows fixed helper output and shutdown. Generic children retain 270 seconds
and review-site children 630 seconds; no caller-selected timeout exists.
Timeout failures print a fixed `TimeoutExpired` diagnostic without child command,
output or exception text.
Prior calibration recorded 179.34
seconds for 386 cases, then 237.45 seconds for 469 cases. The expanded batch
timed out at 240 seconds; its 29 added focused cases passed in 136.80 seconds.
Keep every case and the exact command. The measured developer-test calibration
changes no model/runtime resource, memory, process, disk or Native permission
limit and grants no controlled qualification retry.
For the complete four-file training-routing core, run the existing training-worker,
focused-controller and result-validation routing modules. The original forwarding
and result-routing tests, the fixed focused-check helper, and only the six
registered training-owner files may
accompany that core. The full support and parser-fixture closure must be regular
and available; check it in groups within the existing 16-file presence bound.
These modules execute the complete text/image/parser commands
and routing/environment denials; owner changes retain automatic and required
checks. Missing/nonregular support, unknown mixed or incomplete scopes, and
explicit generic checks keep broad coverage. This avoids a broad helper-suite
timeout merely because a reviewed training correction accompanies its test tools.
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

The fixed `headless-training-output-retirement-unit` check executes the complete
saved-output retirement regression file. Its measured in-memory ABI batch uses a
90-second child limit and the existing 120-second outer check, leaving diagnostic
grace. Other regression and runtime limits are unchanged. The closed retirement
owner/check-routing scope runs whole related routing modules, including their
actual Native/session/parser commands. Missing or nonregular support, partial,
unknown mixed scope or explicit generic coverage keeps complete controller
discovery. This feature check grants no physical/model execution, retry authority,
resource settlement, Save or final combined-suite qualification.

The exact `headless-protected-training-workflow-unit` file tests protected
pipeline/task-session integration and finite family IO closure with synthetic
SDK/Native replies. Its measured 22-case batch took 104.96 seconds before later
denial cases; use a bounded 240-second child under a 270-second outer ceiling.
Other developer/profile and all production limits remain unchanged. The closed
workflow/routing scope executes whole related routing modules and their fixed
feature commands. The full existing text regression stays a separate selected
required check for its changed source; do not duplicate that long command in a
second routing suite. Incomplete/nonregular support, mixed/unknown scope and
explicit generic requests keep full controller discovery. This is feature
evidence only, with no model-quality, physical Native or parent qualification.

The fixed `headless-original-training-files-unit` runs the whole original file
owner regression, including synthetic training through all three methods. Its
90-second child and 120-second outer limit leave diagnostic grace. The closed
owner/routing scope runs whole related routing modules; the existing full text
regression remains a separate required command. All sixteen runtime prerequisites
must be regular files. Incomplete support, mixed or unknown scope, and explicit
generic requests retain full controller discovery. These checks prove local file
composition only, not physical Native execution or global resource settlement.
