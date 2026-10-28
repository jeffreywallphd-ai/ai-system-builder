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

The existing `functionality-tasks` contributor profile includes the Thin Models
renderer, hook and API-client tests. Its explicit source mapping replaces coarse
app-wide ownership only for declared paths. Unknown impact and explicitly required
focused checks remain selected. These synthetic tests do not download or run
models. Workflow authority, runner commands and full-suite policy are unchanged.

The existing `functionality-tasks` profile also covers the actual Desktop Train
Model form and its hook. Focused cases use synthetic task/model/source clients;
the separately mocked provider-default panel is not qualified by those cases.
No model accuracy, OCR or physical training is rerun.

The `functionality-tasks` profile includes cross-host image request ownership
regressions and the actual image notification consumers. These finite UI/client
fixtures do not run image models or replace host/native qualification. Full-suite
qualification remains separate from component checkpoints.

The fixed owned-task UI journey uses only five declared IPC/HTTP operations. Its
HTTP reader refuses redirects, missing pairing, non-JSON/non-success responses,
invalid UTF-8 and responses over 256 KiB, with a 30-second network deadline.
It cancels and releases response streams and uses fixed failure categories.
The same value bound applies to Desktop replies. Its focused transport fixtures
do not launch either app or qualify host delivery, inference or native cleanup.

The provided-data app cases now include one fixed manual Context pack across
complete restart. Local admission/oracle/module-collection checks are separate
from actual app execution. See the private provided-data qualification guide;
no model, native quota or parent qualification follows from those local checks.

The provided-data two-host tests also create a separate workspace for fixed
Parquet row review. They upload/prepare/approve through visible controls, edit
and reject into immutable successors, and compare exact saved data and history
after restart. The `dataset-version-browser` profile includes focused fixture
and oracle checks. Those checks do not execute the app cases or qualify native
shutdown; use the existing reviewed source-bound operator for that later step.
Accepted model accuracy and OCR results remain separate.

The existing two-host `context-ui-transports-storage.ui.test.tsx` now has 18
additional RAG/query/rebuild cases. They use actual mounted ContextStudio, clients,
preload/registered IPC or owned HTTP, application staging and fresh saved files,
catalog and bindings. A closed finite worker produces synthetic package/chunk/
query results; it does not qualify a LanceDB engine or embedding model. Tests
check explicit review/save, exact source lineage and visible cited answers,
original-preserving rebuild, unavailable-source/device correction and malformed/
foreign/oversized reply refusal. Accepted model accuracy and OCR are not rerun.
Source-pack/RAG whole-app helper wiring and physical/final qualification remain
separate; the joined tests do not turn those implementation/execution gaps into
a pass. Existing manual/source-pack cases and owned cleanup remain included.

The fixed provided-data app-test worker now supports one declared Markdown source
pack and RAG package. Focused tests invoke real Context generation, package
inspection and LanceDB query with a closed finite embedding callback. They check
exact stored source lineage and a relevant cited match without loading a model,
running OCR, downloading dependencies or contacting a provider. Local processor
tests do not qualify app restart, native cleanup, real embedding quality or the
parent roadmap. Source-pack/RAG app helper wiring remains a following chunk.

The existing Desktop/browser dataset restart cases now include source Context and
RAG flows through a shared fixed-source helper. It checks visible preparation,
review/save, cited retrieval/source navigation, immutable rebuilds, discard and
selected deletion against actual public byte/manifest/catalog reads. Desktop
uses its existing download control. New strict oracle tests preserve identity
and reject substitutions or unsafe metadata. The source helper extends no native
launcher or model/resource policy. Actual apps/restart/physical cleanup and the
identified fresh-session pack-rebuild regression remain pending; local collection
and oracle passes are not whole-app qualification. No accuracy or OCR rerun.

## Assets desktop read checks

The `asset-authoring-ui` profile keeps the eight existing Assets interface test
files and adds the desktop authoring client and IPC test files. Its source list
adds only those two production files. Run it through the documented
[control-plane feature checks](../docs/diagnostics/ai-development-control-plane.md#assets-interface-feature-checks).
Unknown changed paths still need their own checks. Component fixtures do not prove
actual app, authorization, storage, native or whole-roadmap qualification.


### Shared Assets authoring journey

The two ordinary browse Playwright drivers also call the shared
`asset-authoring-journey.ts` core after their existing Systems journey. It uses
only public controls and inert synthetic package/resources. It checks imported
and Foundation copies, a three-resource Studio asset reopened through Saved,
explicit review/publication, published rediscovery and unchanged original bases.
The model-free `asset-authoring-journey-oracles.unit.test.ts` checks exact
observations and counterexamples through the fixed `asset-authoring-ui` profile,
which now contains eleven test files. Run the focused file while iterating;
collection and types do not run an app.

Each Assets phase has a 60-second ceiling; the five phases add at most 300 seconds
to the existing browse case budget. Desktop and browser remain serial. Four
replays are explicitly document reloads. They do not prove desktop/server
process restart, durable storage or authorization/native controls. The controlled
restart wiring and execution, and final combined qualification, remain pending.
No model accuracy, OCR, provider or full-suite execution is part of this slice.

Published rediscovery includes a separate existing exact-version public definition
read for exact identity and semantic metadata in the captured workspace. It uses
the public desktop bridge or paired same-origin browser GET. The probes have a
10-second deadline, a 256 KiB response bound and fixed safe errors. Node tests
exercise finite preload/fetch environments without real network or app reads.
This does not prove hidden Browse selection, persisted overlay bytes, a released
implementation or a new customization target. Those checks remain separate.

### Legacy Assets workspace-access checks

The fixed `asset-authoring-ui` profile also covers the connected legacy
application, read facade, API/IPC and finite desktop/server composition tests.
The seven write entries and eight public reads use the existing current
workspace policy. All earlier rendered, transport and profile-safety tests
remain selected. Host fixtures use in-memory documents and owned temporary
roots; they do not open apps, listen on ports, run models or qualify physical
Electron, native storage, provider or parent outcomes. Publication transactions
and Studio/package/derived policy changes remain separate.

The asset-authoring-ui profile also selects finite package workspace-authority, input snapshot/default-limit, lifecycle and two-host composition fixtures. These tests preserve the previous profile, avoid model/OCR/provider or app-process runs, and keep configured direct-inspector limits distinct from the existing32MiB production upload snapshot budget.

The asset-authoring-ui profile includes fixed finite Studio lifecycle, workspace admission, request-capture and two-host composition tests. It does not launch Electron, contact a model/provider or qualify durable restart. Unknown source impact and explicit focused checks retain the generic gate.

The asset-authoring-ui profile includes fixed finite derived lifecycle, direct workflow/catalog/service authority and request-capture tests, both host compositions and all-nine IPC resolver compatibility cases. It starts no app or provider/model. Unknown paths and explicit generic focused requirements retain fallback coverage.

The asset-authoring-ui profile includes the fixed reviewed-definition publication matrix for memory and Node SQLite in both existing definition partitions. It tests Studio and derived races, atomic rollback, original-command lost-response retries, current-revision retries, owner and input capture, and missing or foreign receipts/definitions. It starts no app, model or provider. Actual Electron, native storage, live PostgreSQL and full qualification remain separate.

The existing asset-authoring-ui profile covers the 343-definition target-catalog cohort, sequential compatibility, malformed batch/access denial and held later-batch summary mutation. These finite Node cases preserve original lifecycle/publication checks and use the current exact workspace policy. No new test profile, app launch, model/provider access or full-suite qualification is introduced.

The asset-authoring-ui profile includes the fixed workspace publication facade and shared-composition tests. These finite Node cases cover exact published ownership, recomposition and static denial without launching an app, provider or model. Physical-host and final combined qualification remain separate.

The system-management-ui profile owns the single exact Manage systems rendered test file through the existing fixed single-worker Vitest adapter. Catalog selection covers only its declared UI/config/README sources. Unknown impact, an explicit generic requirement and unsafe/missing/AI-controlled tests retain the existing rejection or fallback. It starts no app, provider, model or native process.

The system-build-publication-ui profile runs two exact shared Build/Publish and published lifecycle interaction files with the fixed one-worker Vitest adapter. Its selection guards retain unknown and explicit generic coverage, unsafe-path and controlled-test refusal. It starts no host, provider, model or native worker and grants no parent qualification.

The `system-runtime-conversation-ui` profile runs only the published desktop conversation interaction file and its existing dedicated preload unit file. It uses the fixed Vitest and Node/tsx runners, retains whitespace/size/unavailable and malformed-envelope refusal coverage, and automatically owns only the exact runtime renderer/preload source and test paths. Unknown app impact retains generic focused checks. The profile loads no model or app and grants no runtime/native or parent qualification.

The `system-canvas-authoring-ui` check profile runs the exact saved-system
comparison, existing protocol/draft unit files and four related rendered Canvas
files. It collects no whole-host or model cases. See
`docs/diagnostics/system-builder-canvas-testing.md` for observation scope.

The packaged Assets and three-useful-systems UI cases now define a complete
owned app restart. They retain one application profile, use separate bounded
worker-record folders per session, and require the existing owned shutdown proof
before replacement. Original saved observations are compared on the new page;
asset metadata readers use that page. Local oracle tests and discovery do not
prove physical restart, native cleanup, server restart or final qualification.

## Operational host UI definitions

The `operational-ui` profile runs the fixed component/task/shell regressions and
the new observation/desktop-slot unit tests. The named desktop and thin-client
operational cases use current public navigation, deferred Settings runtime
controls, Security refresh with an explicit synthetic read failure, and quiet
notifications with keyboard focus return. They use a distinct fixed desktop
slot and the existing setup/owned-cleanup path. It rejects an existing entry or
a lookalike root outside this repository. It does not prove atomic filesystem
ownership or hostile-filesystem safety. Captures are off; attachments
contain only bounded source/run/host IDs and ordered fixed phase facts.

These unit/definition checks do not launch an app, worker or model. Run the named
Playwright cases only through the authorized qualification setup at the final
combined-testing boundary. The browser fault is an injected read-only503, not a
real authorization/TLS failure. Restart/readiness and Stop observations concern
the UI projection; actual process/native/model/provider results remain separate.
Completed model accuracy is not rerun for these definitions.
Refresh observes the settled stopped display. Exact new read dispatch is covered
by the focused footer tests, not inferred from an unchanged host status. Restart
requires a new stopped/spawned log sequence; Clear log retains its canonical
confirmation and removes preceding lifecycle entries. The observation oracle
rejects sparse arrays, accessors and custom iteration before copying fixed facts.
Proxy values are refused before reflection so their traps cannot execute.

## Safe accessibility observations

The fixed Operational profile includes the accessibility observation and
browser-callback unit tests. The callback uses synthetic DOM fixtures here; it
does not qualify real contrast, native zoom, focus or paint performance.

The actual System Builder helper retains the existing named host/profile,
1440px/320px reflow, computed motion/contrast, status and keyboard/modal/focus
checks. Its v2 report retains only fixed stages, trusted installed Axe rule IDs,
finite counts and contrast retry outcomes. Selectors and audit messages stay in
the browser during retry. Unknown, malformed, duplicate or unresolved evidence
cannot become a pass. The report omits the arbitrary user-agent string.
Retry targets require a positive finite bounding box. Setup and finalization
errors use fixed stages. Browser scale is validated before report assignment.
Media restoration precedes publication; failed attachment/storage finalization
rewrites failed evidence when storage permits. A failed test receipt remains
authoritative when the evidence file cannot be updated.

Run actual named host observations at the separately authorized combined-testing
boundary. These local checks grant no host/native/provider/model or roadmap pass.

## Critical operational accessibility definitions

Settings, thin Security and Notifications use the fixed document audit after
existing mounted-state assertions. Closed source/run/host/surface/test identities
and both ordered 1440 px/320 px audits are required. Unknown desktop Security and
arbitrary selectors are refused. Computed motion, reflow, contrast retries and
private-free rule/count evidence reuse the Canvas controls. Canvas retains its
original audit interface and behavior.

The report path uses a bounded hashed test context. Initial creation is exclusive;
an existing report is retained and the new attempt fails. Later writes belong to
that invocation, with best-effort failed finalization. This does not qualify a
hostile filesystem/native ownership race. Each audit returns to the declared
1440 px/no-preference base; it does not restore an unknown prior OS window state.

The fixed set of 40 Operational files includes synthetic callback, strict-context,
width-order, collision and failure tests. Actual host/zoom/paint/full qualification
remains pending. Other critical forms/dialogs and startup observations still need
separate implementation before the original roadmap chunk can be recorded.

## Data and Context accessibility definitions

The reviewed critical audit also covers file selection, dataset preparation,
version comparison, row review/editing, output structure, source RAG/Context pack
review and manual Context review/detail. Audits use existing stable assertions.
They run before timed import or approved review actions and only once at each
initial surface. Later rebuild/replay retains its existing behavior.

Both initial dataset-version host callers provide the current test identity.
No source bytes, workspace/version fences, approval actions, saved settings,
restart guards or memory choices are changed. The same fixed 40-file Operational
profile and 19 automatic paths remain; borrowed consumers have explicit coverage
and do not activate Operational checks for unrelated feature work.

These are definitions with ordinary focused evidence. Actual Data/Context host,
model/OCR/native/zoom/paint/full qualification remains separate. Other critical
views and response-time definitions still precede original roadmap chunk closure.

## Assets and System authoring accessibility definitions

The shared critical audit now has fixed points in Assets import, customization,
Studio, Saved assets and asset details. The System browse journey also checks the
compatible element picker, selected Properties, UI preview and Layers tree.
Audits run after existing content assertions and before the original actions.
First-only guards prevent duplicate records during loops and document reloads.

The original package install, asset review/publication, exact base/history checks,
Undo/Redo, save/reopen, keyboard focus, 320px control boxes and Canvas audit remain.
The shared audit returns to the declared 1440px base before later explicit reflow
checks. It adds no provider, dependency, runtime or approval authority.

The Operational profile keeps its 40 literal tests and 19 automatic paths. Two
borrowed consumers receive explicit coverage without becoming automatic triggers.
Focused checks and case collection cover source definitions only. Actual host,
zoom, accessibility, startup/paint and full qualification remain pending. Other
critical workflows still precede the original roadmap chunk's completion.

## Workspace and System lifecycle accessibility definitions

The primary lifecycle cases audit the workspace form, saved System row in Manage,
checked build dialog, ready publication form and initial publish confirmation.
They use the same closed context and fixed private-free document audit. Every
lifecycle caller now declares an initial or repeat audit mode. Missing or invalid
mode is refused before Page access. Primary callers supply the current TestInfo;
the secondary desktop workspace repeats its original lifecycle without replacing
initial audit records or using private System/workspace names in report paths.

Existing checked revision/build/release identities, explicit Build/Publish actions,
cancel/focus return, installation/runtime lifecycle and workspace isolation remain.
The Operational profile keeps 40 literal tests and 19 automatic paths; three
borrowed consumers receive coverage without becoming automatic triggers.

These are source definitions with related feature evidence. Actual host,
accessibility, native zoom, runtime/model, startup/paint and full qualification
remain pending. Standalone runtime mounting, original host diagnostic capture and
other critical consumers remain separate work before original chunk closure.

## Review-site controller check budgets

The existing full controller keeps its 600-second budget. The review-site Node
wrapper now permits that same budget. Only the review-site focused profile uses
630 seconds for each command, and its outer catalogue limit is 660 seconds. The
extra time lets the nested check report failure and exit within its outer limit.
Other focused commands keep their 270-second limit.

The regression test evaluates the actual source callback with simulated elapsed
time. It covers progress after 203 seconds, the full unchanged controller command,
and refusal after 600 seconds. It reads the actual focused and catalogue limits
to detect a shorter outer wrapper. Qualification runs every existing controller
and review UI test. The simulation alone does not qualify that full run.

These limits govern repository checks. Application timers, model and memory
limits, native controls and UI performance requirements retain their existing
requirements. Source-bound support descriptions remain required for every new
review-site evidence label; a description update never supplies parent approval
or technical qualification.
