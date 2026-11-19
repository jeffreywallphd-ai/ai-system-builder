# Headless client skill

Context citation locations include the source, chunk, row, span and page when
available. A chunk index can restart in each structured row. Keep those location
fields together; different rows with chunk zero are distinct results. Exact
duplicate locations remain invalid. Query status and the consented query card
must agree on the result count and independent cleanup state.

The [packaged Desktop feature observations](../operations/headless-context-desktop-qualification.json)
cover real pack/RAG generation, review/save, two-row local-model queries,
recorded rebuild and separately consented presentation/revocation through MCP.
They retain earlier failures. This component does not complete Managed browser,
physical failure/recovery or final roadmap qualification.

The [Managed Context observations](../operations/headless-context-managed-qualification.json)
cover the actual browser, OIDC, PostgreSQL, TLS, MCP and production-worker path.
Both app callers now use one shared workflow. Each asks two different questions
and checks the expected source row first, with exact source hashes and citation
coordinates. A display client has separate credentials and window consent.
For Managed revocation, wait for the server to confirm that the lease ended.
An unavailable or forbidden status is not that confirmation.
Then require a bounded denial and no further display. Local UI fencing remains
immediate. These small feature cases do not replace the declared corpus/resource,
physical failure or final roadmap checks. Earlier failed attempts stay recorded.

Earlier Desktop pack starts returned “not started” before task dispatch.
Later direct checks confirmed that Windows denies both failed ports selected
from the app process ID. The qualification fixture now retains its established
test endpoint instead of using that product default. The product default-port
repair remains separate pending work. No old exception was retained, so the
port finding does not prove a sole cause for every historical refusal.
A separate cleanup defect rejected the verified Windows Python launcher
relationship. The corrected test distinguishes native exit from process absence
and requires native-backed workers for a successful Desktop journey. Older
failed reports remain unchanged. Bounded error classes, OS codes and passive
runtime diagnostic enums can help diagnose future failures without raw logs.

## Prepare a Context question

Use `aisb_preview_context_query` on a plan-review connection. Supply the exact
saved RAG reference, the question, CPU or CUDA, and a result limit from 1 to 20.
The question can contain up to 2,000 characters. The app returns its exact
fingerprint and original model metadata. It does not save or return the question,
read source files, load a model or start a query. Keep all readiness marked as
not checked. Execution requires the separate version-10 query approval below.

## Show Context in the app

Use this only when the user requests a window handoff. Obtain a current window
lease through the existing consent workflow. For a saved item, read its exact
Context reference and send `show-context-artifact` with that reference. For an
accepted task, send `show-context-task` with its exact task ID. The existing
`aisb_present_in_window` tool supports both selectors; no new tool is needed.

The agent must keep the workspace, saved digest, kind and producer unchanged.
The host checks current read permission and window consent. It shows fixed
status/counts, not source or query text. Display cannot create the Context feature
or approve a new task. Checking an accepted task can validate its output and
recover its existing worker under the original task controls. A saved file's
availability is not checked by this metadata read.
Query summaries use the separate `show-context-query` selector below. Stop display after
revoke or expiry; independent Context work remains intact. Report window display
separately from backend completion and save approval.

## Show a Data result in the app

Use a separate client with window-control permission. The plan-review connection
does not gain that permission by importing or saving data. Ask for the exact
current window, wait for the user's consent and active lease, then call
`aisb_present_in_window` with one of these exact selections:

- `show-data-source`: the saved ingestion `taskId`, `fileId` and `taskRevision`.
- `show-dataset-version`: the returned `datasetId`, `versionId` and `versionDigest`.
- `show-dataset-task`: the accepted preparation `taskId` owned by this user on
  this host. Unknown, unaccepted or other-user tasks are unavailable.

Keep the same command ID to read a prior delivery outcome. The app shows bounded
status and counts; the client receives only current view and resource identifiers.
Do not add source contents, paths, names or provider coordinates. The consent
dialog lists display permissions and allows revocation. After revocation, do not
issue another command or reuse the ended lease. Saved data and independently
authorized tasks remain available through their original plan connection.

A plan-review client can use `aisb_ingestion_status` to check one known Data
task in its approved workspace. The result contains the state, revision and
progress counts. It contains no filenames, paths, source contents or diagnostic
messages. The current host must advertise `data.ingestion-status`. An ordinary
read, editing or conversation registration does not grant access to Data.

Use `aisb_dataset_versions` to inspect one to 16 known version IDs from the
same dataset. The result follows the order of the requested IDs. A missing or
inaccessible version prevents the complete reply. The tool reads only those
versions and does not browse history. `aisb_compare_dataset_versions` compares
two known versions from the same dataset. Both tools return counts and digests,
without private recipes or source contents. They start no model or preparation
task. They require a plan-review client and current Data read permission.

Use `aisb_preview_dataset_preparation` to preview a dataset from up to four
completed local file imports. Supply each exact task, file and revision, the
input and output columns, split ratios, split seed and quality preset. Each
structured file can be at most 4 MiB; the total limit is 16 MiB. The preview
requires a held-out validation or test split. It describes local JSONL output,
required result review and a limit of 1,000 rows per source. Local source
licenses show as unknown. The preview reads no source contents and starts no
processing, model or provider request. It does not prove that the columns exist
in the files. A `headless.source-not-ready` reply means the agent must check
the exact source status and revision before trying again. The tool needs a
current plan-review client with Data read permission.

Before this preview, read `aisb_ingestion_status` and use its current task
revision. A save receipt keeps the revision of its saved effect. Transfer
checkpoint cleanup can advance the task revision after that effect was saved.
An exact receipt replay does not supply the later task revision.

Use [Control AI System Builder](../../skills/control-ai-system-builder/SKILL.md)
to inspect or edit saved systems, check task status, or send one requested turn
to an approved conversation through a paired desktop app. Copy the entire skill
folder into the client's supported skills location, or reference its repository
location if the client supports project skills. Keep its
[generated tool reference](../../skills/control-ai-system-builder/references/mcp-tools.json)
with the skill.

Start the connector in desktop Settings. Follow the
[local MCP adapter instructions](../../modules/adapters/transport/headless-mcp/README.md)
to use the current address and certificate fingerprint. Configure the trusted
client launcher to supply its paired credential from secure storage. Keep
the credential out of chat, source control, and command arguments.

To confirm setup, ask the agent to list visible workspaces. For saved edits,
pair a client with editing permission and enable authoring in the launcher.
If the desktop offers conversation access, pair a client for that access and
enable conversation in the launcher. The flags control tool discovery.
The desktop checks pairing, workspace permission and the existing exact
conversation approval when it receives a request. Presentation tools can ask to
attach an exact app window. The user accepts or declines in that window and can
revoke from the shell or an open dialog. While control is starting or active,
open dialogs pause their body actions, including form submissions. The dialog
header keeps Revoke available. If the desktop does not
offer conversation access, leave that feature unavailable. Installing the skill
grants none of these permissions.

For a client paired to request plan approval, open **Settings** and expand
**Local chat clients**. Select **Review plan requests** for the popup or
**Open plan approval chat** for the conversation. Both show the same saved
request. Use the controls to approve the whole plan or one change at a
time, or to deny, cancel, or withdraw approval. A paired client can read
the result. The app records the decision from the current user.

If the app restarts, open Settings and use the current connection address and
certificate fingerprint. If a write or turn reply is lost, check saved state
or task status before replaying the exact request with the original key.
A missing window does not establish whether work was saved or canceled.

The tool reference is generated from the official SDK's `listTools` for
read, authoring, conversation, presentation, and combined modes. The generator starts no
connector and calls no tools. It emits names and input schemas without
workspace data, credentials or message content. For a repository update,
run this from the repository root with the existing dependencies installed.

```text
node --import tsx modules/adapters/transport/headless-mcp/generateHeadlessMcpToolReference.mts
```

Save the output as `skills/control-ai-system-builder/references/mcp-tools.json`.
The existing pinned MCP check compares the saved file with real SDK discovery.
Discovery checks the adapter catalog. Access to a particular host remains
subject to that host's current permissions.

The Windows qualification fixture
`packaged-desktop-headless.e2e.spec.ts` uses the repository's packaged
Playwright profile and a separate official MCP client process. It uses
synthetic data, drives the native pairing response only in the test process,
and retains no trace, screenshot, video, pairing code, or credential.

When a Headless Data change also edits the packaged test, the control plane
runs the specific Desktop plan-review case. That case verifies tool discovery
and refusal of an unselected provider file.

The same packaged check runs `packaged-desktop-ui-takeover.e2e.spec.ts`.
It measures the shell before and after opening consent, checks focus over
an open Composer preview, and tests ordered presentation and explicit revoke.
It writes a bounded observation with Windows version, sample counts and
latency distributions. The approved conversation fixture checks that an
already running operation continues after window revoke and that its owned
worker exits. The fixture uses a deterministic local runtime.
## Managed server

The same stdio adapter supports an explicitly configured HTTPS managed
host. Select the managed mode and provide its access token, organization
and workspace at launch through the supported private configuration. The
tool schemas still require the exact host and workspace identifiers. See
[managed connector configuration](../../modules/adapters/transport/headless-mcp/README.md#managed-server-connection).

## Plan from a written request

Install the full skill folder so the agent can open
[Build from a written request](../../skills/control-ai-system-builder/references/build-plans.md).
Use the dedicated plan-review connection on Desktop or managed HTTPS.
The reference describes the exact setup, supported effects, and app approval
choices. Leave the ordinary authoring and window controls outside that
connection's allowed scope.

The standard test suite grades deterministic examples with synthetic
responses. It checks decision quality, result recovery and small-plan
limits without running a model or sending a provider request.
The official stdio client and the built app approval journeys are separate
controlled checks. To evaluate another model or client, establish the exact
client build, approved test workspace, synthetic request, tool and resource
limits, user decision surface, and saved-result checks before running it.
Record that result for the tested configuration.

### Preview a local file

In **Artifact Ingestion**, choose a local file and select the plan-review
client. Choose **Prepare for chat**, then **Copy file reference**. Give the
reference to that client. It can preview the file type, size and planned save
action using `aisb_preview_selected_local_file`. The preview leaves the
file staged. Desktop and a Managed browser with plan review configured offer
this preview. Managed browser preparation requires permission to add data in
the workspace.

If the browser chat connection changes during preparation, the app hides
the old file reference. Cancel that staged upload before preparing it again.
Ordinary uploads in the same workspace continue when the chat connection
changes.

### Preview a repository file

In Desktop or a configured Managed browser, open **Artifact Ingestion**
and browse a Hugging Face dataset. Select one Parquet file, select the
plan-review client and choose **Prepare for chat**.
Copy the file reference to that client. The tool
`aisb_preview_selected_provider_file` reads the file type and exact saved
revision. It leaves the import waiting. To request a plan save, include one
`data.save-provider-source` step with the copied task, file and revision, plus
a new idempotency key. The version 3 preview lists required provider reads.
The user approves the plan or that individual change through the app popup
or signed-in approval chat. The client then runs that exact approved step.
An exact retry reads the same saved source receipt with current permissions.
The effect registers the remote source and records its declared license.
For a direct import, choose
**Cancel** on the prepared selection, then **Add data**.

On Desktop or a configured Managed host, review the exact file in the
approval popup or approval chat to let the client run the approved save.
The saved file appears in **Artifact Browser**. Before saving, **Cancel**
discards the staged transfer. Use **Add data** for a direct import.

For the opt-in frontier client check, start the isolated managed reference
database and run `managed-headless-browser-plan-approval.ts` with
`AISB_QUALIFY_FRONTIER_PLAN=1`. Use only the generated synthetic workspace.
The runner prints its finite tool catalog and numbered choice directory.
Give a separate agent the skill, synthetic request, and current tool replies.
Write each returned `tool` and `arguments` object to the requested numbered
choice file. The runner accepts one exact saved-system creation and requires
the app popup's decision before it runs the approved change. It checks the
saved record and collects the elapsed time, number of calls, and sanitized
synthetic replies. Keep the numbered choice files local and use synthetic
input only. The report records message validation results without copying the
agent's prose. Model token counts need a separately measured source.

For saved local training rows, first read the completed ingestion task's current revision. Preview the files, columns, data split and quality settings with `aisb_preview_dataset_preparation`. Include the exact inputs as a `data.prepare-local-dataset` step in a plan. The approval dialog lists the processing limits and the requirement to review results before saving. A `started` receipt means a background task was accepted. Check `aisb_dataset_task_status` with its task ID or the original plan fingerprint and step. This tool cannot approve, save or publish a dataset. Keep the same request on retry; an unconfirmed attempt must not be restarted with a new key. This local provided-row profile does not run a model.

Read `aisb_dataset_task_review` when that task requires review. It returns quality,
reason and split counts with the report identity, without private rows or samples.
If saving is available, propose a separate `data.save-prepared-dataset` step with
the exact task, report fingerprint and output name. The version 5 preview lists
the permission to save one immutable local dataset version. Either approval mode
and app channel can approve it. Processing approval alone cannot save the result.
Read the exact returned version with `aisb_dataset_versions`. An uncertain save
cannot be restarted with a new key or confirmed from a name match. Publication
and Data-window control retain their separate permissions.

The controlled Managed provided-data journey uses the built thin client and
packaged worker. Run `npm run build:thin-client` after browser changes and
`npm run build:server` after server wiring changes. Rebuild
the current Desktop package before running it after worker changes. Its fixed
entry/mapper hash check refuses stale copies before worker use. This is a build
freshness check, not a complete package inventory or a native filesystem fence.

## Preview a Context or RAG input

Use a plan-review connection and check the host's current operation list.
`aisb_context_models` lists up to 32 recorded model choices without scanning
shared folders. `aisb_preview_context_generation` previews up to four saved
sources of 4 MiB each, with an output name and Context settings. Use exact
current file task/revision IDs or an exact saved dataset/version/digest/data
role. A RAG preview also needs the recorded embedding model ID and timestamp.
The reply contains no source text or private file paths. It starts no model,
extraction, index, save or provider request. Runtime readiness is not checked.
See the portable skill's Context input reference for the complete workflow.

When installing or refreshing the portable skill, copy its `SKILL.md` and all
references, including `context-inputs.md` and the generated `mcp-tools.json`.
Use only tools offered by the actual connection. Older hosts can lack these
reads; do not substitute an active Context operation as a passive preview.

### Approved local Context queries

The separately opted-in `context.query` step uses build-plan preview version 10.
Its durable definition binds the exact saved RAG reference, original model record
and timestamp, question hash, explicit CPU/CUDA and 1–20 result limit. Versions
1–9 retain their fingerprints. For approved execution, only `plan.run-step` can
carry a copied transient question (maximum 2,000 characters) within the existing
8 KiB envelope. Passive query preview separately receives text only to hash it. The SDK
maps optional `contextQuery` to that envelope; other steps reject it before effects.
Plans, task/effect records, receipts, audit and returned summaries retain no text.

Metadata-only original-lineage compilation runs at proposal, reservation and
atomic one-use issue after staging. Exact runtime ACK and acknowledged durable
acceptance precede the owned phase. Original caller, client and approval gates
protect preparation, new issue and the outward start reply. Recording a genuine
already-issued ACK remains independent of caller closure or revocation. Only
acknowledged durable acceptance enables owned background policy. Then the retained Browser/reconciler and
captured verified actor reread current membership, role, workspace, saved/source
and original model facts. Closed HTTP requests, old JWTs, ambient context and old
approval lifetime cannot become background authority. Original request fences
still control the start reply. Lost acceptance proof grants no phase switch,
adoption, discovery, rerun or recovery authority.

Fresh status proves the accepted client/host/actor and current artifact AND model
read permission before cached query owner access and at final host publication.
An unknown definition denies before either query or generation owner. Generation
reads retain their original artifact-only policy. Results are closed numeric
rank/score/citation coordinates with original public source references/digests,
question hash, settings and separate cleanup state. They contain no question,
excerpt, vector, private path, worker ID or instruction, and grant no save.

Both approval modes/channels reuse the existing modal. No new engine, scheduler,
retention, provider, model download or native/cleanup policy is introduced.
Controlled Core/SQLite, API, SDK, policy and UI tests are feature evidence only.
Consented query-window display, physical retrieval/resources, actual app hosts and
parent/chunk qualification remain separate. Rollback disables query/v10 admission
and retains consumed history; it never restores a weaker execution path.

### Show an existing Context search

Use `aisb_context_task` to identify the exact accepted query, then obtain separate
window consent. `aisb_present_in_window` accepts `show-context-query` with that
UUID; it starts no query or model. Current artifact/model permission and original
saved/source/model lineage are checked. The existing card shows counts, settings,
question hash and cleanup state; window context exposes only selector/view IDs.
The window connection may differ from the plan connection for the same actor,
workspace and host. Revoke or expiry stops fresh display/context, preserving the
accepted backend task. Read the portable Context guide for exact steps and limits.

### Context worker observations

For the separate approved-model worker profile, use the already installed,
verified MiniLM acquisition. Run from the repository root with the existing
qualified Python environment:

```text
python dev-tools/scripts/qualification/run_trained_context_qualification.py --approved-query --chunks 1000 --samples 8 --model-manifest .local-codex/model-qualification/minilm-<UUID>/acquisition.json
```

This mode preserves the ordinary comparison matrix. It runs only the current
approved-model query branch with the original production embedding callable,
an explicit local model reference and no ordinary model alias. It uses the fixed
corpus and CPU/repeat/constrained and CUDA/repeat profiles. Wrong original-model
and artifact-digest probes must deny before inference and clean materialization.
The recorded ordinary baseline is pinned and reused without rerunning it.
Existing child ownership, unknown-exit refusal, deadlines and memory bounds stay.
No model or dependency is downloaded. Keep every failure and review the generated
`approved-query-report.json` before updating qualification. This worker-only
profile does not exercise the Headless runtime adapter, task approval, saved
ownership, MCP transport or app UI. Those checks remain separate.

The [approved-model worker record](../operations/headless-context-admitted-query-evidence.json)
contains the observed CPU/repeat/constrained and CUDA/repeat results. All five
query cohorts reached recall 1.0, the three exact comparisons passed, and ten
negative probes denied with zero embedding forward calls. All six owned workers
exited normally. The verified temporary model copy and generated source/archive
were removed; the original cache remains unchanged. This is a bounded worker
observation. It does not complete the remaining runtime-adapter, app or roadmap
qualification. No ordinary or Qwen accuracy cohort was rerun.

The [bounded retrieval record](../operations/headless-context-query-runtime-evidence.json)
uses the existing offline, hash-pinned MiniLM model and the fixed 1,000-row,
eight-topic corpus. CPU reference, repeat and enforced 2 GiB profiles and CUDA
reference queries met the recorded recall, citation, sampled-memory and cleanup
targets. Matched baseline/candidate results were exact within each device.
The CUDA baseline uses the current shared embedding runtime; it does not assert
that the historical release supported CUDA. Eight samples are bounded observations,
not a statistical latency claim.

The record measures the ordinary worker/common-embedding path. It does not
physically exercise Headless `queryAdmitted`/`approvedEmbedding` admission, task
approval, app storage, MCP transport or Context UI. Query RSS sampling begins
after shared imports; it does not measure their lifetime peak. Keep actual-app
journeys, failed/interrupted physical builds, exact receipt replay and final
parent qualification pending. Reused native supervision is observed here, not
independently requalified. No model, dependency, guard or runtime default changed.
