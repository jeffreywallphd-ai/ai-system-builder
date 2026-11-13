# System Builder Canvas Testing

The managed reference suite uses actual OIDC/PostgreSQL/RLS/verified TLS through
`dev-tools/config/playwright.managed-reference.config.ts`; the existing unmanaged
fixture remains a separate local journey. Reference browse tests retain exact
1000-system/10000-release/model/custom-asset summaries and 1000-candidate sparse
picker results. Timers begin at navigation or Add, before loading; diagnostic or
failed runs cannot close the approved reference performance criterion. Full host
task and real-model evidence retain their own procedure and acceptance owners in
`docs/operations/functionality-outcome-qualification.md`.

The managed task regression retains actual worker-exit API and rendered failure,
workspace return after completion, temporary browser disconnect, cancellation and
owned-worker cleanup duration. These are synthetic transport journeys; they do
not substitute for trained-model quality or performance. Keep diagnostic sample
runs separate from the thirty-sample reference qualification.
Fault tests first observe a live notification, then write one fixed owned-worker
trigger under the validated isolated cache. The fixture alone consumes this
bounded signal; production has no hook. This separates reload latency from the
fault and tests a real four-second HTTP listener outage without exiting the
worker. The cold Canvas cohort uses 35 fresh desktop profiles (five warmups and
thirty measurements), preserves every attempt, and matches the original
name-entry/Create-to-ready boundary. Exact rendered readiness is observed each
animation frame so test-runner assertion backoff is not mistaken for product
latency; unchanged explicit content assertions remain after measurement.
Each attempt also records launch-to-first-window-handle and
launch-to-interactive-shell times before workspace creation. The shell observation
requires the styled loading screen to finish, the app root to accept input and
the existing Create new workspace control to be visible and enabled. These times
include test-driver observation overhead and the requested loading-screen minimum.
A window handle is not proof of first paint. Profile seeding, workspace creation
and inference are outside these startup intervals; OS and model caches remain
uncontrolled. Startup values are ordered finite measurements bounded by the
existing ten-minute cohort deadline, not a new speed target or pass. They do not
change the original Canvas interval, its 15,542.8 ms budget, five warmups or thirty
samples. Edit/input-to-two-frame, revisit and inference timing remain separate.
Local oracle tests qualify only the recording rules. Actual startup, host and
performance results stay pending until the named packaged test runs.

The Form Composer cases build an equipment intake and a branching questionnaire
from empty forms, then save and reopen them. Separate cases author both forms
on the secured record template, publish them, check that a canceled invalid
form writes no record, and submit each form by keyboard. A valid submission
must write exactly one record with the four mapped values. Changing the
questionnaire route must keep the answer from the skipped page out of that
record. Each host also checks labels, validation announcements, and focus at
normal width, reflow at 320 CSS pixels, and reflow at actual 400 percent zoom
with the editor alone and with a Preview validation error visible.

Run the exact definitions separately so that only one host is active:

```powershell
npm run test:visual-composer -- --project=packaged-desktop packaged-desktop-form-composer.e2e.spec.ts
npm exec -- playwright test --config dev-tools/config/playwright.managed-reference.config.ts --project=managed-thin-chrome managed-reference-form-composer.e2e.spec.ts
```

Use the [owned managed qualification database](../operations/managed-reference-qualification.md)
for the browser case. The cases use separate test profiles or workspaces and
synthetic answers. They keep screenshots, video and traces off.

The scale fixture uses eight pages and 32 fields. Each host records five
samples each for a keyboard page change, committed text edit, and validation
through two rendered frames. Each sample must be at most 1.5 seconds. The
published intake has the same page and field counts; its single observed
submission must show confirmation within 15 seconds. The measures include
automation overhead and exclude startup, publication and model work.
The reports include source identity, host, counts, timings and fixed result
facts. The fixed definition check only lists the four cases per host. It
does not run them or qualify either host.

The managed Assets restart case loads its fixture in the Playwright worker.
It imports the shared process cleanup helper without loading the visual
composer command-line entry point. The import regression runs without opening
an app or database. Restart qualification still requires the named managed
Assets case to observe its existing graceful shutdown and new process checks.

The Canvas element picker uses a short visible heading and shows the selected
container in the dialog body. Its accessible name still includes the
container. Card metadata uses the stronger secondary text color so the type
and version stay legible when a result is focused or hovered.
The draft footer keeps its muted text style on revision history. The
**Save and validate revision** button keeps the primary button text color.
The Canvas UI preview uses a short visible title and shows the system name in
the body. Its accessible dialog name still includes the system name. Preview
coverage and the rendered surface are named groups. Preview uses the registered
System Foundation renderers without executing backend logic, activating a
release, or deploying the system.
The selected Layers row uses its highlight foreground for placement details in
forced colors. Normal themes and unselected rows keep their existing styles.
In Assets Customizations, each open read-only source panel has a keyboard
focus stop. Its accessible name identifies the resource, and the text remains
read-only. The source has its own theme background and text color, including
when the user chooses Windows high contrast.
The Assets history test compares the rendered publication row after reload. It
allows a visible line break between the revision and asset ID while requiring
the exact name, status, revision, ID, and version.
Asset details honors reduced motion even though its dialog is rendered
outside the application shell.
Once an asset definition loads, its details dialog shows a short heading and
keeps the full asset name in the body and in the dialog's accessible name.
The validation control remains available on request.
The registered native 400 percent Desktop browse case waits for the selected
workspace, uses compact navigation and responsive inspector controls, and lets
transient notifications dismiss before auditing the underlying surface. It
checks test-owned application exit. The standard restart case retains its
separate native worker cleanup checks.

On Windows, Playwright's launch process is a shell. Bind worker ownership to the
actual Electron main PID read through its live main IPC context. Shutdown
qualification retains a read-only Win32 process handle acquired while that main
is live, rechecks IPC identity, then requires a fresh `will-quit` acknowledgment,
native exit code zero and physical worker disappearance. An already crashed host
or vanished worker alone cannot pass. These read-only process observations grant
no native file-deletion/reveal authority. Desktop disconnect evidence requires
actual owned-listener refusal, retained nonterminal IPC identity, and eventual
same-task rendered/API success; a warning toast is not assumed.

Reference setup waits for actual draft readiness and selects the named Main page
and Page Shell controls. A transient application-layout Add button cannot become
the test's target. Absent usable results fail within ten seconds; declared p95
budgets stay unchanged. Sparse multi-type queries filter in the repository before
paging, retain all OR-compatible branches, and never discard matches through
oversampling. Preserve original failed/partial measurements before rerunning.

Desktop compatibility also runs the installed published-runtime lifecycle and a
synthetic one-page PDF upload/preview through the packaged PDF worker. Each
desktop case seeds its own isolated profile so persisted selection cannot make
later cases pass or fail accidentally. PDF qualification checks a decoded image
and visible text pixels, without bypassing the upload or preview UI.
Lifecycle fixtures retain the protected metadata-edit denial and use the actual
download command with an authenticated loopback worker. It admits one fixed
synthetic model, creates only a no-weights marker under an isolated cache, rejects
caller paths and redirected ancestors, and returns an opaque handle. The server
and desktop use separate listeners and caches. This verifies transport and host
integration; it does not qualify real downloads, model validation or inference.
The server's explicit nonproduction preparation callback checks the exact fixed
synthetic worker launch. Production rejects the callback and retains its Python
dependency checks. This avoids running Python installation probes on the Node
fixture while preserving real host token rotation, dispatch and shutdown.
The browser credential includes only the artifact/model/asset/workspace scopes
needed by its journey, with no administrator scope. The nonmanaged server fixture
has no organization summary authority: the lifecycle test verifies the exact
503/unavailable response, cleared loading and dash counts. Only its correlated
Chromium resource message is expected; other API failures and page exceptions
still fail. Dashboard/count qualification remains unavailable in this fixture.
The combined browser lifecycle also re-enters Home with an existing selected
workspace and creates another by a real pointer click. This reproduces the
workspace controls overflowing beneath summary cards; the shared layout wraps
controls inside their own column without forcing clicks or hiding the summary.
Source identities bind the present working tree, including unstaged deletions
and renames independently of index staging; other I/O failures and nonregular
inputs still deny qualification.

- Status: diagnostic suite; product corrections and roadmap qualification pending
- Owner: `system-builder-canvas-reliability`
- Verification: focused Canvas interaction tests and isolated Playwright journeys

## Useful systems from scratch

The shared `meaningful-system-journeys.ts` driver creates systems through the
actual UI from an empty workspace. It never supplies a prebuilt composition or
uses a template to bypass construction. Each host builds all three in a fresh
isolated workspace to cover coexistence, system switching and reload. Each
contains at least six distinct definitions beyond the required Foundation shell.

| System | Components | Observable behavior |
| --- | --- | --- |
| Request intake | Page, card, form, text and number fields, required checkbox, submit action | Invalid-to-valid native form validation, actual text/quantity/consent interaction, preserved labels and composition |
| Operations dashboard | Page, card, table, status, progress, collapsible section, summary | Table semantics, visible progress/status, reversible detail expansion and preserved hierarchy |
| Conversation interface | Page, card, transcript, composer, text area, submit action, response and error surfaces | Editable message input and declared conversation regions; no fabricated model response |

Every case exercises sibling reordering, reparenting, subtree removal and undo, then asserts exact definition/version references, actual inserted instance
identities, undo/redo, recursive preview containment, save (including explicit blocked validation), checked-build readiness, reload, reopen and
the same useful controls after reopening. Browser exceptions fail the case.
Durable per-test JSON records retain progress on failure as well as success. They contain source identity, component kinds and measured local creation
and insertion durations; they do not contain credentials or entered content.

These preview controls are nonexecuting. A form preview is not durable business
record submission, and a conversation preview is not inference. Checked builds,
release-bound data operations and controlled runtime outcomes require separate
actual evidence. Missing capabilities remain findings rather than invented passes.

## Focused failure reproductions

`SystemBuilderCanvasReliability.interaction.ui.test.tsx` exercises actual shared
React controls with deferred typed clients: unsaved draft creation guards,
51 edits followed by 50 undo actions, optional history latency and pending-save
mutation protection. The retained red run precedes fixes. Test-fixture errors
are corrected separately from reproduced product defects.

Use the repository Node24 runtime and a writable local temporary directory.
Run exact focused files through `dev-tools/helpers/run_vitest_checks.mjs --`.
Run real browser cases with the existing isolated qualification harness:

```text
node node_modules/@playwright/test/cli.js test --config=dev-tools/config/playwright.visual-composer.config.ts --project=thin-chrome thin-client-meaningful-systems.e2e.spec.ts
node node_modules/@playwright/test/cli.js test --config=dev-tools/config/playwright.visual-composer.config.ts --project=packaged-desktop packaged-desktop-meaningful-systems.e2e.spec.ts
```

The desktop harness packages the current source and requires an absolute
`npm_execpath`. Both harnesses own disposable local state and report source
freshness. Keep thin-client traces disabled because its short-lived test token
is injected into local storage. No provider credentials or model downloads are
needed for these construction journeys.

Source identity includes every nonignored input under the tested source roots,
including styles, templates, images/fonts and native/worker code, with explicit
file/byte bounds and regular-file checks. A changed visual asset invalidates an
observation. Runner completion and global setup/teardown errors are separate
failing checks: passing children cannot produce an overall passing artifact
after teardown or freshness validation fails. Global error records retain only
a bounded count and finite status, never the raw exception.

## Qualification boundaries

Current-source local journeys and failure regressions do not establish
representative performance, native filesystem or real-model/hardware
qualification. Human acceptance is handled offline and is outside these technical roadmaps. Keep technical criteria pending in their
owning roadmap and JSON qualification crosswalk. The original-supplier dependency
gate now passes after the scoped Undici patch and qualified Forge Vite migration;
this does not qualify the pending controlled checks.

The conversation case intentionally asserts blocked validation and build readiness
when its model binding is absent. The current UI cannot author the required
persisted-history conversation interaction or the closed data/runtime policy
profile from an empty composition. Tests never inject template metadata or claim
that denied custom execution worked. The dashboard checked build qualifies composition checks only. Request intake
correctly denies materialization without a platform policy; that policy cannot
yet be authored through this UI. Save validation and build readiness currently
fail to explain this requirement early, an explicit remaining usability gap. Complete runnable custom applications need a separately
designed bounded authoring/runtime surface; real inference and user qualification
remain unavailable.

Draft regressions cover delayed and rejected layout/save operations, duplicate
click admission, wrong-owner revisions, cross-workspace late responses, rejected
current reads with explicit retry and independently unavailable history. The
saved checkpoint survives the50entry Undo limit. Same-slot absolute move orders
refer to the final sibling sequence after removing the moved item.

Current-revision loads do not wait for history. A late history snapshot is merged
with locally saved revisions by immutable identity, preserving descending revision
order. System navigation releases obsolete transaction locks while late completion
cannot unlock or overwrite the new system's work.

## Local measurement protocol

Run the fixed source-bound draft algorithm workloads before and after a production
change, in the same Node24 environment, with no concurrent test/build workload:

```text
node --import tsx dev-tools/scripts/qualification/visual-composer/canvas-draft-performance.mjs baseline
node --import tsx dev-tools/scripts/qualification/visual-composer/canvas-draft-performance.mjs candidate
```

The immutable JSON records under ignored `artifacts/qualification/visual-composer/performance/`
identify source, harness digest, environment, warmup/sample counts and all measured
operations at50/200/500instances. They exercise actual production helpers and
assert state/tree outcomes. The broad synthetic graph is an algorithm workload,
not a validated application or browser paint measurement. Compare matching harness
and environment records; retain every attempt and report regressions or unmet
budgets. Source identity is captured before importing the measured implementation,
checked after import and checked after measurement. No benchmark adds a timing
threshold to ordinary unit tests.

Real host journeys separately record input/add/move/undo/redo/remove until two
animation frames have elapsed, creation/reopen timing and bounded long-task counts.
They collect durations only, with no entry URLs, transcripts or user payloads.
Progress JSON is retained under each run's `canvas-journeys/<host>/` directory,
so a later Playwright run cannot erase earlier measurement or failure progress.
Unsupported measurement APIs are recorded unavailable. A final roundtrip revisits
all three systems after later creations, including warm system switching and
useful controls. These local samples do not qualify representative hardware,
manual assistive technology or population-level usability.

Browser tests also attach bounded protocol outcomes from the current loopback
page origin for component reads, layout
preview and revision save: fixed operation paths, statuses, counts, identity and
model-binding-presence booleans, and allowlisted public failure codes. They never
retain headers, full URLs, credentials or request/response payloads. This helps
distinguish an unavailable definition, a cancelled read, a lost configuration and
an unissued save without suppressing the original UI assertion.

Demand-driven definition tests verify exact in-use reads and early Minimal
bootstrap without consuming unrelated continuations. Candidate browsing remains
paged; source and policy authorization are still enforced by existing host
operations. Long IDs use the catalog's bounded search prefix and still require
full exact identity/version matching across pages. Privately owned immutable history is tested against mutable aliases,
shallow caller freezes and executable accessor/serialization fields.

## Startup regression evidence

`modules/application/services/asset-packs/tests/canvas-startup-bootstrap.integration.test.ts`
exercises the real registry and repositories:343definition bounded bootstrap,
complete-body reuse, invalid batches, registration-hook denial, actual CAS-conflict
recomputation, concurrent initialization and failed-attempt recovery. Timing stays
out of deterministic assertions. Compare cold and unchanged-store stages with the
same source-stable local harness, SQLite WAL/FULL policy and real immutable artifact
storage; retain before/after source identities, all attempts and call counts.
Packaged-desktop/thin-client useful-system journeys remain functional coverage.
A faster local bootstrap is not reference hardware, native or model qualification.

The reference large/sparse picker exposed two independent sources of repeated
reads: multi-type filtering after paging and a desktop lazy wrapper that omitted
the registry's batch detail method. Preserve predicate semantics before paging
and forward the complete scoped batch through host wrappers. The composition
regression covers lazy startup, ordered missing results and failure propagation;
real host timings still determine whether the user-visible target is met.

After the Electron 42.11.3 security update, repeat the useful-system host matrix
and real packaged PDF path with a fresh package. Also execute the existing
`sqlite-runtime.electron.integration.test.ts` suite: it invokes the installed
embedded runtime for migration, transaction, backup/restore and operator CLI
checks. Dependency installation remains script-free; CI explicitly invokes the
official `node_modules/electron/install.js` before runtime tests. Passing UI
fixtures alone does not qualify a host runtime update.

## Automated reference accessibility

`technical-reference-profiles.json` declares the actual reference environment,
viewport, repeat counts and budgets before performance measurement. The browse
journey verifies platform, architecture, processor count, memory and device scale
against that declaration. Performance qualification still needs the specified
measurements; naming the environment alone is insufficient.

The same journey executes exact tree focus/name/expand behavior, modal activation,
both Tab wrap boundaries, Escape focus return, computed reduced motion, status
text, 320-pixel control access and WCAG semantics/contrast on both real hosts.
It retains every indeterminate rule. For offscreen/overlapped contrast nodes it
scrolls each exact synthetic element into view and measures it again; unresolved
results and all noncontrast incomplete checks fail. Initial and retry results,
counts, source/profile digests and runtime identities remain in per-run JSON.
No DOM, credentials, entered content or external script is retained/fetched.

The managed browser picker showed two indeterminate contrast samples on the
asset type and version labels at 1440 pixels. The same text rendered as one
text node let the browser audit verify the labels. Keep that metadata in one
text expression so the type, separator and version are measured together.
The picker retains the same text, wrapping and colors. Unresolved samples
still fail the host check.

The regression exposed narrow nested-panel label/badge overlap, insufficient
selected-tree detail contrast, unsupported preview labels and lost tree focus.
The Canvas now wraps labels/actions and reduces nested padding on narrow screens;
opaque reading surfaces keep contrast independent of decoration. Tree items name
only their own labels and retain exposed keyboard focus after pointer expansion.

## Exact saved-system observations

The meaningful-system journeys retain the selected workspace and system IDs, every
observed instance and exact definition version, parent/slot/sibling order, and
the configured synthetic labels and required fields. Save/reopen and later
system switches compare the same bounded observations. A matching node count
alone cannot pass. The comparison rejects duplicate IDs, missing parents, cycles,
extra fields and excessive data without changing the caller's observations.

The browser case builds all three examples in one newly created workspace and
then revisits each captured system ID. It has the same aggregate budget as the
former three creation cases and one revisit case. Both host drivers keep all
existing edit, useful-control and explicit unsupported-build assertions. This is
local test implementation; actual app execution, process restart and final
combined qualification remain separate. Run the bounded
`system-canvas-authoring-ui` profile for the oracle/protocol/draft unit files and
four related rendered Canvas files. Profile tests do not launch a host or model.

## Desktop authoring restart definitions

The packaged browse/Assets and meaningful-system cases keep the same isolated
application profile across two app sessions. Each session has a separate worker
record folder. The first session must pass the existing owned quit, native exit
and worker-exit checks before the second session can start. Both failures are
retained if the journey and cleanup fail. Old worker records are preserved.

The replacement must have a different process and page. Assets are checked
against the original workspace, published definitions, immutable base fields and
resource bytes, and customization history. Public metadata reads use the new
page. The three useful systems are checked against their original exact saved
observations. The original four asset document reloads and useful system actions
remain. A document reload is still not a process restart.

The replacement asset check allows one explicit attempt. It rejects the retired
page and duplicate attempts during or after verification, including a failed
attempt. These finite oracle tests and test discovery qualify the test
implementation only. Actual app/native restart, browser-server restart and final
combined qualification remain pending until separately executed. No accepted
model/OCR accuracy check runs as part of this work. The browse case has an extra
150-second total budget for its additional restart and verification steps;
existing action, launch, shutdown, output and resource limits are unchanged.

## Rendered workspace recovery tests

The thin-client workspace recovery test uses the existing Vitest/jsdom adapter,
as do the adjacent WorkspaceGate tests. Its assertions still cover refused
selection and clearing, a failed refresh and an empty workspace result. Teardown
always unmounts the owned root, removes its container and restores the prior
React act flag, including after a failed assertion.

Use `functionality-browse` for the related feature tests. The fixed helper
classifies the Vitest import automatically; no runner or dependency change is
needed. The earlier Node import-time failure remains failed harness evidence.
Passing these local tests does not qualify an actual host or process restart.

## Exact runtime shutdown and separate conversations

The controlled desktop lifecycle keeps two separately built and installed
systems in one isolated workspace. It sends the original button message to A,
stops A and requires that captured window to close. It then starts B with an
empty conversation, sends B's own message and checks its exact window closes.
Reopening A must retain A's first message, exclude B's message and accept the
original keyboard message. The input limit and Shift+Enter are also checked.

Each action selects the exact public system and build card and rechecks its
workspace, saved version and release. Preparation captures the Compose selection
and completed build's public details, then selects that exact build in Publish.
The existing thin-client wrapper retains
its single-system flow. It does not expect a local desktop runtime window.
The desktop case has 120 additional seconds for the second build and conversation;
individual action, build, launch and shutdown timeouts remain unchanged.

After shutdown, the existing isolated data verifier checks two distinct runtime,
database and conversation session IDs. Both must match the public release
observations and their stored release records. It checks exactly two A turns
and one B turn, the corresponding responses and execution counts, and no
conversation or execution data in the control store.

Run `functionality-browse` for finite wrong-identity, reused-window,
open-window, pending/failing-stop and mixed-transcript checks. Only the new test
and its four owning source paths are added to that existing profile. These tests
and test discovery qualify the definitions. Actual host execution, native
revocation and worker cleanup, browser-server restart and combined qualification
still need separate evidence. No model accuracy or OCR check is repeated here.

## Activate and Deactivate UI coverage

The rendered published-build tests now click both Activate and Deactivate. They
check the exact workspace, release and current revision sent by each button,
updated eligible controls and success notifications. Two clicks in one turn
must send one command. The tests also refuse a stale Activate and a denied
Deactivate, hold the status refresh open and require an explicit retry with the
new revision. Refused actions must not show success or replay automatically.

Run `system-build-publication-ui` for these cases and the related Build/Publish
tests. This is focused rendered coverage using the real shared component and
finite client replies. Product behavior and guards are unchanged. Actual host,
native and combined qualification remain separate.

## Operational host navigation and audit inputs

The operational journey opens Settings through the unique shell-header button.
Both shells also have a sidebar button with the same name. Focused regressions
exercise the real journey with that duplicate-button condition and retain its
safe failed-phase report on both hosts.

Accessibility qualification reads its fixed reference profile and locked axe
script from the test source checkout. The process working folder can be a fresh
isolated test folder. It cannot supply either input. Standard, native and shared
technical audits use the same argument-free engine reader. Report output remains
under the original case-owned working folder; its exclusive creation, audit,
reference, viewport, motion, failure and restoration controls remain intact.

Source tests cover unrelated working folders and missing-engine denial. They
grant no actual browser, native zoom, model, provider or parent qualification.
The source correction must be followed by a fresh source-bound host observation.
Keep accepted model accuracy and OCR closed and defer whole-software tests until
the open implementation work is ready.

## Responsive operational journeys

The standard operational journey opens the navigation menu at 320 CSS pixels.
It returns to 1440 pixels before checking the sidebar's Collapse and Expand
buttons. The journey restores its caller's viewport after success or failure.
Each standard accessibility collection also restores its caller's viewport.
Standard callers must supply an explicit positive integer viewport. An absent
or invalid restore target fails before layout or media changes. The helper does
not invent a viewport for an automatically sized Electron window. The owning
standard desktop launchers establish the viewport before invoking the helper.

The native 400% journey uses the actual zoomed window. It never resizes the
viewport. It checks that the sidebar is hidden and the navigation trigger is
visible, then uses that menu for later page changes. Its two responsive phase
names differ from the standard sidebar actions. The oracle takes the mode from
the runner, rejects unknown modes and refuses cross-mode phase substitution.
The standard v1 report and its ordered phases stay compatible.

For navigation accessibility, both normal and forced-color collections require
the visible wide sidebar or the visible narrow open menu, as applicable. These
checks add to the existing frame, contrast, reduced-motion, reflow and control
access checks. They do not replace native zoom measurement.

Home must show the selected fixture workspace's heading and retain that
selection. Workspace names and IDs stay out of the generated phase reports.
The notification check first verifies the panel's initial Close focus. It marks
unread records when needed and clears completed current-session records before
checking the empty state. An active record prevents that check from passing.
Escape must close the panel and return focus to the notification button.
The focused component tests also verify dismissal of a notification. Dismiss a
focused toast to return focus to the notification button, even when the panel
is open. Dismiss a focused item in the panel to return focus to Close.
Dismissal from an unfocused control keeps the current focus. The
`notification-dismiss-focus` profile runs the
rendered dismissal, notification-action, and toast timing component tests.

A managed-browser fixture used the shared toast styles at 320px and 1440px.
A long unbroken reference made the text and dismiss button extend beyond the
available bounds at both widths. Allowing the text container to shrink and wrap
kept both inside the toast and viewport. Ordinary text fit in all variants.
The twelve cases produced zero contrast samples. The running-app contrast
finding still needs separate evidence.
The shared stylesheet lets toast text shrink and wrap long references. The
component regression checks the applied rule and the dismiss button's size rule.
A fresh browser fixture used the changed stylesheet. Wrapped text and long
unbroken references fit beside the dismiss button at 320 and 1440 pixels.
This fixture produced zero contrast samples. The running app still needs
contrast qualification.

An open notification panel exposed a separate layout problem. The panel fit
horizontally at all three test widths. At 320 pixels the panel and toast
overlapped. The test reached the center of Dismiss and missed Close. At 720
pixels it reached both centers, but the toast extended past the viewport.
At 1440 pixels both controls were reachable and both surfaces fit. The fixture
checked synthetic pointer targets. Running-app accessibility and contrast
still need qualification.

The shared stylesheet keeps the open panel visible and clips the duplicate
toast on narrower screens. It removes the hidden toast button from keyboard
access while retaining the live text. The component test confirmed initial
focus on Close. Six browser cases confirmed the panel and standalone toast
controls at 320, 720 and 1440 pixels, with both controls visible when the wide
panel was open. At 320 pixels with the panel open, the accessibility tree
included Close and the toast text without the duplicate Dismiss button.

A focused toast stays at the bottom when the window narrows. The stylesheet
limits its height and keeps the other toasts visually hidden. The resize test
kept focus on Dismiss and kept both button centers reachable while moving from
1440 to 320 pixels in a 280-pixel-high window with four toasts. Moving focus to
Close hid the duplicate buttons and kept the live text in the accessibility tree.
This test resized the synthetic viewport. Native zoom still needs a host test.

Use the focused `operational-ui` profile for these helpers and related feature
tests. Synthetic Page and DOM fixtures check the test definitions; they do not
qualify an actual host. Preserve earlier failed runs. A fresh source-bound host
run is still required, and coverage-ledger source pins need separate current
reconciliation before aggregate closure.

The seven affected desktop launchers now prepare each relevant owned standard
Page at 1440 by 1000 pixels. This includes both provided-data app sessions, the
output-shape reload callback and both separately captured lifecycle runtime
windows. The preparation awaits successful viewport setup before reading its
exact dimensions. A failed setup cannot pass by reading Playwright's cached
requested dimensions. The shared audit then captures and restores that explicit
viewport. Existing browse setup stays in place.

Native preparation makes no Page calls. The launchers retain their original
owned native zoom, frame measurements, observer and cleanup order. Source tests
inspect the actual launcher syntax and reject missing, wrong-Page, wrong-mode,
late, unawaited and dead-branch setup. They also reject missing runtime or reload
setup. These source checks do not execute OCR, model quality or real hosts, and
do not close the outstanding host or coverage-census qualification.

The Operational profile already executes the native Data/Context wiring test.
Replacing its redundant source-only entry with the exact low-memory launcher
preserves every executable test and previously covered path. The union adds
only that launcher. Unknown or incomplete impact retains the generic guard.
The related Data/OCR contract checks remain required; no real OCR, model quality
or whole-system campaign is repeated by this source component.


## Current definition census and preserved source history

The earlier definition census followed the reviewed operational source checkpoint.
Ten stale source entries are refreshed. The other 170 entries, all 39 scenarios,
131 behavior links, 29 host files, 16 inventories and pending feature checks
stay intact. Source facts use LF-normalized text. Each committed pin has a real
Git witness at the recorded source baseline.

The [operational census history](../operations/comprehensive-ui-automation-operational-census-history.json)
preserves the exact previous rows and their digests. It also binds the prior
census Git version and the unchanged eight-row historical archive. Keep the
one-space JSON format: that map was 499849 bytes and fit the existing
512 KiB limit. The reader and total input limits are unchanged.

The existing reporting test validates the current map, authenticates every Git
pin and checks history and no-execution results. Forged facts, Git pins, test
statuses and history are refused. This guard stays outside the map's source
inventory to avoid a circular source pin. Run the existing census unit file as
a focused feature check and the related Operational profile for the guard.

A valid definition map runs no inspected software tests. The 39 host journeys,
conditional test modifiers and pending feature check remain explicit gaps.
Actual host, native, provider, resource, model and combined qualification stay
separate. Accepted model accuracy and OCR are not repeated for this update.

## Failed contrast measurement diagnostics

New collectors emit `contrast-retry-diagnostics-v4`. The 16 fixed reason keys introduced in v2
include the installed engine's emoji-only, pseudo-element, complex-shadow and
shadow-contribution cases. The v1 reader, original 11-key constant and serialized
v1 shape remain compatible. The v2 reader retains its exact aggregate shape.
Each version requires its own exact keys. Mixed, missing, unknown or excessive
values fail. Saved v1 through v3 reports remain readable in their original formats.

Home reading panels use opaque palette surfaces, and readable cards no longer
carry the large decorative pseudo-element. Accent icons, actions and responsive
layout remain. This source repair does not prove that the earlier contrast
failures are resolved. A separately reviewed current-source browser observation
must still qualify every required view, width, media state and control.

The browser collector now returns a separate, validated diagnostic value to the
critical-surface collector. Existing audit entry points still return the same
core audit. No callback, caller selector or extra argument is accepted by the
new fixed observation entry points.

Failed mounted-surface reports include `contrastRetryDiagnostics` with the
fixed audit stage and bounded counts. Successful reports keep their existing
fields and attachments. Missing diagnostics do not make an audit pass.

- Retry outcomes count violations, unresolved measurements and missing positive
  samples. They partition the failed retries. Original attempted and passed
  counts must match the core audit.
- Engine reason counts keep only known `color-contrast` check reason codes.
  Each failed retry contributes one recognized reason, or `other`. These are
  engine-reported hints, not proof of the cause.
- Region counts assign each failed retry to its nearest fixed UI region, such as
  the glossary help, page summary, shell or Home content. Version 4 distinguishes
  notification toasts, the notification panel, modal dialogs, and the shell
  content and main containers. If the collector finds no known region, it records
  the retry under `other`. Region counts add up to the original count for each
  reason. The counts locate the target by area. The cause still needs evidence.
- Style hints count background images, reduced opacity, clipping, non-RGB
  computed text colors and truncated inspection. Counts contain no CSS values.
  The collector inspects at most 64 ancestors and 64 node/check slots per failed
  retry. The existing 1000-node retry limit stays intact.

Selectors, page text, messages, URLs, colors and raw exceptions stay out of the
diagnostic projection. Collection adds no audit, scroll, frame wait, media change
or viewport change. All original rule, target identity, visibility, contrast
sample and retry requirements remain. An incomplete result still fails.

Focused tests exercise the real browser callback with synthetic DOM/engine
results. They check safe projection, partitioning, bounds, unchanged successful
core output, extra-argument refusal and failed report persistence through save,
restore and attachment errors. Fixtures do not qualify an actual browser host.

The [v2 contrast census history](../operations/comprehensive-ui-automation-contrast-v2-census-history.json)
preserves the three previous source rows. All three earlier history files remain
unchanged. Tests authenticate the earlier diagnostic map against its real Git
version and the current map against its own baseline. The current map records
working facts for those three files and real committed pins. Three explicit
source-drift gaps remain until a later reviewed committed-source refresh.
The map, reader and total input bounds stay unchanged. Both reporting and census
tests reject forged, future, missing, duplicate or unrelated versions. The map
still records 39 unrun host families, seven conditional modifier gaps, one
pending feature check and no execution or parent pass.

The [contrast region census history](../operations/comprehensive-ui-automation-contrast-regions-census-history.json)
preserves the preceding v2 map and its three replaced source rows. All earlier
history remains intact. The new map records three current definitions and keeps
the same bounds and open execution gaps. The history test keeps its existing
cache limits and evicts old entries when it checks more versions.

The [shell overlap census history](../operations/comprehensive-ui-automation-shell-overlap-census-history.json)
binds the three updated test and collector definitions to their earlier Git
versions. The open host and qualification entries retain their previous status.

A separately reviewed browser run recorded 60 direct passing samples and two
unresolved retries at its first audit. The engine tagged one as partial
obscuring and one as very short text. No contrast violation was measured, and
no full audit or operational phase passed. A later reviewed feature check can
use the fixed region counts to narrow the investigation. Preserve
the earlier failed runs and every genuine remaining qualification gap. Keep
completed accuracy and OCR checks closed. Full-system testing remains deferred
until the open implementation work is ready.


## Notification count contrast

The standard thin-client run grouped one unresolved short-text retry in the
notification badge region. Separately, the earlier white text and red background
in the shared palette compute to about 3.10:1. The badge now uses an existing
dark palette color for text and a shorter line box. The focused check
reads the actual stylesheet and requires at least 4.5:1 in both the shared
palette and its fallback. The count, accessible label and controls are unchanged.

This source check does not qualify a rendered browser or desktop result. The
separate unresolved partial-obscuring measurement still needs diagnosis. Keep
the original failure and all existing accessibility and host requirements.
