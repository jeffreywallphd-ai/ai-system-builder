# Fixed native qualification lifecycle

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

This helper owns only newly created model-free qualification trees on Windows
x64. The public CLI exposes `--native-selftest`; it has no caller command, PID,
working-directory, shell or JSON execution option. Private child roles are fixed.
Normal portable tests leave physical qualification explicitly skipped/pending.

The pipe-only root, fixed leaf and guardian use `DETACHED_PROCESS`, not
`CREATE_NO_WINDOW`; this avoids requesting a console host. This flag does not
permit job breakaway. Exact one-root/two-member fixture counts remain unchanged.
An earlier stdio attempt had exact output and confirmed owned-job retirement but
two total job processes. A headless console host is a source-supported likely
cause, not an observed process identity. The detached-process correction used the
fixed `native-detached-command-selftests-v2` family. The earlier family, failed
observation and fences remain untouched; the new family grants no old-process
recovery or retrospective qualification.

The native selftests exercise real private stdout/stderr, exit23 failure,
natural-expiry97 rejection, root-plus-descendant timeout, bounded output overflow,
and actual guardian exit before resume/after a real descendant starts. Duplicated
read handles, exact identities and strict zero/count checks verify crash outcomes.
The guardian Popen handle is explicitly detached into an owned native ledger and
closed with acknowledgment. Protocol reads poll their retained pipe handle;
there is no untracked timeout reader thread. Unknown handle/read retirement is
retained in a process-global pending registry and fences new launches. Active
owners register before native preparation or guardian creation. Independent
cleanup steps retain failed stream, detach and native-close ownership; there is
no reset or retry that clears an uncertain owner. Finished owners cannot reuse
retired numeric handles through a second prepare, resume, run or finish.

Atomic JOB_LIST assignment precedes root execution; an explicit HANDLE_LIST
permits only NUL stdin and two private write handles. Job, completion-port, read,
process and thread handles do not inherit. There is no post-start assignment,
breakaway, caller PID action or unknown process open. Cleanup needs native active
count zero, root exit, final pipe drains and acknowledged closure of every owned
handle. A nonzero command remains failed even when cleanup is proven; retries
still need separate review. Unknown cleanup grants no successor.

Every process has a 1 GiB commit ceiling and every job permits at most 32 active
processes. Fixture and package jobs retain a 2 GiB aggregate commit ceiling. The
fixed combined ingestion UI role has a 3 GiB aggregate ceiling for its server,
Vite, browser and desktop topology. Only an exact issued immutable intent selects
this profile. No caller quota, environment override or public budget option exists.
These are finite limits, not reservations, measured requirements or model-memory
policy. Readback and
peaks are recorded. Observed process/job/count limit notifications fail the
command. Windows notification delivery is not guaranteed; missing messages never
prove that no limit was hit and never supply cleanup evidence.

Limit reports retain the message number and a bounded `reported_pid`, plus the
created root's number, for diagnosis. Count-limit messages and missing or invalid
process numbers use `null`. Collection keeps the existing 128-message poll and
4,096-event total bounds. These numbers can be stale or reused by Windows. They
never authorize opening, inspecting or changing a process, identify a current
process, or prove cleanup. The original limit-message failure rule is unchanged.
See the [Windows completion-port contract](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_associate_completion_port).

The private `ocr-runtime-import` diagnostic isolates installed Torch import and
its accelerator-availability query. It uses only the exact existing qualification
Python environment, a fixed script, a fresh fixed run directory and a minimal
offline environment. It has no caller executable, command, script, environment,
working-directory or quota selector, and adds no public CLI option. Its limits
are 1 GiB per process, 2 GiB per job, 32 processes and 20 seconds.

This role discards raw stdout and stderr before disk retention and before the
first-line queue. It still counts all bytes and fails on the existing 8 MiB stream
overflow, read, timeout, native-limit or retirement failure. At most three
exclusive, synced files contain bounded stage, own-process and typed result facts;
they contain no supplier exception text. Other roles retain their existing logs.
An exit code alone cannot prove import or query success: the final typed fact and
strict native retirement must agree. Missing final facts remain failed or pending.

This is a separate runtime diagnostic, with a new working directory and minimized
output and environment. It does not execute or qualify the full production
dependency preparer, identify a process from an earlier failed run, run a model or
change production admission. A limit hit is evidence of the new probe's failure,
never a reason to waive a guard or mark a host journey passed.

Two actual thin UI attempts reached the original 2 GiB job limit before the
desktop case started. A fixed 256 MiB V8 old-space budget reduced peak single
process commit but did not make that topology fit. Those failures remain failed.
The role-budget revision uses `native-ui-budget-command-selftests-v3`: the seven
existing lifecycle cases plus a closed fixed UI-budget case that reads back
exactly 3 GiB with the unchanged process/count/handle controls. The readback does
not allocate 3 GiB or prove that a UI journey fits. A fresh separately reviewed
real-host run must establish that outcome. Earlier observations and fences remain
untouched; the revision grants no old-process, offload or parent qualification.

A separately reviewed ignored consumer may compose only the two private fixed
host forms: hash-bound offline Forge adapter and exact two-spec ingestion UI.
Its candidate, installed Node digest, environment digest, four helper hashes and
review witness remain local. This is trusted-source cooperative composition,
not authority from an untrusted caller JSON file or proof of reviewer identity.
No local user path is embedded in the portable helper. The committed closed
`control_plane/qualification_job.py` fixture remains unchanged.

Run portable policy checks with Python unittest discovery for
`tests/test_owned_command_job.py`. Set `AISB_RUN_FIXED_NATIVE_QUALIFICATION=1`
only after independent source review and controlled Windows execution authority
when collecting the physical cases. No model, provider, retained stage, old
unknown child, native filesystem/offload lease or parent-roadmap pass is implied.
See [control-plane operations](../../../docs/diagnostics/ai-development-control-plane.md)
and its [threat model](../../../docs/security/ai-development-control-plane-threat-model.md).

The same two fixed private command forms now permit exact `ocr-documents` for
real deployed Windows OCR with bounded synthetic generation. No new CLI, argv,
quota, process cleanup or old-run recovery route exists. Unknown scenario strings
are refused. Both the new scenario composition and changed launcher source need
current reviewed evidence before a real OCR host run. OCR model accuracy remains
separate from synthetic generation and native/host delivery.
