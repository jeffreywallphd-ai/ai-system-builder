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
