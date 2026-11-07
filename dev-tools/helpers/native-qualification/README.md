# Fixed native qualification lifecycle

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

This helper owns newly created qualification trees on Windows x64. Its public
selftests remain model-free. The public CLI exposes `--native-selftest`; it has no caller command, PID,
working-directory, shell or JSON execution option. Private child roles are fixed.
Normal portable tests leave physical qualification explicitly skipped/pending.

Each phase uses one monotonic deadline that starts before native preparation.
Preparation must finish within that limit before the suspended command can
resume. Execution and the normal descendant exit grace use the time that remains.
A root exit observed after the deadline is a timeout. Owned cleanup still runs
with its existing confirmation checks and cleanup limits. This phase control
does not provide a whole-run watchdog or interrupt a blocked native call.

One private source-reviewed retry is available for the known first-case process
count failure only after the user authorizes it. It checks exact saved output,
active-zero accounting, closed handles, both old stop markers, reviewed source
and the original interpreter. It exclusively creates and flushes one family-wide
claim before a new suite. Every existing claim, including a partial file or broken
link, refuses another attempt. A failed write or retry does not reset that claim.
The public command keeps refusing the original stop marker. Old files and process
identities are never adopted, changed or removed.

Each retry case rechecks the approved witnesses and empty owner registries.
Fixture intents retain the approved source/interpreter hashes, and guardian
dispatch rechecks them before launch. Final success requires all nine unchanged
native assertions, unchanged proof/source, and no active or uncertain owner.
These cooperative source attestations do not prove hostile live code replacement,
power-loss durability, model outcomes, offload safety or product qualification.
Source review alone grants no physical test result.

The closed standard-library fixtures, their leaf and their guardian use the
original Python interpreter. A Windows virtual environment can start an extra
interpreter through its redirector, which changes the expected process tree.
The fixed commands require a regular original interpreter and keep isolated
flags. Fixture intents bind its bytes before launch. This test-only choice
preserves the separately reviewed model, training and OCR runtime context.
See the [CPython 3.12 redirector](https://raw.githubusercontent.com/python/cpython/v3.12.8/PC/launcher.c).

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

The current-family stop marker is checked without following it. Any entry at
`FENCED.json`, including a broken link, prevents a fresh run. An access error
also prevents a fresh run. This check does not remove or repair old markers.

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

## Closed Desktop training roles

The separate private `_reviewed_training_intent` composes only generated tiny
training-input creation, read-only dependency readiness, offline packaging and
one Desktop train/private-review/Save/reopen journey. It has no public execution
route, caller command, working-directory, environment or quota option. Installed
Node identity is a reviewed trusted-host witness, as in the earlier private
factory. Python comes from the fixed existing managed environment and its actual
base interpreter. Its config, interpreter, DLL and seven package metadata inputs
must match the declared bounded witnesses. Missing inputs deny; nothing installs.

Literal role deadlines are 120, 300, 420 and 690 seconds respectively. A separate
eight-second `training-budget` intent has an inert internal child. It is outside
`_FIXTURES` and the unchanged nine-case default selftest. Only exact issued
training intents select the existing 2 GiB per-process and 4 GiB aggregate Job
grade; count, handle inheritance, atomic assignment, guardian and retirement
controls stay unchanged. These ceilings do not reserve RAM or prove model fit.

Every consumer/source/runtime witness is checked before issuance and again
before native preparation. Reference reads are bounded and reject reparse,
identity, size, time or hash drift; they grant no supplier ownership or deletion.
Windows named and descriptor queries can report different change-time values.
Compare change time within each API, while retaining cross-API identity, size,
modification-time and content checks. The original generic factories and budgets
retain their existing checks.

Input/readiness work uses its owned phase directory. The reviewed readiness
adapter must call the real dependency ports through a read-only spawn adapter
with that directory. Package work uses a fresh source-only descendant candidate.
Its regular `node_modules` starts empty and is checked before native preparation;
Vite can then write its temporary configuration cache there and resolve unchanged
installed dependencies from ancestors. Copy the actual configs and their relative
resource helpers; using the original configs would select shared output paths.
The later reviewed consumer must bind the full candidate/resource manifest,
offline Electron ZIP, output/temp roots and expected write surfaces. No dependency
or Python runtime copy, junction, download or shared `.vite`/`out` write is needed.

Only declared generated inputs can use the exact fresh package worker directory.
Node computes a space-free relative argument to the fixed original wrapper,
verifies its absolute target and retains the legacy argument constant otherwise.
The Python wrapper independently checks the generated context and the packaged
main file against current source before importing it. UI issuance also binds the
fresh application and worker-main hashes; it selects one exact test name.

All environments are constructed from minimal Windows fields and fixed offline
settings, with owned home/temp roots and no inherited credentials. A Job is not a
network sandbox. Reviewed consumers must retain the existing no-install and
no-download paths. Source tests do not qualify a native Job, model, app, resource
outcome, retained restart or parent roadmap. Each actual stage needs a separate
current-source effect review, one-use execution evidence and exact owned cleanup.
Unknown owners/fences and historical failures remain; there is no reset or retry
authority. Completed model accuracy and OCR checks stay closed.


## Fresh tiny-input tokenizer metadata

The fixed creator normalizes the pinned serializer's known generic tokenizer
label to its actual explicit fast class only inside the slot that this invocation
just created. Normalization precedes manifest hashes. The strict input inspector
still accepts only `PreTrainedTokenizerFast`; existing and interrupted slots are
not normalized, adopted or retried. Unknown classes, `auto_map`, duplicate or
oversized JSON, linked files and detected identity/content drift deny before a
rewrite. Already-explicit bytes stay unchanged; a write failure keeps its original
exception and leaves the partial slot for review. Ordinary file checks here do
not establish Native hostile-filesystem custody.

CLI failure JSON adds a fixed source-stage and an allowlisted exception type. It
retains the unavailable status, exit 1 and no-launch/no-accuracy facts. Raw exception
messages, paths and traceback text are excluded. Success schemas, legacy model
admission, installed dependencies, Native budgets and effect-review requirements
remain unchanged. Model-free regressions cover the actual supplier-shaped label;
they do not qualify a new physical input, model, app or parent roadmap.

## Private Source-session role

The private Source issuer admits only the base interpreter with `-I -S -B`, the
fixed Source qualifier and `--native`. It checks exactly twelve reviewed source
files and the two base-runtime files. Stable bounded reads run at issuance and
again before Native preparation. No command, executable, directory, environment
or budget selector is added to the public CLI. The review hash is a cooperative
source witness; it does not establish reviewer identity or grant effect authority.

The fixed fresh phase lives under `native-source-session-host-v1/runs` in ignored
local storage. PATH uses the admitted Windows directory and base interpreter.
TEMP and TMP use the fresh phase's empty `t` directory. Ambient search paths and
credentials are not copied. The Source role uses the existing 1 GiB process,
2 GiB aggregate and 32-process limits, with a fixed 180-second execution timeout.
These are ceilings, not reservations. The inner Source lifetime remains 120 seconds
and its immediate child Job remains 512 MiB. Existing role limits stay unchanged.

The existing runner assigns the outer Job atomically from qualifier creation.
Its noninherited Job handle and kill-on-close cover driver termination; complete
root exit, Job zero, drains and handle acknowledgements still govern retirement.
Its timeout uses the live driver's polling loop. It is not an independent watchdog
for a frozen but alive driver. Source stderr is drained and discarded while its
observed byte count and overflow remain visible. The saved empty-log hash does not
prove that original stderr was empty. Bounded stdout is retained for strict parsing.

A separately reviewed one-use consumer must check one bounded Source JSON object,
the fixed namespace and fresh 32-hex `summary.json` leaf, source bindings, inner
report and original outer retirement. A printed path is data, not authority.
Ordinary portable tests execute no Native role. The actual nested Source trial,
model borrowers, staging/accounting, model-worker recovery, resources and parent
qualification remain pending. Accepted model accuracy and OCR stay closed.

The separate private issuer `_reviewed_source_map_denial_intent` admits only
`--native-shared-write-denial` in a fresh `source-shared-map-denial` phase under
the same fixed family. It uses the same reviewed twelve-source/two-runtime set,
sanitized environment,180-second timeout,1GiB process/2GiB tree/32-member ceilings
and strict original retirement. No public case, command or quota selector exists.
The inner parent owns one shared writable view of a new tiny synthetic file,
closes the writer before Source admission, then requires the attributed Read-oplock
refusal and actual child exit before view/section cleanup. Collector validation
matches its bounded hash/size to the original input manifest; it never trusts a
generic failure as the expected denial. Default `--native` remains the original
unused-Source case. Source stderr handling and the live-driver timeout limitation
remain unchanged. Portable checks never execute either physical case; separate
exact-source effect review and outcome review remain required.

### Fixed Source sharing-open case

The private `source-sharing-open-denial` intent selects only
`--native-sharing-open-denial`. The existing Source roundtrip and oplock-denial
roles keep their exact flags. A literal role-to-flag map has no fallback or
caller-supplied command, environment, case, runtime or budget selector.

This role uses the same twelve Source/entry/fixture witnesses and two Base Python
image witnesses. It retains the Standard 1 GiB process, 2 GiB Job, 32-process and
180-second outer limits. The inner Source actors retain 512 MiB, 120 seconds and
16,384 total rows, including the 64 terminal rows. Four probe rows are reserved in
that same table before the Source reader loads. The probe calls use those rows
at the mapped-weight frontier; they do not create a second pool.

Source checks qualify only this closed issuer and its fixed synthetic consumers.
Actual execution requires a separate current-source effect review and one-use
attempt. Root exit, total3/active0, nonforced retirement, complete drains and all
owned-handle acknowledgements remain necessary. A failed or uncertain attempt
grants no retry, old-input cleanup, staging credit or parent qualification.
