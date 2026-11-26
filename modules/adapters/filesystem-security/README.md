# Filesystem security adapters

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

`containedFilesystem.ts` supplies the existing cooperative containment helpers.
`windowsTrainingResultStore.cc` is the optional private Node-parent custodian.
It stores each new result publication in one protected `.asbtr` file and exposes
logical readers through original capabilities. It is outside the public barrel
and default host composition, and starts no service, model or new process.

The user-approved replacement and fixed binary layout are specified in
[Private Training Result Container](../../../docs/architecture/training-result-container.md).
The complete copied group/role/name/size/hash inventory, safe offsets and exact
payload/metadata bounds pass before effects. One fresh exclusive preallocated file
receives its final owner/World/OWNER_RIGHTS DACL at creation. The fresh-result
World denial0xD0157 includes READ_DATA; original write/delete/control restrictions
and OWNER_RIGHTS remain. Actual
original grant0x13019f, identity, permissions, single link, default stream, empty
EOF and measured allocation precede private metadata. Secondary control opens
and least-right secondary READ_DATA opens must deny before private metadata.
Protection sub-steps4/5 identify control/read probes;6 checks final identity.
The existing file-only implementation creates no result directory and makes no
file ACL transition. The user's later fresh-parent approval is described below.

Ordered8KiB writes finish with row hashes, verified header/index/zero padding,
then footer and full prefix/EOF/identity/allocation/stream readback. Only a fully
finalized container admits bounded logical readers. One original async operation
and one reader lease remain owned through actual settlement. Fencing, GC and
lost readers cannot retire unknown IO. Known same-episode original-handle cleanup
returns no capacity credit and never deletes by pathname or touches old data.

Four failed directory fixtures, both failed container fixtures and their trees
stay retained. The measured secondary path-read exposure is corrected by the
explicit read denial; sharing mode alone was insufficient in that fixture.
Historical small Windows run `8c3de43d01e54b0f854593a32c4611c9` subsequently
passed all eight declared file-component checks, including original reads and
cleanup, with independently reviewed source and exact receipt/review records in
the supporting-work registry. This does not qualify the current full candidate.
The restricted failed run's missing historical group-empty proof is not repaired
by that pass. Actual shared reservation, caller-parent
protection, durable crash retention, original SDK/controller/Job retirement,
receiver role/name binding, review/Save, packaging and hosts remain separate.
No configuration, scope digest, header/footer or component pass supplies that
proof. Default activation stays denied; no weaker live-only fallback exists.

Later approval on2026-11-26 permits protection and qualification of NEW exclusively
app-owned result folders in the same custodian process/account, with no administrator
privileges, new service, additional process or identity. Existing folders, failed
data and permissions remain untouched. Qualify creation/file access, foreign
control/write/rename/deletion refusal, disk accounting and crash/retention before
activation. Unknown writers/control handles are not a stable fence; neither a
path check nor read-only permissions suffice. No mechanism or new physical pass
is selected by this permission, and all old attempt limits/evidence remain.

Private `inspect` exposes state and finite numeric diagnostics only: stage0..14,
protection sub-step0..6, unsigned native status/granted access, permission match
bits1/2/4/8 and protected-control mask0x150c. No path, SID, payload, descriptor or
raw exception leaves this diagnostic path. These fields grant no authority.

Build: `python -B dev-tools/scripts/native/build_windows_training_result_store.py`.
The no-fetch fixed builder uses pinned cached official Node SDK files and the
existing MSVC/SDK with the unchanged bounded job. Compiled no-file ABI:
`node modules/adapters/runtime/python/tests/windows-training-result-store.unit.test.mjs --native-abi`.
Plan actual files: `python -B dev-tools/scripts/native/qualify_windows_training_result_store.py --plan`.
Only explicit `--run` executes the tiny container fixture after current completed,
independently reviewed source. Exact binary/Node/source, clean loaders, original
single-link locks, actual child/job closure and full-source revalidation are
mandatory. Failed files stay saved; no automatic retry, adoption or cleanup.
