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

Private `inspect` reports a finite numeric stage (0 captured, 1 principal,
2 parent, 3 capacity, 4 directory creation, 5 files, 6 sealing, 7 empty-tree
checks, 8 prepared, 9 append, 10 hash/readback, 11 receipt, 12 read,
13 discard, 14 closed). It contains no paths or payloads and grants no authority.
The explicit synthetic-file fixture is prepared separately from the no-file ABI:
`python -B dev-tools/scripts/native/qualify_windows_training_result_store.py --plan`.
Only `--run` performs actual file effects, after a current completed source Work
and separate review. It uses the existing bounded owned job, small fixed data,
known original child exit and observed job closure. Unknown file trees are retained,
with no automatic retry, path cleanup, ACL reset or capacity credit. These are
controlled component checks; crash, original training controller/SDK, application
receiver, Save, quota and full-host qualification remain separate.

The file fixture uses a fixed child environment without provider keys or ambient
loaders and binds the actual Node image/version/hash. A short original OS lock
serializes namespace count/create; a separate worker-owned lock lasts through
execution. Regular single-link lock identities are checked against the opened
descriptor. Full current Source Work/review binding is rechecked at closure.
