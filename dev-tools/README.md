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

The Operational profile keeps the original 40 component files plus one routing unittest and 22 automatic paths. Two
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
The Operational profile keeps the original 40 component files plus one routing unittest and 22 automatic paths; three
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

## Published conversation accessibility definitions

The primary desktop lifecycle audits the published conversation window after
ownership and empty-transcript checks. The closed runtime-conversation context
admits only the desktop host. Both initial admission and browser collection require
one fixed runtime main element. Builder checks still require their builder shell.
Callers cannot supply a selector or turn this check into a generic browser audit.

The audit checks the full document at 1440px and 320px. It retains the same reduced
motion, reflow, contrast retry, count-only reporting and failure-aware finalization
rules. It runs only on the first conversation, before input is entered. Existing
input limits, conversation turns, release identity, restart, stop and workspace
isolation assertions remain. Operational and runtime feature profiles are unchanged.

Focused synthetic tests check the definition and its refusal paths. They do not
qualify the real desktop window. Actual host, native zoom, startup/paint, model,
accessibility and full qualification remain pending. No accepted model accuracy
check is rerun, and this source checkpoint does not complete the parent increment.

## Critical display accessibility definitions

The critical audit checks individual visible controls at 1440px and 320px. It
scrolls each control into view before checking finite, positive horizontal
geometry against the viewport. Hidden and inert controls are excluded. Empty or
excessive collections cannot pass. The report contains counts and fixed statuses;
control labels, selectors, text and raw errors stay outside the evidence.

The same audit then enables forced-color mode and verifies that the browser
reports it as active. Reduced motion remains enabled. Both declared widths repeat
the unchanged computed contrast/semantic audit and control geometry check. The
original baseline audit pair remains separate. Media and the base viewport are
restored through the existing failure-aware finalizer; a failed high-contrast or
restoration step cannot leave a passed report.

These checks define bounded test behavior. They do not prove every clipping or
visual layout case, native browser zoom, actual OS display behavior, model quality
or successful execution on a real host. Those checks remain separate and pending
until executed. This source work does not qualify a parent criterion or complete
the original roadmap chunk. Operational profile membership and resource limits
are unchanged; no actual apps, models, OCR engines or full suite are run here.

## Models and Image configuration accessibility definitions

The two local operational journeys now visit Model Management and Image
Generation after the original notification focus-return check. Discovery and
inventory use their current host-specific forms. The desktop also opens its
training configuration; the thin client must not expose a training tab. Closed
context IDs and ordered operational phases require each supported audit point.

These visits edit local form fields only. They do not submit a provider search,
save/download a model, train a model, start image generation, repair an install
or change runtime settings. The existing Settings, Security, runtime controls,
notifications and Home assertions retain their relative order. The fixed
private-free critical audit covers normal and forced-color display at both
declared widths. Phase limits, host timeouts and profile membership are unchanged.

Source builds, focused fixtures and case collection check these definitions.
They do not supply actual host, model output, native zoom, performance or full
qualification. Model results and task outcomes retain their owning tests and
qualification. Other missing critical workflows still precede completion of the
original roadmap chunk; accepted model accuracy is not rerun for this work.

## OCR form accessibility definitions

The existing local OCR journeys audit the initial configured form and the first
ready output-review dialog. Closed context IDs admit the desktop and local thin
client only. A mismatched transport and test project is refused before file or
Page effects. The common audit checks normal and forced-color display at 1440px
and 320px with private-free counts and failure-aware evidence.

After each audit, the OCR journey returns to its original 1280px by 900px viewport
and reduced-motion setting. The original 640px check, unavailable-language retry,
five-row review, source/page lineage, explicit approval, reload, cancellation and
workspace assertions remain. No engine, provider, native/resource guard, timeout
or model-quality requirement changes. The existing end-to-end elapsed field now
also includes these UI observations; it is not an isolated OCR speed measurement.

Portable mock/contract/UI checks and case collection check definitions only.
Actual engine, native, host, zoom, performance and full qualification remain
pending. Accepted model accuracy is not rerun. These audit definitions do not
complete the parent roadmap criterion or original implementation chunk.


The fixed native browser-zoom helper retires its returned browser even when
post-launch inspection fails. Its focused tests cover failed setup, session
detachment, concurrent or repeated cleanup, uncertain process exit and changed
profile ownership. Only a verified fresh test profile can be removed. A failed
launch or unproven exit retains the files; it never authorizes stopping an unknown
process. Original setup and cleanup failures remain available for diagnosis.
These synthetic fixtures start no browser and qualify no real native zoom,
hostile filesystem protection, model offload or parent roadmap. The fixed Chrome
launch options and three-second exit-observation limit remain unchanged.

The operational profile now contains its original 40 Node/Vitest files and one
existing routing unittest. Three exact menu hook/shell sources extend its
automatic paths from 19 to 22. Borrowed barrel/README/controller coverage does
not activate this profile by itself. Unknown, incomplete and explicit generic
impact keeps its existing checks and bounds. No test-selection policy changes.

## Native critical accessibility test definitions

The explicit native400 mode measures the actual CSS viewport after browser zoom.
It checks control fit, horizontal reflow, reduced motion and computed accessibility
under normal and forced-color display. Separate schemas retain the observed width;
they never label it as a standard 320px audit. Standard mode keeps its original
DPR1 admission and 1440px/320px checks. Unknown modes and unsupported hosts are
refused before test effects.

The first consumer is a separately named local Chrome operational journey. It uses
the existing fixed fresh browser profile, factor4 preferences, capture-off settings
and verified retirement. It does not resize the native viewport. The original
operational phases, credentials, host checks, timeouts and resource limits remain.
The type declaration is borrowed source coverage only; all 41 fixed test files
and 22 automatic paths are unchanged. Unknown or explicitly requested generic
impact still keeps its checks.

Focused DOM/reader tests and case collection validate these definitions only.
Actual host/native execution, desktop and other-surface native definitions, and
final qualification remain pending. No models or OCR engines are run; accepted
model-quality results remain closed. This checkpoint grants no parent criterion
pass or original chunk completion.

## Desktop operational native zoom definitions

The separate desktop operational zoom case uses a fresh operational-native400
slot. The standard case keeps its original assertions and default mode. Both
use the existing isolated seed, runtime scenario, capture restrictions, launch
and phase bounds, and owned app/worker retirement. Existing or dangling native
slots are refused before seeding. This is cooperative test isolation, not
protection against a hostile filesystem owner.

The zoom helper obtains only app.browserWindow(page). It checks that window and
its web contents, applies fixed 1440px by 1000px bounds and factor4, then reads
the factor back. It disposes the obtained handle once. Setup and disposal errors
use fixed messages, including combined failures and empty rejection reasons.
The common native audit still checks actual frame, reflow, control fit and media;
it never substitutes a Playwright viewport for browser zoom.

The Operational profile retains all 41 test files and 22 automatic paths. The
new helper is borrowed coverage only. Unknown, incomplete and explicit generic
impact retains its checks. Foreign Assets slot additions and unrelated settings
are preserved and excluded from this checkpoint.

An isolated real Chrome fixture confirmed factor4 geometry and successful owned
browser/profile/server retirement. That fixture loaded no app or model. Focused
desktop port fixtures and source checks define the desktop case only. Actual
desktop execution, other native consumers and parent/full qualification remain
pending. Accepted model accuracy stays closed; retained offload files are not
inspected, adopted, moved, removed or given a new lease.

## Data and Context native zoom definitions

Six additional local browser/desktop variations reuse file ingestion, provided
dataset versions and row review, source RAG/Context packs, manual Context and
structured output controls. Six public helpers accept only explicit standard or
native400 mode; standard is the unchanged default. Unknown modes and unsupported
native transport/project pairs are refused before Page or file effects. All ten
existing critical state IDs use the common native audit when selected.

The six original host cases retain their assertions, scenarios and limits. Their
full service/app restart checks remain standard qualification. The focused native
provided-data variation completes creation/review in one session, so it cannot
reuse a second-owner marker or restart the shared service twice. Structured
output retains its renderer reload and explicit saved choices; desktop zoom is
reapplied to the exact owned Page window after reload. Native browser cases use
the fixed fresh Chrome profile and verified retirement, with capture disabled.

Three closed desktop native slots inherit the existing fresh-run fence, refusal
of existing/dangling entries and hidden 30-second seed limit. Native ingestion
shutdown and output-control results have separate file names. Standard names and
exclusive creation remain. The affected desktop import/provided-data wrappers
reuse the existing owned-phase helper so empty primary or shutdown failures
cannot disappear. Main/worker shutdown evidence retains its original scope.

The Operational profile retains its previous 41 files and 22 automatic paths.
It adds only the finite native admission file and existing phase-oracle file,
for 43 exact files. Borrowed source coverage stays explicit. Unknown, incomplete
and explicitly requested generic impact still keeps its checks. Foreign Assets
aliases and unrelated configuration/README edits remain outside this checkpoint.

Local fixtures, source builds/types and case collection define these tests.
Actual app/native workflows, model/provider results, original chunk completion
and full qualification remain pending. Accepted model accuracy is not rerun.
Original chunk4 still owns broader report-finalization repairs; this source work
does not assert every earlier result writer is fully qualified.

The native process-exit observer now has an additive TypeScript declaration for
its existing outcome fields and asynchronous close method. Its JavaScript,
Python/native behavior, checks, deadlines and authority remain unchanged. This
repairs the pre-existing missing-declaration diagnostic without suppressing it.

The app-free provided-data collector checks the exact four standard/native cases
that the existing wrong-profile guard skips, plus one real resolver pass. It
retains its offline environment, 256MiB heap ceiling, fixed process/test deadlines,
output cap and verified owned temporary-tree cleanup. It starts no app or model
and grants no actual host qualification.


The Assets and System editing definitions add two separately named local
native-zoom cases. They reuse all nine critical form audits and the existing
creation, preview, editing and document-reload assertions. The standard cases
keep their viewport, reflow and full desktop replacement checks. Native cases
use the fixed owned Chrome context or exact Electron Page window; they do not
resize the viewport to claim zoom. Final native control/dialog checks use the
measured layout width and require a passing frame. A fresh `browse-native400`
slot keeps earlier profiles intact, and owned cleanup retains primary and
retirement failures. The fixed operational profile gains one admission file
for44files; its22automatic triggers stay unchanged. Borrowed Assets test sources
do not activate another profile on their own. Focused fixtures, source checks and
case collection do not qualify real hosts, restart, model quality or the parent
roadmap. Broader report finalization remains the later reporting work chunk.

The Assets wiring guard checks each exact standard/native case separately. It
retains one awaited browse step before one awaited Assets core, the declared
host, default or explicit native mode, bounded public reads, document reload
restrictions and the original per-case deadline. Earlier failed guard evidence
is retained; no actual host or parent pass follows from this source check.


The lifecycle/OCR definitions add four named native-zoom variations for the
remaining eight critical contexts. Standard authorization, summary-unavailable,
runtime release/transcript isolation, stop/restart/uninstall and OCR source,
review, cancellation and persistence checks remain. Repeat lifecycle preparation
requires local host metadata in native mode and does not repeat initial audit
files. The main and each standalone runtime Page use exact owned-window zoom;
the browser variant acquires no unused default Page. OCR keeps its real fixed
scenario and existing resource envelope. Native reports use separate filenames
and measured fit; they do not claim the standard640px emulated viewport check.
Two fresh native slots retain existing seeding/root guards. The fixed operational
profile has46files and the same22automatic paths, with unchanged literal runners,
Windows argument bounds and unknown/explicit fallback. Focused fixtures, syntax,
builds/types and case collection do not qualify actual apps, native OCR, model
accuracy or the parent roadmap. Full testing stays at the approved later boundary.


## Reliable UI test reports and workspace setup

The reference browse, cold Canvas and structured-output journeys preserve the
first test failure and later reporting failures, including empty thrown values.
They attach current facts before final storage. Attachment or storage failure
changes the result to failed and permits at most one failed-write retry. No raw
exception enters the JSON. Structured output recalculates both serialized copies
and replaces a stale passed stage when finalization fails. Its exclusive-create
rule stays in force: an existing unknown file is never overwritten for recovery.
If storage refuses the failed report, the failed test receipt remains decisive.
Cold attempts also preserve a journey failure when owned app shutdown fails.

The standard browser authoring case opens the Home creation form and waits for a
new, distinct selected workspace before opening Systems. All existing browse,
Assets, reload, timing and native-case assertions remain.

The existing operational profile retains its 46 earlier files and adds two fixed
reporting tests and one routing test, for 49 files. Its 22 automatic source
patterns, fixed runners and argument bounds remain. Report consumers have exact
borrowed coverage; unknown, incomplete or explicitly requested generic impact
keeps generic checks. These checks start no app, model or provider. Other report
writers, actual app/native qualification and final combined testing remain pending.


The same report finalizer now protects the seven tracked ingestion, OCR, version,
saved-row, source/manual Context and low-memory UI result writers. Each callback
serializes current status again. Attachment failure is stored as failed; refused
storage remains a failed test. Existing exclusive-create rules and byte limits
stay in force. All workflow checks before publication and all later operations
are preserved, including source bytes/lineage, OCR approval/cancellation, standard
and native output identities, restart and explicit low-memory notification choices.
The fixed operational membership stays at 49 files with 22 automatic patterns.
Adjacent OCR and dataset profiles still run when their source rules apply; missing
or explicit generic coverage retains its gate. Model accuracy remains separately
closed. Task diagnostics, native cleanup, other report recovery, final HTTP byte
budgeting and actual host/full qualification remain pending.
