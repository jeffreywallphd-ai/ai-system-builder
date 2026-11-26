# Filesystem security adapters

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

`containedFilesystem.ts` supplies the existing cooperative containment helpers.

`windowsTrainingResultStore.cc` is a private, opt-in Node-parent custodian for
fresh training results. It is not exported through the adapter barrel or selected
by a default host. It uses stable Node-API 8 and the existing Node process; it
starts no helper, service, model or training worker.

The trusted caller must supply the exact existing parent directory, a fresh
32-character lower-case hexadecimal publication ID, a scope digest, and explicit
file/count/data/metadata/operation limits. These values provide no authorization,
global capacity reservation or right to inspect an old directory. The complete
binary inventory is copied and validated before native effects. All empty entries
are preallocated and sealed with the original World/OWNER_RIGHTS policy before
any private payload. Original creators remain private and non-inheritable.

Only module-tagged opaque objects can prepare, append, finish, read, fence or
discard. Each operation owns its native buffers and asynchronous completion.
Fencing never claims that pending IO stopped. Unknown effects remain retained.
Sequential appends and a full SHA-256 readback precede completion. One explicit
reader uses the retained creator; ordinary path readers are not compatible with
the exclusive sharing policy. GC never closes a live store or reader. A lost
reader therefore retains its store until process exit, rather than permitting
cleanup. Only explicitly fenced, known, reader-free stores can discard their
exact original creators. There is no old-root adoption, ACL reset or quota credit.

Build with `python -B dev-tools/scripts/native/build_windows_training_result_store.py`.
The fixed builder needs the pinned official Node SDK inputs already present in
the ignored local cache. It never fetches them. The existing bounded compiler
profile is reused. Run compiled no-file ABI checks with
`node modules/adapters/runtime/python/tests/windows-training-result-store.unit.test.mjs --native-abi`.
These checks do not qualify actual file/crash behavior, durable custody, receiver
integration, secure Save, packaging or a training task. Those checks and the actual
global reservation must pass before a host enables this component.
