import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod/v4";
import headless from "../../../contracts/headless/index.js";
import type { HeadlessHostIncarnationId, HeadlessReadRequest, HeadlessSemanticBatchRequest, HeadlessSystemManagementRequest } from "../../../contracts/headless/index.js";
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
const enableAuthoring = process.env.AISB_HEADLESS_ENABLE_AUTHORING === "1";
const forward = createHeadlessMcpReadForwarder(
  process.env.AISB_HEADLESS_ENDPOINT, process.env.AISB_HEADLESS_FINGERPRINT, process.env.AISB_HEADLESS_CREDENTIAL, enableAuthoring,
);
delete process.env.AISB_HEADLESS_CREDENTIAL;

async function invoke(request: HeadlessReadRequest | HeadlessSemanticBatchRequest | HeadlessSystemManagementRequest, signal?: AbortSignal) {
  const result = await forward?.(request, signal) ?? { ok: false, code: "headless.unavailable" };
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }], isError: !result.ok };
}

function invalidAuthoring() {
  return { content: [{ type: "text" as const, text: '{"ok":false,"code":"headless.invalid-request"}' }], isError: true };
}

function addAuthoringTools(server: McpServer) {
  const displayName = z.string().min(1).max(120);
  const idempotencyKey = z.string().refine(headless.isHeadlessHostIncarnationId, "Invalid retry key");
  const base = {
    hostIncarnationId, workspaceId, systemId, baseRecordRevision: z.number().int().positive(),
    baseRevisionId: z.string().min(1).max(160),
  };
  const target = { ...base, idempotencyKey, name: displayName };
  const id = z.string().min(1).max(160);
  const place = { parentInstanceId: id, slotId: id, order: z.number().int().nonnegative().max(511) };
  const configuration = z.record(z.string().min(1).max(64), z.unknown());
  const edits = z.array(z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("add"), instanceId: id, definitionId: id, version: z.string().min(1).max(128), configuration, ...place }),
    z.strictObject({ kind: z.literal("configure"), instanceId: id, values: configuration }),
    z.strictObject({ kind: z.literal("connect"), bindingId: id, bindingKind: z.enum(["input", "output", "event", "control"]),
      sourceInstanceId: id, sourcePortId: id, targetInstanceId: id, targetPortId: id }),
    z.strictObject({ kind: z.literal("move"), instanceId: id, ...place }),
    z.strictObject({ kind: z.literal("remove"), instanceId: id }),
  ])).min(1).max(headless.HEADLESS_MAX_SEMANTIC_EDITS);
  const writeHints = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
  const queryHints = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  async function author(operation: HeadlessSemanticBatchRequest["operation"] | HeadlessSystemManagementRequest["operation"],
    input: { hostIncarnationId: string }, signal?: AbortSignal) {
    if (!headless.isHeadlessHostIncarnationId(input.hostIncarnationId)) return invalidAuthoring();
    const raw = { version, operation, input };
    const edit = headless.parseHeadlessSemanticBatchRequest(raw, input.hostIncarnationId);
    if (edit.ok) return invoke(edit.request, signal);
    const management = headless.parseHeadlessSystemManagementRequest(raw, input.hostIncarnationId);
    return management.ok ? invoke(management.request, signal) : invalidAuthoring();
  }
  server.registerTool("aisb_create_system", {
    description: "Create one saved system from an exact template in the approved workspace. Reuse the same key after a lost reply.",
    inputSchema: z.strictObject({ hostIncarnationId, workspaceId, templateId: z.enum(systemBuilder.SYSTEM_BUILDER_TEMPLATE_IDS), name: displayName, idempotencyKey }),
    annotations: { ...writeHints, destructiveHint: false },
  }, (input, context) => author("systems.create", input, context.mcpReq.signal));
  server.registerTool("aisb_rename_system", {
    description: "Rename one saved system against both revisions. If omitted, the existing description is preserved.",
    inputSchema: z.strictObject({ ...target, description: z.string().min(1).max(1_000).optional() }), annotations: writeHints,
  }, (input, context) => author("systems.rename", input, context.mcpReq.signal));
  server.registerTool("aisb_clone_system", {
    description: "Copy one exact saved system revision in its approved workspace.",
    inputSchema: z.strictObject(target), annotations: { ...writeHints, destructiveHint: false },
  }, (input, context) => author("systems.clone", input, context.mcpReq.signal));
  server.registerTool("aisb_preview_edits", {
    description: "Validate a bounded edit batch and list what it removes. This does not change saved state.",
    inputSchema: z.strictObject({ ...base, edits }), annotations: queryHints,
  }, (input, context) => author("systems.preview-edits", input, context.mcpReq.signal));
  server.registerTool("aisb_apply_edits", {
    description: "Apply the exact preview to the same saved revision. Reuse the same key after a lost reply; do not repeat with a new key.",
    inputSchema: z.strictObject({ ...base, edits, previewDigest: z.string().regex(/^[a-f0-9]{64}$/), idempotencyKey }), annotations: writeHints,
  }, (input, context) => author("systems.apply-edits", input, context.mcpReq.signal));
}

serveStdio(() => {
  const server = new McpServer({ name: enableAuthoring ? "ai-system-builder-desktop-authoring" : "ai-system-builder-desktop-read", version: "1.0.0" }, { capabilities: { tools: {} } });
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
  if (enableAuthoring) addAuthoringTools(server);
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
