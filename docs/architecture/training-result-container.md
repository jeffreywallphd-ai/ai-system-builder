# Private Training Result Container

- Status: current
- Related decisions: ADR-0043 and ADR-0047
- Qualification: historical small file-component pass; integrated parent/custody and hosts pending
- Authority: user-approved protected-file replacement and later fresh-parent protection, 2026-11-26; ADR-0043 and ADR-0047
- Verification: focused compiled ABI and contracts, then explicit Windows component qualification

## Boundary

The optional Node-parent custodian stores one fresh publication in one exclusive
`.asbtr` file. It keeps the original file handle and exposes logical entry readers.
It creates no result directory or child files. Existing failed directory trees
are never opened, migrated, adopted or removed. Default hosts remain unavailable.

The trusted application still owns current actor/workspace/task approval, actual
shared reservations and qualified parent custody. A path, scope digest, header,
footer, configuration or successful component test grants none of that authority.
There is no new service, process, identity, privilege, engine or dependency.

The user's later approval permits protecting newly created, exclusively app-owned
holding folders in this same custodian process and account, without administrator
privileges. Only fresh folders are eligible; existing folders, failed data and
their permissions remain untouched. This extends the earlier file-only direction,
not its physical qualification. The actual implementation must prove creation and
file access, refusal of foreign control/write/rename/deletion, bounded accounting
and crash/retention behavior before activation. Unknown writers or pre-existing
control handles cannot be dismissed; a path check or read-only ACL is insufficient.
No particular protection mechanism or weaker fallback is selected by this approval.

## Fixed Codec

All integers are explicitly encoded little-endian. No C++ structure is serialized.
The private input starts with `ASBTRS02` and a 32-bit row count. Each 48-byte row has
index32, group16, role8, name8, length64 and 32 expected SHA-256 bytes. Indices are
consecutive. Groups start at 0 and advance by at most 1. Earlier groups are
checkpoints (role 1); the final group is the candidate (role 2). Names are unique
within a group. Lengths are positive and bounded. The complete copied inventory
and derived layout must pass before any filesystem effect.

The fixed 1-based name ordinals are:

1. `config.json`
2. `generation_config.json`
3. `tokenizer.json`
4. `tokenizer_config.json`
5. `special_tokens_map.json`
6. `added_tokens.json`
7. `vocab.json`
8. `merges.txt`
9. `model.safetensors`
10. `adapter_config.json`
11. `adapter_model.safetensors`
12. `serialization_manifest.json`
13. `training-run.json`

These labels select no physical path or executable loader. The file name is only
the trusted fresh 32-hex publication plus `.asbtr` under the configured parent.
Input version1, unknown tags, duplicate names and malformed sizes are refused.

The private filesystem adapter's `trainingResultInventory` codec revalidates the
receiver's complete passive inventory and explicit count/file/total limits before
encoding this input. It emits no more than12,300 metadata bytes for256rows.
Publication identity, groups, roles, fixed labels, media types, indices, positive
sizes, lowercase SHA-256 and exact total must agree. Golden vectors cover the
existing layout, all13name ordinals and large integer precision. Proxies,
accessors, sparse/extra arrays and unknown fields are denied without callbacks.
This pure encoder opens no file, loads no native module and supplies no authority.
Native layout/allocation checks and actual backend composition remain mandatory.

The codec can also return a detached frozen metadata snapshot beside its private
encoded Buffer. The optional filesystem publication adapter uses that one snapshot
with an installation-owned preloaded native API, never a request-selected module.
It captures all ten original method descriptors, including non-enumerable exports,
then creates and retains the exact store. Workspace/organization/principal scope
is fixed; publication calls also match the original request/correlation context.
Later private reads may use a fresh request under the same actor/workspace scope;
the application must independently reauthorize them before and after waits.

Preparation, append, finish, reads and discard observe their original native
promises. Pending producer flights survive fencing. Unknown replies retain
uncertainty; no retry or automatic cleanup occurs. Producer chunks are intrinsically
bounded to8KiB before copying. Returned storage keys are private logical references,
not result paths; consumers must use the captured original reader, never a normal
filesystem-key lookup. Reader leases block discard, and discard is one-use over
the same fenced original owner. This local capability is not a cleanup grant:
the qualifying coordinator still owns application authority, actual global
reservations, SDK/controller/worker/Job barriers and capacity reconciliation.

The bridge has no loader, public export barrel or default host wiring. Frozen
bindings and opaque-looking objects do not attest native provenance; trusted
installation binding and actual host execution remain mandatory. Its inert ABI
tests supply logical adapter evidence only, independently of the completed small
native component fixture. No physical fixture attempt is repeated by those tests.

The original owner's private `inspectFinalizedFiles` additionally returns copied,
frozen role/name/media/size/hash metadata and logical references once every file
was acknowledged, publication is fenced and current native inspection confirms
the exact prepared file count without pending IO, readers or uncertainty. It
never exposes the encoded Buffer, a physical path or a new capability. The facts
describe finalized files only. Receiver final delivery acknowledgement, task
completion, worker retirement, fresh application permission and candidate
review/Save remain independent prerequisites. Tests use the real output receiver
and an inert native dependency for multiple checkpoint/candidate files and a
corrupt candidate; this is logical composition, not installed-native execution.

The physical version1 format is 256-byte header, complete index with 64 bytes per row,
ordered payloads at derived 8-byte-aligned offsets, zero gaps, then 256-byte footer.
Every addition, alignment, total and allocation calculation is checked. No caller
supplies offsets. Reserved fields and padding are zero; trailing data is refused.

| Header offset | Meaning |
| --- | --- |
| 0 /8 /12 | `ASBTRC01`, version32=1, header size32=256 |
| 16 /32 | Publication16 bytes, scope digest32 bytes |
| 64 /68 | Row count32, row size32=64 |
| 72 /80 /88 /96 | Index bytes64, logical payload bytes64, footer offset64, physical length64 |
| 104 /136 | Index SHA-25632 bytes,120 zero reserved bytes |

| Row offset | Meaning |
| --- | --- |
| 0 /4 /6 /7 | Index32, group16, role8, name ordinal8 |
| 8 /16 /24 /56 | Derived offset64, length64, expected SHA-25632 bytes,8 zero bytes |

| Footer offset | Meaning |
| --- | --- |
| 0 /8 /12 | `ASBTRF01`, version32=1, footer size32=256 |
| 16 /24 /28 | Physical length64, row count32, zero32 |
| 32 /64 | Index SHA-25632 bytes, preceding-content SHA-25632 bytes |
| 96 /112 /144 | Publication16 bytes, scope32 bytes,112 zero bytes |

The footer hash excludes the footer itself. There is no arbitrary archive reader,
historical reopen or extraction API. Existing raw model directories are unchanged.

## Original Capability and Accounting

The final owner/World/OWNER_RIGHTS DACL and protected controls apply at creation.
For fresh private result files, World denial0xD0157 adds FILE_READ_DATA denial to
the existing write/delete/control restrictions. The owner retains only the same
READ_CONTROL owner policy. Earlier Model/input/legacy file policies are unchanged. Actual original grant 0x13019f, exact permissions, identity, single
link, default stream, empty EOF and measured full allocation precede private
metadata writes. Secondary control and least-right READ_DATA|SYNCHRONIZE opens
must return access denied without a handle before any private header/index. No ACL transition or
weaker initial policy is used. Original non-delete-sharing ancestors pin live
names only within the declared profile; they do not establish protection after
a host crash. A real diagnostic fixture permitted a secondary path read under
the prior D0156 policy. Sharing mode alone is not confidentiality proof. Actual
original-handle reads under the tighter policy remain required qualification.

The single physical allocation includes 512 fixed bytes, 64 per row, actual zero
padding, payloads and NTFS allocation rounding. Everything except logical payload
is charged to the explicit metadata limit. Available-volume observation is checked
before creation; it is not a shared reservation. All existing global role charges
remain the application coordinator's responsibility and stay retained.

Writes are ordered and at most 8 KiB. Each row is flushed and hash-checked. Final
verification reads the actual header/index, zero gaps and every row hash, then
writes and flushes the footer. A subsequent prefix digest, exact footer and
EOF/identity/stream/allocation readback must match. Per-row completion is distinct
from a finalized container. Only a finalized container admits logical readers.

One original operation and one reader lease are permitted. Logical reads cannot
cross entry boundaries. Fencing, deadlines, GC and lost replies do not retire
pending IO or lost readers. Known cleanup uses only the same original creator
after fencing and reader/IO closure, then closes its original ancestors. It
grants no global cleanup credit and never deletes by a pathname.

## Qualification and Composition

The no-file ABI tests include invalid names/groups/roles, duplicate rows, metadata
limits and safe-integer layout overflow. Actual files require the explicit small
source/review-bound Windows profile after the source checkpoint. Earlier failures
remain recorded. No model accuracy tests are repeated for this workflow work.

Historical run `8c3de43d01e54b0f854593a32c4611c9` passed its eight declared
Windows file checks: final creation permissions, complete inventory, secondary
control/read refusals, path/stream mutation refusals, ordered writes, original
logical reads, reader lifetime and original-handle cleanup. The completed reviewed
measurement Work is `headless-native-training-result-container-file-qualification-r4`;
the supporting-work registry retains its exact receipt/review. This is evidence at
the recorded source, not current full-candidate, parent, producer or host readiness.
The earlier failed directories/containers and the restricted-run shutdown gap
remain recorded and receive no cleanup or capacity credit.

The receiver's optional preparation passes its validated frozen group/role/name
inventory before data. A private native adapter implements logical byte/owner
dispatch, but qualified native loading and actual producer/host composition still
need evidence.
Current application authority, actual shared
capacity, parent deletion/rename/ADS/injection protection, durable ownership and
post-host-exit retention, SDK/controller/Job retirement, review/Save and both hosts
still need their own evidence. A file DACL alone does not protect its parent or
prove crash custody. Fresh parent provisioning/protection is now authorized only
within the later approval above; its actual proof remains pending. No historical
ACL change, recovery or live-only fallback is authorized by this format.
Unsupported protection keeps product activation denied.
