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
revoke from the shell or an open dialog. If the desktop does not
offer conversation access, leave that feature unavailable. Installing the skill
grants none of these permissions.

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
