# Standalone local model testing

- Status: current
- Verification: `dev-tools/scripts/qualification/tests/test_standalone_model_tests.py`

## Current qualification scope

Completed Standard model accuracy is closed under the accepted 30%/80%
requirements for the 0.5B/1.5B models. Do not repeat those tests to close unrelated
resource, host or native work. See the [model evidence bundle](model-blocker-testing.md)
for retained protocols and current scope. New collection still needs its own
reviewed, authorized evidence purpose; these reference commands grant none.

## Diagnostic commands (reference)

For a separately approved diagnostic, open Command Prompt in the repository
folder. The launcher uses the existing AI Python environment and installed Node
runtime. It installs nothing. Running it separately frees the coding agent's RAM.

```bat
"dev-tools\scripts\qualification\run-model-tests.cmd"
```

The default runs the already cached, pinned Qwen 1.5B model on CPU in both
unchecked and constrained structured-output modes, with one repetition. Each
mode processes 24 synthetic billing/support requests twice (first and warm).
Tests run sequentially, one fresh child per cohort. Each child has the existing
20-minute deadline and 4 GiB sampled process-RSS emergency ceiling. These safety
limits are not product resource budgets. Large models or constrained decoding
can time out; partial results remain available.

Before starting another complete matrix, use an explicitly smaller diagnostic
to measure feasibility. `--case-limit 1` or `6` selects the first N exposed cases
in their original order for **both** first and warm phases. The default remains
24. The plan records the selection; a small selection is not a representative
quality sample, full-corpus qualification or a replacement baseline.

Use explicit selections for a shorter run or to compare devices:

```bat
rem Inspect and verify inputs without importing Torch or loading a model.
dev-tools\scripts\qualification\run-model-tests.cmd --plan-only

rem Smaller model, CPU, one mode.
dev-tools\scripts\qualification\run-model-tests.cmd --model-profile qwen05-float32 --devices cpu --modes constrained

rem Short feasibility diagnostic of the existing 1.5B CPU model.
dev-tools\scripts\qualification\run-model-tests.cmd --case-limit 1 --modes unchecked

rem Larger model, CPU and CUDA, three separate repetitions per mode/device.
dev-tools\scripts\qualification\run-model-tests.cmd --model-profile qwen15-bfloat16 --devices cpu cuda --repeats 3
```

Run the relative examples from the repository root. CMD options use spaces
between multiple devices/modes. If the existing AI environment has moved, set
`AISB_MODEL_TEST_PYTHON` in that Command Prompt session:

```bat
set "AISB_MODEL_TEST_PYTHON=C:\path\to\prepared-environment\Scripts\python.exe"
```

Do not substitute the system Python unless its AI dependencies are already
prepared. The CMD launcher calls Python directly and needs no PowerShell process
or execution-policy changes. Alternatively, with Node on PATH, call the prepared
Python directly:

```bat
artifacts\tmp\lancedb-python312-ai-runtime\Scripts\python.exe -s -B dev-tools\scripts\qualification\run_standalone_model_tests.py --run --model-profile qwen15-bfloat16 --devices cpu --modes unchecked constrained
```

The existing PowerShell launcher remains available with its original options:

```powershell
& '.\dev-tools\scripts\qualification\run-model-tests.ps1' -PlanOnly
& '.\dev-tools\scripts\qualification\run-model-tests.ps1' -ModelProfile qwen05-float32 -Devices cpu,cuda
& '.\dev-tools\scripts\qualification\run-model-tests.ps1' -CaseLimit 6 -Modes constrained
```

Keep the repository unchanged while a run executes. Close the application and
other model workers first to avoid competing memory use. The script does not
stop unrelated processes or the review server. It preserves production memory
admission; insufficient RAM yields `denied-memory`, not an automatic retry with
weaker controls. CUDA absence is recorded separately. A failed cohort normally
allows the next cohort to run; uncertain child shutdown aborts the matrix.
Ctrl+C requests shutdown of the exact owned child. Wait for the evidence path
and terminal return before closing the terminal. Forced termination is never
reported as graceful model cleanup.

The hard deadline stays at 1,200 seconds. Before starting each new case, the
runner checks elapsed time plus 1.5 times the longest completed case against
1,080 seconds, reserving the final 120 seconds for cleanup. This advisory check
can stop early with `incomplete-budget-stop`; an unexpectedly slow first/current
case can still hit the native watchdog. Neither a cooperative stop nor native
exit alone proves cleanup. Complete requested measurements, actual unload and
native exit are separate observations.

## Evidence to bring back

The console prints the exact run directory:
`.local-codex/standalone-model-tests/<unique-run-id>/`. It is ignored by Git and
is not automatically deleted. Keep it intact when restarting Codex, then ask
for a review of that directory or its `summary.json`.

- `plan.json`: exact source, operator, supervisor and corpus identities; pinned
  model/revision; modes, devices, precision, repetitions and safety bounds.
- `summary.json`: incremental cohort states, observed RSS, native exit evidence
  from supervision, failure reasons and summarized quality/timing results.
  Partial progress retains recorded/expected case counts, correct/accepted counts
  and summed case time after a timeout without changing its failed status.
- `<device>-<mode>-<repeat>/cohort.json`: per-case correctness, finite predicted
  labels, attempts, repairs, first/warm timings, model load time, RAM admission
  denials, CUDA peaks and actual model cleanup observations. It is saved after
  every case and on handled failure. A killed process may leave its last
  `running` record; that is incomplete evidence, not a pass.
  Per-attempt numeric observations include input/generated token counts, output
  limit, EOS/max-output/other termination, preparation time, complete generation
  time, first model forward and subsequent forward totals. Preparation includes
  prompt formatting, tokenization and any decoder setup before `model.generate`;
  it does not claim an isolated tokenizer benchmark. CPU forward durations use
  wall time. CUDA forward durations measure host dispatch, **not** kernel time;
  only full generation synchronizes CUDA at its boundaries. No token IDs, prompt
  text or generated text are recorded. Effective thread, cache and allowlisted
  attention settings help interpret results. Hooks are confined to the model
  and its actual input embedding and are removed during cleanup.
- `evidence-index.json`: SHA-256 hashes of the JSON evidence present at handled
  completion/interruption. This detects later accidental edits, not malicious
  alteration by someone who controls the entire directory. An abrupt host or
  parent-process termination can leave partial evidence without this index.

Exit code 0 means every requested cohort produced complete measurements and
confirmed cleanup/exit. It does **not** mean that quality, performance or a
roadmap acceptance gate passed. Exit code 1 means preflight, execution or cleanup
was incomplete. Earlier runs are never overwritten. Review individual failures
alongside successes; do not pool repetitions as extra independent quality cases.

## Concurrent test commands

Run one model test command at a time. The diagnostic, Standard and evidence-bundle
commands use the same operating-system locks. A second command refuses execution
while another command or its child still owns a lock. Wait for that test to exit,
then retry. Do not delete lock files. A stopped process releases its own lock;
a surviving child keeps its lock until it exits. The child takes its lock after
the supervisor confirms native process observation and before model work starts.
Plan-only commands do not reserve execution locks.

## Scope and security review

The following run608aab71 findings describe that historical diagnostic only.
They do not reopen the completed Standard accuracy tests or apply the old
comparison policy to the current 30%/80% requirements.

The [assessment of supplied run 608aab71](standalone-model-evidence-assessment.json)
preserves its exact hashes, independently replayed partial results and roadmap
limitations. Both CPU bfloat16 first passes scored 22/24; both timed out during
warm delivery with unobserved model cleanup. No roadmap criterion closes from
that exposed-corpus diagnostic. Future evidence must retain failed trials and
distinguish each model, precision, mode and device.

The same assessment retains the failed first observation trial and a corrected
one-case CUDA rerun. Both unchecked and constrained modes then produced correct
first/warm measurements, EOS termination, observed model unload and native exit
zero. Unchecked output used 47 new tokens and constrained output 33, below the
unchanged 192-token ceiling. This validates the diagnostic seam on those GPU
deliveries; it does not establish the cause of the earlier CPU cost. At that time, CPU
admission remained denied and the complete matrix/quality comparison was
pending. Later accepted Standard quality is closed as stated above.

Security disposition: `security-relevant`. Protected assets are model-cache
integrity, host RAM/VRAM, retained offload files, source identity and private
diagnostics. The local operator authorizes only fixed cached acquisitions and
Standard inference. Inputs cross repository/model-cache and child-process
boundaries; outputs are untrusted model text. Controls reuse the production
Standard runtime and owned native-exit supervisor, verify pinned safe-weight
hashes, bind the current source and plan, deny network/pickle loading, refuse
redirected evidence paths, bound cohorts/logging, and atomically save evidence.
No prompts, source text, arbitrary model output, environment dumps or raw
exception messages are saved. Only finite labels, error classes and numeric
resource-admission events are retained alongside numeric timing/token counts.
The observation delta preserves generation arguments and the exact supplier
return object (both Tensor and structured `sequences` results), installs no
global module hooks, restores methods/hooks on failure, and cannot grant a
passing outcome from a partial phase or a cooperative stop. Negative tests
cover malformed progress, partial hook installation, generation exceptions,
budget stops before inference, memory denial and forced/uncertain native exit.
Relevant owning guidance is the
[runtime model](../architecture/runtime-model.md),
[Context threat model](../security/context-management-threat-model.md) and
[logging standards](../standards/logging-standards.md).

The CMD launcher quotes the selected interpreter and repository script, uses
local environment scope, disables delayed expansion and propagates the Python
exit code. Options are explicit local operator input forwarded to the existing
Python argument parser; no model or retrieved content becomes a shell command.

Only the two previously pinned Qwen acquisitions are supported. The runner
creates no offload stage, claims no retained lease and never removes old model
files. It neither changes nor completes historical qualification/roadmap
records. The exposed 24-case corpus is useful for reproducible diagnostics,
not a fresh holdout or a general model-capability claim. Current quality uses the approved model-specific 30%/80%
requirements; this diagnostic does not change or rerun them. Any new qualification
needs its own approved purpose and exact-target review. Offload recovery remains
separate.

Residual limits: the supervisor samples RSS rather than enforcing a kernel
memory quota; native Windows observation must be available or execution fails
closed. Directory checks do not qualify hostile same-user filesystem races.
This local trusted-contributor tool is not a sandbox for arbitrary model code.
Hardware inference, accuracy, speed and memory qualification require an actual
installed-model execution on the declared host; model-free tests do not grant
those passes. It may be launched by an agent when admission allows it. No human
acceptance task or request to close unrelated applications is a closure gate.
