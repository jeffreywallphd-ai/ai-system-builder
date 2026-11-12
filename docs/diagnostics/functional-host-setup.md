# Functional host setup failures

The Functional UI test setup can report where startup stopped without exposing
an error message, stack, log, credential or user content. This is a test-harness
diagnostic. It does not change app startup, permissions, cleanup or resource limits.

`functional-host-global-setup.mjs` exports
`readFunctionalHostSetupFailure(error)`. A reviewed wrapper must use that function
from the same imported module instance that supplied its setup function. Call it
with the error that setup actually threw. Record only its fixed returned fields.
Do not reload the module through another loader or substitute an inner error.

The observation contains a fixed stage, a fixed native error type, and booleans.
An unregistered or non-object thrown value returns `stage: unavailable`.
Error properties cannot supply a stage. Frozen errors and proxies need no changes.
The records are immutable and weakly keyed. They grant no launch or test pass.

A stage names the known setup frontier. For example, `artifact-read-identity`
means setup was preparing the temporary read-only identity. `host-startup` means
setup was starting its local hosts. Neither identifies a root cause by itself.
When setup and cleanup fail together, the original aggregate still escapes.
The reported frontier does not assert that cleanup caused the startup failure.
An error from later teardown is marked `teardown` or `desktop-teardown`.

Continue to require a real executed case, its complete ordered phase report,
awaited teardown, original owned-process retirement, temporary identity absence,
and unchanged source and runtime before accepting a host trial. Preserve failed
attempts. A fresh app attempt needs its own reviewed inputs and one-use allowance.

The earlier local artifact trial recorded in
[the feature observation](../operations/data-local-artifact-ui-observation.json)
failed before a case ran. Its setup stage was not captured at the time. Do not
fill that historical gap from a later run. No user action is needed; the agent
must collect and diagnose the remaining feature evidence. Accepted model accuracy
and OCR checks stay closed. Full-system testing remains deferred until the open
roadmap feature work is implemented.

## Artifact provider isolation

Local Functional publication-denial tests must not send a publication or Hub
request to a real provider when the permission check under test fails. The
metadata/offline flags alone do not prevent every provider request.
The launch plan now projects one fixed internal
mode through the closed server environment. Default, metadata and local-artifact
cases use `deny`. Only an explicit private-source case uses `private-source`.
Unknown values, conflicting flags and a caller-supplied internal mode are refused.
The existing dual-case Desktop provider plan remains supported; its unused
Server plan selects `deny`.
Tokens, provider configuration and arbitrary caller fields are not projected.
Private-source mode still requires the existing separate provider admission,
credential lease and authorized repository; the mode grants no authority.

In `deny` mode, the trusted server entry supplies the guarded nonproduction
constructor transport. All six fetch/Hub operations throw before transport.
They retain only counts, never arguments, URLs, tokens, payloads or exceptions.
This covers the injected artifact Hub and metadata-fetch ports. Retrieval uses
the separate secure-egress broker and is outside this transport guarantee.
Do not use these counters as proof of no retrieval or general network activity.
Counts saturate visibly at 1024 per operation. Snapshots are immutable.
Real constructor/HTTP controls use only a public synthetic token and an independent
fallback trap. They must prove that both fetch and Hub forwarding reach the
throwing transport. A source or mounted-component pass cannot qualify a real UI
journey.

The entry writes `functional-artifact-provider-observation.json` in the fixed
run-owned server runtime directory once, after server creation and awaited
listener, background-task and persistence shutdown. The exclusive, bounded file
contains only the run/source identity, mode, narrow transport scope, counters and
fixed observation flags. `server_creation_returned` records constructor return;
it does not assert listener readiness. A failed shutdown or write cannot produce
a successful shutdown ACK.
Private-source mode does not write a local zero-call report. The report is a
trusted fixture observation, not an OS network audit or independent native proof.

For a real local publication-denial pass, the reviewed consumer must check the
exact run/source, installed `deny` guard, zero calls, no saturation and the
after-shutdown frontier. It must also require real HTTP `403`, all five ordered
UI phases, original owned-process retirement, temporary identity removal and
unchanged source/runtime. Missing evidence stays pending. Keep completed model
accuracy and OCR checks closed. This does not qualify general physical ownership,
managed tenancy, native offload, restricted security reviews or the parent roadmap.
The canonical boundaries remain in the
[Data threat model](../security/data-management-threat-model.md).

Use the existing `functional-host-ui` profile explicitly for helper-only changes;
`ingestion-publication` owns the server constructor and its integration tests.
The exact new helper/test pair is declared in the Functional profile. Unknown,
incomplete and explicitly generic impacts retain generic checks. A new actual
journey still needs its own reviewed, one-use execution plan.

## Current local artifact results

The [local lifecycle result](../operations/data-local-artifact-ui-observation.json)
records all eleven Thin Client steps passing. The separate
[read-only publication result](../operations/data-artifact-publication-denial-ui-observation.json)
records all five steps passing in a background browser. The read-only test sign-in
could read the local file. The actual server refused publication with HTTP 403.
The local bytes stayed unchanged after reload, and the six controlled provider
counters stayed at zero. All 44 owned test processes stopped normally and the
temporary identity was removed. Independent review confirmed these results.

These are separate focused results. Earlier failures stay in the history. Other
hosts, large inputs, websites, managed policy, native protection and final combined
qualification keep their own requirements. The counters cover the injected Hub
and metadata-fetch ports; they do not qualify brokered downloads or general
network isolation. Completed model accuracy and OCR checks stay closed. No user
action is needed for this completed local test. Full software tests follow the
remaining open feature work.

## Compact navigation accessibility sampling

The standard navigation journey measures the complete page with the compact
menu closed. It then measures the expanded menu, including its opener and panel.
Both measurements must pass in normal and forced-colors modes. The page audit
keeps every document region; the menu audit keeps its expanded opener and every
menu item. Neither measurement can replace the other. The agent must retain positive contrast samples, resolve each
incomplete check, and preserve any violation or failed measurement.

The driver uses Escape and ArrowDown to change the real menu state. It checks
visibility and `aria-expanded`, and restores the open menu even when the page
audit fails. The menu collector accepts only the fixed 320-pixel observation.
It requires one open menu container with a visible panel and trigger inside the
mounted shell. It accepts no caller selector or observer. Contrast retry targets
must remain inside that menu, including its opener. Other document, runtime and
native-zoom collectors retain
their existing scope and requirements.

This avoids measuring background text while a dropdown covers it. The earlier
open-page failures remain in the evidence history. A source test or a closed-page
pass does not qualify the expanded menu, the actual host journey, native zoom or
the parent roadmap. The agent must execute the focused real-app journey after
this correction. No user action is needed.

## Current definitions and historical source

The UI coverage inventory records source definitions. It grants no test execution,
host pass or roadmap completion. When definitions change, update their working
source facts and keep their authentic committed pins. Report each difference from
the pinned Git version as source drift. Independent current-source checks and
review remain necessary. A working fact is not a committed version or a test pass.

Historical inventory tests must read the source, ledger and discovery records
from the named historical Git snapshot. They must not use today's files as proof
of an earlier version. Keep the original snapshot and row hashes. A forged pin,
missing or duplicate row, hidden source drift or invented qualification must fail.

## Automatic notification popup reference checks

The installed accessibility engine asks for review when an opener uses both
`aria-haspopup` and `aria-controls`, even when the referenced dialog exists.
The source regression mounts the actual shared notification components and
reproduces that result with the installed engine. It does not measure contrast
or qualify an application run.

Standard notification qualification audits the complete page with the panel
closed, then restores it through the real keyboard controls. A separate fixed
audit covers both the bell and the complete dialog. The bell is in the header;
the dialog is under the main content. Panel-only sampling misses the opener.
The dedicated journey first marks messages read and clears completed entries.
Its proof requires the exact `Notifications` name and a native `button` opener,
with no overriding role or name reference. Nonempty notification journeys need
their own declared name/state checks; this empty-state proof cannot qualify them.

The additional check requires unique visible source-owned elements in the same
shell, correct role/name/state and both ID references. It matches the exact
engine node and `controlsWithinPopup` check, then verifies the identities again
after asynchronous work. Reports retain the original failed generic audit beside
the bounded reference proof. Generic readers still reject that raw audit alone.
Every other violation, unresolved check, contrast retry and positive-sample rule
remains required. Unknown or changed elements fail; no audit rule or product ARIA
attribute is removed.

The Thin client Image Generation intro uses the secondary text color on its
elevated panel. The normal-color contrast check still covers this text at both
widths. The existing system color token applies in forced colors.

The Desktop Image Generation form gives each input its own label and keeps
glossary help separate. Focused component tests check the default fields, the
extra FaceID fields and the separate checkbox and help actions. These tests do
not qualify the packaged Desktop app.

The Dataset Preparation tests check that both hosts give the Allowed labels
field its own label and describe optional guidance separately. The Thin client
tests also check that the edited labels still reach the preparation request.

Native zoom admission stays unchanged. Standard-width proofs do not qualify
native400 or another host. A new actual host result, source-bound checks and
independent review are required. Preserve all earlier failures and defer combined
full-system testing until the approved feature work is implemented.
