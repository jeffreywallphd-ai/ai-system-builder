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
cause, not an observed process identity. The corrected source uses the separate
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

Prospective ceilings are 1 GiB per-process commit, 2 GiB aggregate commit and
32 active job processes for model-free Node/esbuild/Chrome/Electron qualification.
They are finite limits, not measured requirements or model-memory policy. Readback and
peaks are recorded. Observed process/job/count limit notifications fail the
command. Windows notification delivery is not guaranteed; missing messages never
prove that no limit was hit and never supply cleanup evidence.

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
