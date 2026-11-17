# Standard-only model qualification

- Status: executed on 2026-10-22; neither complete model profile qualified
- Owners: Functionality model outcomes and optional constrained-generation evidence
- Verification: `dev-tools/scripts/qualification/tests/test_standard_generation_qualification.py`

The latest operator-run Windows version2 collection is assessed in
[versioned JSON](model-blocker-evidence-assessment.json). All48 workers were
attempted:23 full measurements,16 memory denials and9 historical-baseline
contract failures, with48 observed native exits0 and model cleanups. The user
accepts the completed1.5B absolute-quality check at **22/24**; all7 completed
candidate observations meet that revised threshold. This explicit retrospective
acceptance leaves the frozen23/24 protocol and its results unchanged.

The1.5B GPU cohorts also meet the prospective host budgets. Full model criteria
remain incomplete: CPU has only one unchecked pair (baseline23, candidate22,
one lost-correct case), constrained CPU is denied, and0.5B quality/matched
baselines remain insufficient. No missing memory, paired no-regression, native,
offload or whole-host qualification is converted into a pass. Original version1
measurements in this document and its companion JSON remain historical.

The separate [all-blocked bundle](model-blocker-testing.md) selects the prospective
`windows-lightweight-v1` version2 host profile: CPU first, a fixed2400second
1.5B CPU watchdog/2160second cooperative cutoff, and explicit absolute batch and
VRAM targets. Default/version1 callers keep their original bounds and gates.
Original recorded results below retain their exact source/protocol and failures.
The new profile does not relabel those results, change the23of24 automatic-label
floor, grant parent qualification or enable native/offload operations. Both routes
now stop successors when actual model cleanup is unobserved, even after native exit.

This operator continues installed-model measurements independently of native
file effects and offload recovery. It uses the two already approved, hash-verified
Qwen acquisitions. It downloads nothing, uses no credentials, and never calls
offload readiness or inspects the retained staging directory.

```text
python dev-tools/scripts/qualification/run_standard_generation_qualification.py --model-profile qwen05-float32
python dev-tools/scripts/qualification/run_standard_generation_qualification.py --model-profile qwen15-bfloat16
```

Planning hashes the installed inputs, extracts only two fixed historical
algorithms, and characterizes each arm in a fresh process without loading weights.
Review the exact returned plan digest, source and operator before execution:

```text
python dev-tools/scripts/qualification/run_standard_generation_qualification.py --execute <run-id> --plan-sha256 <reviewed-digest>
```

Execution requires the exact plan and an exclusive one-attempt intent. New attempts
need new plans and retain previous directories. Results are incremental bounded
JSON under ignored `.local-codex/standard-generation-qualification/`. An uncertain
native exit stops scheduling and must also prevent starting another experiment.
The child supervisor retains its four-GiB sampled RSS ceiling, 1,200-second
deadline, finite startup/output limits and native exit observation. Sampling is
not a hard allocation guarantee or an approved product resource budget.

Both arms use today's entire `local_text_generation.py`, model loader, forward
guards, placement, cache and unload implementation. The baseline selects only
the verified `example_generation.py` and `constrained_json_decoder.py` bytes from
commit `442518c46fa9c2caf755ce1dd83b2f490b635330`. Decoder and error identities are
bound together before importing the selected generation algorithm. The candidate
uses current algorithms. The historical runner and its common-runtime hash check
remain unchanged; this is a separate prospective algorithm comparison over a
shared current runtime, not qualification of a historical release.

The literal Standard/no-overflow configuration and exact
`TransformersChatGenerator` implementation are required. Standard mode remains
authoritative even though the existing internal call accepts the keyword
`allow_offload=True`. In-process caches and retained leases must be empty before
load and after cleanup. No staging lease is acquired or ambient staging inspected.

The original exposed 24-case classification regression, prompt, labels, per-case
seeds, sampling, four CPU threads and first/warm phases stay fixed. Each profile
has three fresh paired replicates per CPU/CUDA and unchecked/constrained cohort;
pair order alternates. Float32 0.5B and BF16 1.5B are independent profiles.
Arm-specific schema fingerprints are declared because the current schema adds
the label enum. Semantic cases, oracle and final validators stay authoritative.
These exposed cases are never fresh validation or prompt-tuning data.

A candidate must produce at least 23 correct accepted results in every phase,
lose zero baseline-correct cases, accept no invalid output, and retain actual
placement, settings, cleanup and confirmed native exit. Every required cohort
must complete; the median paired correct-accepted delivery ratio must reach 1.20
in at least one positive-baseline cohort. A zero baseline has no defined relative
gain. Count intervals describe fixed-fixture observations, not population accuracy.

Primary delivery is model load through all 48 requests, every attempt/repair,
evidence overhead and one unload. Common imports, input verification, algorithm
selection and CUDA runtime initialization are excluded identically, preserving
the original comparison boundary. Full launcher-to-native-exit time is reported
separately. CPU/GPU, modes and profiles are never pooled. A cooperative stop
reserves cleanup time but remains incomplete; it cannot shorten the denominator
or convert a deadline failure into qualification.

The assessor replays finite predicted labels and exact case membership, checks
attempt/timing aggregates, arm identity, source, sampled RSS, observed VRAM floors,
ownership caches and actual native exit before computing paired rates. Historical
failures, denied CPU admission, exposed partial diagnostics, pending whole-host
model outcomes and native/offload safety remain separate. A completed helper or
measured cohort grants no parent pass. No retrieval-only budget becomes a
generative budget. Numerical results are summarized in
`standard-generation-qualification.json` after actual execution and review.

Security disposition: security-relevant qualification integrity and local model
resource/worker ownership. Fixed safe-weight hashes, no network/pickle/remote
code, current production guards, bounded owned children, exact protocol/source
binding, numeric-only diagnostics and fail-closed replay control the boundary.
Operator-owned local evidence is not authenticated against a malicious same-user
actor; native protection and other existing security gaps are not qualified here.

## Recorded execution

Both exact plans passed separate pre-execution review and fresh registered checks
before execution on the same frozen source. The 1.5B experiment ran first. Its
24 confirmed native exits and observed cleanup were checked before admitting
the 0.5B experiment. The versioned JSON retains plan, source, report and evidence
index hashes, every cohort, all denials, timing boundaries and paired calculations.
Author replay verified all54 indexed JSON files,23 complete measurements and
eight comparison results. The control plane requires separate final work review;
none of these measurements grants parent qualification.

| Current algorithm profile | Device / decoder | Correct per24, first and warm | Current repetitions completed | Matched median delivery ratio |
| --- | --- | --- | --- | --- |
| 1.5B BF16 | CUDA / unchecked | 23 | 3/3 | 0.962711 |
| 1.5B BF16 | CUDA / constrained | 23 | 3/3 | 1.018119 |
| 1.5B BF16 | CPU / both | Unavailable: memory admission denied | 0/3 each | Unavailable |
| 0.5B Float32 | CUDA / unchecked | 9 | 3/3 | Unavailable: baseline contract failure |
| 0.5B Float32 | CUDA / constrained | 12 | 3/3 | Unavailable: baseline contract failure |
| 0.5B Float32 | CPU / unchecked | 12 | 3/3 | Unavailable: baseline contract failure |
| 0.5B Float32 | CPU / constrained | 10 | 2/3; final attempt denied | Unavailable: failed/denied baseline |

Each completed phase contains the same24 exposed cases; repetitions are not new
independent examples. The1.5B GPU quality/no-lost-correct gates pass, but both
ratios miss1.20. Its12 CPU attempts were denied by the unchanged memory guard.
The0.5B candidate misses the23of24 floor in every measured phase. Ten historical
baseline runs stopped at the finite accepted-field/label contract check. Two
later constrained CPU baselines and the last candidate were denied after observed
available RAM fell below admission requirements. Neither failures nor short denial
durations supply a complete baseline denominator. No failed experiment was retried
until pass, and no threshold, guard, prompt, schema or model setting was changed.

All48 worker exits were observed as zero, and model caches/retained in-process
leases were empty after cleanup. Twenty-three workers completed both phases,
15 were denied memory and10 retained incomplete failed measurements. A normal
worker exit establishes lifecycle evidence, not numerical model success. CPU
unchecked0.5B candidates took248.79–249.75seconds for primary delivery; the two
completed constrained candidates took about157seconds. Exact timings, wrong
accepted labels, rejected/skipped results, attempts and repairs remain separate
in JSON. No speed or accuracy claim pools devices, modes, precisions or models.

These observations support treating this0.5B profile as an unqualified source of
narrow proposals requiring the existing dataset review/approval control. They do
not establish general model capability. The larger model's GPU fixture result
does not qualify its CPU profile or demonstrate the required optimization.
Complete whole-host generation, optional adaptive/override visual-builder
qualification, native file/staging protection and offload recovery remain pending.
No resource-budget alternative was introduced; human acceptance stays offline.

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
