# Headless client skill

Use [Control AI System Builder](../../skills/control-ai-system-builder/SKILL.md)
when an agent needs to inspect or edit a saved system through a paired desktop
app. Keep the skill in the client’s supported skills location, or reference its
repository location if the client supports project skills. This installs
instructions only; it does not enroll a client or turn on editing.

Start the connector in the app's Settings. Follow the
[local MCP adapter instructions](../../modules/adapters/transport/headless-mcp/README.md)
to connect the client to that app and supply its credential through a secure
launcher. Keep the credential out of chat, source control, and command arguments.
To confirm setup, ask the agent to list visible workspaces without changing
anything. Use the separate editing permission only when you want the client to
make saved changes.

If the app restarts, open Settings and use the current connection address and
certificate fingerprint. If a write reply is lost, ask the agent to check the
saved system before retrying. A missing window or an unchanged selection does
not tell you whether the edit was saved.
