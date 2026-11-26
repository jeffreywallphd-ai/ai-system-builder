# Filesystem security adapters

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

`containedFilesystem.ts` supplies the existing cooperative containment helpers.
`windowsTrainingResultStore.cc` is an opt-in private Node-parent custodian. It is
not in the public barrel or default host composition. It starts no service/model
and changes no original training controller retirement.

The trusted caller supplies current authority, actual shared reservation, the
exact existing parent, a fresh32hex publication ID, scope digest and explicit
file/count/data/metadata/time limits. Configuration grants none of that authority.
Inventories are copied and checked before native effects. Every fresh object uses
the unchanged FINAL owner/World/OWNER_RIGHTS ACL and protected controls from birth.
The creator profile is the previous profile minus unavailable WRITE_DAC:
0x1301a7 for directories and0x13019f for files. These are explicit profiles, not a
globally minimal-rights claim. Actual grant, identity and exact final permissions
must match. A secondary control-only WRITE_DAC open must return access denied.
The full allocated empty namespace is checked before payload. There is no weaker
construction ACL, later setter, new privilege, identity, service or recovery.

This is an unqualified construction candidate. Actual original-root child creation
and creator write/read/delete must work on Windows. Unsupported behavior refuses
before data. Three earlier setter-based failures and their trees stay retained.
Tagged objects own one async operation and its original buffers through known
completion. GC/fencing cannot retire unknown IO or lost readers. Ordered writes
finish with flush and full SHA-256 readback. Readers use original capabilities;
ordinary path readers cannot replace them. Only fenced, known, reader-free stores
can discard original same-episode creators. There is no quota credit or old-tree
inspection, deletion, move, adoption or ACL reset.

Private `inspect` has finite numeric diagnostics only. Stage0..14 records the
operation phase. Protection sub-step1 is NtCreate,2 actual creator grant,3 exact
final descriptor,4 secondary control-open denial,5 stable identity,6 verified.
`nativeStatus` records creation/grant or unexpected-probe NTSTATUS, unsigned32bit.
`grantedAccess` records the last original grant. Permission bits1/2/4/8 mean valid
descriptor/matching owner/exact ACL/expected protected controls; controls are
masked0x150c. No paths, SIDs, payloads or raw exception text. Diagnostics are not
authorization, custody, readiness or qualification.

Build: `python -B dev-tools/scripts/native/build_windows_training_result_store.py`.
The fixed no-fetch builder uses pinned cached official Node SDK files and existing
MSVC/SDK with the unchanged bounded job. No-file ABI:
`node modules/adapters/runtime/python/tests/windows-training-result-store.unit.test.mjs --native-abi`.
Plan real files: `python -B dev-tools/scripts/native/qualify_windows_training_result_store.py --plan`.
Only explicit `--run` executes its tiny synthetic fixture after current separately
reviewed completed source. Loader environments, actual Node/source/binary identity,
original single-link locks, atomic admission, child/job closure and final full
source review are checked. Failed files remain; no automatic retry/cleanup.
Original SDK/controller, crash custody, global quota/durable accounting, receiver,
Save, packaging and whole-host qualification remain separate and pending.
