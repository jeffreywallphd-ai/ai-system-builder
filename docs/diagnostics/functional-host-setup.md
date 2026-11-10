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
