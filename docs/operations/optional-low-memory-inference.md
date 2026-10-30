# Optional low-memory local inference

- Status: implementation in progress; installed-model qualification pending
- Decision: `docs/adr/ADR-0045-optional-bounded-model-offloading.md`
- Roadmap: `docs/optional-low-memory-inference-implementation-roadmap.md`

Dataset Preparation has an explicit `offload-v1` model memory option. Standard
remains the default, including for old saved settings. Desktop and thin client
retain the selected model, device, precision and memory mode. A saved unsupported
mode reports an error; it cannot silently become Standard or choose another model.
Status reads never install, download or load a model. The application rechecks the
exact `dataset-preparation.offload-v1` capability before staging or starting work.
The UI refreshes capability information every five seconds and rejects stale
capacity snapshots. An old worker cannot silently ignore the new setting.

## Supported initial profile

Choose CPU or CUDA and an explicit float32, float16 or bfloat16 precision. The
initial implementation supports inspected native Qwen2/Qwen2.5 causal models;
chat uses the inspected Qwen2.5 text template shared by the two approved model
acquisitions. Unknown templates, tokenizer classes/path selectors, architectures,
rotary extensions, quantization, LoRA and seq2seq offload fail explicitly.
Standard behavior for these combinations remains available. Context embeddings,
training and conversation do not implicitly adopt this Dataset Preparation option.

The versioned capability requires the inspected Transformers4.51.3,
Accelerate1.14.0, Torch2.6.0 CPU/CUDA build and safetensors0.5.2 path. No new
dependencies are installed. Other versions need separate support and qualification;
they cannot obtain this capability through a permissive fallback.

Weight placement is limited to1GiB CPU and2GiB CUDA. There is one exclusive
offload-cache slot and at most12GiB of owned staging. These are **not** total
process-memory limits. Admission additionally reserves source-width and converted
loading tensors, the largest execution layer, bounded prefill scratch, KV/cache
transients, source-width disk-read conversion on the execution device, and runtime
headroom. Unknown RAM/VRAM/disk observations or insufficient
capacity deny the profile. It never grants the standard overflow allowance.
If available headroom falls after loading, the unchanged forward guard reports
insufficient resources through the existing task error, rather than a generic
inference/format failure. Bounded numeric observations record that denial; no
prompt, model output or path is logged, and an unstarted forward is not poisoned.
Disk streaming may be slower, even when it enables a model that cannot load whole.

Each call uses batch1, at most2048 complete templated input tokens and512 new
tokens. Oversized tokenization uses a single overflow sentinel and fails; no
truncated prompt can return a successful generation. Repair calls obey the same
bounds. Beam/assisted/DoLa expansion, disabled KV caching, static caches and
retained hidden-state/attention/logit output are outside this profile. Pinned
generation already keeps last-token logits; the option does not change decoding,
precision, task/schema validation or the useful-output oracle.

## Loading and ownership

The adapter first validates bounded native configuration, exact safe-weight
shapes/offsets, shard/index coverage, tokenizer inputs and source digests. It
rejects PEFT adapter configuration/weight families case-insensitively before any
supplier load. Native model classes still discover those files when PEFT is
installed; merely binding them would permit an unsupported base-path redirect.
Directory-name and byte rechecks also reject an adapter inserted after admission.
Planning uses a tied meta-model with intact Qwen2 decoder layers and bounded
nonpersistent rotary buffers. Independent map validation checks complete parameter
coverage, tied placement, residency limits and rejects all-disk or unknown maps.
If current RAM permits fewer resident CPU weights, the planner moves complete
connected CPU placements to disk, preserving tied/no-split groups. It reserves
the same loading/execution costs first and validates the resulting map again;
it cannot change the execution device, precision, profile, reserves or ceilings.
The pinned per-load loader binds an omitted tied output-head disk-index name to
the verified canonical input-embedding safe tensor before installing dispatch
hooks. It checks exact shard, source name, precision and disk-name coverage; no
weight copy is made. Unsupported/conflicting serialized aliases deny opt-in.
Before the first forward, the pinned dispatcher correction removes its empty
meta-pointer sentinel and retains only admitted tied-name metadata. Real tied
storage is preserved. Unknown hook topology or an already populated sentinel
denies loading. Actual parameter names, shapes and precision are checked afterward.
The pinned loader references admitted original safetensors and explicitly disables
secondary state-dict offload temporaries. It uses no remote code, pickle or network.

Private host-cache staging belongs to the cached generator, across task completion.
Request views share weights and serialized execution while retaining their own
generation settings. Current source bindings are rechecked before each forward;
rebinding a model id cannot reuse older weights. Switching profile/source/settings
that affect model identity requires unloading the existing offload model first.
An interrupted supplier forward can bypass an offload post-hook. It poisons the
cached owner for further generation; explicit idle unload must confirm release
before retrying. It cannot accumulate resident layers through automatic retries.
The adapter never deletes original model inputs or another owner's staging.

Unloading fences new task admission and rejects queued/running tasks. It drops
decoder/model references and collects cycles, without detach hooks, `.to`, `.cpu`
or full-model reconstruction. Live weak references or uncertain deletion retain
the slot. Cleanup records each confirmed removal so retry cannot adopt a recreated
file. An ambient/stale slot is never adopted or recursively removed. Verified
owner recovery after process failure remains a distinct native operation.

Queued dataset work remains cancellable. Running Dataset Preparation is currently
not force-cancellable: a request or timeout cannot declare it finished or stop the
shared worker. Wait for observed completion before retry or unload. The desktop
unload action remains available for a supported idle runtime to retry cleanup.

## Evidence and limits

The separate [owned Windows worker fixture](../../dev-tools/scripts/native-owned-job/README.md)
tests a fixed harmless worker and supervisor loss without starting a model or
accessing retained staging. It is uncomposed qualification support. Actual file
protection, protected accounting and protection lifetime across a crash remain
pending agent work; a worker-exit test cannot supply those guarantees.

Focused contract, application, model-input, resource, map, supplier-call,
partial-load, reference-release, cleanup-retry and UI tests exercise local controls.
Empty-model diagnostics admit CPU/CUDA maps for both approved models. These
diagnostics load no generation weights and do not qualify task quality or peak RAM.

A bounded native mechanical trial on2026-10-22 loaded the pinned1.5B bfloat16
model on CPU, generated one nonempty non-heldout response and confirmed unload,
native exit zero and zero remaining staging bytes. Load/generation/cleanup took
13.95/5.68/0.21seconds;5ms whole-child sampling observed1.55GB peak RSS. The
frozen source was
`source.720e60c177ce1aa98089265c918f69068b9f6f76a738652c8b4131e499ae33e2`.
Earlier safe resource denials and failed forwards remain preserved under ignored
`offload-load-diagnostic` reports. A tiny actual tied-Qwen regression reproduces
the pinned dispatch failure without its correction, then matches reference logits
on repeated corrected CPU/disk forwards. Neither trial is heldout quality or
full resource qualification; the4GiB abort remains sampled, not a hard quota.

The current roadmap separates completed model quality from actual optional
execution and resource/lifecycle qualification. Completed output uses the approved
30% small-model/80% larger-model floors in
`model-software-quality-qualification.json`; admission denials have no accuracy
outcome. Reuse those verified results without another accuracy run. Keep model,
precision, source and CPU/CUDA/constrained/unchecked observations distinct.
The original 24-case/three-repetition, 23-of-24 and no-lost-baseline comparisons
remain historical protocols; their failures are preserved. Actual optional
1.5B low-memory CPU delivery, owned cleanup and native staging protection still
need their own evidence; completed Standard quality is not an offload pass.
The retained optional measurement harness
uses a4GiB sampled child-RSS abort budget and existing deadlines; sampling is not
an allocation guarantee. Historical6GiB trials and failed quality/performance
results remain intact. No new optional result retroactively passes Standard or
Context qualification. Native reparse/ACL races and untested hardware remain
separately pending; cooperative path checks and component tests do not prove them.

A later0.5B trial on source9ee72939 was withdrawn during qualification. Its
completed Standard CPU first/warm phases scored12/24; CUDA unchecked pairs
scored9/24 in both modes with no baseline-correct cases lost. These results are
limited assistance evidence, not an automatic-use quality pass. The CPU offload
attempts failed unchanged forward guards (for example2,519,232,512bytes available
against2,925,661,184bytes required); most later Standard CPU loads were denied.
The declared0.5Bfloat32 and1.5Bbfloat16 profiles have different weight and
execution costs; parameter count alone does not establish memory suitability.
No precision or guard was changed to turn these failures into passes.

That withdrawn runner also reported`cleanup_passed:false` with8,519,680bytes
still allocated in both CUDA arms. A separate model-free process reproduced that
exact allocation after its first fixed16x16float32 matrix multiply, with a stable
20,971,520byte reservation after a second multiply. Its zero-allocation-only
initialization had reported a zero floor. The diagnostic confirmed native exit0,
stable source/operator and no model load. It is retained under ignored
`.local-codex/cuda-runtime-floor/e787589885b742db88cb458a8a3a1e76/`.
This identifies common runtime initialization, not a model-quality pass or a
guarantee about cold-process allocator fragmentation. The original failed reports
remain unchanged. The separate production unload fix drops its last loop-local
Standard generator before collection and allocator release; uncertainty in an
offload close still retains ownership.

## Retained original qualification protocol

The original runner used the isolated Python runtime and approved acquisition
manifest: `python dev-tools/scripts/qualification/run_optional_generation_qualification.py
--model-manifest <repository-relative-acquisition.json>`. This documents the
historical protocol, not a current instruction to rerun closed accuracy checks.
No model acquisition is performed by this command. It verifies the pinned
safe weights and retains separate Standard/offload results for CPU/CUDA,
unchecked/constrained decoding, three fresh processes and first/warm phases.
Keep the source unchanged across both model runs. The original generation runner
and historical gates remain separate and unchanged.

Each new child binds the same bounded protocol bytes to its hash before parsing,
checks the actual schema/settings/device/profile and preserves raw synthetic
outcomes. Start, load, first, warm and cleanup phases retain RSS observations;
the parent samples the whole child at5ms and aborts above4GiB. Private commit is
not sampled. Native process exit, zero owned staging, reference release and
allocated/reserved VRAM cleanup must all be confirmed. Observation failures do
not skip unload. An uncertain native exit prevents launching another cohort.
The revised prospective protocol initializes the same fixed CUDA matrix multiply
as the original runner before observing common-runtime allocated/reserved floors.
Whole-delivery time still includes that initialization. Reports retain the actual
floors, whether they were observed, and staging-observation error count; the
comparison independently checks these values rather than trust a cleanup flag.
It still requires post-unload usage at or below both observed floors. No private
workspace clearing, production warmup or higher cleanup allowance is introduced.
Library/driver state may persist in a live runtime; confirmed owned process exit
remains distinct from model unload and releases that process's context.
Results stay under ignored `.local-codex/optional-generation/`. This section
describes the retained original measurement protocol, not an instruction to rerun
closed accuracy checks. Actual required offload/resource/lifecycle evidence that
has not executed remains pending independently of completed model quality.
The parent checks source/operator identity before launch and again before
interpreting any returned result; drift stops scheduling even when a child
denied before producing a complete semantic result.

The focused host journey uses the existing visual-composer Playwright config
with `low-memory.e2e.spec.ts` and the fixed `dataset-profile` worker scenario.
Its disposable hosts retain normal authentication, staging, approval and storage.
The thin-client setup uses the existing write-authorized upload route because
the newer ingestion-task API is deliberately denied pending separate security
work. It does not admit that API or start workers through passive status reads.
Host fixtures produce synthetic rows and establish plumbing only; the pinned
model runner establishes actual generation/resource evidence.
Desktop generation fields retain explicit accessible names alongside glossary
help buttons, so keyboard/screen-reader and automated role-based access address
the actual setting rather than the nested help control.
Both host fixtures seed sources through the existing authorized upload use case
(HTTP or trusted IPC), then exercise the actual preparation/review/save UI.
The desktop Add data path instead uses resumable ingestion. Native testing found
its finalized explicit-key artifacts lack the storage bindings required by
Dataset Preparation; those sources fail closed before runtime execution. That
separate unresolved ingestion finding is not qualified by the upload-seeded
optional-model journey. Do not adopt missing bindings at read time or infer
native publication/recovery safety from either fixture.

## Current prospective-v2 qualification limits

The frozen `source.d7d6026c2799f4583f2789cdd307431ec3e5222fdb9521fb40f1c04f694ef25c`
candidate passed both synthetic host journeys and the focused unload/floor
regressions. Its actual model matrices did **not** qualify. The 1.5B report
`09fa0732c3504a60b9de83fd47aefb0e` retains three Standard CPU load denials and
three optional unchecked CPU forward-resource failures. Those completed attempts
confirmed native exit zero and cleanup, but supplied no complete useful delivery.
The first optional constrained CPU child ended with a supervisor `RuntimeError`
at the fixed 20-minute boundary. Its last retained report contains 16 first-phase
cases, 14 correct, no warm phase and no completed cleanup observation. The timing
supports a deadline diagnosis; the failed parent result does not retain a typed
deadline reason or qualify successful cleanup.

That timeout retained an offload lease. The next child rejected existing staging
before its ready handshake, so the parent stopped with
`aborted-unconfirmed-child-exit`. A subsequent 0.5B attempt
`5fac0890837746a1bae80d6bf6bbfae8` stopped at the same preflight before measuring
any cohort. These acquisition directories share their parent offload cache;
different model directories do not isolate that staging root. Read-only native
inventory later found no matching qualification process or recorded launcher.
Process absence does not retroactively establish native exit zero or successful
pre-exit model cleanup.

Both raw reports, old failures and retained staging remain under ignored local
qualification storage. Do not delete an owner marker, adopt uncertain staging,
weaken admission or shorten the test population to continue. Remaining model,
decoder and repetition profiles are pending. Qualification needs a separately
verified isolation/recovery path and successful complete delivery under the
unchanged prospective criteria. Passing synthetic UI or component tests cannot
replace it; neither related roadmap is complete.

## Prospective native supervision correction

New optional runs declare `early-native-identity-v1`. The child sends its native
identity and waits for observer acknowledgement before plan, model or staging
preflight. The later measurement-ready message must identify that same worker.
The real child command dispatch also reaches identity acknowledgement before
run-ID, output-directory or plan admission; direct function tests alone cannot
establish that entry-point ordering. Invalid interpreter/import/command syntax
before dispatch still retains unknown native observation and the launch fence.
Both startup phases share the existing60-second bound; execution retains the
1200-second deadline,4GiB sampled RSS ceiling and bounded output/reader handling.
The native observer covers startup plus execution and shutdown. Existing Context
callers retain their default single ready/run protocol.

Confirmed failures now retain finite supervisor reasons and actual launcher/native
exit, reader shutdown and termination-request observations in private reports,
while preserving the original workload exception type. Startup/deadline, RSS,
output and protocol failures remain failures. Diagnostic-write failure retains
known exit facts; unknown exit/reader/stream shutdown retains the serial launch
fence. A requested or forced termination always leaves model cleanup unobserved
unless the model report separately establishes it. Exception text, commands,
environment and raw payloads are not included in the supervisor metadata.

Model-free regression fixtures exercise actual Windows preflight exit23 followed
by successful owned execution, changed second identity and output-overflow
termination. Injected tests cover the combined startup deadline, execution/RSS
limits, diagnostic failure, parent serialization and unknown cleanup fencing.
These controls supply no model-quality, staging-recovery or historical cleanup
pass. The prior failed reports and unknown retained owner remain unchanged.

## Guarded restart gate and current limit

The user approved a guarded qualification restart: preserve/protect the retained
temporary data, count it within the existing 12 GiB total, and admit at most one
fresh lease only after real protection and capacity proof. Current readiness is
available without reading that slot or loading a model:

```text
python -B dev-tools/scripts/qualification/offload_guarded_restart.py --plan
```

The diagnostic prints `pending-native-protection`, `admitted: false` and
`qualification_complete: false`. A successful `--plan` exit means only that the
diagnostic was generated. Without `--plan`, exit 3 means actual restart is pending.
No root, quota, proof-ticket or permission override is accepted. The optional
comparison's existing plan includes the same `guarded_restart` result.

Unknown retained data is charged the full ceiling; this is a conservative budget
reservation, not a measurement claiming the folder uses 12 GiB. The pure immutable
ledger tests bounded counters, the exact total, one fresh reservation, expected
generations, retained uncertain charges and malformed/replayed snapshots. Its
`arithmetic-only` JSON is not a capability, filesystem journal, native observation
or release certificate. There is no release/adopt/reset API, and the real gate
does not consume caller-supplied ledger data as authority. This preserves the
existing staging metric; it does not claim a kernel storage or process quota.

The native read-only identity fixture also demonstrates its limitation: new child
bytes can be created while the directory lease is held and identity revalidation
can still succeed. Directory R/RH oplocks likewise notify about content changes
without blocking them, according to
[Microsoft's oplock documentation](https://learn.microsoft.com/en-us/windows/win32/api/winioctl/ni-winioctl-fsctl_request_oplock).
Identity handles, owner/DACL observations and notification callbacks therefore
cannot be promoted into a stable tree/security fence.

Actual guarded restart remains unimplemented pending a qualified protection
provider, protected durable accounting, owned-worker exit-before-release and
guardian-crash guarantees. The current component never inspects, changes ACLs,
moves, copies, adopts or deletes the retained slot. The original failures and
unknown historical exit/cleanup remain intact. The full CPU/CUDA model matrices
and parent roadmap closure remain pending; passing gate/accounting tests is
separate component evidence. Standard-only work remains independently possible.

## Model-free worker lifetime qualification

The closed fixture helper checks new Windows workers without loading models:

```text
python -B dev-tools/helpers/control_plane/qualification_job.py --self-test
```

It creates an unnamed job with a noninheritable handle, kill-on-close, at most
two fixture processes and 256/512 MiB per-process/total committed-memory limits.
`PROC_THREAD_ATTRIBUTE_JOB_LIST` assigns the fixed suspended worker during
creation. Membership is checked before resume. Native job membership identifies
the ordinary descendant; only read/query process handles pass to the supervisor.
The supervisor duplicates from its exact retained guardian process handle into
itself, tracking every local handle before validation. It never reopens a parent
PID or allocates a handle in another process. Failed thread closure retains the
exact handle for retry. Successful shutdown requires the exact member count and
integer exit code zero; fixed natural expiry and errors use nonzero codes. A real
short-expiry negative control must fail that same positive shutdown predicate.
Normal shutdown and guardian termination, including before resume, require
observed exit through those exact handles. Unknown exit remains a failure.
No caller command, PID, directory, staging or quota override is accepted.

Output is `evidence-collected-review-required`, with real restart and parent
qualification false. This fixture does not protect retained files, supply a
protected journal, integrate the actual model worker or measure offload delivery.
The full unknown retained charge and actual restart denial remain. Accepted model
accuracy stays closed. This is not isolation against a malicious same-user
process that can obtain additional handles.

Creation-time assignment closes the suspended-before-assignment crash window
described in [Microsoft's process job example](https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812/).
See also [job-list process attributes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)
and [native job limits](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information).


## Reviewed feature support: 2026-10-30

The read-only restart check and its pure budget calculations are committed with
focused passing checks and a separate review. Unknown retained usage still
reserves the full 12 GiB ceiling. The check cannot protect retained files or
grant another model run.

The shared exit observer now accepts only the nine exact existing qualification
windows through its private PID-only Python API. Root-bound shutdown and the CLI
retain 30 seconds. This fixes a setup mismatch without changing work deadlines
or resource limits. The observer's 25 focused tests passed. Nine Windows
file-identity cases passed on the earlier narrow candidate; independent review
confirmed that the later extra wait does not change their tested branch.

File identity still permits new child files. Native file protection, protected
accounting, owned-worker recovery and actual optional offload remain pending.
Accepted Standard model accuracy stays closed. Full combined testing is deferred
until the open roadmaps' feature work is complete. No user action is needed for
the remaining agent-owned implementation.


## Directory protection primitive diagnostic

No user action is needed for this agent-owned implementation. The bounded
`probe_windows_staging_protection.py` diagnostic tests one prerequisite for the
approved guarded restart. Its default and `--plan` modes make no native changes.
An explicit `--self-test` uses four new synthetic empty NTFS directories under
`artifacts/tmp`. It never opens retained offload content or accepts a caller path.

The controls distinguish directory notifications, write denial by permissions,
and a permission change through a handle opened before the protection. A fourth
case tests refusal of a folder writer opened before protection. The combined
case tests whether a directory RH oplock delays a security change until the guard is
released. This is a hypothesis to measure on the installed filesystem.
[Microsoft describes directory content breaks as advisory](https://learn.microsoft.com/en-us/windows/win32/api/winioctl/ni-winioctl-fsctl_request_oplock).
The [object-store oplock model](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fsa/306239fb-cb60-49fe-b293-df4d1a5f757a)
is research input, not proof of this local NTFS behavior.

The diagnostic saves and restores the original DACL and its control bits. It uses
[single-object NtSetSecurityObject](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntsetsecurityobject)
on each held fixture. It does not use SetSecurityInfo, which propagates inherited
entries to child objects. The guard must be unbroken before dispatch. Its native
break frame, RH-to-R transition and required acknowledgment must then be verified.
A prebroken or canceled guard cannot establish a security barrier. A
non-inheriting deny entry affects only each newly created empty fixture; owner
recovery rights are retained. No owner, audit policy, service, driver, account or
privilege is changed. Native creation must report a new object. Cleanup uses
only created handles and never recursively removes unknown children. Unconfirmed
thread/IO completion or changed restoration prevents cleanup and stops the run.
Output contains only fixed phases, numeric native codes and synthetic IDs.
The pure unit profile runs no native test, model, provider or worker.

Even if all three observations succeed, full-tree and existing-file/mapping
protection, protected durable accounting, owned-worker exit and guardian-crash
lifetime remain separate work. A failed observation remains failed. The report
requests evidence review and always reports restart and parent qualification
as false. The real restart guard and full 12 GiB unknown charge remain unchanged.
Accepted model accuracy stays closed. Full software testing is deferred.

The diagnostic runs in its own short-lived command process. A fixed 30-second
watchdog starts before native effects. Each report is limited to 8 KiB, with a
5-second publication deadline. Normal publication requires native IO, mutation
threads and the watchdog to be retired first. Native buffers are retained before
issuing operations. Unconfirmed native lifetime produces failed evidence and
exits only this diagnostic process without Python object finalization. It never
terminates another PID. Interrupted fixtures may remain protected; no later
invocation adopts or removes them. These controls are diagnostic safety, not the
missing production worker/crash or protected-journal qualification.

The directory request uses the Windows SDK read and handle cache flags (RH).
The native validator checks those same flags. An untouched fixture is checked
without an unnecessary permission rewrite. A possible update is marked before
issue, including interrupted calls. Protection and restoration compare actual
readback. A mismatch reports only ACL equality and bounded expected/current
DACL control integers, never ACL bytes, hashes or SIDs. Primary failures remain
separate from cleanup failures. Earlier failed fixtures are not reused or
removed by a later invocation.

### Controlled new-folder profile

The prospective `fresh-protected-current-user-v1` profile supplies an explicit,
protected, non-inheriting DACL during exclusive creation. The only allow entry
is for the current process user's SID, obtained through a bounded read-only
query of its own token. The SID is kept in memory and filesystem permissions;
it is never logged or written to evidence. The entry grants file operations and
permission recovery, with no write-owner grant or privilege enablement.

Creation must read back the exact intended ACL and protected control value
before any test action. An unexpected baseline is rejected and is not normalized
for a pass. This profile does not qualify arbitrary inherited ACLs. Earlier
inherited-baseline failures, including the lost auto-inherited flag with unchanged
ACL entries, remain failed. The diagnostic explicitly denies auto-inherit
requests because the documented operation can propagate to existing children.
No retained folder is converted to this profile.

A failed lock-frame check records only version, length, original/new levels,
flags, transferred bytes and native status. It records no access/share payload.
The advisory control requires completed child creation separately from a genuine
RH-to-None break. The returned frame may request cache acknowledgment even though
the content operation already proceeded. The security-change control remains
stricter: a fresh RH guard, validated RH-to-R break and required acknowledgment,
a waiting mutation thread, confirmed release/completion and exact restoration.
A new private baseline does not turn a failed inherited round trip into a pass.


## File and mapping protection checks

No user action is needed. The agent uses a fixed companion diagnostic to test
whether open writers or memory maps can bypass the proposed protection. Each
case creates a new private directory and regular file with 4096 synthetic bytes.
It never opens retained model files. Default and `--plan` make no native changes.

The explicit `--self-test` must observe refusal while an existing writable file
handle, writable section or writable view remains open. A separate positive
case checks read-only mapping access, refusal of a new writer, and a waiting
permission change through a preopened handle. The test validates the actual
Read-Handle oplock frame and thread exit; a prebroken guard or a change that
finishes before release cannot pass the barrier check.
[Microsoft lists the writable-section grant restriction](https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/granting-oplocks).
[Creating a writable section can cause a break](https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/fs-filter-acquire-for-section-synchronization2),
so this fixed test combines file sharing with the native grant check.

The code retains anonymous nonexecutable mappings until confirmed release. It
requires exact identities, file shape and original permission restoration. An
unknown map, thread, IO or cleanup lifetime stops further cases. The standalone
process retains the directory diagnostic's fixed deadlines and redacted output.

These observations apply only to new private unnamed-stream files. Existing
and inherited files, full trees, alternate streams, protected durable accounting
and owned-worker crash/restart proof remain separate work. Even a passing run
does not admit real offload or close a parent criterion. The existing guard and
full 12 GiB charge for unknown retained usage stay in force. Accepted model
accuracy stays closed. Full software testing remains deferred.

Rejected or unsuccessful native requests have no measured transfer count. Their
`transferred_bytes` field is `null`. A successful completed-result query records
its actual count. This reporting distinction does not change admission or the
required status, frame, acknowledgment and lifetime checks.


## Stream metadata and preopened folder writers

No user action is needed. The agent must test these boundaries before composing
a protection provider for a complete model folder.

- A folder handle opened for writing before protection must prevent admission.
- A file with a named data stream must be refused. The test creates only one
  fixed synthetic stream on a new private seed held against replacement.
- Native stream metadata must have valid bounded lengths, offsets and sizes.
  Unknown names or sizes must prevent cleanup. The code never reads payloads
  or includes stream names in reports.
- Exact permissions, file shape, stream facts and a fresh guard must be checked
  after the grant. A failed check must not close a handle with a live request.

[Windows maintains sharing modes and oplocks per stream](https://learn.microsoft.com/en-us/windows/win32/fileio/file-streams).
The bounded parser uses the
[FILE_STREAM_INFO layout](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_stream_info)
and [GetFileInformationByHandleEx](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getfileinformationbyhandleex).
The new synthetic stream is at most 4096 bytes; its fixture has at most 8192
data bytes. New directory and file controls do not inspect retained content.

A refusal control does not qualify support for arbitrary named streams. Full
existing or inherited trees, durable accounting and owned-worker crash/restart
composition remain separate work. Actual offload and parent qualification stay
pending. Accepted model accuracy stays closed and full software testing is deferred.

An interruption during guard construction leaves ownership uncertain until the
request is assigned or a completed refusal is proven. Unknown construction
stops native cleanup and keeps references alive until this test process exits.
A saved alias of an assigned guard handle must not be closed a second time.


## Owned-worker launch and exit controls

No user action is needed. The agent uses a separate fixed inert-worker
diagnostic to test the Windows job ownership needed for safe restart. It loads
no models, starts no app worker and changes no model memory guard. The default
and `--plan` modes have no native effects.

An explicit `--self-test` creates a new anonymous job and one small isolated
Python worker per case. It must read back the one-process and 512 MiB commit
ceilings, atomic membership and actual native exit. The worker inherits only
two unnamed events. The job handle is not inherited. The stop-event case must
exit with its fixed code. The last-job-handle case must observe actual exit
after the close. Its own success, timeout and error codes cannot qualify this
case. The fallback timeout is outside the diagnostic watchdog window. The
ceiling is not allocated up front.

[Windows job objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
provide the ownership mechanism.
[Startup attributes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)
place the new suspended worker in its job before execution.
[Process termination is asynchronous](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-terminateprocess),
so the helper must confirm the process handle is signalled; a stop request is
not completion. Failure cleanup has no arbitrary PID or command interface.

These are cooperative inert-process controls. They do not establish actual
guardian-process crash behavior, file-guard lifetime ordering, protected durable
accounting or real model loading and delivery. The app's shared worker and all
old retained data stay outside this diagnostic. The full 12 GiB unknown charge
and real restart denial remain in place. Accepted model accuracy stays closed.
Full software testing remains deferred.

Failed process-count checks keep the observed total, active and limit-terminated
counts for each fixed phase. These numeric diagnostics do not relax the one-worker
requirement or qualify an unconfirmed shutdown or cleanup.

The fixed event-only worker uses `DETACHED_PROCESS`. It does not inherit or
allocate a console. There is no hidden-console or larger-process-limit fallback.
The memory, ownership, native-exit and cleanup requirements remain the same.


## Bounded folder metadata inventory

No user action is needed. The agent is testing a small newly created folder
before using this mechanism for larger tree accounting. The default and
`--plan` modes have no native effects. Explicit `--self-test` creates a fresh
4096-byte file and, for the refusal case, a second empty file. It reads only
metadata and never opens retained model files.

The helper requires two complete equal listings with root and file guards
still active. It checks native identities and known file sizes. An additional
entry must refuse the one-file expected inventory. Uncertain entries or native
lifetimes prevent cleanup and completion. Only acknowledged new objects with
matching identities and known streams can be removed. The parent guard must
retire before child cleanup to avoid a self-deadlock.

[The Windows directory metadata structure](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_extd_dir_info)
uses variable records with 128-bit IDs.
[The file information API](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getfileinformationbyhandleex)
provides classes 20 and 19 for restarting and continuing this listing. A record
that ends a page does not prove that the complete listing has ended.

Logical data size and native allocation metadata are separate observations.
They do not measure all physical filesystem storage or grant a quota lease.
Recursive existing/inherited tree protection, protected saved accounting,
guardian crash ordering and actual offload remain pending. The unknown retained
usage still consumes the full 12 GiB budget. Accepted accuracy stays closed;
full software testing remains deferred.


## Nested-folder guard composition

No user action is needed. The agent is testing how the existing guards work
together across two small newly created folders. Three files contain a total
of 4096 data bytes. Two empty files have the same name under different parents.
The default and `--plan` modes have no native effects.

The helper requires two complete equal listings while all folder and file
guards remain active. It checks native identities under the correct parent.
A deliberately wrong parent-specific identity must be refused by the metadata
comparison. No unexpected entry is opened or followed. Native IDs and names
stay internal; reports contain bounded scalar results.

The nested folder borrows its parent handle. It must not close that handle.
Cleanup releases all relevant guards before removing known children, then
confirms the parent is still available before its own cleanup. Unknown native
close results, constructor returns, guard states or metadata stop cleanup and
retain ownership. No recursive path deletion or old-data adoption is allowed.

This is a fixed two-level test, not a general recursive protection provider.
Existing/inherited trees, protected saved accounting, actual guardian crash
ordering and real low-memory loading still require implementation or evidence.
The full unknown 12 GiB charge and stronger application denials remain intact.
Accepted model accuracy stays closed; full software testing remains deferred.

The first Windows attempt failed because a guard changed. Its test files stay
untouched. Fixed role and step facts now help identify where a later attempt
fails. A failed test never becomes a completed check through this reporting.


## Safe handling of a failed file-handle close

No user action is needed. The agent is fixing a shared test helper. If closing a
known file handle fails or is interrupted, the helper must keep its ownership
record and stop. It must not retry that handle or remove the test files.

Focused tests cover failure, interruption, denied retries, confirmed success and
normal repeated cleanup. They use synthetic native replies. No operating-system
failure is forced, and no old or failed test folder is inspected or changed.

This closes only a helper failure path. Complete folder protection, saved disk
accounting, worker recovery and actual low-memory loading still need work.
Accepted model accuracy stays closed; full software testing remains deferred.


## Guarded lifecycle consumer and resource-only entry

The private guarded context reaches the actual generator factory/cache/forward,
pinned loader and `OwnedOffloadLease`. An explicit guarded request needs its exact
live host-owned context before model or cache-path inspection. Missing or
serialized context cannot fall back to ordinary mode. Ordinary empty-root leases
and Standard loading retain their existing behavior. A second owner cannot reuse
the first owner's cache or start another fresh lease through that context.

The parent owner is retained before readiness/reserve/create callbacks. The
native backend must acknowledge protected reservation before supplier writes and
native sealing before reuse. Supplier interruption or unknown callback results
retain custody and deny another attempt. Worker cleanup signals reference release
once; it does not prove process exit, delete guarded files or free the charge.
Only the separate parent view may confirm native retirement. Unconfirmed exit,
readers/IRPs, closes or accounting keep cleanup pending.

No production backend is composed. Agent work still includes the protected native
tree/journal/process provider and actual resource/lifecycle qualification. The
fixed command below identifies the separate model-quality record and prints
pending native readiness. It opens no old staging, starts no worker/model and scores no output:

```text
python -B dev-tools/scripts/qualification/run_offload_resource_qualification.py --plan
```

Without `--plan`, it reports the same pending state and exits3. A successful plan
exit is not a test pass or execution authority. There is no root, quota, PID,
model, force or native-proof option. The four-file model-free lifecycle profile
uses synthetic new-domain ports and preserves actual native/model gaps. Accepted
accuracy remains closed; original protocols and failed evidence remain history.
