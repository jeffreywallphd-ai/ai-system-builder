# Headless client skill

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
