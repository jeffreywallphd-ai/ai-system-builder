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
