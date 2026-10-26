> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

# Developer tools

Saved-version full-app test support is described in
[Provided-data version journeys](scripts/qualification/visual-composer/provided-dataset-qualification.md).
It uses the real packaged processor with synthetic supplied rows and a durable
test-only server composition. Source verification and actual bounded native
execution are separate; neither may be inferred from the other.

To run cached model tests after closing the coding agent, use
`scripts/qualification/run-model-tests.cmd` from Command Prompt, or
`scripts/qualification/run-model-tests.ps1` from PowerShell. Both preserve incremental JSON
evidence for later review without changing roadmap qualification. See
[standalone model testing](../docs/operations/standalone-model-testing.md) for
commands, runtime requirements, safety controls and evidence locations.

The legacy `--all-blocked` option requires a reviewed remaining-only plan.
Completed Standard model accuracy is closed under the accepted 30%/80%
requirements; do not repeat those checks. The inventory keeps every registered
incomplete qualification owner, even when it has no open human-action issue.
It rejects changed registry inputs, missing targets, owners whose declared targets
are all complete, and unknown open-issue owners. The issue-only security entry requires its
unresolved issue. Pending native/offload/provider/OCR/host work stays separate.
See [model evidence testing](../docs/operations/model-blocker-testing.md) for
the retained protocol and its limits. Planning grants no execution authority.
After termination, add `--restart` (`-Restart` in PowerShell) to start one fresh
same-source/protocol trial from that reviewed template. Old evidence remains;
OS-owned Standard coordinator/worker slots prevent overlapping supported tests.
This does not resume an interrupted cohort or qualify its missing cleanup.

The review site's `review-site` source-owned check profile runs the complete fixed
Node DOM/controller test file for exact HTML/JavaScript/CSS/test ownership. It
preserves all UI assertions while avoiding unrelated directory-owned desktop
typechecks. Catalog and profile data are policy-bound; uncovered impact and an
explicit `focused-tests` requirement retain the generic gate. This scoped UI
result grants no whole-application, native, model or parent roadmap qualification.

Repository-owned scripts live under `dev-tools/scripts`. Portable contributor
helpers for recurring Codex and verification loops live under
`dev-tools/helpers`; see its README for configuration and safety boundaries.

Actual managed reference qualification uses the separate PostgreSQL/OIDC/TLS
launcher in `scripts/qualification/visual-composer/managed-reference-host.ts` and
`config/playwright.managed-reference.config.ts`. Setup is isolated, credentials
stay private, failures are retained and forced cleanup never counts as graceful
shutdown. See `docs/operations/functionality-outcome-qualification.md` for exact
profiles, finite worker scenarios, existing budgets and qualification limits.

Owned task visibility timing captures the fixture's fixed initial 10-percent
progress and timestamp before navigation. Reload/recovery time stays in the
sample; a later authoritative update cannot retimestamp older rendered progress.
Missing initial milestones and invalid/negative progress or terminal delays fail
qualification. Focused counterexamples live in `scripts/qualification/tests/`.

Installed generation comparisons admit only the two explicitly pinned Qwen
profiles documented in the outcome qualification procedure. Native precision is
fixed per profile for both variants and devices, and propagated to every fresh
child; changing a profile cannot overwrite another model's failed evidence.

User-invoked cross-agent workflows are different: their canonical definitions
live under `skills/`. The implementation-roadmap skill may describe when to
use a bounded helper, but its workflow state engine remains with the skill and
generic checks and patch transport remain here.

## Test orchestration

`npm test` runs the standard unit and interaction loop. `npm run test:e2e`
runs integration, end-to-end, and legacy explicitly marked long-duration files.
`npm run test:ai` runs only explicitly marked or enumerated tests that load or
run AI components. Use `npm run test:standardande2e` for combined non-AI
coverage. Use `npm run test:all` for standard, end-to-end, and AI coverage only
for AI-related changes or an explicit request. The Node and Vitest runners discover
their owned files independently and write duration-ranked JSON reports under
`artifacts/test-reports/`.

Qualification identities hash the present candidate, including dirty and
untracked inputs. Tracked unstaged deletions change the identity without making
it depend on index staging; unsafe files, other read errors, empty candidates
and missing explicitly referenced evidence still deny qualification. Tests of
repository HTTP exposure load the actual source server configuration when the
aggregate runner stages executable tests, retaining the production filesystem
allowlist and private-file/origin denial assertions.

`npm run test:dataset-preparation:e2e` is the opt-in dataset creation matrix.
Run it only when Dataset Preparation changes or when explicitly requested. It
reports 27 top-level training-goal/material-division cases (nine goals by an
existing dataset, combined datasets, and source material) plus the 39 detailed
preparation-method combinations. Every case uses one or two bounded sources,
writes real Parquet output, reopens it with PyArrow, and verifies non-empty task
columns plus source association. It uses
deterministic valid generation at the model boundary so it qualifies dataset
creation without repeating large-model inference for every combination. It is
intentionally outside `test:e2e` and `test:all`.

The named command `npm run test:model-training:e2e` is the opt-in physical
model-training matrix. Run it only when Model Training changes or when
explicitly requested. It trains every supported task with two synthetic rows,
one epoch, and fixed tiny Hugging Face snapshots at immutable revisions. Each
case must reach the staged generated-model candidate used by Save/Discard; the
suite never invokes model save or registration. It is intentionally outside
`test:e2e`, `test:ai`, and `test:all`.

The model-free owned-job fixture is separate from real offload admission:
`python -B dev-tools/helpers/control_plane/qualification_job.py --self-test`.
On supported x64 Windows it checks an unnamed noninheritable job, atomic
creation-time job assignment, normal descendant shutdown and forced guardian
exit before and after resume. It starts only fixed copies of its own Python
fixture, with two-process and 256/512 MiB process/job commit limits. It accepts
no command, PID, directory, retained-slot or quota option. The JSON is evidence
for independent review, never a restart lease or parent qualification. Portable
failure tests run with the fixed control-plane suite; actual native tests require
`AISB_RUN_OWNED_JOB_NATIVE=1` and are not qualified by a skipped test.
The supervisor pulls read-only handles from its exact retained guardian handle
into its own process. Partial handoffs stay locally owned. A fixed natural-expiry
negative control must be rejected by the same strict shutdown oracle; ordinary
fixture expiry and errors cannot count as successful job shutdown.

The ordinary ingestion host journeys use real Add data controls and IPC/HTTP
publication. Run
`npm run test:visual-composer -- --project thin-chrome --project packaged-desktop --grep "imports distinct multi-chunk"`.
They use three synthetic CSV/JSON/JSONL files, one larger than 8 MiB, and observe
bounded renderer reads, progress, completion and source discovery after renderer
reload. Ambiguous same-name/same-size inputs must stop before task creation with
a correction action. Profiles and temporary data are isolated; traces, video and
screenshots are off for these credential-bearing host journeys. The browser uses
only a generated local qualification credential. No saved user credential,
provider publication, model or retained offload slot is used. Slice-size
observations do not measure whole-process RSS or qualify the full
provider/website/scale/native matrix. The `ingestion-publication` profile also
runs focused shared-panel interaction tests; real host journeys remain opt-in.

The `ocr-provider-contract` profile runs only the portable managed-runtime OCR
contract, private framing, resource identity, process failure and build-hook tests. Fixed source patterns select it automatically
for the provider package, fixed builder/hook and exact portable test files. Complete explicit source coverage can replace generic
focused selection only for those declared changes; unknown or explicitly
required generic impact remains. This profile starts no OCR engine or model
and establishes no actual Windows or parent-roadmap qualification. The explicit
model-free Windows operator in the native OCR README tests new synthetic owned
processes separately. It downloads nothing, leaves historical runs intact and
does not enable product OCR or qualify model accuracy.

The fixed `ocr-provider-contract` profile now includes the portable provider
orchestration tests. `qualification_ocr_documents.py --native` is an explicit
Windows-only synthetic image/scanned-PDF operator, excluded from ordinary
discovery and profile execution. It uses installed SDK/Pillow/Arial without
downloads and only fresh ignored bundles. Actual local document evidence does
not qualify product packaging, normalization, host delivery or model accuracy.

The same fixed profile includes portable tests for
`scripts/native/build_windows_ocr.py`, its Node hook and Forge wiring. The builder
is development-only: `python -I -S -B dev-tools/scripts/native/build_windows_ocr.py --build`.
Forge calls it before x64 Windows start/package. It uses only installed fixed
compiler/SDK inputs, native input leases, bounded time/output and a fresh UUID
source copy. It publishes a validated source/binary manifest last, supports
interruption retry without deleting prior evidence and preserves Standard startup
when optional tools are absent. The compiler is trusted; no compiler descendant
containment is claimed. Portable tests never compile or launch OCR. Actual build,
fixed product resource and copied-resource evidence stay separate from
normalization, host UI and parent qualification. Build changes also select the
dependency gate even though this component adds no dependency.

The `ocr-provider-contract` profile also runs complete-PDF recognition, optional
scanned-PDF normalization and the existing Standard normalization regressions.
It contains nine Python modules and one Node file. The normalization tests use
the existing installed worker dependencies (including Pydantic, pypdf,
python-docx and markdownify); they do not install anything or run an OCR engine.
Actual fixed-resource scanned-PDF normalization remains in the separate explicit
native document operator and grants no public capability or parent completion.

## Controlled OCR app journeys

[OCR qualification](scripts/qualification/visual-composer/ocr-qualification.md)
uses the actual packaged worker, source capture and Windows reader in desktop and
browser. The fixed fixture substitutes only synthetic generation and retains
normal dependency preparation, authentication, review and approval. Actual
package/resource identity and native retirement are required separately. The
portable OCR profile covers fixture/launch regression tests without launching
OCR or a model; real app qualification stays pending until its controlled run.
