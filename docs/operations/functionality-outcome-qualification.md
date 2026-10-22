# Functionality outcome qualification

- Status: implementation procedure; controlled qualification pending
- Owner: `functionality-optimization`, increment 4
- Requirements: `functionality-qualification-crosswalk.json`
- Verification: focused qualification tests and current overall control-plane work

Run `node dev-tools/scripts/qualification/check-functionality-qualification.mjs
--write` from the repository root. It reads canonical owner state and actual
source, verifies complete controlled-criterion coverage and writes ignored
`docs/tmp/functionality-qualification-assessment.json`. A successful assessment
can report pending qualification; it never approves or completes a roadmap.
Missing inputs, changed source, unsafe references and owner drift fail closed.
Keep the review site's roadmap criteria pending until their actual evidence is
available. Source and owner-state digests bind a report to its observed inputs;
regenerate it after source or owner changes. Historical passes need current
source and named environment qualification and are not silently transferred.

## Available evidence and separate owners

Local browse journeys cover packaged desktop and thin-client authoring with
synthetic records; observer and lifecycle fixtures cover their stated failure
conditions. The Context comparison records actual isolated native memory/timing
with deterministic embeddings. These are useful local evidence and do not qualify
representative hardware or model quality, or every automated accessibility requirement.
The crosswalk lists existing harnesses for each owner; model/provider harnesses
remain opt-in. Do not download a model or use credentials through this assessor.

Data Management's guided-foundation, quality-review and exact-task human acceptance
criteria are handled offline by the user and excluded from technical closure.
Their original criteria, plans, evidence and prior approvals remain archived in
owner state; no human test pass or hardware qualification is asserted. See
`offline-human-acceptance-handoff.json` for the review of all open roadmaps. The
active crosswalk retains eleven controlled technical or mixed criteria, and exact
coverage against active owner criteria still fails closed on missing or stale maps.

Asset experience, remaining Data Management and optional constrained JSON retain
their technical qualification requirements. Security remediation retains its own
blocked file-effect qualification and independent work. The active-source Run &
Test proposal retains its approval gate. This procedure grants none of those
owners new authority. OCR remains unavailable; hardware availability alone
cannot satisfy the advanced-capability criterion.

## Agent-executable journeys and accessibility

Human studies and manual acceptance for Functionality and Canvas are user-owned
offline, outside technical closure. The original five-participant study and manual
assistive-technology portions remain archived in owner state. Exact scope revisions
supersede human instructions in original work packages, deliverables, verification
and completed plans; those are historical approved intent. No human result is
asserted. Current technical criteria govern qualification, and original failed or
pending evidence remains unchanged.

Use synthetic records to build useful multi-component systems from scratch on
packaged desktop and thin client, validate/save/publish through supported paths,
reopen exact saved structure and verify supported runtime behavior. Keep existing
Data, Asset, Context and Model task journeys in their owning tests. Unsupported
runtime/model/provider profiles stay pending. Zero critical data loss and authority
confusion remain automated journey/security invariants; participant scoring is not
an automated surrogate.

Declare source/build, OS/browser, viewport/zoom and supported host profiles before
qualification. Run actual automated keyboard traversal and activation, dialog
open/close and focus return, loading/error/terminal status, accessible names/roles,
320 CSS-pixel reflow, computed contrast, text independent of status color and
reduced-motion assertions. Store sanitized DOM/semantic/visual results, exact
assertions, failures and retries. Critical automated exceptions prevent
qualification. The crosswalk links existing meaningful-system host harnesses as
supporting coverage. Their current journey/axe results do not prove every contrast,
non-color or reduced-motion obligation: missing exact assertions/profile coverage
remain pending. Never relabel old passes under revised semantics.

Asset experience and other owners retain their independent original criteria;
this narrow three-roadmap scope change does not rewrite their manual or technical
requirements. The crosswalk inventories these owners and does not require their
qualification to pass merely to prove accurate ownership mapping.

## Model and resource cohorts

Use only separately authorized, already-installed fixed models. Declare model
revision, task/corpus/held-out digest, seed, schema, metric and statistical
tolerance before comparisons. Use existing nine-task training and preparation
matrices where supported, with separately recorded CPU, accelerator,
constrained-memory and constrained/unchecked JSON cohorts. Keep cold and warm
results separate; record RAM/VRAM measurement method, hardware, dependency
versions, elapsed time, invalid output, failures, retries and cleanup.

Report accepted examples or accepted task outcomes per minute, not raw tokens
alone. Retain every attempt. A candidate needs no statistically material quality
regression under the predeclared task metric/tolerance and at least 20 percent
better accepted-output throughput, or demonstrated compliance with the approved
resource budget. Do not choose a tolerance after seeing results. Compare only
matching cohorts; unavailable or skipped runs stay pending. Deterministic Context
conformance and Python fixtures are not installed-model quality evidence.

### Task and model expectations

Model size describes a resource/capability class, not a quality guarantee. Declare
the task, use, precision/coverage targets and failure handling before opening fresh
validation. Keep expectations separate from model-independent schema, grounding,
isolation, review, injection and resource controls.

| Model/use class | Realistic expectation and qualification limit |
| --- | --- |
| Small general-instruct models, including the pinned 0.5B model | Evaluate narrow tasks with explicit definitions and bounded outputs as review-required proposals. Report useful correct coverage, accepted precision, abstentions and repair cost; expect broader tasks to need more review or remain unsupported. Neither constrained syntax nor a development success implies broad reasoning, reliable automatic acceptance or a universal 95-percent accuracy claim. |
| Larger or task-specialized models, including the approved 1.5B trial | Measure broader coverage against added load/RAM/VRAM cost on matching cohorts. Size alone does not fix errors; retained 23/24 observations apply to that synthetic task only. Keep unavailable CPU admission pending. |
| Automatic or high-impact use | Parameter count grants no additional authority. Representative independent semantic/error and operational qualification would be required before changing the existing review or acceptance policy. This experiment changes neither policy. |

The bounded 0.5B caption experiment uses twelve new development cases across three
unrelated task configurations. Compare the exact current prechange caption with
one generic clarification in both existing decoding modes and first/warm phases,
using unchanged profile/settings and owned-child guards. Keep the candidate only
if it preserves every paired correct case and improves correct accepted outcomes;
a cost-only benefit must meet the existing 20-percent whole-delivery target across
matching repeated groups. Otherwise withdraw it. These are development selection
rules, not new product quality thresholds or unseen validation. Original exposed
24-case regressions, strict quality/throughput gates and failed observations stay
unchanged. Freeze any prospective task-specific validation targets and candidate
before a separate case author supplies fresh validation. No domain answers,
benchmark-specific heuristics or new few-shot input contract enter production.

The completed caption-only GPU development comparison retained all baseline-correct
cases. One distinct case improved in both first and warm phases; across the repeated
observations, correct outcomes increased from 42/48 to 44/48, with 46 accepted in
each arm. Both constrained arms correctly handled all twelve distinct clear cases
in each phase. Two wrong accepted outcomes still remain in the candidate's unchecked
observations. Twelve cases repeated across modes/phases are not 48 independent
examples or a population accuracy estimate. The three-group median delivery ratios
were 1.07582 unchecked and 1.01910 constrained, below 1.2; the constrained opaque-label
pair was slower. These measurements support the predeclared development semantic
alternative, not a 20-percent cost improvement or automatic acceptance.

The unchanged CPU guard denied the first development child before inference:
3543986384 bytes required against 1961914368 available after runtime initialization.
The remaining CPU development is unexecuted/pending. The twelve completed GPU
children recorded physical exit zero and runtime cleanup; neither supplies CPU
compatibility. Retain the raw paired/token/resource reports and independent
recomputation under ignored local evidence. Known-model regressions and future
independent task-specific validation remain distinct from this development split.

The subsequent exposed 24-case GPU compatibility run used one baseline/candidate
pair per mode for each approved model. Against the original 442518c4 baseline,
the 0.5B candidate improved 7 to 12 correct unchecked and 5 to 14 constrained in each
phase, losing no previously correct case. Both still failed the absolute quality
floor. This comparison includes existing allowed-label schema constraints and
other earlier framework changes; it does not isolate the caption. The 1.5B
unchecked pair retained 23/24, but constrained regressed 23 to 22/24 in both phases,
losing one distinct correct case. The shared caption clarification was therefore
withdrawn, restoring the original production wording. Preserve all eight native
child reports, paired identities, cleanup results and original thresholds.
One diagnostic pair per cohort is neither the full three-replicate qualification
nor fresh independent validation; its process exit zero means measurement
completed, not that quality passed. No new model-size threshold, automatic
acceptance policy or CPU pass is inferred from these results.

## Whole-host task qualification

The representative controlled download matrix has passed on the declared
packaged desktop and managed-server/thin-client profiles; see the final controlled
qualification results below. This does not qualify every model or provider family.
Record source/build, OS, runtime/dependency versions, transport,
installed model revision, device, fixture digest and the physical worker identity
in private operator evidence; retain only sanitized identity digests and counts
in repository evidence. Use a disposable workspace and synthetic inputs. Never
terminate unrelated processes or use a real user's data to inject failure.

Use a representative actual-host matrix plus the current family-specific cleanup
regressions: downloads exercise real API/IPC observation and physical owned-worker
lifecycle; training, image and Context tests retain their distinct staging, power,
output-finalization and cancellation paths. A supported-family claim requires its
own evidence; a representative host check never asserts inference or every family.
Run a successful task, leave its feature page while active, reopen it and verify
exact task/result identity. Repeat with workspace navigation, transport disconnect/reconnect,
explicit cancellation, an owned disposable worker failure and graceful host
shutdown. Mark unsupported cancellation/families explicitly unavailable; do not
admit currently denied route families merely to run this procedure. Record all
attempts, task-status times, output finalizations and resource release times.
Verify stale workspace responses cannot update the destination, terminal outputs
finalize once, retries preserve authority and resources are released without an
open page. Measure healthy-local progress and terminal visibility p95 against the
approved 2 second target; distinguish transport outages from that denominator.
Capture the fixture's fixed initial 10-percent API transition and its immutable
timestamp before reload/navigation, then time its rendered value or a newer
value. Include reload/recovery time; never replace a missed milestone with a
later easier transition or retimestamp older UI progress from a newer API read.
All thirty initial-progress and terminal delays must be finite and nonnegative;
retain slow samples. Later 50-percent visibility proves updates occur, while
focused live-observer tests retain the one-second subsequent-update assertion.
The initial recovery metric does not independently time every later transition.
Check actual worker exit, staging removal, subscriptions and power leases after
each terminal/failure/shutdown case. Unreleased resources or ambiguous ownership
fail the run; cancellation acknowledgment alone is insufficient.

Owned-task reconciler, host shutdown and runtime supervisor tests are supporting
failure-path fixtures. The Python training E2E runner exercises training only;
none alone qualifies whole-host observation, physical cleanup or every family.

The separate `playwright.managed-reference.config.ts` launcher uses actual
PostgreSQL, OIDC/JOSE, organization membership, forced RLS and verified TLS. It
requires a separately owned disposable database reference under ignored local
storage, verifies its pinned image/labels and sole loopback port, creates a fresh
database and nonowner runtime account without administrative privileges, and
uses separate privileged migration/setup. Local CA trust is scoped to child
processes; verification is never disabled or installed globally. The frontend is
a controlled loopback development proxy, not production frontend qualification.
Missing/invalid credentials, a nonmember and foreign organization are denied;
an existing foreign workspace is unavailable under the primary context while a
matched authorized summary succeeds. Credentials, keys and private diagnostics
remain ignored, never in public reports or browser traces.

The managed authoring journey explicitly selects Systems after workspace
creation and requires its level-one heading and actual system creation form.
Home has a Systems dashboard card, so a global heading match alone cannot prove
route readiness. Preserve original failed runs and use a separate Playwright
output directory per diagnostic or qualification cohort so a later run cannot
replace its failure screenshot or DOM. A shortened diagnostic timeout supplies
failure analysis only; qualification retains the declared default timeout and
the complete authoring and automated accessibility checks.

Set `MANAGED_REFERENCE_DATABASE` to that owned fixture's private-state reference.
Use `MANAGED_REFERENCE_LARGE_FIXTURE=1` for the exact large summary/sparse catalog
test, and `PYTHON_RUNTIME_QUALIFICATION_SCENARIO=observed-download` for fixed task
tests. The failure cohort uses the finite `worker-failure-download` scenario: only
the owned fixture exits, with code 23 after 1200 ms. It never kills a foreign
process. `QUALIFICATION_TASK_DIAGNOSTIC=1` reduces task samples and explicitly
cannot close qualification. Full task timings use thirty actual observed tasks;
the transport/model marker contains no weights and never qualifies inference.
Actual host shutdown requires acknowledgment, exit zero and physical worker exit;
unexpected death or forced cleanup fails, and all owned cleanup is attempted.
Owned-task and fault scenarios require at least one exact owned worker identity
before zero remaining processes can qualify cleanup; browse-only runs may
legitimately launch no worker.

The desktop disconnect probe must observe actual `ECONNREFUSED` within its
unchanged three-second window. Closing an already connected health probe can
first produce `ECONNRESET`; that one demonstrated transient condition retries
within the same window and never supplies positive evidence. Other errors fail.
The report records actual refusal and the reset count, bounded by the polling
window. Same-task IPC retention, eventual API/UI completion and acknowledged
native cleanup remain separately required. Preserve original reset failures.

Focused lifecycle qualification also drives registered training and dataset
callbacks through failed, cancelled and failed/`task_timeout` results without
external feature reads or cancel calls. It asserts real private staging removal,
one lifecycle completion, released reconciliation ownership, retained workspace
identity and zero model/output publication. These are synthetic registry tests;
physical worker shutdown remains the separate host qualification above.
Fake-clock observation tests enter capped idle/error backoff, then require an
explicit scoped invalidation to read immediately without advancing time, while
preserving single-flight, foreign-workspace denial and disposal.

Reference UI tests measure navigation through exact rendered large-summary counts
and Add/search through the first usable compatible page, with five warmups and
thirty samples. The actual UI page size is 48; complete traversal must return the
100 exact compatible definitions from 1000 sparse candidates without duplicates,
skips or repeated continuations. The independent operation probes retain their
original exact workloads and budgets. Partial/failed attempts are preserved;
neither an empty picker nor a successful HTTP envelope qualifies the workload.
Baseline host diagnostics exposed missing shared authored-asset composition and
an existing notification left running after completion in another workspace,
and an exited owned worker whose task stays unavailable instead of receiving an
authoritative terminal disposition;
these product findings require fixes and fresh complete runs before closure.

## Installed Context embedding qualification

`run_trained_context_qualification.py` implements the fixed trained MiniLM
comparison. Before execution it verifies every inert model/tokenizer file against
the official pinned revision hashes, refuses extra/pickle/redirected files, and
disables network and pickle loading. It generates the actual bounded package from
1000/10000/100000 prepared synthetic rows, with eight held-out queries and exactly
five labeled relevant rows per query. The 100000-row cohort uses separately
declared 128 dimensions to preserve the 128 MiB member ceiling; the others use 384.
No quality threshold or package ceiling changes after seeing results. A separate
1000-row ordinary generation trial omits placement and verifies actual default
CPU execution; its package/evidence is preserved alongside common CUDA packages.

The unchanged retrieval algorithm and candidate share the current fixed local
embedding implementation for each matched CPU/CUDA pair. This qualifies the
retrieval allocation optimization on real model/device cohorts; it does not claim
the historical release already supported CUDA. Each timed query loads the trained
model afresh. Five warmups, thirty measurements and three fresh-child memory runs
include digest/materialization/validation, model load/inference, exact search and
cleanup. Shared library/CUDA-context initialization is outside the measured
boundary; OS cache warmth is uncontrolled. Actual embedding weight/input devices,
runtime versions, recall, exact citations/order/scores, p95, 5 ms sampled incremental
RSS and VRAM cleanup are retained. CUDA initialization includes a fixed tiny
matrix multiplication before the readiness/RSS handshake. Its measured persistent
BLAS-workspace allocation/reservation is reported as a runtime floor; after every
cohort task-owned model/tensor memory must return to that floor. No cache settings
or private allocator APIs are changed. See the [PyTorch CUDA semantics](https://docs.pytorch.org/docs/2.6/notes/cuda.html).
The 4 GiB child ceiling is a test safety bound,
not an approved generation resource budget. A third matched CPU cohort assigns
each disposable child to its own unnamed Windows job with enforced 2 GiB process
and job commit limits before model imports. Native readback verifies assignment,
limits and peak commit; this is the declared constrained-memory profile, not
a claim that polling alone enforces memory. Only owned children are restricted;
no host setting, privilege or unrelated process changes. [Windows extended job limits](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information)
bound committed memory independently of the sampled RSS metric. Reduced invocations
are diagnostic only and cannot report complete qualification. Failures remain in
per-run JSON; bounded native stderr stays in ignored private diagnostics.

Run with the pinned native Python environment and a separately verified isolated
model acquisition:

```text
python -s -B dev-tools/scripts/qualification/run_trained_context_qualification.py --model-manifest .local-codex/model-qualification/minilm-<owned-uuid>/acquisition.json
```

This procedure is pending. Use a fixed authorized, already-installed embedding
model/revision and a digest-identified synthetic corpus with predeclared query
and relevant-citation labels. Declare chunking, dimensions, top-k, seeds, cold
and warm cohorts, repeat count, precision and measurement method before running.
Prepare separate unchanged-baseline and candidate packages through the real
generation/application path with the same corpus/model settings when changing
generation. For the current retrieval-only allocation delta, compare the two
algorithms against one shared immutable package generated through the actual
runtime path, with identical trained embedding execution for each pair. Do not use the
deterministic synthetic embeddings or tiny random-model test as quality proof.

On each named CPU, accelerator and enforced constrained-memory profile, execute the held-out
queries through the supported Context operation. Record retrieval recall@5,
exact citation identities, failures, retries, p95 latency and isolated incremental
peak RSS, including package/model load and cleanup. The approved targets are
recall@5 at least 0.90, absolute recall degradation at most 0.02, unchanged exact
search/citation correctness, at least 25 percent lower incremental peak RSS on
10000/100000 chunk fixtures and no more than 5 percent p95 latency regression.
Keep workload dimensions and cold/warm results explicit. Preserve a rejected
fixture that exceeds an existing resource limit; never enlarge a limit to get a
pass. Denied/corrupt/wrong-workspace packages and cancellation must still fail
safely. Keep model/package digests and aggregate metrics, not private text,
vectors, paths or outputs, in evidence. Unavailable profiles remain pending.

`run_context_efficiency_qualification.py` supplies the bounded deterministic
allocation comparison; Context tests supply conformance and failure coverage.
They support this procedure but do not measure installed-model retrieval quality.

## Release decision

After all implementation chunks are recorded, run the configured aggregate suite
through a serial `overall` work item, applicable repository/build gates and real
separate-invocation review. Preserve failed attempts and triage failures; a skip
is not a pass. Link the exact current receipt and owner evidence before recording
local completion. Every controlled criterion must pass before final roadmap
completion. While required automated profiles, provider credentials or physical model
environments are unavailable, technical qualification remains pending. Human
acceptance is offline and does not block these technical roadmaps.

Rollback withdraws an unqualified candidate and preserves evidence and stronger
security controls. Never restore weaker authority or declare an unavailable check
passed to meet a schedule.

Historical aggregate attempts and corrections remain in the owner JSON and
control-plane record store. Earlier fixture/test-root failures and six headless
artifact-fixture failures were preserved, corrected and separately reviewed; those
historical passes do not qualify later source. Find current aggregate evidence
through the newest current-source work bound to this roadmap and `overall`, never
through a hardcoded historical pass.

The original-supplier dependency audit now passes with zero runtime and toolchain
advisories after the approved official toolchain remediation. See
`docs/security/security-local-controls-qualification.json` for the actual focused
receipt/review and residual limits. This does not rewrite the existing failed
`full-current-qualification` declaration or grant a new overall pass. Regenerate
current source-bound qualification after later edits. The crosswalk inventories
eleven controlled criteria; current outcomes live in each owning roadmap's JSON
state. Neither this inventory, a metadata scope change nor the dependency audit
silently promotes any criterion.
# Reproduced task and custom-selection defects

Reference qualification must verify scoped custom definitions through both list
and detail, including foreign-workspace denial and complete sparse continuation.
Task evidence includes terminal notification reconciliation after workspace return,
confirmed owned-worker exit in both authoritative API and rendered UI, temporary
transport uncertainty, cancellation and physical cleanup duration. Supporting
one-sample diagnostics never supply the thirty-sample timing qualification.

## Installed generation measurement

`run_installed_generation_qualification.py --model-manifest <isolated acquisition>`
uses the original `qwen05-float32` profile by default. The separately authorized
`--model-profile qwen15-bfloat16` selects Qwen2.5-1.5B-Instruct revision
`989aa7980e4cf806f80c7fef2b1adb7bc71aa306`, with native bfloat16 on both matched
CPU/CUDA variants. Both profiles pin all eight inert file hashes and isolated
cache identities. Unknown profiles, cross-profile acquisitions and effective
precision mismatches fail before inference. The original 0.5B float32 plan and
failed results remain preserved; a new profile never relabels them. The larger
safe-weight file bound applies only to the explicitly selected 1.5B acquisition;
production memory admission and all other test/resource/validation bounds remain
unchanged. The harness performs no download, remote-code or pickle loading, and denies socket
connections. The source-bound `installed_generation_holdout.json` freezes24new
balanced synthetic classification cases, their oracle, prompt, actual sampling,
per-case seeds, three fresh paired replicates and quality/throughput decisions.
Development cases are excluded. Repeats are timing observations, never additional
independent semantic cases or a population accuracy claim.

This is the configured structured-layout classification worker function path;
it does not qualify every preparation recipe, the default UI or whole-host model
execution. Each CPU/CUDA and constrained/unchecked pair uses the verified unchanged selected
baseline modules and common pinned inference runtime. First-batch load/inference,
warm inference and one final unload are reported separately. The primary rate
charges the whole child's cold load,48requests, failed/invalid attempts, repairs
and cleanup. All cohorts must meet the predeclared absolute fixture floor and
paired non-regression/cleanup gates; at least one positive-baseline matched
generative cohort must demonstrate the20percent gain. Zero-baseline percentage
gains remain undefined. Unchanged cohorts are reported without an improvement
claim. Process RSS, actual tensor placement, CUDA allocated/reserved peaks and
runtime floors, final cache state and observed native child exit accompany each
run. The disposable6GiB/20minute safety ceilings are not product resource budgets.
Private diagnostic logs and incremental failure evidence stay in ignored local
run storage. Only actual complete passing results may qualify the parent roadmap.

The first fixed 1.5B trial reproduced a regression in a candidate with experimental
prompt field order (23/24 baseline versus 20/24 candidate correct per phase). That
experiment was withdrawn in favor of the existing sorted canonical prompt
presentation. Retain the failed/interrupted evidence and retest the same fixed
cases and gates; development-set improvements never override a failed comparison.

The completed GPU portions of the canonical-presentation follow-up preserved
23/24 correct in both modes but median whole-delivery gains were only 2.9 percent
unchecked and 5.3 percent constrained. CPU admission stayed unavailable. Retain
this failed overall result.

A separate compact-formatting trial passed84 installed grammar checks and28
independent non-constant string checks, but its first matched constrained pair
regressed from23/24 baseline correct to18/24 candidate correct in both phases.
Both children completed cleanup and native exit. The remaining redundant repeats
were interrupted only on the verified owned process tree; retain the partial
parent report together with its interruption record. All three unchecked pairs
preserved23/24 with a median whole-delivery ratio of1.00123. The empty whitespace
override was withdrawn, restoring the original pinned backend default. This is
a failed optimization experiment, not a model-quality qualification. CPU retry
was still denied by the unchanged available-memory guard. Original quality,
throughput and resource requirements remain active.

The final host matrix on source
`source.6b4990a4abba2c603460fb911e23c0c602c19be23ece09e5befb29bd39c9da1a`
passed seven of eight groups, including all nine packaged desktop cases, all six
thin-client cases, and each managed browse/performance/task/failure journey. The
owned catalog workload failed its unchanged 200 ms budget at 205.704 ms p95;
earlier passing observations remain historical. Source inspection found duplicate
complete passive copying in each definition card/detail read. The correction
combines bounded admission with private full-body authority matching on the owned
copy. It retains all bounds, metadata controls, custom-row readability, optional
validation, workspace isolation and pagination. Focused denial/alias tests and a
fresh unchanged workload must pass; this component alone does not qualify a
parent criterion or replace the required current-source host matrix.

The first unchanged six-operation probe after the correction passed on
`source.f459693377dd421f5d4a6b20ea54f510d6d0c217bf1c60e7ec161eb638e622f7`.
Catalog p95 was 172.582 ms across the original five warmups and thirty samples;
the other five operations also met their original budgets. This is a supporting
observation, not a paired statistical improvement estimate or final host
qualification. The earlier 205.704 ms failure remains preserved. The focused
authority/facade suite passed all thirty tests; its initial copy-isolation test
omitted the existing configuration-schema opt-in, then passed after requesting
that option without changing production projection behavior.

## Final controlled host and database results

The subsequent frozen matrix on
`source.e17e30d2c83ce4f62a0bda9f9d39f4bb3584a15f419b15ef1839a69dcd7f8ac7`
passed all eight groups, including all nine packaged desktop and six thin-client
cases and the four managed cohorts. Three useful mixed-component systems per
editor host retained their exact saved structure and declared behavior. Actual
automated keyboard, focus, reflow and scoped accessibility checks passed on the
named profiles. The catalog p95 was 188.011 ms within 200 ms; all other fixed
operation and reference-page budgets passed. The cold Canvas p95 was 6209.8462 ms
within 15542.8 ms over thirty measured fresh profiles after five warmups. Retain
the 15949.4652 ms maximum, the small Add p95 regression, earlier failures and
the unresolved cause of the historical Foundation startup failure.

The Canvas roadmap and functionality browse/task increments have actual
criterion-specific verification and independent review. Their immutable local
evidence packets retain the raw report bindings and scope limits. The combined
suite remains 3953 passed, four skipped and zero failed; its skipped outcomes
are not rewritten. Context, installed-model and remaining native/security
qualification are separate.

Both optional PostgreSQL cases were then executed separately, unchanged, against
fresh databases in the existing isolated loopback fixture. Migration/transaction/
health/revision conformance and physical runtime database/least-privilege isolation
each passed, with ordinary child exit zero and no skip. The bounded operator
verified exact fixture identity and exclusive access, kept credentials in memory
and private child environments, and restored the exact baseline database, role
and membership inventory using journaled object identities. Its actual result is
under ignored `.local-codex/approved-controls/postgres-conformance-df19d477de93757f/`.
This supplies neither deployment TLS nor native file/model/provider qualification.
The separate run does not replace the four skipped aggregate events. Independent
pre-execution review required safe pool errors, bounded waits, independent cleanup
and owner/partial-pair checks; ten focused delta admission cases passed after
retained test failures were corrected without weakening those controls.

The trained Context harness admits a read-only native exit observer for the
validated ready worker before authorizing Windows inference. A redirector's exit
alone is insufficient. Returned evidence requires actual worker exit zero. An
unconfirmed exit or blocked reader latches later launches and immediately aborts
the matrix with its partial report and cleanup pending; confirm exact owned
cleanup before attempting another invocation. Termination errors still permit
independent exit confirmation. Termination remains limited to the originally
spawned launcher tree. Memory/job limits, corpus, metrics and thresholds stay unchanged.
Injected denial tests and a harmless native handshake fixture qualify this
lifecycle behavior separately from the full trained-model matrix.

