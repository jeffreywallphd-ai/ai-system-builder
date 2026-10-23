# Complete standalone model evidence bundle

- Status: accepted Standard model-quality checks closed; other technical qualification remains pending
- Verification: `dev-tools/scripts/qualification/tests/test_model_blocker_tests.py`
- Authority: approved installed-model tests and the user-requested realistic host profile

## Current qualification scope

The user accepted at least 30% correct output for the 0.5B model and at least
80% for the 1.5B model, measured on completed output tests. Those quality checks
are closed. Do not repeat them to close unrelated resource, host or native work.
Earlier thresholds, failures and collected evidence remain historical records.

The inventory includes each registered incomplete roadmap and its declared
criteria, even if an old issue record is resolved. A resolved issue does not
pass a technical criterion. Unknown open-issue owners, changed registry inputs,
missing criteria and owners whose declared targets are all complete still refuse planning. The
issue-only security entry must retain its unresolved issue. The legacy CLI and
JSON field names remain compatible. Only a specific required human action is a
blocker in the roadmap review site; agent work stays pending. Inventory reads
public metadata and starts no model or provider call.

## Historical remaining-only protocol

The following handoff records the earlier remaining-only test protocol. It is
kept for traceability. Its commands and old quality targets are not instructions
to repeat the accepted accuracy tests.

New CLI plans require an independently assessed bundle reference. For the latest
collection, prepare without loading any weights:

```bat
dev-tools\scripts\qualification\run-model-tests.cmd --all-blocked --remaining-from 4a779a6ada06447daff32bdba8c39286 --plan-only
```

After separate review, use the supplied exact current template identity and hash
with `--all-blocked --restart --approved-run <id> --plan-sha256 <hash>`.
PowerShell planning uses `-AllBlocked -PlanOnly -RemainingFrom <bundle-id>`.
Restart retains that exact selection, source and protocol; it never broadens the
run back to a full matrix. Previous attempts remain immutable.

The reviewed archive is rehashed through root/subrun indexes and all raw cohort
files; complete candidate cases, model/source bindings, native exit, cleanup,
quality and resource budgets determine selection. The latest selection has
**17 current candidates**: five denied1.5B CPU cohorts and all twelve failed or
denied0.5B cohorts. Seven1.5B cohorts already meet the user's22of24 absolute
check and resource budgets and are not repeated. Historical baseline workers
are not executed. No old measurement is spliced into the new experiment or
promoted to current-source qualification; paired non-regression and other
unresolved parent requirements remain visible. The old full-matrix procedures
below describe retained legacy protocols; new CLI planning requires remaining-only
selection. Partial matrices deliberately cannot claim the old whole-matrix pass.

At the user's direction, these new CPU/chat/Standard trials admit the exact pinned
0.5B Float32 safe weights at**3.0GiB free physical RAM**, and1.5B BF16 at
**3.5GiB**. Weight/config hash verification and loaded-weight upper bounds2GiB/3GiB prevent
using a model name to grant that estimate to unknown or larger bytes. A symlink,
reparse point, extra safe-weight size, different hash/model/dtype, adapter, auto
device or other mode retains the conservative guard. At the upper bounds these
estimates leave at least1GiB/512MiB respectively beyond weights; these are trial
headrooms, not proof of runtime capacity. A below-threshold observation still
denies. GPU admission, other models and precision, no-overflow/no-offload policy,
sampled4GiB process limit, cooperative stopping and native/cleanup fences remain.

The17 execution watchdogs total at most7hours20minutes plus bounded startup,
verification and shutdown overhead. A partial/denied/failed output remains so.
The exposed24-case regression set and22of24 user check do not establish unseen
population accuracy or general0.5B automation capability. The runner does not
inspect retained staging, acquire offload leases, obtain credentials or qualify
native protection, OCR/provider delivery or whole-host UI.

The latest completed collection has a [numeric evidence assessment](model-blocker-evidence-assessment.json).
The user's revised absolute-quality acceptance is22of24 for the completed1.5B
observations. The assessment marks that check passed separately from the frozen
protocol's23of24 gate. Executed plans/results are never rewritten, and missing
CPU cohorts, paired comparisons, smaller-model quality and native/offload/host
prerequisites remain separate. Collection completion alone grants no parent pass.

The CMD/PowerShell launchers offer an explicit `--all-blocked` /
`-AllBlocked` mode. Existing diagnostic defaults and subset options are unchanged.
The retained full-matrix protocol froze both installed acquisitions, all24 exposed cases in
first/warm phases, CPU and CUDA, unchecked/constrained decoders, historical/current
algorithm pairs and three fresh repetitions. New CLI plans select only unresolved
current candidates as described above. Execution is serial, CPU first, without
Codex or the review server being required. No model or dependency is downloaded.

Prepare without loading weights:

```bat
dev-tools\scripts\qualification\run-model-tests.cmd --all-blocked --remaining-from 4a779a6ada06447daff32bdba8c39286 --plan-only
```

After separate exact-source/bundle review, use the returned identity and digest:

```bat
dev-tools\scripts\qualification\run-model-tests.cmd --all-blocked --approved-run <bundle-id> --plan-sha256 <reviewed-sha256>
```

The contributor supplies the exact command after review. Run it in a normal
Command Prompt or PowerShell window after closing Codex and the product's model
workers. Keep this repository unchanged. The launcher uses the existing prepared
Python environment and Node; it changes no execution policy, installed packages,
system settings or unrelated process. A changed source, input, coverage inventory,
digest is refused. Ordinary execution refuses an already attempted bundle;
explicit restart derives new plans and preserves old attempts. Diagnostic subset
flags cannot narrow this full mode.

PowerShell also supports `-AllBlocked -PlanOnly -RemainingFrom <reviewed-bundle>`, then
`-AllBlocked -ApprovedRun <id> -PlanSha256 <digest>`. CMD avoids PowerShell script
execution-policy requirements and is the recommended handoff command.

## Restart after termination

Use this form with the exact reviewed **current-source template**:

```bat
dev-tools\scripts\qualification\run-model-tests.cmd --all-blocked --restart --approved-run <template-id> --plan-sha256 <reviewed-sha256>
```

PowerShell supports `-AllBlocked -Restart -ApprovedRun <id> -PlanSha256 <digest>`.
Each explicit invocation creates one fresh bundle and two new model plans. The
same command can be used again after termination without deleting any files or
requesting a new plan for unchanged software. There is no automatic retry loop.
The script prints the new summary path and binds `restart_of` to the exact
template identity and hash. It compares all model protocol fields except the
creation timestamp, validates new plan hashes, and preserves source, inventory,
weights, precision, cases, sampling, budgets and thresholds. Source or input
changes still require a fresh independent review; an old-source template cannot
authorize new software. Only the explicitly selected template is reused as a
protocol, never its reports, intents, partial results or model state.

Fixed OS locks serialize the full-mode coordinator and every current Standard
measurement child before loading weights. Lock files are retained; their presence
does not mean a process is running. The OS releases ownership when its process
exits, including a hard termination. A surviving Standard child keeps its own
worker slot, so a new coordinator refuses overlap until it exits. A delayed child
must obtain that same slot before loading. Busy slots produce a finite diagnostic;
the script never kills an unrelated process or clears a live ownership latch.
These slots cover current Standard qualification, not the legacy diagnostic mode,
product workers, other software or native/offload authority. Continue to close
other model workers and retain the existing resource admission checks.

Ctrl+C keeps the interrupted row and the supervisor's observed process lifecycle.
Forced exit does not establish graceful model cleanup. Hard termination may leave
partial records without an index; these remain incomplete. Starting a fresh trial
never marks an old trial cleaned up, completes missing observations, or combines
case results across attempts. Lock availability is concurrency admission only.

The earlier `8f08ff0609cc4cbe8dd0f65e47ecc8b6` attempt remains preserved: three
memory-denied cohorts followed by a fourth interrupted running cohort. Its missing
cleanup remains unknown. Its old source is superseded by this reviewed restart
implementation; use the newly supplied current-source template instead of changing
the old plan, digest or evidence. Native/offload and other pending prerequisites
listed below remain pending.

## Prospective targets for this host

The `windows-lightweight-v1` profile is an explicit new protocol version. It
uses the existing Windows CPU/RTX4060 host and pinned0.5B Float32 /1.5B BF16
acquisitions. It does not reinterpret earlier failures or silently substitute a
different model, precision, provider, device or loading mode.

| Profile | Primary48-request batch target | Native worker watchdog | Cooperative cutoff |
| --- | --- | --- | --- |
| 0.5B CPU | 600seconds /10minutes | 1200seconds | 1080seconds |
| 1.5B CPU | 1800seconds /30minutes | 2400seconds | 2160seconds |
| Either GPU | 300seconds /5minutes | 1200seconds | 1080seconds |

These are background batch expectations, not interactive response promises.
Primary delivery includes load, all attempts/repairs, evidence and unload;
launcher/import/integrity overhead remains separately reported. Both modes and
devices stay separate. The larger CPU window accounts for the earlier observed
roughly28seconds/request; the original20-minute window could not finish48 such
requests. The fixed40-minute window is admitted only for the exact Standard CPU
qualification operator. Existing callers, defaults and historical protocols retain
their prior deadlines. Cooperative stopping remains advisory and incomplete.

The4GiB sampled worker-RSS ceiling and production RAM admission remain unchanged.
The GPU resource target is at most6GiB peak reserved VRAM, with return to the
observed runtime floor after unload. Neither placement nor sampling is a hard
allocation guarantee. Unknown/insufficient resources deny safely. Closing Codex
can help admission but cannot guarantee sufficient memory or useful output.

Absolute resource/time budgets are reported separately from the legacy1.20
accepted-output gain. That relative optimization gate and the23of24 automatic-label
fixture floor remain visible and unchanged. A0.5B model is assessed as a source
of reviewed proposals, not certified automatic labeling; report correct, wrong,
rejected and repaired outcomes honestly. JSON validity does not establish semantics.
Larger-model utility also requires actual measured quality. Exposed regression
cases are not fresh validation, and repetition does not enlarge the case population.
The bundle never changes roadmap acceptance or supplies automatic parent closure.

### Memory denial and output failure diagnosis

The Standard loader checks **available physical RAM**, after runtime imports,
before loading weights or starting constrained decoding. Its existing estimate is
checkpoint weight bytes, doubled for Float32, multiplied by1.25, plus1GiB of
headroom. The pinned1.5B BF16 acquisition therefore requires4.59GiB available;
the0.5B Float32 acquisition requires3.30GiB. In the latest operator collection,
denied1.5B CPU children observed3.69–3.91GiB available and denied0.5B children
observed3.05–3.12GiB. A timeout increase or decoder change cannot admit those
loads. These observations do not identify which other application used RAM.
Installed RAM, free physical RAM, process RSS and available VRAM are different
measurements; a successful earlier CPU load does not guarantee later admission.
That collection used the conservative guard. The current handoff above records
the user's subsequent3GiB/3.5GiB trial estimates and exact safe-weight limits;
the overflow policy remains unchanged.

New reports retain numeric memory shortfalls and distinguish these from output
quality failures. A model returning an out-of-contract label is recorded as
`invalid-accepted`, incorrect, with no raw label, extra field or model text saved.
The remaining cases continue, while any such candidate acceptance prevents
qualification. This addresses the earlier historical baseline's early
`ValueError` without repairing its output, changing its schema, counting it as
rejected, or converting a failed historical cohort into a pass. Runtime/native,
source, memory, cleanup and bounded-result failures retain their existing guards.
The separate22of24 user-accepted check is reported alongside the original23of24
protocol gate. Parent qualification remains pending on its actual requirements.

Failure logs include an allowlisted stage and exception type, plus up to eight
repository-relative Python source frames (file, function and line). Output
validation retains at most two such logs per case. Cleanup failure has its own
log. Exception messages, full paths, local variables, input text and model output
are deliberately excluded; the code locations identify the failing checks for
debugging without disclosing those values. Unknown external frames are omitted.
The same formatter covers operator planning, source/plan admission, coordination
and top-level failures. Planning/execution logs are retained in the fresh attempt's
summary; admission errors also print bounded locations in the terminal. They never
rewrite a prior attempt just to save an error. Deliberate busy/already-attempted
refusals retain their finite reason codes and recovery instructions.
At most four allowlisted cause types identify wrapped memory, permission, JSON
or other known failures without retaining their messages; cyclic chains stop.

Allow several hours with the PC awake and power available. Execution watchdogs
alone total up to20hours across48 worst-case workers, plus bounded startup/exit
overhead; typical successful cohorts can finish much earlier. The script does
not alter power settings. Ctrl+C requests the existing owned-child shutdown; wait
for the terminal to return. Unconfirmed exit, missing model cleanup, source drift
or corrupt evidence stops all successors and leaves the remainder pending.

## Coverage and evidence

The reviewed JSON registry `dev-tools/config/model-blocker-qualification.json`
maps exact canonical criteria to each current execution owner. The inventory
includes every open blocker and validates existing frozen roadmap handoffs using
the control plane's own admission logic. An unknown new owner, missing criterion
or changed inventory refuses execution instead of silently dropping work.

- Functionality: current guarded Standard quality, attempts, repairs, first/warm
  timing, accepted-output rates, RSS/VRAM, cleanup and paired comparison evidence.
- Optional constrained JSON: partial direct-model/resource/checked-output evidence;
  packaged-host adaptive default, override and visual-builder UI remain separate.
- Optional low-memory: native staging protection/accounting/process proof remains
  blocked. The runner never inspects retained staging, calls offload readiness,
  acquires a lease or starts offload. Free RAM cannot clear this prerequisite.
- Security: native effects/ownership and restricted legacy review remain pending;
  ordinary Standard worker evidence cannot qualify those controls.
- Data Management: classification is partial generation support. Private-provider
  ingestion, OCR/layout, semantic/critic/advanced-quality oracles and host UI remain
  pending on their authorized environment/runtime. No credentials or new model
  are obtained, and no unsupported test is relabeled as passing.
- Assets: its shared security-review dependency is inventoried, outside model tests.

The console prints `.local-codex/model-blocker-tests/<bundle>/summary.json`.
Bring that path back after restarting Codex; preserve the entire directory and
the referenced `.local-codex/standard-generation-qualification/<run>/` folders.

`plan.json` binds source/operator/config/inventory and exact subplan hashes.
`coverage.json` records criterion coverage and all prerequisite limitations.
`summary.json` updates after each model profile, with raw case progress saved
after every case in the referenced subfolders. Profile records retain actual
status, resource-target results, legacy gates, native exit and cleanup; failed
or denied cohorts never supply a fabricated rate. Each subrun and the bundle
write `evidence-index.json` at handled completion. Abrupt termination may leave
partial evidence without an index; it remains incomplete. No resume, cleanup or
recovery action is inferred from process absence.

Exit0 means evidence collection reached both matrices with verified retained
records, including any real failures/denials. It is **not** model or roadmap
qualification. Exit1 means preflight, integrity, lifecycle or collection halted;
the summary explains what remains pending. Existing diagnostic exit semantics
stay unchanged. The parent qualification flag is always false pending actual
owning criterion review, regardless of these collection exit codes.

Security disposition: security-relevant local resources and evidence integrity.
Reuse fixed safe-weight hashes, the entire current Standard loader/forward guards,
offline/no-pickle/no-remote-code controls, exact owned native observation and
bounded redacted evidence. Refuse redirected paths, stale/malformed plans,
duplicate/missing coverage, reentry and unobserved cleanup. No JSON specifies
commands. Only finite labels, safe error classes and numeric observations survive;
no model text, prompts, tokens, credentials, environment dump or raw exception is
published. Local operator evidence is not authenticated against a malicious
same-user actor; native/offload authority remains unqualified. Rollback removes
only this opt-in bundle route and preserves existing secure diagnostics.

## Remaining-only operator results reviewed on 2026-10-23

The supplemental [numeric assessment](remaining-model-evidence-assessment.json)
records bundle `1283a33f1a7a4d3ca7bf0864d13b3557`: 17 current candidate attempts,
14 complete measurements and three memory denials. Replay verified all 27 indexed
files and 672 case rows; these repeat the same 24 exposed cases. All 17 native
exits and model cleanups were observed. The frozen earlier assessment remains
unchanged; seven previously accepted candidates and all historical baselines
were excluded from this run.

Two additional 1.5B BF16 CPU unchecked repetitions meet the user-accepted 22/24
floor in both phases, taking 1320.67–1323.44 seconds within the declared 1800-second
batch budget and 4 GiB sampled RSS ceiling. The earlier accepted repetition stays
a separate historical reference. Three 1.5B constrained CPU attempts still lack
about 207–242 MiB of the required 3.5 GiB available RAM and have no output result.

All twelve 0.5B cohorts now complete within resource budgets. Correct results per
24 remain 12 (CPU unchecked), 10 (CPU constrained), 9 (CUDA unchecked) and 12
(CUDA constrained), below the semantic floor. The three constrained CPU runs do
supply previously missing structural/resource evidence: 22 accepted outputs per
phase, zero invalid output attempts, and observed cleanup. The optional JSON
criterion does not add a semantic threshold; its actual adaptive-state, explicit
override and packaged visual-builder UI qualification remains pending.

These are qualified portions of existing criteria, not full criterion or new
implementation-chunk completion. Paired comparisons, final aggregate checks and
native/offload/provider/advanced-quality concerns retain their owning gaps.
The partial bundle cannot be supplied directly as a new `--remaining-from`
template under the current full-profile selector; a reviewed successor must
exclude the newly accepted runs and preserve earlier results separately.

## Accepted 0.5B testing and fallback qualification

The user accepts **9 correct results per 24 cases** for the pinned 0.5B model's
testing and low-quality fallback use. Under that standard, its qualification is
**passed and completed**. The [qualification record](small-model-qualification.json)
replays all twelve completed CPU/CUDA and unchecked/constrained repetitions from
bundle `1283a33f1a7a4d3ca7bf0864d13b3557`, with first and warm phases kept separate.
They score 9–12/24, meet the existing resource/time budgets, accept no invalid
output and have observed native exit and cleanup. No model tests were repeated.

This supersedes the earlier 22/24 accuracy blocker for this limited 0.5B use.
The original higher-threshold assessments, raw results and paired findings remain
historical; they have not been rewritten as passes. This small model is useful
for testing and a free local fallback with low-quality results. Its outputs still
need the existing validation and review controls; automatic labeling is not
certified by this acceptance. These are 24 exposed cases, not unseen validation.

The larger model retains its 22/24 floor. Its three constrained CPU memory denials,
actual packaged UI qualification and native/offload/provider/final qualification
gaps remain separately owned. Do not rerun the accepted smaller-model cohorts
using an old remaining-only template; its selector needs a reviewed successor.

## Closed software model-quality tests: 30% / 80%

The current user-approved requirements assess completed model-output tests at
**at least 30% accuracy for 0.5B** and **at least 80% for 1.5B**. Insufficient
resources on the operator's PC do not count as model-quality failures or block
this quality closure. The [requirements and qualification record](model-software-quality-qualification.json)
marks **both model-quality tests passed and completed**.

All twelve current 0.5B cohorts score 9–12/24 (37.5–50%). Both latest completed
1.5B CPU cohorts score 22/24 (91.67%); earlier reviewed larger-model GPU results
score 23/24 (95.83%) and remain separate historical sources. These percentages
conservatively include every requested case, including rejected outputs. Each
device, decoder, repetition and first/warm phase remains separate. Repetition
does not turn the 24 exposed cases into fresh validation.

The three memory-denied 1.5B constrained CPU attempts have no accuracy result.
They remain environment observations, with no invented successful generation.
No further model-memory runs are needed for this quality-test contract. Historical
thresholds, paired results and raw failures remain unchanged. Production memory
guards, output validation, review/approval and cleanup remain intact; actual
packaged UI, offload safety/functionality and final software gates retain their
own acceptance. Standard-mode output does not qualify optional offloading.
