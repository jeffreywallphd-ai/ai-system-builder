# Structured output controls qualification

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

These focused Playwright journeys use the actual packaged Windows desktop and
local Chrome client. They create an isolated workspace and upload a fixed text
fixture through the existing authorized host boundary. The explicit
`structured-output-controls` worker scenario simulates decoder readiness and
refuses dataset generation. It does not load a model, run accuracy tests, use
provider credentials or acquire an offload lease.

This scenario explicitly declares an 8 GiB accelerator total in its authenticated
capabilities response. Both actual hosts must forward that declared fact and
initialize an untouched known 1.5B CUDA model with checked output on, before
switching to the unknown-model/default-off and explicit-choice journey. This is
software integration evidence for a declared profile, not a physical GPU reading
or a claim that the fixture can decode. Verify the production worker's read-only
capacity observation separately and keep its source/environment identity distinct.

Run one host at a time from the repository root:

```powershell
$env:PYTHON_RUNTIME_QUALIFICATION_SCENARIO = "structured-output-controls"
npm run test:visual-composer -- thin-client-structured-output.e2e.spec.ts --project thin-chrome
npm run test:visual-composer -- packaged-desktop-structured-output.e2e.spec.ts --project packaged-desktop
```

The desktop command builds the current package before launching it. Use the
repository's supported Node/npm toolchain. Each test has a three-minute limit;
package construction has its own existing five-minute bound. Tests run serially
without retries. The fixed ports and profiles follow the existing owned host
harness; a conflicting listener must not be adopted or stopped.

Complete the production desktop typecheck and server build as well as the focused
checks. Shared provider declarations must compile with the server's non-browser
TypeScript configuration; a desktop-only typecheck cannot establish that result.

The bounded `host-memory-fixture` check profile also executes the owning desktop,
thin-client and shared recommendation regressions, the runtime protocol mapper,
and the model-free Python capacity/worker-app tests. The Python tests mock all
driver process effects; they do not run a hardware benchmark. Run it with:

```powershell
python dev-tools/helpers/run_focused_checks.py --profile host-memory-fixture
```

These model-free renderer checks use declared capacity snapshots, including
sufficient CPU/accelerator, constrained CPU, unknown, stale and missing facts.
They verify stable initialization, explicit opt-out and recovery, and no unchecked
dispatch after checked mode loses readiness. They do not qualify physical
accelerator telemetry or model execution. Keep both real host journeys below as
separate regression evidence after the final source is frozen.

The journeys check the declared sufficient accelerator default, an unknown
model's unchecked recommendation, an explicit
checked choice, protected training purposes, keyboard focus, renamed fields,
a nested numeric field, the schema preview, invalid duplicate-field refusal and
repair, reset, and restored settings after a renderer reload. Desktop also saves
and explicitly loads a named settings set. A reload does not prove a server or
native-process restart. The browser additionally checks that the authorized
capacity route reports available RAM within the reported total; it must not infer
current free RAM from total installed memory.

The tests disable screenshots, traces and Playwright's automatic page snapshot
for copy prompts. They retain only bounded source-bound stage names and completed
checks in each run's `structured-output-controls/` directory, plus the harness's
sanitized result and observed desktop-worker shutdown. They do not retain schema
examples, prompts, generated output or bearer credentials. A failure remains a
failure, including failed shutdown; a synthetic capability is never physical
decoder-readiness evidence.

These controls tests are separate from the already reviewed
[CPU/GPU structural and resource measurements](../../../../docs/operations/remaining-model-evidence-assessment.json).
They do not rerun accepted model quality, qualify actual inference or native
offload, prove physical accelerator-capacity reporting, or close a parent criterion by
themselves. Final owning qualification still needs current checks and independent
review against all of that criterion's requirements.
