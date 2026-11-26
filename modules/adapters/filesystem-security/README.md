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
receives the unchanged final owner/World/OWNER_RIGHTS DACL at creation. Actual
original grant0x13019f, identity, permissions, single link, default stream, empty
EOF and measured allocation precede private metadata. Secondary control opens
must deny. There is no result directory, child insertion or ACL transition.

Ordered8KiB writes finish with row hashes, verified header/index/zero padding,
then footer and full prefix/EOF/identity/allocation/stream readback. Only a fully
finalized container admits bounded logical readers. One original async operation
and one reader lease remain owned through actual settlement. Fencing, GC and
lost readers cannot retire unknown IO. Known same-episode original-handle cleanup
returns no capacity credit and never deletes by pathname or touches old data.

Four failed directory fixtures and all their trees stay retained. The container
is a new unqualified physical candidate. Actual shared reservation, caller-parent
protection, durable crash retention, original SDK/controller/Job retirement,
receiver role/name binding, review/Save, packaging and hosts remain separate.
No configuration, scope digest, header/footer or component pass supplies that
proof. Default activation stays denied; no weaker live-only fallback exists.

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
