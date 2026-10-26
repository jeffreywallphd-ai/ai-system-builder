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

Standard fixtures and dataset-profile commands retain a 1 GiB process commit
ceiling. Their fixture/package jobs retain a 2 GiB aggregate ceiling and their
combined UI job retains a 3 GiB ceiling. The approved fixed OCR profile uses
2 GiB per process and 4 GiB per job. Only an issued immutable `ocr-documents`
host intent, `ocr-runtime-import-v2` diagnostic or `ocr-budget` fixture selects
that profile. All jobs retain the 32-process ceiling. No caller quota,
environment override or public budget option exists.
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

A separately reviewed ignored consumer may compose the private fixed host
forms: hash-bound offline Forge adapter, exact two-spec ingestion UI, or one
exact web-only or desktop-only UI project.
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

The same two fixed private command forms permit exact `ocr-documents` for real
deployed Windows OCR with bounded synthetic generation. They use the approved
2 GiB process and 4 GiB job profile. No caller quota, new CLI, argv, process
cleanup or old-run recovery route exists. Unknown scenario strings are refused.
The changed launcher needs current reviewed evidence before a real OCR host run.
Model accuracy remains separate from synthetic generation and native/host delivery.

The new `native-ocr-budget-command-selftests-v4` family runs nine closed cases:
the earlier eight mechanics and Standard budget checks, plus actual OCR-profile
readback. It refuses a fence in the previous v3 family. Readback sets limits; it
does not allocate the ceiling or prove that Torch or either app fits.

The separate `ocr-runtime-import-v2` diagnostic directly starts the hash-pinned
base interpreter with `-I -B`, the fixed venv launcher context and the approved
2 GiB/4 GiB limits. `-S` is excluded because Python 3.12 needs site activation
for this environment. Before importing Torch, its bounded first fact checks
the exact venv executable/prefix, base executable/prefix, isolation flags and
installed guidance-distribution context. Facts contain booleans, not paths.
The consumer must match each fact's PID to the retained created root. A parent
match or an advisory process number cannot replace that check.

This v2 role retains the 20-second deadline, 32-process ceiling, raw-stream
discard and byte-overflow controls. Its three exclusive, synced facts are each
at most 1,024 bytes. Runtime identity, import, query and native retirement must
all pass. The original v1 probe and failed app runs remain unchanged. The v2
factory refuses `runs/FENCED.json` in either diagnostic family and also refuses
a parent-level fence. A fresh source review, native
qualification and separate one-use calibration are required; no startup, host,
model or parent pass follows from the approved budget alone.

The additional private `ui-thin` and `ui-desktop` forms select only
`--project=thin-chrome` or `--project=packaged-desktop`. Original package and
combined `ui` argv remain unchanged. Each role requires its own exact fresh phase
directory and the same reviewed four-helper, source, executable and environment
witnesses. Unknown roles and injected project names fail before identity reads
or directory work. No public selector or caller command is added.

Both single-host forms retain the existing per-job UI policy: Standard 1 GiB per
process and 3 GiB per job, or the already approved OCR 2 GiB/4 GiB profile; 32
members and 420 seconds remain fixed. The active/pending-owner guard still
refuses a successor until exact native retirement and handle closure are proven.
Selecting one project does not prove that its reviewed setup starts only that
app. A separately reviewed serial consumer must supply host-specific setup,
complete retirement before the next app, a finite whole-run deadline and
separate per-host observations. Do not reuse a combined-UI setup that starts web
services during a desktop-only phase.

`native-host-policy` runs this area's one fixed policy test file through the
control plane. Normal execution leaves its physical Windows case explicitly
skipped. Physical opt-in still requires separate source review and controlled
execution authority. These portable command, limit-selection and injected-owner
checks do not qualify new native readback, actual apps or memory savings. The
earlier 1 GiB process-limit failure remains failed; reducing overlap need not
resolve that single-process limit. Existing old-run and offload guards remain.
