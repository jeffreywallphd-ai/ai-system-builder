import assert from "node:assert/strict";
import {createHash, randomUUID, randomBytes} from "node:crypto";
import {resolve} from "node:path";
import test from "node:test";
import {Client} from "@modelcontextprotocol/client";
import {StdioClientTransport} from "@modelcontextprotocol/client/stdio";
import {startDesktopHeadlessLoopback} from "../../headless-loopback";
import {readModelDownloadSource} from "../../../../contracts/model";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {HEADLESS_READ_OPERATIONS, type HeadlessHostIncarnationId} from "../../../../contracts/headless";

const hostIncarnationId = "a745c71b-550e-49c1-a8bb-c343c55a638b" as HeadlessHostIncarnationId;
const organizationId = createOrganizationId("org.synthetic-download"), workspaceId = createWorkspaceId("workspace.synthetic-download");
const source = readModelDownloadSource({provider: "huggingface", modelId: "fixture/model", revision: "a".repeat(40),
  format: "transformers-safetensors", license: {kind: "unknown"},
  files: ["config.json", "model.safetensors", "tokenizer.json"].map(name => ({path: name, sizeBytes: 10,
    integrity: {algorithm: name.endsWith("safetensors") ? "sha256" : "git-blob-sha1", digest: "b".repeat(name.endsWith("safetensors") ? 64 : 40)}})),
  totalBytes: 30, excludedFileCount: 0, sourceVerification: "provider-metadata", bytesVerification: "not-checked", runtimeReadiness: "not-checked"},
  {provider: "huggingface", modelId: "fixture/model", revision: "a".repeat(40)});
const manifest = {source, manifestDigest: "sha256:" + createHash("sha256").update(JSON.stringify(source)).digest("hex")};
const step = {operation: "models.download", idempotencyKey: randomUUID(), name: "Synthetic model", sourceManifest: manifest,
  maximumDurationSeconds: 30, allowedOrigins: ["https://huggingface.co"], inferenceMode: "causal"};

function result(response: Awaited<ReturnType<Client["callTool"]>>): any {
  assert.ok(Array.isArray(response.content));
  const block = response.content.find((item: any) => item.type === "text"); assert.ok(block && "text" in block);
  return JSON.parse(block.text as string);
}

for (const operation of ["models.download", "models.save-download"] as const) for (const enabled of [false, true]) test(`official MCP ${operation} plan keeps host capability ${enabled ? "enabled" : "disabled"}`, {timeout: 20_000}, async () => {
  const selectedStep = operation === "models.download" ? step : {operation, name: step.name,
    idempotencyKey: randomUUID(), taskId: randomUUID(), sourceManifest: manifest};
  const credential = randomBytes(32).toString("base64url"), registeredClientId = randomUUID(); let providerReads = 0, proposals = 0, stale = false;
  const expiresAt = Date.now() + 60_000;
  const connector = await startDesktopHeadlessLoopback({
    registrations: {async completePairing() {return {status: "denied"};}, async verifyCredential(value) {
      return value === credential ? {organizationId, principalId: "synthetic-principal", registeredClientId, workspaceIds: [workspaceId],
        operations: HEADLESS_READ_OPERATIONS, planReview: true, modelSourceRead: true, isCurrent: () => true} : undefined;
    }},
    async read(raw: any) {
      if (raw.operation !== "models.preview-source" && raw.operation !== "models.review-download") return {ok: false, code: "headless.forbidden"};
      providerReads++;
      if (raw.operation === "models.review-download") {
        assert.equal(raw.input.selection.taskId, "taskId" in selectedStep ? selectedStep.taskId : undefined);
        return {ok: true, operation: "models.review-download", value: {workspaceId, taskId: raw.input.selection.taskId,
          plan: {fingerprint: "d".repeat(64), step: 1}, modelId: source.modelId, revision: source.revision,
          manifestDigest: stale ? "sha256:" + "d".repeat(64) : manifest.manifestDigest, format: source.format, license: source.license,
          selectedFileCount: source.files.length, totalBytes: source.totalBytes, fromCache: false,
          selectedFilesVerification: "verified-at-completion", registration: "requires-separate-approval", runtimeReadiness: "not-checked"}};
      }
      assert.equal(raw.input.modelId, source.modelId); assert.equal(raw.input.revision, source.revision);
      return {ok: true, operation: "models.preview-source", value: {workspaceId, ...manifest,
        ...(stale ? {manifestDigest: "sha256:" + "d".repeat(64)} : {}), downloadApprovalRequired: true}};
    },
    planReview: {hostIncarnationId, allowModelDownload: enabled, allowModelReferenceSave: enabled,
      async execute(request, grant, current) {
        proposals++; assert.equal(grant.isReadCurrent?.(), true); assert.equal((await current())?.isReadCurrent?.(), true);
        assert.equal(request.operation, "plan.submit");
        if (request.operation === "plan.submit") assert.equal(request.proposal.requests[0].operation, operation);
        return {ok: true, value: {fingerprint: request.target.fingerprint, revision: 1, stepCount: 1,
          status: "pending", approvedSteps: 0, expiresAt}};
      }},
  });
  const transport = new StdioClientTransport({command: process.execPath, args: ["--import", "tsx",
    resolve("modules/adapters/transport/headless-mcp/serveHeadlessMcpReadAdapter.mts")],
    cwd: process.cwd(), stderr: "ignore", env: {TSX_DISABLE_CACHE: "1", NODE_OPTIONS: process.env.NODE_OPTIONS ?? "",
      AISB_HEADLESS_ENABLE_PLAN_REVIEW: "1", AISB_HEADLESS_ENDPOINT: connector.endpoint,
      AISB_HEADLESS_FINGERPRINT: connector.fingerprint, AISB_HEADLESS_CREDENTIAL: credential}});
  const client = new Client({name: "synthetic-download-plan", version: "1"});
  try {
    await client.connect(transport, {timeout: 10_000});
    const target = {hostIncarnationId, workspaceId};
    const preview = result(await client.callTool({name: "aisb_preview_build_plan", arguments: {...target, steps: [selectedStep]}}));
    assert.ok(preview.ok, JSON.stringify(preview)); assert.equal(providerReads, 1); assert.equal(proposals, 0);
    const submitted = result(await client.callTool({name: "aisb_request_build_plan_approval", arguments: {
      ...target, steps: [selectedStep], fingerprint: preview.value.fingerprint}}));
    assert.equal(submitted.ok, enabled, JSON.stringify(submitted)); assert.equal(proposals, enabled ? 1 : 0);
    stale = true;
    const changed = result(await client.callTool({name: "aisb_preview_build_plan", arguments: {...target, steps: [selectedStep]}}));
    assert.equal(changed.ok, false); assert.equal(proposals, enabled ? 1 : 0);
    const malformed = await client.callTool({name: "aisb_preview_build_plan", arguments: {...target,
      steps: [{...selectedStep, sourceManifest: {...manifest, source: {...source, files: []}}}]}});
    assert.equal(malformed.isError, true); assert.equal(providerReads, 2, "Schema refusal must precede provider I/O.");
  } finally {await client.close(); await connector.close();}
});
