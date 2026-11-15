# Headless client skill

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

### Preview a local file on Desktop

In the workspace's Add Data page, choose a local file and select your paired
plan-review client. Choose **Prepare for chat**, then **Copy file reference**.
Give that reference to your chosen client. It can preview the file type, size
and planned save action using `aisb_preview_selected_local_file`. The preview
leaves the file staged. Choose **Cancel** to discard the staged transfer, or
use the usual **Add data** action for a direct import.

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
