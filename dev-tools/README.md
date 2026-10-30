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


## Owned-run diagnostic and cleanup reporting

Task runs capture one immutable profile before UI effects: one sample remains a
diagnostic, while 30 samples retain the existing qualification flag and timing
thresholds. The finalizer admits the diagnostic success label only explicitly;
ordinary callers still require passed. Unknown profiles and mutable/accessor or
proxy inputs cannot broaden work or turn a diagnostic into qualification.

Worker and file-import cleanup preserve primary, observer-disposal, attachment
and storage failures, including empty thrown values. Public JSON uses only fixed
type and bounded stage labels. Exception names, messages and supplied getters or
proxy traps are not read. Native identities, acknowledgments, phase hashes,
worker bounds, exclusive reports and actual retirement requirements remain.
File-import cleanup is a local testable adapter with closed host/mode/stage
admission; the two existing app journeys keep their launch, zoom and deadlines.

Meaningful system construction protects listener/observer setup and final
recording; failed cleanup cannot hide earlier UI failures. The original successful
clock and observer/setup sequence, multi-component purpose, replay and build
assertions remain. Managed tasks explicitly create and bind a fresh workspace
without resetting reference data. The operational profile retains its 49 earlier
members and adds seven fixed new/related test files, for 56. Its 22 automatic
patterns, literal runners, twelve-file Node groups and generic/adjacent-profile
guards remain. Focused fake ports do not qualify actual apps, native processes,
model accuracy or final roadmap closure. Final qualification
remains pending.


## Repeatable Assets UI test definitions

The Assets test profile has 41 fixed test files. It retains the earlier 39 and
adds evidence-oracle tests and the existing desktop-slot tests. Five exact source
rules select the profile. Missing coverage and explicit generic requests retain
their additional checks. The profile does not launch an app or load a model.

Four host cases cover import, Foundation and imported copies, Studio resources,
save and reopen, review and publication. The cases capture their test identity
before effects, create a distinct workspace, and check that workspace after each
restart. Desktop cases refuse an existing test slot and retire each owned app
before another launch. Native zoom targets the app's owned window.

Evidence uses the bounded `asset-accessibility-v2` format. Browser text, selectors
and private error messages stay out of JSON. Reports use fixed stages, finite
facts and exclusive initial creation. Cleanup, restoration, attachment and save
failures remain failures. Deliberate PNG captures retain their original hashes,
device-coordinate mapping and focus/text contrast assertions. Each PNG is capped
at 16 MiB; the capture set is capped at 64 MiB. Native cases do not replace the
physical viewport with an emulated one.

Local fake-port tests and test discovery verify these definitions. They do not
qualify real app behavior, native process isolation, storage protection, model
quality or final roadmap completion. Those checks keep their separate evidence.


## Current functional UI definition census

Run `node dev-tools/helpers/ui_coverage_census.mjs` to check the current JSON map
against the original 39 scenario families and their 131 behavior statements.
The map records exact source hashes, named cases, assertion locations/digests,
29 host test files and 16 route, tab and dataset capability inventories. Source
analysis does not execute the inspected code. The fixed controller test runs
the census and its focused invalid-input and file-admission checks.

The checker reads bounded regular repository files only. It reports changed
source, test modifiers, missing host mappings and pending feature checks. It
always reports zero executed product tests and grants no host or parent pass.
Current missing mappings are visible work for the agent; they do not require
human intervention. Thin-client Settings still needs focused mutation/recovery
tests. Existing accepted model accuracy stays closed. Full testing remains
deferred by the user until feature work across open roadmaps is worked through.

The detailed map is `docs/operations/comprehensive-ui-automation-current-census.json`.
The historical coverage ledger keeps every approved requirement and earlier
feature-evidence entry. Its small current-census pointer does not replace that
history or qualify newer source from an older test result.


The fixed Settings profile has nine test files: four existing Desktop files,
three new thin-client/shared-field files and two related dashboard/use-case files.
One uses literal Node arguments and eight use Vitest. Its 23 exact source rules do
not hide unknown, incomplete or explicitly requested generic impact. Synthetic
fixtures cover HTTP denial, consumed/masked data, labels, readback and current-view
recovery. They do not start an app/model/provider or qualify physical restart,
reconnection or final full testing. See the host/shared Settings READMEs.


The operational UI profile now retains its original 56 ordinary files and adds
`review-site-oracles.unit.test.ts`. Its 26 exact automatic rules include the four
review-browser helper/oracle/test/config paths; existing borrowed host coverage
and unknown, incomplete or explicit generic fallbacks remain. It runs no browser
by itself. Use the focused review-site Playwright config documented in the
review-site README for the three named real-browser cases without app bootstrap.
The existing final browser matrix also includes those cases. Live canonical
observations and controlled refresh/storage variations have separate reports;
none grants app/model/native/full or parent roadmap qualification.

The live browser reads use a bounded read-only proxy to the verified loopback
server. Every live reply retains the server's security headers and checks its
bytes, current repository identity or exact shipped asset. This is distinct from
the controlled refresh/error copy. The canonical journey pins the existing
Comprehensive UI operational increment and compares every requirement bullet in
order, including nested bullets. Initial port failures, owned-read retirement and
report publication retain fixed primary/cleanup facts without private errors.


## Website acquisition host definition

The existing thin ingestion Playwright entry also defines a real website import
journey. It uses Add data, one page and the existing production capture controls.
It checks separate HTML and readable-text records, their exact workspace/source/
snapshot identity after reload, their preview text and workspace separation.
Existing file-import cases and focused pages/sitemap/retry/cancel tests remain.
Refresh is an application/API operation; this test does not invent a Refresh UI.

Before actual execution, separately authorize one public synthetic HTTPS page
and its use policy, robots policy and expected short text. Supply only that
page in `VISUAL_COMPOSER_WEBSITE_FIXTURE`, as JSON with exactly these fields:
`schemaVersion` (`authorized-website-host-fixture-v1`), `pageUrl`, `expectedText`
and `authorizationRef` (the reference to the prior authorization). The declaration
records prerequisites. It does not grant network authority. Do not use private
content, credentials, query strings or a local/private test server. The existing
capture adapter still verifies DNS, redirects, robots and resource limits.
The expected text must be a short, harmless ASCII marker present in both the
HTML source and extracted text. A missing declaration skips this case and keeps
acquisition qualification pending. An invalid declaration fails before page work.

Focused construction checks run the bounded declaration/key/report oracle and
collect the named browser entry without starting the app or requesting a page.
The operational profile preserves its prior 57 files and appends this one oracle
file, with three exact automatic source rules. It retains adjacent ingestion
coverage and generic fallback checks. Actual host execution, native recovery,
provider qualification and the later combined test run remain separate.

### Offline Desktop training journey

The dedicated `dev-tools/config/playwright.training-host.config.ts` profile covers a
small local LoRA training run, private review, explicit Save, and the same saved
model after a reload. The ordinary Desktop qualification profile is unchanged.

Set `VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION` to the repository-relative
`acquisition.json` for the already authorized, pinned Qwen 0.5B input. The fixed
preflight verifies its hashes and the installed Python 3.12 dependencies. It
denies installation and download. Missing inputs leave the case pending before
packaging or app launch. It does not rerun accepted model accuracy tests.

Use `npx playwright test --config dev-tools/config/playwright.training-host.config.ts`
only at the scheduled host qualification boundary. `--list --reporter list`
collects the definition without running a model or opening the app. A collected
case is not a successful host test. Outputs and caches use a fresh training slot;
existing slots and original model files are retained.

### Launcher-aware shutdown checks

The Windows test observer can bind a known worker to its known test root through
at most two parent links. It holds read-only process handles, checks creation
order and liveness, and waits for the worker and intermediate launcher to exit.
The root remains an ancestry anchor and is observed separately when needed.
After native exit, a recycled process number is not treated as the old worker.
Numeric PID absence is checked only for the weaker legacy fixture path.
Unsupported APIs, layouts, rights, mismatched parents and incomplete frames deny
admission. The existing PID-only mode remains available to existing callers.

Desktop cleanup captures live worker handles before it closes the owned test
app. It preserves the actual immediate parent, including a Windows Python
launcher. An already-exited direct controlled fixture retains only the older
PID-absence check. That limited check is not a native ownership or security pass.
A missing live admission cannot fall back to that limited check. The public
report identifies `worker-admission` separately and retains at most 32 fixed
failure labels for the bounded four-worker cleanup; private errors stay private.

Focused tests use portable protocol/denial fixtures and fresh inert Windows
children. They do not load PyTorch, models, ComfyUI or the product app. These
checks establish the helper behavior only. Actual app and complete job-tree
shutdown, native offload protection and parent-roadmap qualification remain
separate. Full cross-roadmap testing remains deferred by the current user request.


### Image generation host journeys

The dedicated `playwright.image-host-desktop.config.ts` and
`playwright.image-host-thin.config.ts` collect two real-image cases each. Run one
host at a time. Execution requires `VISUAL_COMPOSER_IMAGE_HOST=1` and an explicit
qualification run ID. Prepare only already authorized local inputs under that
run's fixed `thin-runtime/runtime-installs/comfyui` root; the setup never installs,
repairs or downloads them. The fixed `thin-runtime/image-host-inputs.json` has
exactly `schemaVersion: image-host-input-manifest-v1`, `runId`,
`checkpointFileName`, `checkpointSha256`, `checkpointBytes` and `comfyCommitSha`.
The checkpoint basename ends in `.safetensors` and identifies a file under
`models/checkpoints`. The existing managed installation and its metadata must
match the official source and exact commit. A declaration or hash grants no
supplier trust, runtime readiness or launch authority. Missing inputs leave the
cases pending before packaging or app startup.

Each case requests one 256-by-256 image with one sampling step through the public
UI, observes the real task, decodes the PNG and reopens the unique saved artifact.
The recovery case also checks navigation and task identity after reload. Its
renderer clock control supplies no timing evidence. The fixed Server child
accepts one stdin shutdown command and acknowledges the canonical task drain and
persistence close before generic owned cleanup. Desktop reports only its observed
main-process exit; ComfyUI/model workers and full native job retirement remain
unqualified by that report. Neither definition construction nor synthetic helper
tests qualify an actual image, model quality, native security or parent roadmap.
Accepted model-accuracy results stay closed. Full host execution stays deferred
until the user-directed combined qualification campaign.


### Later named UI qualification campaign

The user has deferred this campaign until feature implementation is worked
through across the open roadmaps. The current definitions and focused tests do
not supply a full app pass. Five families still need four functional host-journey
groups: Settings public/secret/default changes, provider acquisition, model
search/save, and artifact backing/publication/local deletion. Their focused
variation tests stay useful; the missing functional host bodies stay pending.

Choose the matching host, case and trusted fixture composition below. The files
are under `dev-tools/scripts/qualification/visual-composer/e2e/`; each listed stem
ends in `.e2e.spec.ts`. Visual Composer means
`dev-tools/config/playwright.visual-composer.config.ts`; Managed Reference means
`dev-tools/config/playwright.managed-reference.config.ts` with its separately
owned database reference. The generic setup supplies a controlled Node runtime.
Provided-dataset, real OCR, training and image cases require their own declared
composition or dedicated setup; a generic selection does not supply those inputs.
The fixed native/operator admission and resource rules still govern each case.

| Current host files | Entry or selector | Required setup | Evidence after an actual pass |
| --- | --- | --- | --- |
| `packaged-desktop-visual-composer`; `thin-client-visual-composer` | Visual Composer; one declared project | Fresh isolated profile; controlled Foundation runtime | Canvas smoke, UI state and storage only |
| `packaged-desktop-browse`; `thin-client-browse` | Visual Composer; matching host | Fresh workspace and declared asset fixtures | Typed browse/authoring/publication and restart UI |
| `packaged-desktop-meaningful-systems`; `thin-client-meaningful-systems` | Visual Composer; matching host | Fresh workspace; meaningful multi-component system fixtures | Build, connect, save and reopen supported systems |
| `packaged-desktop-reference-performance`; `managed-reference-performance` | Visual Composer / Managed Reference respectively | Declared 1000/2500/10000 fixtures and named environment | Exact counts and declared UI observations; separate from inference |
| `managed-reference-browse` | Managed Reference | Separately owned authorized database reference | Managed browse/authoring boundary |
| `packaged-desktop-asset-experience`; `managed-reference-asset-experience` | Visual Composer / Managed Reference respectively | Owned asset fixtures and matching host/database | Layered asset experience and persistence |
| `packaged-desktop-owned-tasks`; `managed-reference-tasks` | Visual Composer / Managed Reference respectively | Declared task-family fixture and cache | Mounted task notices/actions; controlled fixture tier |
| `packaged-desktop-worker-recovery`; `managed-reference-owned-failure` | Matching host; explicit worker-failure-download case | Owned worker/cache/fault gate and confirmed cleanup | Actual owned failure/recovery; no unrelated native security pass |
| `packaged-desktop-cold-canvas` | Visual Composer; packaged Desktop | Fresh cold profiles; frozen named observation workload | Startup/render observations only |
| `packaged-desktop-pdf-preview` | Visual Composer; packaged Desktop | Fixed synthetic PDF and isolated storage | Rasterized PDF preview and saved bytes |
| `packaged-desktop-ingestion`; `thin-client-ingestion` | Visual Composer; matching host | Isolated file fixtures; website case also needs its declared authorized public HTTPS page | File/source lineage and preview; website is not provider import |
| `packaged-desktop-dataset-versions`; `thin-client-dataset-versions` | Explicit provided-dataset host composition | Existing approved Python and provided-dataset-host-launch-plan.mjs preflight | Dataset versions, saved rows and manual/source/RAG Context UI |
| `packaged-desktop-low-memory`; `thin-client-low-memory` | Controlled Node runtime; fixed `dataset-profile` scenario | Desktop sets the scenario in its launch; Thin requires `PYTHON_RUNTIME_QUALIFICATION_SCENARIO=dataset-profile` before its controlled Server starts | Synthetic denial/cancellation and UI persistence only; no real model, offload or native ownership qualification |
| `packaged-desktop-structured-output`; `thin-client-structured-output` | Declared structured-output-controls composition | Matching fixed capability and dataset fixture | Output controls and constrained-structure UI contract |
| `packaged-desktop-ocr`; `thin-client-ocr` | Declared real OCR composition | Approved installed Python/package/Windows OCR and bounded native/OCR preflight | Actual OCR and document UI; synthetic adapters alone cannot qualify OCR |
| `packaged-desktop-operational-ui`; `thin-client-operational-ui` | Visual Composer for ordinary operational cases; dedicated selectors below for extra cases | Fresh profile; explicit standard/native400 mode and required per-case inputs | Shell/runtime/Security/Notifications plus critical accessibility definitions; opening Settings is not save/readback coverage |

Four dedicated selectors reuse the operational files. They add no host-file
inventory entry:

| Selector | Cases | Required input and scope |
| --- | --- | --- |
| `playwright.review-site.config.ts` | Three `review site real browser` cases in the thin operational file | A verified running local review server. No app global setup, model or provider pass. |
| `playwright.training-host.config.ts` | The Desktop local adapter training/review/save/reopen case | Explicit opt-in, existing pinned approved offline model and installed dependencies. Missing readiness is pending; no installation or fresh accuracy trial. |
| `playwright.image-host-desktop.config.ts` | Desktop image create/register and task recovery | Explicit image opt-in and the fixed verified managed inputs described above. Main-only shutdown does not qualify image workers. |
| `playwright.image-host-thin.config.ts` | Thin image create/register and task recovery | The same fixed inputs, one host at a time, scoped test credentials and acknowledged owned Server shutdown. Full native job proof remains separate. |

Before actual execution, freeze current source, the exact expected case set,
profile, fixture/input identities and evidence tier. Collect only the intended
cases first. Missing inputs or conditional skips remain pending; they cannot
close a required row. Declarations grant no database, credential, provider,
publication, model-download or native-process authority. Use only already
approved inputs and destinations. Preserve failed and interrupted attempts.

Run one Playwright worker with no competing app, model, build or performance
workload. Keep the existing per-case deadlines, capture restrictions and owned
cleanup checks. Sensitive traces/capture stay disabled. UI status alone does not
prove process exit or native ownership; retain each declared physical check.
Read source and runtime setup together before choosing standard versus native400,
controlled versus real Python, or worker-failure variants. Current unsupported
combinations remain pending instead of gaining a new permission or bypass.

The named packaged/managed/dedicated tests remain explicit outside `test:all`.
After all implementation is worked through and the final campaign is due, run
the declared named cases and the roadmap's once-only `npm run test:all` boundary
plus affected documentation/architecture/build/package checks. Keep accepted
model-accuracy matrices closed. Actual host, provider, accessibility, performance,
native and final current-candidate qualification remain pending until their own
required evidence passes and is independently reviewed. See
`docs/diagnostics/ai-development-control-plane.md` for source support limits.

### Functional Settings host journeys

The two dedicated Settings selectors each collect two cases from the existing
Operational host specs. They test a public value and a synthetic token plus a
passive model default. The checks save, confirm readback, reload and clear the
values. Clearing the model default restores its built-in value. The Thin Client
case also fails one read after a real save, checks that further writes are disabled,
then uses Refresh settings to read the actual saved value.

For the later qualification campaign, set `VISUAL_COMPOSER_SETTINGS_HOST=1` and
use either `dev-tools/config/playwright.settings-host-desktop.config.ts` or
`dev-tools/config/playwright.settings-host-thin.config.ts`. Run one host at a time.
Use a new run ID. The setup refuses an existing run/profile, strips ambient
provider tokens and migration settings, and uses only synthetic credentials in
the isolated profile. No new model, provider publication or dependency download
is part of these cases. Screenshots, traces and video stay off.

The fixed Settings test credential adds Settings read/write and provider-credential
read/write scopes to the existing qualification scopes. It has no credential-use
or runtime-administration scope. The production route and organization policies
remain authoritative. A successful Settings check grants no provider authority.

The Server uses a fixed Settings-only stdin stop message and acknowledges only
after canonical task/listener/persistence draining. The shared finite shutdown
core preserves the image protocol. Desktop reports main-process exit separately;
background/model workers and complete job-tree retirement stay unqualified.
Missing opt-in is a pending test, not a pass. Focused fixtures and collection
do not qualify actual host execution; the full campaign remains deferred.


### Model reference host journeys

The `functional-host-ui` profile checks the isolated model-reference definitions
and borrows the existing model preload/HTTP and ownership regressions. It keeps
the Operational profile and its limits unchanged. Unknown, incomplete and
explicit generic test impact retains its checks.

The two named actual-host cases search the already approved small Qwen model,
save its reference, inspect details, reload and check a second workspace. They
never download weights or run inference/accuracy. Dedicated functional Desktop
and Thin configs use one worker, no retries and no capture. Setup requires both
`VISUAL_COMPOSER_FUNCTIONAL_HOST=1` and `VISUAL_COMPOSER_FUNCTIONAL_METADATA=1`;
these declarations do not grant new provider authority. Profiles are fresh and
strip ambient credentials. The managed credential adds only credential-use for
metadata lookup; it cannot write secrets or create repositories. Functional
Server shutdown drains background tasks before persistence. Desktop evidence
qualifies only its owned main process. Actual hosts, provider behavior, full
worker retirement and final combined qualification remain pending.


### Local artifact host journeys

The two dedicated `playwright.functional-artifact-*` configs select one Desktop
and two Thin Client cases. Future actual execution requires both
`VISUAL_COMPOSER_FUNCTIONAL_HOST=1` and
`VISUAL_COMPOSER_FUNCTIONAL_LOCAL_ARTIFACT=1`. Collection does not start a host.
The existing model cases still require their separate metadata opt-in.

These journeys upload a tiny useful inventory, check exact local bytes and
backing state, reload, cancel deletion, require the exact confirmation and
preserve another workspace's artifact. Desktop alone uses its Download control.
Its actual Electron launch enables downloads only for that fixed export case;
the functional model launch explicitly refuses them. Export reads are bounded
and checked against the known bytes, without retaining an extra saved file.

Logical keys may repeat across workspaces. The isolation read runs while the
second workspace is empty, before its own upload. Later deletion must preserve
its separately scoped content. This proves logical workspace behavior, not
hostile native races or physical shared-object ownership.

The controlled loopback Server keeps its original primary identity. A separate
fresh identity has only `artifact:read` and `workspace:read`. It first completes
an authenticated read, then receives the actual route refusal for missing
`artifact:write`. This is the existing development LAN-token enforcement path;
it grants no managed provider-use or LAN-TLS qualification. No provider secret,
publication or model is used. Identity setup checks only its newly created
synthetic store and uses bounded cooperative file guards, not native ownership
proof. Canonical owned shutdown and truthful main-only cleanup remain in force.

The finite `functional-host-ui` group adds the real HMAC/HTTP denial, byte-bound
and fixture tests and borrows existing artifact UI/storage regressions. Its
unknown and incomplete impact fallbacks and the Operational bounds are retained.
Provider import, real private publication, actual-host execution, full worker
retirement and the final combined campaign remain pending. Accepted model
accuracy stays closed.


### Provider source and private artifact UI journeys

The dedicated `playwright.functional-provider-*` configs define two Desktop
journeys and one Thin Client journey. They use actual app controls. No test
injects a provider success or enters a provider credential in a browser.
Collection and inactive setup read no credential and make no provider request.
The executing MJS loader uses the installed public `tsx/esm/api` entry. Its
synthetic proof also verifies the production token-file format and retirement.

Actual execution requires `VISUAL_COMPOSER_FUNCTIONAL_HOST=1`, the relevant
`VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_SOURCE=1` or
`VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_PUBLICATION=1`, and
`VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_CONFIG` naming an explicit ignored test
manifest. Private cases reject mixed model/local-artifact flags. Thin Client
has a source journey; its product has no publication or export control.
The manifest records inputs; it grants no credential or publication authority.

The manifest has this structure. Replace every placeholder with a separately
prepared, authorized synthetic fixture before execution:

```json
{
  "schema_version": "functional-private-provider-v1",
  "repository": "OpenFinAL/ai-system-builder-test",
  "credential_file": ".local-codex/provider-test-inputs/credential.json",
  "source_file": {
    "path": "data/train-00000-of-00001.parquet",
    "revision": "<full immutable converted-Parquet commit>",
    "size_bytes": 1024,
    "sha256": "<exact 64-character content hash>",
    "localize": false
  }
}
```

The credential reference must identify an explicit test-only input with the
existing production `{ "token": "..." }` shape. The helper does not discover
or copy saved profiles, read ambient provider variables, migrate credentials,
or print the token, its suffix or its hash. Public planning omits the reference.
The source file must already exist in the supported converted-Parquet listing.
These tests do not create a dataset, request conversion or substitute a source.
The source declaration can be omitted for a publication-only run.

The source journey registers the exact selected immutable reference, checks
unavailable local content, reloads and checks workspace isolation. Registration
does not download bytes or create a raw/readable pair. `localize: true` adds a
separately authorized download capped at 4 KiB with exact-byte checks. Localized
catalog size can remain absent; a separate media-only read measures actual
bytes. Existing strict local-upload checks remain intact.

Publication uses only the existing authorized private repository, an absent
unique run path and tiny owned inventory. Repository creation stays unchecked.
A bounded Node-only read checks privacy before the UI action and again after it.
The local published backing records its actual `main` branch. A separate
authenticated immutable-commit read verifies the exact remote bytes. No remote
deletion, public visibility, blind write retry or new repository is permitted.
Reads refuse redirects, uncertain/private metadata, malformed UTF8 and response
overflow; request, stream and cleanup waits share the finite deadline.

Only a fresh opaque admission created before identity seeding can install the
test credential in the exact run/case production store. Desktop cleanup binds
the known launcher to the separately observed main PID, fresh canonical stop
report and acknowledgement. Server cleanup uses the actual owned shutdown
protocol. Uncertain stop or changed file identity retains the file and fails;
independent cleanup still runs. The operator input remains untouched. This is
cooperative test isolation, not secure erasure, Windows ACL/DPAPI protection,
hostile-race resistance, complete worker shutdown or managed OIDC qualification.

The finite `functional-host-ui` group includes the new contract, loader, file,
bounded-reader and actual source-oracle checks plus related existing provider
UI/use-case tests. The Operational bounds and generic unknown/incomplete
fallbacks are unchanged. Source construction, selected builds/types and named
collection do not qualify actual provider/app execution or the full campaign.
Accepted model accuracy remains closed. Final coverage linking is separate.

### Pure offload restart readiness checks

The `offload-restart-readiness` profile runs only the eleven pure Python
readiness and budget tests. It starts no model, native helper or provider.
Use `python dev-tools/helpers/run_focused_checks.py --profile offload-restart-readiness`
for this component. Its CLI plan is
`python dev-tools/scripts/qualification/offload_guarded_restart.py --plan`.
Unknown retained content keeps the full existing 12 GiB charge. Arithmetic and
serialized state grant no protection, journal authority or fresh lease. Actual
native protection, worker recovery and optional model qualification stay pending.
The existing outcome profiles and all unknown-impact checks remain unchanged.


### Qualification observation windows

The private Python `observe` API in
`dev-tools/scripts/qualification/observe_windows_process_exit.py` supports the
existing qualification controllers' exact execution windows. It accepts
630000, 690000, 930000, 990000, 1200000, 1230000, 1290000, 2430000 or 2490000 milliseconds,
in addition to short waits up to 30000 milliseconds. The separate 1200000-millisecond installed-generation wait has no added grace. The other windows combine the existing
600/900/1200/2400-second work limit with 30 seconds for retirement, or with
60 seconds for startup and 30 seconds for retirement. Other longer waits fail
before Windows process access. Boolean and non-integer values also fail.

The command-line interface has no timeout option and retains its 30-second
limit. The `observe_with_root` API also retains that limit. Both modes use only
held read-only process handles. The longer compatibility wait does not extend
the controller's execution, process, memory, disk or cleanup limits. An unknown
exit still fails. PID-only exit evidence does not prove a protected job tree,
staging protection or permission to restart offload work.

Run the focused observer test file for fake boundary checks and inert owned
Windows children. The native file-identity integration test additionally uses
the fixed installed compiler profile and new disposable synthetic fixtures.
Neither test runs model accuracy checks or qualifies a stable staging fence.


### Model-free Windows identity checks

The fixed `windows-file-identity` profile runs exactly the TypeScript protocol/
adapter unit file and Python native-builder denial unit file:

```text
python -B dev-tools/helpers/run_focused_checks.py --profile windows-file-identity
```

These tests use mocks and newly owned synthetic files. They do not compile or
run native code, load a model or qualify a file effect. The separate
`windows-model-file-identity.native.integration.test.ts` fixture builds only the
fixed installed MSVC14.42/SDK26100 profile, with no fetch or arbitrary compiler,
source or destination. Select the qualification Python through `PYTHON` before
that explicit controlled test. It uses new disposable roots, actual native exit
and source/tool/binary observations. Missing tooling remains unavailable.

Read-only identity cannot fence new child bytes or establish protected ownership,
production binary protection, stable storage accounting or offload recovery.
Existing broader profiles and generic fallback remain unchanged. Accepted model
accuracy and the deferred combined software campaign are outside this profile.


### Direct Windows dependency audits

The dependency checker preserves npm's inherited `npm_execpath` and the existing
Unix invocation. When started directly on Windows, it searches only a bounded
set of configured local absolute PATH entries. Native npm executable shims stay
supported. For a standard `npm.cmd` installation, it runs the adjacent installed
npm JavaScript CLI with the current Node executable, fixed arguments and
`shell: false`. It does not install tools or change package versions.

This follows [Node's documented Windows command-script behavior](https://nodejs.org/download/release/v24.21.0/docs/api/child_process.html#spawning-bat-and-cmd-files-on-windows).
Missing or incomplete tools still fail the check. The checker does not use a
shell or search relative or UNC PATH entries. The configured local toolchain remains trusted;
this lookup does not verify its supplier signature or provide a sandbox. Audit
JSON validation, accepted command exits, SBOM checks and the zero-advisory policy
are unchanged. Focused tests cover inherited CLI, spaces, native shims, Unix,
bounded lookup and denied paths. Direct invocation needs no manual npm-path edit:

```text
node dev-tools/scripts/security/check-dependency-security.mjs
```


### Native identity builder impact checks

A change to the fixed Windows identity builder now selects both its model-free
unit profile and the existing dependency audit in the control-plane check plan.
The unit profile does not replace the build-script audit required by `AGENTS.md`.
The impact rule adds only this exact source path; existing profile tests,
dependency paths and generic fallback stay unchanged. This selection does not
compile native code, start a model or qualify production file protection.


## Windows staging protection diagnostic

`python -B dev-tools/scripts/native/probe_windows_staging_protection.py --plan`
prints an effect-free plan. `--self-test` explicitly runs four model-free
controls on new, exclusively handle-created empty directories under the fixed
`artifacts/tmp` namespace: advisory directory notifications, permission-based
write denial, and a preopened security handle's permission change with both
mechanisms, plus refusal of a preopened folder writer. It accepts no caller
root, command, PID, ACL or privilege override.

The fixed `windows-staging-protection-probe` contributor profile runs only pure
unit tests. The native diagnostic is a separate explicit check, with fixed stage
codes and no paths, ACLs or private data in output. It restores exact original
permissions and removes only known empty created objects through their handles.
Unknown completion or unexpected content prevents cleanup and further cases.
This is cooperative disposable-fixture evidence, not hostile same-user isolation,
retained-tree protection, durable accounting, worker crash safety or offload
admission. See the [owning guide](../docs/operations/optional-low-memory-inference.md).


## Windows file and mapping protection diagnostic

`python -B dev-tools/scripts/native/probe_windows_file_protection.py --plan`
prints a plan without native effects. The explicit `--self-test` runs five
model-free checks on new private regular files of 4096 bytes. They test refusal
with an existing writer, writable section and writable view, then read-only
access with a waiting security change, plus refusal of a named data stream.
Anonymous mappings are not executable. A stream has at most 4096 bytes; a
synthetic fixture has at most 8192 data bytes in total.
The companion reuses the directory diagnostic's native identity, private
creation, exact permission restoration and bounded process lifetime.

The `windows-file-protection-probe` profile runs only pure unit tests. This shared-code change
runs both the file and existing directory pure profiles. Native checks
remain separate explicit actions; there is no path, PID, command or size input.
Unconfirmed mapping, thread, IO or cleanup stops the test. Only newly created
objects can be removed, through held handles and without recursion. Reports
contain fixed phases and numeric codes, with no paths or permission contents.

This diagnostic does not qualify retained or inherited files, alternate streams,
full trees, durable accounting, worker crashes or production offload. It does
not grant restart admission or roadmap acceptance. See the
[owning guide](../docs/operations/optional-low-memory-inference.md).


### Stream and folder-writer admission

The existing pure file and directory profiles also test bounded stream metadata,
preopened folder-writer refusal and post-grant checks. The fixed stream control
creates `probe.bin:probe-stream:$DATA` only on its new private seed. Its held
creator denies delete sharing, so the seed cannot be replaced while that stream
is created. No caller can supply a stream name or path. Named streams are refusal
controls; positive protection is limited to unnamed data.

Native stream metadata uses a fixed aligned 64 KiB buffer and at most 16 records.
Malformed offsets, duplicate names, oversized or invalid entries fail closed.
Actual names are never reported and payloads are never read. Unknown streams or
sizes prevent cleanup. A live guard remains held after a failed post-grant check
until its caller confirms retirement. Default and plan modes remain effect-free.


## Windows owned-job diagnostic

`python -B dev-tools/scripts/native/probe_windows_owned_job.py --plan` prints an
effect-free plan. An explicit `--self-test` starts one new inert Python process
at a time, with no model or Torch import. The two cases test a stop event and
closing the last job handle. Each requires actual readiness, native process exit
and confirmed cleanup. A stop request alone cannot pass. A worker that exits
by itself with a success, timeout or error code cannot qualify the job-close
case. Its fallback timeout is outside the diagnostic watchdog window.

The fixed job has a 512 MiB process/job commit ceiling and one active process.
This ceiling is not an upfront allocation or a change to model memory admission.
The helper reuses ABI shapes from the existing qualification memory helper but
does not call or change its 2 GiB policy. It uses the actual current runtime image
reported by Windows, avoiding a virtual-environment launcher's extra process.
The child has a fixed isolated-stdlib program, two explicitly inherited unnamed
events, and a minimal OS-derived environment with no provider credentials.

Creation uses a suspended process and atomic JOB_LIST plus HANDLE_LIST. The job
handle is not inherited, and there is no AssignProcess fallback. Membership,
limits and counts are read back before resume. Failure cleanup can stop only
the new process acknowledged by that creation. Unknown ownership or native
lifetime stops cleanup and retains references until the diagnostic exits.
The `windows-owned-job-probe` profile runs pure mocked unit tests only.

No caller can supply a command, executable, path, PID or memory ceiling. Closing
a job handle is not an actual guardian-process crash or proof of file-fence
ordering. Existing/inherited staging, protected accounting, production worker
integration, actual offload and parent qualification remain pending.

Failed process-count checks keep the observed total, active and limit-terminated
counts for each fixed phase. These numeric diagnostics do not relax the one-worker
requirement or qualify an unconfirmed shutdown or cleanup.

The fixed event-only worker uses `DETACHED_PROCESS`. It does not inherit or
allocate a console. There is no hidden-console or larger-process-limit fallback.
The memory, ownership, native-exit and cleanup requirements remain the same.


## Guarded folder inventory diagnostic

`python -B dev-tools/scripts/native/probe_windows_guarded_inventory.py --plan`
prints an effect-free plan. Explicit `--self-test` uses only new private flat
folders, one 4096-byte file and an optional additional empty file. It never
reads retained staging or starts a model or worker. There are no path, PID,
command or limit overrides.

The reader parses aligned 64 KiB directory metadata pages. A scan can read at
most four pages and 32 records. Classes 20 and 19 restart and continue the scan.
Only an explicit clean `ERROR_NO_MORE_FILES` completes it. Partial pages,
duplicate names or identities, unsupported metadata and ambiguous completion
fail. Names and native IDs stay internal; reports contain scalar counts only.

Two equal complete scans must match the known created identities and sizes
while root and file guards stay unbroken. The extra-file case must refuse the
one-file expected inventory even though both fixture objects are known owned.
Unknown content or lifetime denies cleanup. Known cleanup retires child guards
and then the parent guard before child deletion, with the private DACL retained
until its existing exact-handle cleanup. No recursive path cleanup is used.

The `windows-guarded-inventory-probe` profile runs mocked pure tests only. Native
controls require separate source safety review and explicit execution. This is
flat fixture metadata, not recursive tree protection, whole physical disk usage,
a protected journal, crash ordering, real offload or a staging capability.
The 12 GiB unknown charge, model guards and application denials stay unchanged.


## Nested guarded-folder composition diagnostic

`python -B dev-tools/scripts/native/probe_windows_guarded_tree.py --plan` prints
an effect-free plan. Explicit `--self-test` uses only one new two-level fixture
per case: two folders, three files and 4096 data bytes. Two empty files have the
same leaf name in different folders. No path, PID, command or limit override
exists; no model or worker starts.

The nested-directory control borrows its parent handle and never closes it.
Creation must acknowledge a new object; unknown returns, alias handles or
lifetimes prevent cleanup. All permission changes precede all guards. Shared
close failures mark the native adapter uncertain, and failed setup prevents
cleanup or retries.

Both directory listings must complete twice under every root, nested and file
guard. Final guard checks follow all metadata reads. IDs, volume, sizes and
parent membership must match the known created tree; unknown entries are not
opened or followed. The refusal case swaps expected same-name file identities
and must fail the parent-specific comparison. This is a software comparison
refusal after native observation, not a foreign filesystem operation.

Cleanup retires file guards, then nested and root guards, before child deletion.
It removes only exact known objects and confirms that the borrowed parent is
still open before root cleanup. There is no recursive path deletion.
The `windows-guarded-tree-probe` profile runs mocked pure tests only; native
effects need separate source preflight and explicit execution.

This fixed two-level composition is not arbitrary recursive/existing/inherited
tree protection, physical disk accounting, a protected journal, guardian crash
ordering, actual offload or parent qualification. Original guards and the
unknown retained 12 GiB charge remain unchanged.

Failures report only a fixed guard role and setup/inventory checkpoint. Each
already acquired guard is checked after the next setup operation; any break
stops immediately and preserves the failed fixture. The initial failed run
remains historical evidence, without an inferred cause or cleanup pass.


## Uncertain native handle closure

The shared Windows diagnostic close operation retains its native adapter and
exact handle before the operating-system call. A failed or interrupted result
marks the adapter uncertain. Later close attempts stop before native dispatch.
Only acknowledged success retires the temporary reference. No stale handle is
retried after an unknown outcome.

File creator closure also retains its fixture before calling the adapter. An
unknown return or interruption marks both local and shared lifetime uncertain.
It preserves the primary error and prevents cleanup or retry. A known successful
close clears the creator and remains idempotent. Finalization interruptions keep
the stronger denial.

The focused regressions use mocks for failures and successful close paths, then
reuse the existing file, folder, inventory and nested-tree checks. They inject no
real failed handle, start no worker/model and inspect no failed or retained tree.
These helper guarantees do not qualify production protection, durable accounting,
guardian ordering, guarded restart or another roadmap.


## Current model-quality scheduling

The existing `run-model-tests.cmd --all-blocked --plan-only` path reports the
accepted 30% small-model and 80% larger-model quality references. It schedules no
quality cohorts, creates no evidence directory and acquires no model lock. Old
run/restart forms cannot reopen that accepted work. Completed declared roadmap
owners remain visible as history, while real resource/native/provider/host work
stays pending. Unknown owners, missing criteria or contradictory records refuse
effects with fixed messages. No accepted quality is rescored.

The current public dispatcher never invokes the private historical quality entry.
Its old 22/23 arithmetic and protocol functions remain for archived compatibility
checks. The `model-qualification-scheduling` profile runs the fixed model-free
Python test file and preserves unknown, explicit and incomplete coverage fallback.
It grants no native capability, new resource/quality result or parent closure.
Unrelated explicit standalone diagnostics and the launcher forwarding stay intact.


## Guarded offload resource entry

`python -B dev-tools/scripts/qualification/run_offload_resource_qualification.py
--plan` identifies the separate quality record and the pending private lifecycle
gate. Keep the command on one line. It starts no model/process, reads no archived
outputs or retained staging, writes no evidence directory and grants no native
or parent qualification. Without `--plan` it reports pending and exits3. Unsupported
arguments or unexpected gate failures refuse with fixed safe copy. Accepted accuracy
is never rescheduled.

The fixed `offload-resource-lifecycle` profile runs four model-free files for the
real guarded lease/loader/cache, ordinary compatibility and resource entry. Native
backend, protected journal, owned-worker retirement and actual resource delivery
remain pending. Unknown or explicitly generic impact keeps normal test fallback.


## Fresh Windows staging feature checks

`offload-resource-lifecycle` includes seven fixed model-free files. The new Core
and concrete backend tests use synthetic native, journal and standalone-worker
facts through the real guarded lease. They do not start a model or native worker.
Unknown, incomplete and explicit generic impact keeps its fallback checks.

`python -B dev-tools/scripts/qualification/qualify_windows_offload_core.py --plan`
prints remaining native checks. Default exits3 with pending status. It cannot
execute a native fixture or accept a root, command, budget, PID or proof. Actual
fresh-fixture effects require separate reviewed execution. Existing/inherited
tree, protected journal, owned-worker/crash, model resources and the final combined
campaign remain separate. Accepted accuracy stays closed.


The declaration includes the still-missing finite native execution owner.
Preparation and dispatch refuse its absence. Source tests qualify canonical
owner/callback admission and the late-break cancellation refusal, not a native
deadline or physical cleanup. Microsoft documents the distinct cancellation
outcomes in [CancelIoEx](https://learn.microsoft.com/en-us/windows/win32/api/ioapiset/nf-ioapiset-cancelioex)
and the pending operation in [FSCTL_REQUEST_OPLOCK](https://learn.microsoft.com/en-us/windows/win32/api/winioctl/ni-winioctl-fsctl_request_oplock).
The output-slot event API is [NtCreateEvent](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-zwcreateevent).
