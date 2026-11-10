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

The local artifact trial recorded in
[the feature observation](../operations/data-local-artifact-ui-observation.json)
failed before a case ran. Its setup stage was not captured at the time. Do not
fill that historical gap from a later run. No user action is needed; the agent
must collect and diagnose the remaining feature evidence. Accepted model accuracy
and OCR checks stay closed. Full-system testing remains deferred until the open
roadmap feature work is implemented.
