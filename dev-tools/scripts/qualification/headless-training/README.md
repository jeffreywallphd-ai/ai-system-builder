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
the separately completed/reviewed guard Work, both prior failed receipts and
unchanged limits. An active exact task-outcome Work must own the test. The driver
consumes a durable exclusive marker before its fixed Node command; interruption,
failure or absent results never rearm it. It accepts no command, arguments,
recovery path or executable input from the authorization record.

The two old attempts remain unconfirmed. Each retains a conservative 32 MiB
logical declaration, and the new attempt reserves another 32 MiB in addition to
the 128 MiB free-disk reserve. This is developer-test accounting, not a measured
old-tree size or an operating-system physical quota. No old tree is inspected,
adopted, moved, deleted or released. The signed-in-user/dependency trust in ADR49
is unchanged. Only original new-worker and IO closure allow new fixture cleanup.
The small authorization/consumed/result records remain as bounded audit evidence.
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
