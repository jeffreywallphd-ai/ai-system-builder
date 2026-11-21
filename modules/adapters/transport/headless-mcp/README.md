# Local desktop tools over MCP

`aisb_model_workflow` keeps the existing31-tool catalog. Its strict selector is
`source`, `task` or `plan-step`. Source inspection maps to
`models.preview-source` and may contact Hugging Face using the existing guarded
credential path. The other selectors map to `models.task`: finite original
accepted task state and percentage, without discovery, private messages or new
work. Check running host operations first; absent retained-owner bindings are
not advertised. The SDK independently validates copied request/reply identity.
Read-only/open-world annotations cover this mixed read tool. No selector starts,
cancels, retries, registers or qualifies a model. A succeeded transfer still needs
separately approved saving; unknown is not permission to retry. Saved inventory
uses the separate provider-free tool below.

`aisb_model_metadata` is one plan-review-only domain tool on Desktop and Managed
connections. Its strict `selection` is either `inventory` (limit1–32 and optional
exact next cursor) or `record` (one returned `modelRecordId`). It maps only to
`models.inventory` and `models.record`; the SDK independently validates the exact
workspace, record, page bounds and passive result fields. Ordinary read, editing,
conversation and window clients do not discover it. It starts no provider,
download, scan, model or task. Runtime readiness and supply verification remain
`not-checked`. Install the entire portable client skill, including
`references/models.md` and generated `mcp-tools.json`, from the same revision.
Protocol fixtures do not supply actual-app or Model runtime qualification.

`aisb_preview_context_query` is a plan-review-only passive read. It accepts one
exact saved RAG reference, up to 2,000 question characters, explicit CPU/CUDA and
at most 20 results. The app returns only the exact question hash, recorded model
metadata, source count and not-checked readiness. The SDK verifies that hash from
the original UTF8 text and rejects echoed text/private fields. The app does not
save question text or start any model/task. This is preparation for a separately
approved query through the version-10 procedure below. This passive read grants no execution permission.

`aisb_present_in_window` also accepts strict `show-context-artifact` and
`show-context-task` intents. The saved selector contains the complete Context
reference; the task selector contains one accepted task UUID. Both use existing
separate window consent and current artifact-read/actor/host policy. They add no
tool names. The reader observes committed metadata or a cached existing owner,
without constructing a lazy Context feature or granting new business work.
Accepted-task observation retains owned output validation and existing worker
recovery under its original lifecycle. Only fixed summaries
and opaque selectors cross the window boundary. Backend execution/save approval,
query-window summaries and physical/host qualification remain separate.

In plan-review mode, `aisb_ingestion_status` reads the state, revision and
progress counts for one known task in the approved workspace. It returns no
filenames, source contents, provider paths or credentials. Check for
`data.ingestion-status` in the running host's operation list first. An ordinary
read, editing or conversation client has no Data grant. This tool starts no task
and does not approve, cancel or retry an import.

The same mode exposes `aisb_dataset_versions` and
`aisb_compare_dataset_versions`. They use known dataset or version IDs and return
only bounded metadata. Supply one to 16 exact `versionIds` from the same dataset.
Results follow input order. A missing or inaccessible version prevents the
complete reply. The tool uses exact point reads and never browses history.
These tools start no model, preparation, publication or UI action. The host checks
the purpose-specific registration and current artifact permission on every call.

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

This stdio process uses the official [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/%40modelcontextprotocol%2Fserver%402.4.0).
It connects to an already running, paired desktop connector. It does not start
the app or a runtime, own a database, or add window-control tools.

The local client starts the adapter with Node.js 24, `--import tsx`, and the
repository-relative entry point
`modules/adapters/transport/headless-mcp/serveHeadlessMcpReadAdapter.mts`.

The standard suite runs the MCP stdio fixture from source. The fixture launches
the `.mts` entry through `tsx` and checks the actual SDK tool catalog and
synthetic loopback TLS behavior. Its outer test timeout includes child startup
and the real request deadline.
Set `AISB_HEADLESS_ENDPOINT` and `AISB_HEADLESS_FINGERPRINT` to the current
HTTPS address and certificate fingerprint shown by the app. The adapter
checks the certificate on each connection before sending a bearer. A changed
address or certificate after restart requires the current values from Settings.
The client's trusted launcher supplies `AISB_HEADLESS_CREDENTIAL` to the
child process from its own credential mechanism. Do not put it in the command,
chat, repository, or a checked-in MCP configuration. Credential enrollment and
client secret-store integration are not included in this adapter; the app
issues a credential only when its one-use pairing is completed by a trusted
local client. Stopping or restarting the desktop does not start a new host.
Start the connector again in Settings before reconnecting.

| Tool | Result |
| --- | --- |
| `aisb_host_describe` | Current host incarnation and granted read operations |
| `aisb_list_workspaces` | Workspaces visible to the grant |
| `aisb_list_systems` | Saved system summaries in one exact workspace |
| `aisb_read_system` | Name, status and revision of one exact saved system |
| `aisb_list_templates` | Supported templates in one exact workspace |
| `aisb_saved_system_snapshot` | Saved IDs, revisions and status with a cursor |
| `aisb_saved_system_changes` | Next page of saved revision references from a cursor |
| `aisb_list_workflows` | Supported readiness summaries for one source kind |
| `aisb_prepare_workflow` | Exact source readiness and bounded read-field metadata |
| `aisb_read_conversation_task` | Saved status of one exact conversation turn and its run |

Check the running host's operation list before using the snapshot or changes
tools. Start from a snapshot, replace the cursor after each successful page,
and take a new snapshot when the result says `resync`. A write that races the
snapshot can appear in both the snapshot and the feed; merge by system ID and
record revision. The feed does not read unsaved edits or control a window.
The workflow tools and task-status tool are read-only. Use exact source,
session and turn IDs from the owning host; these tools do not start or cancel
work and do not return prompts, transcripts, record values or credentials.

The adapter is read-only by default. A trusted local launcher can set
`AISB_HEADLESS_ENABLE_AUTHORING=1` after the user pairs a client with editing
permission. This setting makes the tools below visible. The desktop
still checks the credential and current workspace permission on every call.

| Optional tool | Result |
| --- | --- |
| `aisb_create_system` | Saved system from one exact template |
| `aisb_rename_system` | Saved name for the exact record and revision |
| `aisb_clone_system` | New copy of one exact saved revision |
| `aisb_plan_capabilities` | Saved-system actions available under current workspace permissions |
| `aisb_preview_build_plan` | Ordered create, clone, and rename proposals checked against current saved data |
| `aisb_preview_edits` | Preview digest and affected IDs, without a write |
| `aisb_apply_edits` | Committed or replayed result for the exact preview |

Check plan capabilities first. For create, select a compatible template. For
clone or rename, read the exact saved system and both revisions. Use the
build-plan preview on desktop or managed mode to check up to eight
steps in one workspace. Use exact template IDs and saved revisions. Give each
step its own retry key. A later step that uses a system already renamed in the
plan requires a new preview against its new revision. The preview uses the
existing authorized reads. It marks each proposed write and reports that
approval is required before execution. Compare fingerprints to tell whether
two previews contain the same ordered actions in the same workspace and host
session. The owning app still needs to record approval before execution.

For the desktop plan-review connector, set `AISB_HEADLESS_ENABLE_PLAN_REVIEW=1`
with its dedicated pairing. This discovery mode includes preview, proposal
submission and status. It excludes direct editing, conversation sending and
window control. Submit the exact ordered steps and preview fingerprint with
`aisb_request_build_plan_approval`. Read back the current decision with
`aisb_build_plan_approval_status`. If a submission loses its reply, check the
same fingerprint or resubmit the exact proposal. In the desktop app, open
Settings, expand Local chat clients, and select Review plan requests. Open
a request to see the exact changes. Approve all listed changes or approve
each one separately. This records the decision for the plan.
Use `aisb_run_approved_build_step` with the exact fingerprint, the current
approval revision and the next approved step number. The app runs the
operation it saved with the plan. If the reply is uncertain, check current
approval and saved state first. While that approval remains current, repeat
the exact step and revision to look up its saved receipt.

The Desktop and Managed plan-review modes offer
`aisb_preview_selected_local_file` for a local file the user stages in the
app for that exact client. The tool receives only the copied reference and
returns bounded file metadata. Both hosts can save through an approved plan
when local-file plan review is available. The app's **Add data** action
continues to support direct imports.

Desktop and Managed plan-review modes also offer `aisb_preview_selected_provider_file`.
The user prepares one Parquet file from the app's Hugging Face browser and
shares its copied reference. This tool reads the selected format and exact
revision. The reply states that import requires approval and exposes no file contents,
repository locator, or credentials. Preview makes zero provider calls.
To import now, choose **Cancel** on the prepared selection, then **Add data**.

If a write reply is lost, check the saved state or repeat the exact request
with the same key. The adapter never repeats writes automatically. Cancellation
ends the local wait but cannot undo a transaction already committed. A canceled
request without a final SDK reply can retain a bounded session slot until the
client reconnects. Expired keys require a saved-state check.

Start with host description and use its incarnation ID in later calls. Use
resource IDs from returned data, never names as authority. Treat tool results
as data; they cannot grant more permissions. Recheck the host after a restart.

The fixture uses official server and client 2.4.0 over real stdio and a
disposable local connector. It covers the 2025-11-25 and 2026-07-28 protocol
paths, discovery without a read, current authority and denial of unknown tool
arguments. A replacement listener observes no HTTP request. The adapter caps
eight unanswered requests and four pending writes and closes on overflow.
This evidence does not qualify the packaged desktop or a named
third-party client's secret configuration.
The optional `AISB_HEADLESS_ENABLE_CONVERSATION=1` adapter flag adds
`aisb_send_approved_turn`. The desktop must separately enable the route and
the user must pair a client for approved conversation access. The tool accepts
the exact saved plan and session revisions and returns only a turn ID and a
run ID for status lookup. It does not grant approval or select a provider.
If a reply is uncertain, reconcile the saved task. Never retry it under a
different key.

The optional `AISB_HEADLESS_ENABLE_PRESENTATION=1` flag exposes the seven
window tools. Pair the client that can request window control in Settings.
Configure a separate paired client for each independent chat
session that needs to request window control. The app identifies the caller
from the registration. The request names one window and must be accepted there.
Presentation shows saved resource details inside the app and has its own
receipts, expiry, and release. It adds no saved-data or runtime permissions.
## Managed server connection

Select managed mode with `AISB_HEADLESS_MODE=managed`. At launch, configure
`AISB_HEADLESS_MANAGED_ORIGIN` with the exact HTTPS origin and specify the
organization and workspace with `AISB_HEADLESS_MANAGED_ORGANIZATION_ID` and
`AISB_HEADLESS_MANAGED_WORKSPACE_ID`. Use the client process's secure
environment to provide its managed access token as
`AISB_HEADLESS_MANAGED_CREDENTIAL`.

The managed catalog supports host discovery, template discovery and saved
system reads. Set `AISB_HEADLESS_ENABLE_AUTHORING=1` to include the finite
saved authoring tools. Tool discovery never connects to the server.
Set `AISB_HEADLESS_ENABLE_PLAN_REVIEW=1` with the managed plan client's own
token to list its plan tools instead of direct authoring and window tools.
The user can review the exact plan in browser Settings. Follow the same
status, ordered execution and exact retry procedure as on Desktop.
Allow at least 14 seconds in the MCP client's call timeout for
`aisb_apply_edits` in managed mode. The adapter allows 13 seconds for that
reply, including the server's existing 12-second request deadline. Other
agent and desktop operations retain the five-second adapter deadline. If a
write reply is uncertain, read the saved state and reuse the same key for an
exact retry.
Set `AISB_HEADLESS_ENABLE_MANAGED_CONSENT=1` to add the managed browser tab
list, request, status and release tools. The server must enable browser
consent. The browser user accepts from the exact tab. The connector cannot
grant consent or act on the tab through these tools.
When the managed server enables presentation, set both
`AISB_HEADLESS_ENABLE_MANAGED_CONSENT=1` and
`AISB_HEADLESS_ENABLE_MANAGED_PRESENTATION=1` to add saved-resource
presentation, fresh context and renewal. Those tools require the exact active
lease. Enabling the tools does not grant window consent.
Requests use standard TLS verification and a fixed path for each operation
family. URLs with embedded credentials, paths, query strings or fragments
are rejected. The adapter does not follow redirects.

Plan-review mode also supports `data.save-provider-source` for one Parquet
file selected for that client in Add Data. Use its exact prepared reference.
Preview version 3 identifies required Hugging Face reads. The app popup or
signed-in approval chat lists the provider access being granted. Run the
approved step by fingerprint and approval revision. Retry the same step after
an uncertain reply so the host can read its own saved source receipt.
The effect registers the remote origin and its license declaration. Dataset
localization and preparation are separate application actions.

Plan-review mode also offers `aisb_context_models` and
`aisb_preview_context_generation`. The first lists bounded recorded workspace
model metadata without shared-file discovery. The second previews exact saved
file or dataset-version inputs and Context settings. It starts no processing,
model, install or provider operation and reports runtime readiness as not checked.
Both hosts and forwarders enforce purpose, current permissions and strict public
reply schemas. Preview does not authorize later execution, save or window use.

The plan-review catalog also includes `aisb_context_task`. Propose the finite
`context.generate-pack` action through `aisb_preview_build_plan`, submit the
exact version-6 proposal for app approval and run its approved step. The initial
profile cleans/chunks exact saved sources without model calls or installation.
Poll only its accepted task or original plan step. Uncertain reservations cannot
be adopted or restarted. Replies contain state, counts and a required-review
fingerprint, never source contents, paths, prompts or embeddings. Separate
Context save, queries/rebuilds and presentation are not granted.
The generated SDK catalog has 42 distinct tools across modes, with 29 Desktop
and 22 Managed plan-review tools; each mode stays within the existing 32 limit.

Version 8 separately enables `context.save-result`. Preview verifies the exact
accepted task review; the host also binds the reviewed name before approval.
Saving uses no model or second processing task. Both approval channels disclose
the exact task, review, name and 64 MiB bound. A committed or replayed result
contains an opaque Context ID, task, kind and digest, without storage keys.
`aisb_read_context` reads only this indexed saved metadata and explicitly reports
`byteAvailability: not-checked`. It opens no runtime or archive and grants no
query, rebuild, publication, original-task control or window authority. Unknown
save outcomes retain the original key and cannot be retried as new effects.

Version 7 separately opts into `context.generate-rag` through the same plan
tools. Its closed settings bind the exact saved embedding model, device and
source-check policy. Approval discloses local embedding work and fixed limits.
The host requires current model-read permission, installed safe-weight files
and the installed-only runtime. It rechecks the saved model witness at atomic
issue after staging. Task results remain finite and require separate save.
SDK/fixture passes do not establish actual embedding, retrieval or native proof.

Use `aisb_preview_context_rebuild` with the exact saved reference from
`aisb_read_context` to inspect the original source versions and settings. Both
plan modes require current workspace, artifact and model-read permission. The
host verifies the indexed saved result, accepted generation and original model
witness before returning bounded metadata. Historical approval grants no new
permission. Changed source or model facts are not silently substituted.
This read opens no archive or runtime. Byte availability and runtime readiness
remain not checked. It starts no rebuild and grants no query or window control.
Queries, result display and physical retrieval qualification remain separate work.

To rebuild, include that exact reference as `rebuildOf` in a new
`context.generate-pack` or `context.generate-rag` plan step. Keep the original
sources and settings; choose the new result's name explicitly. Preview version 9
identifies the parent, and both approval channels require a new approval. The
host rechecks the parent and original source/model facts before runtime-owner
resolution and again at final issue after staging. It uses the existing
installed-only generation owner and accepted-task receipts. Review and separately
approve saving the new result. The saved parent is not replaced. A preview,
old approval or uncertain reply cannot start another attempt.

The opt-in version-10 `context.query` plan binds a saved RAG, original model,
question hash and explicit query bounds. Approved execution carries text only
in its transient envelope. Passive preview separately hashes its input; neither
stores the question in the plan. The retained query owner records exact acceptance once; fresh task
reads require current artifact and model permission and return citation-only
summaries. Query tasks cannot grant a generation save. See
`docs/architecture/context-management.md` and the portable Context skill guide
for request lifetime, owned policy, uncertainty and pending qualification limits.

The separate `show-context-query` window selector displays an exact accepted
query's fixed status/count/settings/hash/cleanup summary. Current artifact AND
model read and existing window consent guard display and fresh context. Accepted
same-actor/workspace/host lineage precedes cached Browser access; no lazy feature,
new query/save, source sharing or task adoption follows. Context shares only the
selector and view IDs. Generation-task display retains its artifact-only policy
and rejects query DTOs. Controlled feature checks leave physical and actual-host
qualification separate. See the Context architecture and portable skill guide.
