import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod/v4";
import headless from "../../../contracts/headless/index.js";
import type { HeadlessHostIncarnationId, HeadlessReadRequest } from "../../../contracts/headless/index.js";
import systemBuilder from "../../../contracts/system-builder/index.js";
import type { SystemBuilderSystemId } from "../../../contracts/system-builder/index.js";
import workspace from "../../../contracts/workspace/index.js";
import type { WorkspaceId } from "../../../contracts/workspace/index.js";
import { createHeadlessMcpReadForwarder } from "./createHeadlessMcpReadForwarder.mjs";
import { boundHeadlessMcpStdio } from "./boundHeadlessMcpStdio.mjs";

const hostIncarnationId = z.string().refine(headless.isHeadlessHostIncarnationId, "Invalid host ID");
const workspaceId = z.string().refine(workspace.isWorkspaceId, "Invalid workspace ID");
const systemId = z.string().refine(systemBuilder.isSystemBuilderSystemId, "Invalid system ID");
const version = headless.HEADLESS_CONTRACT_VERSION;
const forward = createHeadlessMcpReadForwarder(
  process.env.AISB_HEADLESS_ENDPOINT, process.env.AISB_HEADLESS_FINGERPRINT, process.env.AISB_HEADLESS_CREDENTIAL,
);
delete process.env.AISB_HEADLESS_CREDENTIAL;

async function invoke(request: HeadlessReadRequest, signal?: AbortSignal) {
  const result = await forward?.(request, signal) ?? { ok: false, code: "headless.unavailable" };
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }], isError: !result.ok };
}

serveStdio(() => {
  const server = new McpServer({ name: "ai-system-builder-desktop-read", version: "1.0.0" }, { capabilities: { tools: {} } });
  const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  server.registerTool("aisb_host_describe", {
    description: "Read the connected desktop host's version, current ID, and granted operations.",
    inputSchema: z.strictObject({}), annotations,
  }, (_input, context) => invoke({ version, operation: "host.describe", input: {} }, context.mcpReq.signal));
  server.registerTool("aisb_list_workspaces", {
    description: "List the workspaces this paired client can read.",
    inputSchema: z.strictObject({ hostIncarnationId }), annotations,
  }, (input, context) => invoke({ version, operation: "workspaces.list", input: {
    hostIncarnationId: input.hostIncarnationId as HeadlessHostIncarnationId,
  } }, context.mcpReq.signal));
  server.registerTool("aisb_list_systems", {
    description: "List saved systems in one authorized workspace.",
    inputSchema: z.strictObject({ hostIncarnationId, workspaceId }), annotations,
  }, (input, context) => invoke({ version, operation: "systems.list", input: {
    hostIncarnationId: input.hostIncarnationId as HeadlessHostIncarnationId, workspaceId: input.workspaceId as WorkspaceId,
  } }, context.mcpReq.signal));
  server.registerTool("aisb_read_system", {
    description: "Read one saved system's name, status, and revision from its workspace.",
    inputSchema: z.strictObject({ hostIncarnationId, workspaceId, systemId }), annotations,
  }, (input, context) => invoke({ version, operation: "systems.read", input: {
    hostIncarnationId: input.hostIncarnationId as HeadlessHostIncarnationId, workspaceId: input.workspaceId as WorkspaceId,
    systemId: input.systemId as SystemBuilderSystemId,
  } }, context.mcpReq.signal));
  server.registerTool("aisb_list_templates", {
    description: "List the supported System Builder templates in one authorized workspace.",
    inputSchema: z.strictObject({ hostIncarnationId, workspaceId }), annotations,
  }, (input, context) => invoke({ version, operation: "templates.list", input: {
    hostIncarnationId: input.hostIncarnationId as HeadlessHostIncarnationId, workspaceId: input.workspaceId as WorkspaceId,
  } }, context.mcpReq.signal));
  return server;
}, {
  transport: boundHeadlessMcpStdio(process.stdin, process.stdout, () => {
    process.exitCode = 1;
    process.stdin.destroy();
    process.stdout.destroy();
  }),
  maxSubscriptions: 1,
  // Keep SDK diagnostics out of protocol/stdout and do not print untrusted errors.
  onerror: () => {},
});
