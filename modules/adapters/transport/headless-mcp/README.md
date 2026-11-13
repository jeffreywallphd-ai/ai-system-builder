# Local desktop tools over MCP

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

This stdio process uses the official [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/%40modelcontextprotocol%2Fserver%402.4.0).
It connects to an already running, paired desktop connector. It does not start
the app or a runtime, own a database, or add window-control tools.

The local client starts the adapter with Node.js 24, `--import tsx`, and the
repository-relative entry point
`modules/adapters/transport/headless-mcp/serveHeadlessMcpReadAdapter.mts`.
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
permission. This setting makes the five tools below visible; the desktop
still checks the credential and current workspace permission on every call.

| Optional tool | Result |
| --- | --- |
| `aisb_create_system` | Saved system from one exact template |
| `aisb_rename_system` | Saved name for the exact record and revision |
| `aisb_clone_system` | New copy of one exact saved revision |
| `aisb_preview_edits` | Preview digest and affected IDs, without a write |
| `aisb_apply_edits` | Committed or replayed result for the exact preview |

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
