# Artifact confirmation fields

Desktop uses one confirmation dialog for registered and unregistered artifacts.
Thin Client has a single-artifact dialog and a separate bulk confirmation field.
This change does not add bulk deletion to Desktop.

Each supported field has a unique React-generated ID and an explicit visible
label. Its glossary help button is beside the label, outside it. An implicit
label with a help button before its input can associate with that button and
leave the input unnamed. Changing the test to find an unnamed input would hide
the accessibility defect.

The mounted component regressions check the actual `input.labels` and
`label.control` association, exact label text, unique IDs and separate help.
They also exercise help without changing the input, cancel and reopen with a
stable ID, wrong-case confirmation with no mutation, and the supported scoped
delete request. The required words remain exactly `Delete` and `Delete All`.
The existing explicit confirmation, pending-operation and workspace guards remain.

Before the markup fix, six relevant regression cases failed on missing labels.
After the fix, both exact component files passed all 32 tests with no unhandled
errors. These are mounted tests with finite synthetic clients. They do not
qualify a real browser, Desktop package, physical file ownership or a roadmap.

The related feature check also exposed an older stylesheet assertion. It expected
one line before the shared forced-colors stylesheet was added. The guard now
checks the exact shared import order and rejects missing, duplicate, local,
unknown or reordered layers. Harmless formatting is allowed. The stylesheets
remain unchanged; the shared high-contrast overlay stays loaded.

The `artifact-confirmation-ui` check runs the two mounted component files and
the shell stylesheet guard. It does not run a native build, app, model or
provider. The broad outcomes profile retains its Windows file tests and their
separate qualification. Source ownership never supplies that physical result.
The existing routing checks retain refusal or generic coverage for missing
configuration, incomplete ownership, unknown changes and an explicit generic
test request. The new profile does not change other profiles or test limits.

The [feature observation](../operations/data-local-artifact-ui-observation.json)
keeps the earlier setup failure and the later real Thin Client journey. That
journey passed seven of eleven steps before timing out at typed confirmation.
Its processes, temporary identities, source and installed runtime were checked.
The agent must run a separately reviewed fresh host trial after this source
checkpoint. No user action is needed. Model accuracy and OCR checks stay closed.
Full-system testing remains deferred until the open feature work is implemented.
