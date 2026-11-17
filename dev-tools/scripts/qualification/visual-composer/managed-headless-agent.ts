import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {writeFile} from "node:fs/promises";
import path from "node:path";
import {Client} from "@modelcontextprotocol/client";
import {StdioClientTransport} from "@modelcontextprotocol/client/stdio";

import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId} from "../../../../modules/contracts/headless";
import {startManagedReferenceHost} from "./managed-reference-host";

async function main() {
  const fixture = await startManagedReferenceHost(process.env.MANAGED_REFERENCE_DATABASE ?? "", {headlessAgent: true});
  const client = new Client({name: "managed-authoring-qualification", version: "1.0.0"});
  const checks: Record<string, boolean | number> = {};
  let step = "startup";
  let complete = false;
  try {
    const {agent, organizationId, serverOrigin} = fixture;
    assert.ok(agent);
    const transport = new StdioClientTransport({command: process.execPath,
      args: ["--import", "tsx", path.resolve("modules/adapters/transport/headless-mcp/serveHeadlessMcpReadAdapter.mts")],
      env: {
        AISB_HEADLESS_MODE: "managed", AISB_HEADLESS_MANAGED_ORIGIN: serverOrigin,
        AISB_HEADLESS_MANAGED_CREDENTIAL: agent.access, AISB_HEADLESS_MANAGED_ORGANIZATION_ID: organizationId,
        AISB_HEADLESS_MANAGED_WORKSPACE_ID: agent.workspaceId, AISB_HEADLESS_ENABLE_AUTHORING: "1",
        NODE_EXTRA_CA_CERTS: agent.caFile, TSX_DISABLE_CACHE: "1",
      },
      stderr: "ignore", maxBufferSize: 256 * 1024,
    });
    await client.connect(transport);
    const call = async (name: string, input: Record<string, unknown> = {}) => {
      const reply = await client.callTool({name, arguments: input}, undefined, {timeout: 8_000});
      assert.ok(Array.isArray(reply.content) && reply.content.length === 1 && reply.content[0].type === "text");
      return JSON.parse(reply.content[0].text);
    };
    step = "discovery";
    const description = await call("aisb_host_describe");
    assert.equal(description.ok, true);
    const hostIncarnationId = description.value.hostIncarnationId;
    assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));
    assert.equal(description.value.version, HEADLESS_CONTRACT_VERSION);
    const target = {hostIncarnationId, workspaceId: agent.workspaceId};
    const request = (route: string, body: object, token = agent.browser) =>
      fixture.request(route, {method: "POST", token, organizationId, body});
    const denied = await request("/api/headless/agent/read", {version: HEADLESS_CONTRACT_VERSION, operation: "host.describe", input: {}});
    assert.equal(denied.status, 403);
    checks.browser_cannot_use_agent_routes = true;
    const before = await request("/api/headless/system-builder/snapshot", {workspaceId: target.workspaceId});
    assert.equal(before.status, 200);
    assert.equal(before.body.value.cursor.hostIncarnationId, hostIncarnationId);
    checks.same_running_host = true;
    const templates = await call("aisb_list_templates", target);
    assert.equal(templates.ok, true);
    const templateId = "reference.secured-data-review@1.0.0";
    assert.ok(templates.value.some((template: {templateId: string}) => template.templateId === templateId));

    step = "write-and-retry";
    const args = {...target, templateId, idempotencyKey: randomUUID(), name: "Synthetic managed portal"};
    const saved = await call("aisb_create_system", args);
    assert.equal(saved.ok, true);
    assert.equal(saved.value.kind, "committed");
    const first = saved.value.reference;
    const replay = await call("aisb_create_system", args);
    assert.deepEqual(replay, {ok: true, value: {kind: "replayed", reference: first}});
    checks.durable_receipt_replay = true;
    const conflict = await call("aisb_create_system", {...args, name: "Different synthetic input"});
    assert.deepEqual(conflict, {ok: false, code: "headless.idempotency-conflict"});
    checks.changed_payload_denied = true;
    const read = await call("aisb_read_system", {...target, systemId: first.systemId});
    assert.equal(read.ok, true);
    assert.equal(read.value.currentRevisionId, first.revisionId);
    assert.equal(read.value.revision, first.recordRevision);

    step = "browser-replay";
    const changes = await request("/api/headless/system-builder/changes", {workspaceId: target.workspaceId, cursor: before.body.value.cursor});
    assert.equal(changes.status, 200);
    assert.equal(changes.body.value.events.length, 1);
    assert.equal(changes.body.value.events[0].systemId, first.systemId);
    assert.equal(changes.body.value.events[0].revisionId, first.revisionId);
    checks.one_committed_change = true;
    complete = true;
  } finally {
    step = complete ? "cleanup" : step;
    await client.close().catch(() => {complete = false;});
    await fixture.stop().catch(() => {complete = false;});
    await writeFile(path.join(fixture.runRoot, "managed-headless-agent-evidence.json"), JSON.stringify({
      schema_version: "managed-headless-agent-v1", source_revision: fixture.sourceRevision,
      status: complete ? "passed" : "failed", step, checks,
    }, null, 2) + "\n", {flag: "wx"});
  }
  assert.equal(complete, true);
  process.stdout.write(JSON.stringify({status: "passed", checks}) + "\n");
}

void main().catch(() => {
  process.stderr.write('{"status":"failed","code":"managed-headless.agent-unqualified"}\n');
  process.exitCode = 1;
});
