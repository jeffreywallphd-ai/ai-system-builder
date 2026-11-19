import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import test from "node:test";
import {createWorkspaceId} from "../../workspace";
import {readModelDownloadSource} from "../../model";
import {HEADLESS_CONTRACT_VERSION as version, type HeadlessHostIncarnationId} from "../headless-protocol";
import {readHeadlessModelDownloadPlanRequest} from "../headless-model-download-plan";
import {parseHeadlessBuildPlanProposal, serializeHeadlessMutationInput} from "../headless-system-management";
import {readHeadlessPlanReviewAgentRequest} from "../headless-plan-review-wire";
import {readDesktopPlanApprovalView} from "../desktop-headless-plan-approval";
import {readManagedBrowserPlanApprovalValue} from "../managed-browser-plan-approval";

const host = "ca353bdd-7793-44c6-8c36-c470be8c537c" as HeadlessHostIncarnationId;
function fixture() {
  const workspaceId = createWorkspaceId("workspace.model-plan");
  const source = readModelDownloadSource({provider: "huggingface", modelId: "fixture/model", revision: "a".repeat(40),
    format: "transformers-safetensors", license: {kind: "unknown"}, files: ["config.json", "model.safetensors", "tokenizer.json"].map(path => ({
      path, sizeBytes: 10, integrity: {algorithm: path.endsWith("safetensors") ? "sha256" : "git-blob-sha1",
        digest: "b".repeat(path.endsWith("safetensors") ? 64 : 40)}})), totalBytes: 30, excludedFileCount: 0,
    sourceVerification: "provider-metadata", bytesVerification: "not-checked", runtimeReadiness: "not-checked"},
    {provider: "huggingface", modelId: "fixture/model", revision: "a".repeat(40)});
  const wire = {version, operation: "models.download", input: {hostIncarnationId: host, workspaceId, idempotencyKey: randomUUID(),
    name: "Small support model", sourceManifest: {source, manifestDigest: "sha256:" + createHash("sha256").update(JSON.stringify(source)).digest("hex")},
    allowedOrigins: ["https://cdn-lfs.huggingface.co", "https://huggingface.co"], maximumDurationSeconds: 1800, inferenceMode: "chat"}};
  const {hostIncarnationId: _host, workspaceId: _workspace, ...fields} = wire.input;
  const proposal = {hostIncarnationId: host, workspaceId, steps: [{operation: wire.operation, ...fields}]};
  const capabilities = {allowLocalFileSave: false, allowModelDownload: true};
  return {wire, proposal, capabilities, workspaceId};
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

test("model download proposal captures exact bounded source data without granting transfer, readiness or registry authority", () => {
  const f = fixture(), decoded = readHeadlessModelDownloadPlanRequest(f.wire, host); assert.ok(decoded.ok);
  assert.deepEqual(decoded.request, f.wire); assert.notEqual(decoded.request.input.sourceManifest.source.files, f.wire.input.sourceManifest.source.files);
  f.wire.input.allowedOrigins.reverse();
  assert.notDeepEqual(decoded.request.input.allowedOrigins, f.wire.input.allowedOrigins);
  const built = parseHeadlessBuildPlanProposal(f.proposal, host, f.capabilities); assert.ok(built.ok);
  assert.equal(built.preview.version, "aisb-build-plan-preview-v11");
  const step = built.preview.steps[0]; assert.equal(step.operation, "models.download");
  if (step.operation !== "models.download") assert.fail();
  assert.equal(step.effect, "download-model-files"); assert.equal(step.maximumTotalBytes, 30);
  assert.equal(step.temporaryStorageEstimateBytes, 60); assert.equal(step.maximumDurationSeconds, 1800);
  assert.equal(step.modelCalls, 0); assert.equal(step.externalProviderCalls, "required");
  assert.equal(step.loadsModel, false); assert.equal(step.writesModelRegistry, false); assert.equal(step.explicitSaveRequired, true);
  assert.equal(step.fileTransferAccess, "public-without-credentials");
  assert.equal(step.input.sourceManifest.source.bytesVerification, "not-checked");
  assert.equal(step.input.sourceManifest.source.runtimeReadiness, "not-checked");
});

test("unconfigured plans and submit channels cannot inherit download permission from model metadata or old capabilities", () => {
  const f = fixture();
  for (const caps of [undefined, {allowLocalFileSave: true}, {...f.capabilities, allowModelDownload: false}]) {
    assert.equal((caps ? parseHeadlessBuildPlanProposal(f.proposal, host, caps) : parseHeadlessBuildPlanProposal(f.proposal, host)).ok, false);
    assert.equal(readHeadlessPlanReviewAgentRequest({version, operation: "plan.submit",
      input: {...f.proposal, fingerprint: "a".repeat(64)}}, host, caps).ok, false);
  }
  assert.ok(readHeadlessPlanReviewAgentRequest({version, operation: "plan.submit",
    input: {...f.proposal, fingerprint: "a".repeat(64)}}, host, f.capabilities).ok);
});

test("active properties, mutable branches, hidden authority and unsafe resource/origin data are rejected", () => {
  const f = fixture(); let hooks = 0;
  const getter = {...f.wire.input}; Object.defineProperty(getter, "sourceManifest", {get() {hooks++; return f.wire.input.sourceManifest;}, enumerable: true});
  assert.equal(readHeadlessModelDownloadPlanRequest({...f.wire, input: getter}, host).ok, false); assert.equal(hooks, 0);
  for (const patch of [{taskId: randomUUID()}, {modelWrite: true}, {localPath: "private/model"}, {approval: true},
    {maximumDurationSeconds: 0}, {maximumDurationSeconds: 3601}, {maximumDurationSeconds: 1.5},
    {allowedOrigins: []}, {allowedOrigins: ["https://huggingface.co", "https://huggingface.co"]},
    {allowedOrigins: ["https://huggingface.co", "http://cdn.example.org"]},
    {allowedOrigins: ["https://huggingface.co", "https://127.0.0.1"]},
    {allowedOrigins: ["https://huggingface.co", "https://localhost"]},
    {allowedOrigins: ["https://huggingface.co", "https://example.local"]},
    {allowedOrigins: ["https://huggingface.co", "https://a.example/path"]},
    {allowedOrigins: ["https://huggingface.co", "https://name:secret@a.example"]},
    {allowedOrigins: ["https://huggingface.co", "https://a.example:443"]},
    {allowedOrigins: ["https://a.example"]}, {inferenceMode: "custom-code"}, {name: "token=synthetic-private"}])
    assert.equal(readHeadlessModelDownloadPlanRequest({...f.wire, input: {...f.wire.input, ...patch}}, host).ok, false, JSON.stringify(patch));
  for (const changed of [{revision: "main"}, {format: "pickle"}, {bytesVerification: "checked"}, {runtimeReadiness: "ready"}, {totalBytes: 31}])
    assert.equal(readHeadlessModelDownloadPlanRequest({...f.wire, input: {...f.wire.input, sourceManifest: {
      ...f.wire.input.sourceManifest, source: {...f.wire.input.sourceManifest.source, ...changed}}}}, host).ok, false);
  assert.deepEqual(readHeadlessModelDownloadPlanRequest(f.wire, randomUUID() as HeadlessHostIncarnationId), {ok: false, code: "headless.host-changed"});
});

test("unknown and non-open model licenses remain permitted declared metadata without a rights claim", () => {
  const f = fixture();
  for (const license of [{kind: "unknown"}, {kind: "provider-declared", identifier: "apache-2.0"}, {kind: "provider-declared", identifier: "proprietary"}]) {
    const changed = {...f.wire, input: {...f.wire.input, sourceManifest: {...f.wire.input.sourceManifest,
      source: {...f.wire.input.sourceManifest.source, license}}}};
    const result = readHeadlessModelDownloadPlanRequest(changed, host); assert.ok(result.ok);
    assert.deepEqual(result.request.input.sourceManifest.source.license, license);
    assert.doesNotMatch(JSON.stringify(result), /licenseRights|approvalGranted/);
  }
});

test("both approval channels reconstruct exact transfer limits and reject missing, changed or hidden effects", () => {
  const f = fixture(), built = parseHeadlessBuildPlanProposal(f.proposal, host, f.capabilities); assert.ok(built.ok);
  const selection = {workspaceId: f.workspaceId, registeredClientId: randomUUID(), fingerprint: "c".repeat(64)};
  const value = {selection, viewId: randomUUID(), preview: built.preview,
    state: {fingerprint: selection.fingerprint, revision: 1, stepCount: 1, approvedSteps: 0, expiresAt: Date.now() + 60000, status: "pending"}};
  const managed = {operation: "open" as const, selection, document: {hostIncarnationId: host, workspaceId: f.workspaceId,
    windowId: randomUUID(), uiIncarnationId: randomUUID()}};
  assert.deepEqual(readDesktopPlanApprovalView(value, selection, f.capabilities), value);
  assert.deepEqual(readManagedBrowserPlanApprovalValue(managed, value, f.capabilities), value);
  assert.equal(readDesktopPlanApprovalView(value, selection), undefined);
  assert.equal(readManagedBrowserPlanApprovalValue(managed, value), undefined);
  for (const change of [{externalProviderCalls: 0}, {modelCalls: "required"}, {maximumTotalBytes: 31}, {temporaryStorageEstimateBytes: 1},
    {maximumDurationSeconds: 3601}, {loadsModel: true}, {writesModelRegistry: true}, {explicitSaveRequired: false},
    {effect: "saved-system-write"}, {reviewRequired: false}, {fileTransferAccess: "saved-provider-access"}]) {
    const changed: unknown = {...value, preview: {...built.preview, steps: [{...built.preview.steps[0], ...change}]}};
    assert.equal(readDesktopPlanApprovalView(changed, selection, f.capabilities), undefined);
    assert.equal(readManagedBrowserPlanApprovalValue(managed, changed, f.capabilities), undefined);
  }
  for (const key of ["modelCalls", "maximumTotalBytes", "temporaryStorageEstimateBytes", "maximumDurationSeconds", "loadsModel", "writesModelRegistry", "explicitSaveRequired", "fileTransferAccess"]) {
    const step = {...built.preview.steps[0]} as Record<string, unknown>; delete step[key];
    assert.equal(readDesktopPlanApprovalView({...value, preview: {...built.preview, steps: [step]}}, selection, f.capabilities), undefined);
  }
});

test("source versions, metadata, sites and limits change approved identity while duplicate cache targets refuse", () => {
  const f = fixture(), original = parseHeadlessBuildPlanProposal(f.proposal, host, f.capabilities); assert.ok(original.ok);
  for (const patch of [{maximumDurationSeconds: 60}, {allowedOrigins: ["https://huggingface.co"]}, {name: "Different label"}]) {
    const changed = parseHeadlessBuildPlanProposal({...f.proposal, steps: [{...f.proposal.steps[0], ...patch}]}, host, f.capabilities);
    assert.ok(changed.ok); assert.notDeepEqual(changed.preview, original.preview);
  }
  assert.equal(parseHeadlessBuildPlanProposal({...f.proposal, steps: [f.proposal.steps[0], {...f.proposal.steps[0], idempotencyKey: randomUUID()}]},
    host, f.capabilities).ok, false);
  const request = readHeadlessModelDownloadPlanRequest(f.wire, host); assert.ok(request.ok);
  assert.match(serializeHeadlessMutationInput(request.request), /fixture\/model/);
  assert.doesNotMatch(serializeHeadlessMutationInput(request.request), /idempotencyKey|hostIncarnationId/);
});

// SHA256 previews captured from clean rebuild8e370e648, before Model-plan changes.
const legacyFixtures = [
  {
    "number": 1,
    "proposal": {
      "hostIncarnationId": "ca353bdd-7793-44c6-8c36-c470be8c537c",
      "workspaceId": "workspace.model-plan-legacy",
      "steps": [
        {
          "operation": "systems.create",
          "name": "Legacy system",
          "templateId": "reference.secured-data-review@1.0.0",
          "idempotencyKey": "da914265-c9bb-4cc0-8ccb-35e4a0ad283d"
        }
      ]
    }
  },
  {
    "number": 2,
    "proposal": {
      "hostIncarnationId": "ca353bdd-7793-44c6-8c36-c470be8c537c",
      "workspaceId": "workspace.model-plan-legacy",
      "steps": [
        {
          "operation": "data.save-local-source",
          "taskId": "ingestion.synthetic",
          "fileId": "file.synthetic",
          "taskRevision": 4,
          "idempotencyKey": "da914265-c9bb-4cc0-8ccb-35e4a0ad283d"
        }
      ]
    }
  },
  {
    "number": 3,
    "proposal": {
      "hostIncarnationId": "ca353bdd-7793-44c6-8c36-c470be8c537c",
      "workspaceId": "workspace.model-plan-legacy",
      "steps": [
        {
          "operation": "data.save-provider-source",
          "taskId": "ingestion.synthetic",
          "fileId": "file.synthetic",
          "taskRevision": 4,
          "idempotencyKey": "da914265-c9bb-4cc0-8ccb-35e4a0ad283d"
        }
      ]
    }
  },
  {
    "number": 4,
    "proposal": {
      "hostIncarnationId": "ca353bdd-7793-44c6-8c36-c470be8c537c",
      "workspaceId": "workspace.model-plan-legacy",
      "steps": [
        {
          "operation": "data.prepare-local-dataset",
          "sources": [
            {
              "taskId": "ingestion.synthetic",
              "fileId": "file.synthetic",
              "taskRevision": 4
            }
          ],
          "recipe": {
            "kind": "provided-instruction-rows-v1",
            "inputColumn": "question",
            "outputColumn": "answer"
          },
          "split": {
            "trainRatio": 0.8,
            "validationRatio": 0.1,
            "testRatio": 0.1,
            "seed": 42
          },
          "qualityPreset": "recommended",
          "idempotencyKey": "da914265-c9bb-4cc0-8ccb-35e4a0ad283d"
        }
      ]
    }
  },
  {
    "number": 5,
    "proposal": {
      "hostIncarnationId": "ca353bdd-7793-44c6-8c36-c470be8c537c",
      "workspaceId": "workspace.model-plan-legacy",
      "steps": [
        {
          "operation": "data.save-prepared-dataset",
          "taskId": "26a7ce63-a472-4779-876a-58500d26b971",
          "reportFingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "outputBaseName": "Reviewed baseline",
          "idempotencyKey": "da914265-c9bb-4cc0-8ccb-35e4a0ad283d"
        }
      ]
    }
  },
  {
    "number": 6,
    "proposal": {
      "hostIncarnationId": "ca353bdd-7793-44c6-8c36-c470be8c537c",
      "workspaceId": "workspace.model-plan-legacy",
      "steps": [
        {
          "operation": "context.generate-pack",
          "name": "Legacy Context",
          "sources": [
            {
              "kind": "ingestion-file",
              "taskId": "ingestion.synthetic",
              "fileId": "file.synthetic",
              "taskRevision": 4
            }
          ],
          "settings": {
            "kind": "markdown-context-pack",
            "cleaningPreset": "standard",
            "chunkCharacters": 500,
            "overlapCharacters": 50,
            "maximumChunks": 100,
            "textFields": [
              "text"
            ]
          },
          "idempotencyKey": "da914265-c9bb-4cc0-8ccb-35e4a0ad283d"
        }
      ]
    }
  },
  {
    "number": 7,
    "proposal": {
      "hostIncarnationId": "ca353bdd-7793-44c6-8c36-c470be8c537c",
      "workspaceId": "workspace.model-plan-legacy",
      "steps": [
        {
          "operation": "context.generate-rag",
          "name": "Legacy RAG",
          "sources": [
            {
              "kind": "ingestion-file",
              "taskId": "ingestion.synthetic",
              "fileId": "file.synthetic",
              "taskRevision": 4
            }
          ],
          "settings": {
            "kind": "rag-database",
            "chunkCharacters": 500,
            "overlapCharacters": 50,
            "maximumChunks": 100,
            "textFields": [
              "text"
            ],
            "modelRecordId": "model.synthetic",
            "modelUpdatedAt": "2026-11-18T00:00:00.000Z",
            "device": "cpu",
            "batchSize": 4,
            "sourceChecks": {
              "preset": "strict",
              "allowedLanguages": [
                "en"
              ],
              "requireLicenseMetadata": true,
              "requireConsentMetadata": true,
              "includeSourceAttribution": false
            }
          },
          "idempotencyKey": "da914265-c9bb-4cc0-8ccb-35e4a0ad283d"
        }
      ]
    }
  },
  {
    "number": 8,
    "proposal": {
      "hostIncarnationId": "ca353bdd-7793-44c6-8c36-c470be8c537c",
      "workspaceId": "workspace.model-plan-legacy",
      "steps": [
        {
          "operation": "context.save-result",
          "name": "Legacy saved Context",
          "taskId": "26a7ce63-a472-4779-876a-58500d26b971",
          "reportFingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "idempotencyKey": "da914265-c9bb-4cc0-8ccb-35e4a0ad283d"
        }
      ]
    }
  },
  {
    "number": 9,
    "proposal": {
      "hostIncarnationId": "ca353bdd-7793-44c6-8c36-c470be8c537c",
      "workspaceId": "workspace.model-plan-legacy",
      "steps": [
        {
          "operation": "context.generate-pack",
          "name": "Legacy rebuilt Context",
          "sources": [
            {
              "kind": "ingestion-file",
              "taskId": "ingestion.synthetic",
              "fileId": "file.synthetic",
              "taskRevision": 4
            }
          ],
          "settings": {
            "kind": "markdown-context-pack",
            "cleaningPreset": "standard",
            "chunkCharacters": 500,
            "overlapCharacters": 50,
            "maximumChunks": 100,
            "textFields": [
              "text"
            ]
          },
          "rebuildOf": {
            "workspaceId": "workspace.model-plan-legacy",
            "contextId": "4de870ce-e5e0-4e48-99c8-bc77026d64d8",
            "taskId": "26a7ce63-a472-4779-876a-58500d26b971",
            "kind": "markdown-context-pack",
            "artifactDigest": "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
          },
          "idempotencyKey": "da914265-c9bb-4cc0-8ccb-35e4a0ad283d"
        }
      ]
    }
  },
  {
    "number": 10,
    "proposal": {
      "hostIncarnationId": "ca353bdd-7793-44c6-8c36-c470be8c537c",
      "workspaceId": "workspace.model-plan-legacy",
      "steps": [
        {
          "operation": "context.query",
          "reference": {
            "workspaceId": "workspace.model-plan-legacy",
            "contextId": "4de870ce-e5e0-4e48-99c8-bc77026d64d8",
            "taskId": "26a7ce63-a472-4779-876a-58500d26b971",
            "kind": "rag-database",
            "artifactDigest": "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
          },
          "queryDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "modelRecordId": "model.synthetic",
          "modelUpdatedAt": "2026-11-18T00:00:00.000Z",
          "maximumResults": 3,
          "embeddingDevice": "cpu",
          "idempotencyKey": "da914265-c9bb-4cc0-8ccb-35e4a0ad283d"
        }
      ]
    }
  }
];
const legacyHashes = [
  "ba6ec8d4161c356d53f3110644c42cd9ee3de1d4f7bc253bc5ed030b84edadab",
  "cc65154489a564a763db5f6617aa9b1cf7535510865ad89398fa6fe4eb931c13",
  "365c509a08c0226d79d89ed2e8cb48be19b404a55aa472679d352d4c8d83bd9f",
  "a461df2769c44f60bef275391c9f607bd3c45d6ad08c03c9465c0103c4ac9153",
  "c9eab6a3eb9aeb8ec7957a60963237f2ce8e6926ca6dab3767fd3dc9169282e2",
  "403a6395fb1be555240dcdc23b5893d522eff5269fa78039ff9ac7f0ae44397e",
  "8ee56ba30a3394ec6d6922d2a24fdcf5d2a06e95e52b2ec764f6306c160c9b72",
  "3aba192e683e18d914681c17445fdc92d421fd59ed947b03961f1b952f353c37",
  "94e6adbb95d12bb6b1d66ee87d974316e68bccc9f3e0b36c84885e79a8716d17",
  "464633c209e02fa9e6ba223d848fd9c22c0b3dde8b7eb0ee6ba211671278b370"
];
for (const fixture of legacyFixtures) test("legacy v" + fixture.number + " preview fingerprint remains byte-exact", () => {
  const result = parseHeadlessBuildPlanProposal(fixture.proposal, host, {allowLocalFileSave: true, allowProviderFileSave: true,
    allowLocalDatasetPreparation: true, allowDatasetResultSave: true, allowContextPackGeneration: true, allowContextRagGeneration: true,
    allowContextResultSave: true, allowContextQuery: true, allowModelDownload: true});
  assert.ok(result.ok); assert.equal(result.preview.version, "aisb-build-plan-preview-v" + fixture.number);
  assert.equal(createHash("sha256").update(JSON.stringify(result.preview)).digest("hex"), legacyHashes[fixture.number - 1]);
});
