# Bounded Headless training feature test

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

This explicit Windows x64 test runs one real CPU LoRA step through the approved
Core metadata ledger, original input readers, private application owner and
bounded-local runtime. It uses the existing generated Tiny input. It does not
download a model, score model quality, register the result or publish data.

Set `ASB_HEADLESS_TRAINING_TEST_PYTHON` to the existing qualified Python executable
and `ASB_HEADLESS_TRAINING_TEST_INPUT` to its generated Tiny input directory.
The test pins the executable and all six model-file hashes before effects. These
are trusted developer test settings; they are not product request fields.
No dependency installation or replacement interpreter is permitted.

Closed numeric diagnostic records are saved under the ignored
`.local-codex/headless-training-feature/` directory. Each run writes one new file
of at most 2 KiB, with a 64-file ceiling. Records identify the last test phase,
startup state, factory counts and confirmed original closure. They contain no
prompts, input text, provider tokens, raw worker errors or filesystem locators.
They are diagnostic facts; only the executed receipt and review qualify work.

The control-plane check `headless-training-bounded-feature` is explicit only.
Source edits select strict types or controlled fixture tests. The real runner
does not use a `*.test` filename and is outside normal unit discovery.

The explicit check uses `fresh_training_trial.py` for the one fresh attempt
approved on 2026-11-27. Its closed local authorization binds current source,
the separately completed/reviewed guard Work, all three prior failed receipts and
unchanged limits. An active exact task-outcome Work must own the test. The driver
consumes a durable exclusive marker before its fixed Node command; interruption,
failure or absent results never rearm it. It accepts no command, arguments,
recovery path or executable input from the authorization record.

The three earlier attempts retain unconfirmed cleanup. Each retains a conservative 32 MiB
logical declaration, and the new attempt reserves another 32 MiB in addition to
the 128 MiB free-disk reserve. This is developer-test accounting, not a measured
old-tree size or an operating-system physical quota. No old tree is inspected,
adopted, moved, deleted or released. The signed-in-user/dependency trust in ADR49
is unchanged. Only original new-worker and IO closure allow new fixture cleanup.
The small authorization/consumed/result records remain as bounded audit evidence.
The stored technical review binds the complete validated check plan through its
receipt digest. It has no separate `plan_digest` field. Guard tests use the actual
`Work.review` record producer and an inert complete admission path, with current
source, independent review integrity and single-child checks.
All declared plan-step refusal codes stay visible as diagnostic facts; any such
code prevents a pass. Unknown codes and raw error fields deny. Record identity,
size, modification time and links must agree across observations; creation/change
timestamps must stay stable within their respective pathname and handle APIs.
Another actual attempt needs its own authority; ordinary headed training is
unaffected. Source checks run the inert guard tests and strict types only.

The profile retains the approved ceilings of 2 GiB per process, 4 GiB per Job,
32 processes and 690 seconds. The task has a 600-second bound, a 1 MiB model-copy
limit, a 4 MiB output limit and a 128 MiB free-disk reserve. These are finite test
limits, not a production memory policy, physical disk quota or protected service.
The runtime stays offline and uses a child environment without provider secrets.

Temporary directories are fresh. Cleanup requires the original supervisor's
confirmed retirement plus closed copy/output/verification IO. Uncertain owners
retain their files. Historical input, staging, stop records and ACLs stay intact.
Missing prerequisites and failed checks are failures, never skips or stand-ins.
Paired public Desktop/browser journeys and final roadmap qualification are later
checks. The existing Desktop Tiny journey remains historical evidence.

The fresh attempt was consumed. Its aggregate test failed; the diagnostic confirmed
original worker and IO closure before the afterhook, but did not establish the
terminal training status or final root removal. Do not rerun or rearm that record.
A source correction preserves the App pending-review redaction and checks
checkpoints in the separately verified current candidate inventory. Pipeline and
task identities remain distinct. A fast one-step completion can have zero sampled
intermediate progress; record that count honestly rather than impose a delay.
Controlled progress tests are separate evidence, not an observed live event.

Version 3 diagnostics add finite assertion stages, terminal status, sampled counts,
current verified checkpoint/file counts and a closed runtime error category. The
only recognized runtime failure code is `private_training_failed`; other codes
become `unclassified`, with no message or details. The afterhook writes the new
record after attempted cleanup, even when cleanup fails. Application cleanup and
new-root removal become true only after their actual awaited actions. Child
success alone, a version 2 record or pre-cleanup retirement cannot qualify cleanup.
The observation unit tests are inert; source discovery cannot run the real trial.

The user separately approved one corrected-observation trial after the earlier
one-use attempt was consumed. Its authorization uses a new fixed directory and
reference; the previous authorization, consumed marker and result remain intact.
The driver validates each of three failed receipts under its original Work owner,
retains three 32 MiB logical charges and reserves one more. All original limits,
current source/review/task checks and v3 post-cleanup requirements remain. This
is exactly one new attempt, not a reusable retry permission. Source checks execute
only inert admission and observation tests before the separate actual Work.

The corrected trial also failed. Unlike the old diagnostic, its version 3 record
proved failed terminal status after five progress samples, original worker/IO
retirement, application cleanup and new-root removal. No candidate check was
reached. Its permission is consumed; do not retry or rearm it.

Version 4 adds only allowlisted pipeline-stage and error-category labels. The App
previously dropped a loader failure returned inside result data when the outer
status had no error. It now projects fixed safe categories from the exact original
failed task result. Raw exception messages, paths, logs and arbitrary class names
stay private. Generic/unknown labels remain possible and supply no diagnosis or
pass. Source fixtures exercise this reporting path without loading a model.

After the safe failure projection was committed, the user approved up to two
additional attempts: a diagnostic and, if needed, a verification after a reviewed
fix. This guard enables only the first in a new fixed directory/reference. All
four prior failed receipts are checked under their original owners and charged
conservatively. The existing consumed records stay untouched. The second is not
implemented or admitted by this source: it needs separately reviewed current
source and exact proof that the diagnostic worker, IO, App and root cleanup closed.
No automatic retry, new model, accuracy test or limit increase is permitted.

The first safe-stage diagnostic failed in dataset loading and proved all new
cleanup. Separate tiny JSON-only reproductions (no Torch, model or Native Job)
showed the unchanged installed reader failing with a 325-character cache lock
path and passing with a 219-character path. The qualification wrapper had put
HF_HOME under the deeply nested repository temporary root. A lock-only extended
path experiment then failed later in Arrow cache writing, so no SDK patch is used.

The fixture now creates its fresh `bt-` root under the verified local per-user
Windows Temp folder. Its pure profile budgets the complete new root at 60
characters before effects. Every parent still passes the existing no-alias
plain-path check. Original child/root identity, worker/IO retirement and cleanup
checks remain. It does not change global TEMP, model contents, locks, runtime
limits or production settings. The child keeps its own bounded cache there.

Only the second approved verification is available in this guard. Before any
consumption, it reads the fixed first-diagnostic result record, checks its exact
canonical digest/source/stability, and requires original worker, IO, App and root
cleanup facts. All five failed receipts retain their original Work ownership and
conservative charges. Missing, changed or incomplete proof denies; there is no
third attempt, reset or historical cleanup. Source tests never start a model.

The second approved verification reached successful training with 87 progress
observations and confirmed worker/IO/App/root cleanup. Its overall test failed in
the grouped candidate-lineage assertions. The old zero file counts mean those
counts were not yet recorded; they do not prove missing files. Both approved
attempts are now consumed, and no further model run is authorized.

Version 5 separates candidate readiness, request identity, history identity,
verified inventory, execution presence, pipeline correlation, duration and CPU
device into fixed stages. Seven nullable boolean facts distinguish unobserved,
passed and failed assertions without recording identities or raw reports. Counts
are recorded only after original request/history identity checks, and before
execution-report assertions. Every original assertion remains required. Diagnostic
counts can represent the private contract's256filebound, while a passing actual
test still requires at most32files. Unknown/false/missing facts cannot qualify.
Historical version4 first-diagnostic proof is read separately by its exact digest
and remains unchanged. Version5 is source observability, not a candidate pass.

The user separately approved up to two candidate-focused attempts after successful
training: a detailed diagnostic, then verification of a reviewed fix if needed.
The current guard admits only the first, through a new fixed directory/reference
and current reviewed source/task. It now requires the exact most recent short-cache
result/source and its four original cleanup facts before consumption. All six
failed aggregate receipts retain original owners and conservative charges. The
second is unavailable in this guard and needs a separately reviewed fix/guard
after confirmed preceding cleanup. No accuracy test or automatic retry is added.

The first detailed candidate attempt verified12files, including5checkpoint files,
and every identity, pipeline and duration assertion. Training and all four cleanup
checks passed. Only reported CPU use failed; the reported alternative device is
unknown. The test now explicitly sets ACCELERATE_USE_CPU=true and CUDA/HIP masks
to -1 in its private child environment. The installed Transformers4.51.3 device
selection supports this setting. Fixed thread counts remain1. No product defaults,
caller environment, device assertion or resource limits change.

The current guard admits only the remaining second candidate verification after
the exact preceding version5result/source and all four original cleanup facts.
Seven failed aggregate receipts retain original owners and charges. The latest
user authorization also allows up to two additional verifications; these are not
enabled by this one-use guard. Source tests are inert. No accuracy or download
checks are added. Missing proof or replay denies without touching old files.


## Explicit bounded text generation

`bounded-text-generation-feature.ts` reuses the composed approved-conversation
fixture and the original Python runtime. It runs one offline CPU turn with the
existing generated Tiny Qwen2 input. It checks the original saved response,
turn/run/result associations and replay. It does not score accuracy, train or
register a model, download weights, run images or qualify either public host.

The opt-in check is `headless-bounded-text-feature`. It is never selected by
ordinary source changes. First complete and independently review the source Work;
then create a separate exact task-outcome Work requiring that check. Use the
existing `ASB_HEADLESS_TRAINING_TEST_PYTHON` and
`ASB_HEADLESS_TRAINING_TEST_INPUT` trusted qualification settings. The executable
and six input files must match the existing Tiny training profile hashes.
The generated cache is a synthetic fixture, not a Hugging Face supplier revision.

The original Windows Job retains the existing 2 GiB per-process, 4 GiB total,
32-process and 690-second ceilings. Startup has 60 seconds; the app's original
text task has its two-minute deadline, and the test has 240 seconds. Input is
at most 1 MiB; admission requires 128 MiB spare disk plus copying headroom.
Post-exit accounting permits at most 256 entries and 4 MiB in the fresh test root.
This is bounded admission/accounting, not an operating-system disk quota.

The child is CPU-only and offline. It inherits no provider credentials.
Only the original supervisor shutdown, settled app task/database and identity-
checked new-root cleanup can confirm retirement. Unknown files or owners stay
retained. Do not automatically retry an unconfirmed physical run. Bounded numeric
phase, lifecycle, output-length and cleanup diagnostics are exclusive files under
ignored `.local-codex/headless-text-feature/`, at most 64 files of 4 KiB each.
No prompt, response text, token, raw runtime error or private locator is reported.

Source checks `headless-text-workflow-unit` and `headless-text-workflow-types`
exercise Core/SQLite controlled Python responses and compile the real driver.
They supply no physical inference or parent qualification.

Text diagnostics include the last fixed workflow checkpoint and the original
runtime status. Failed status keeps only allowlisted error codes and exception
classes; all other values become `other`. Prompts, output, arbitrary error
messages and detail objects are never copied. A failed original task stays
failed. Controlled failure tests verify both this redaction and owned cleanup.
