import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { testDouble } from "../../../../testing/node-test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createStructuredIngestionAcquisitionRepository } from "../../../../adapters/persistence/ingestion";
import { createLocalArtifactCatalogPersistenceAdapter, createLocalArtifactStorageBindingAdapter } from "../../../../adapters/storage/filesystem";
import type { ApiIngestionTaskExecuteResponse } from "../../../../contracts/api";
import type { IngestionTaskTransportCommand } from "../../../../contracts/ingestion";
import { createOrganizationId } from "../../../../contracts/organization";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { composeServerHost } from "../composeServerHost";

// In-process route/composition proof only: no HTTP authentication, model,
// provider credential or hostile native-filesystem qualification is inferred.
test("composed server refuses ingestion without an authoritative organization context provider", { timeout: 45_000 }, async () => {
  const parent = await realpath(tmpdir());
  const fixture = await realpath(await mkdtemp(path.join(parent, "server-ingestion-unavailable-")));
  const documents = createInMemoryStructuredDocumentStore();
  const organizationId = createOrganizationId("organization-a");
  const app = { post: testDouble.fn(), get: testDouble.fn(), patch: testDouble.fn(), delete: testDouble.fn() };
  const host = composeServerHost({ env: { NODE_ENV: "test" },
    persistence: { documents, organizationDocuments: documents.forOrganization(organizationId) },
    settings: { localSettingsFilePath: path.join(fixture, "settings.json") },
    artifactRepo: { providerCredentialRootDirectory: path.join(fixture, "credentials"),
      huggingFaceTokenConfigFilePath: path.join(fixture, "no-legacy-token.json") }, logSink() {},
  });
  try {
    host.registerApi({ app, storageRootDirectory: path.join(fixture, "storage"), runtimeRootDirectory: path.join(fixture, "runtime") });
    await host.waitForAssetFoundation();
    const registration = app.post.mock.calls.find(call => call[0] === "/api/ingestion/tasks/execute");
    assert.ok(registration);
    let status = 0, body: ApiIngestionTaskExecuteResponse | undefined;
    const response = { status(value: number) { status = value; return response; }, json(value: ApiIngestionTaskExecuteResponse) { body = value; } };
    await (registration.at(-1) as Function)({ body: { workspaceId: "workspace-a", command: { action: "create-files", files: [{ fileName: "denied.csv", mediaType: "text/csv", sizeBytes: 4 }] } } }, response);
    assert.equal(status, 503); assert.ok(body && !body.ok); assert.equal(body.error.code, "unavailable");
  } finally {
    await host.closeRuntimeDatabases();
    const target = await realpath(fixture); assert.equal(target, fixture); assert.equal(path.dirname(target), parent);
    assert.ok(path.basename(target).startsWith("server-ingestion-unavailable-"));
    await rm(target, { recursive: true, force: true });
  }
});

test("composed server local ingestion publishes one scoped primary source and denies foreign task access", {timeout: 45_000}, async () => {
  const parent = await realpath(tmpdir());
  const fixture = await mkdtemp(path.join(parent, "server-owned-source-"));
  const allocated = await realpath(fixture);
  const storageRoot = path.join(fixture, "storage");
  const documents = createInMemoryStructuredDocumentStore();
  const organizationId = createOrganizationId("organization-a");
  const scopedDocuments = documents.forOrganization(organizationId);
  const workspaceId = createWorkspaceId("workspace-a");
  const otherWorkspaceId = createWorkspaceId("workspace-b");
  const now = "2026-10-24T12:00:00.000Z";
  let contextAvailable = true;
  let providerCalls = 0;
  const unexpectedProvider = async () => { providerCalls++; throw new Error("Unexpected synthetic provider request"); };
  const organizationContextProvider = { getCurrentOrganizationContext() {
    if (!contextAvailable) throw new Error("Synthetic organization context unavailable");
    return {organizationId, principalId: "principal-a"};
  } };
  const app = { post: testDouble.fn(), get: testDouble.fn(), patch: testDouble.fn(), delete: testDouble.fn() };
  const host = composeServerHost({
    env: {NODE_ENV: "test"},
    persistence: {documents, organizationDocuments: scopedDocuments},
    organizationContextProvider,
    settings: {localSettingsFilePath: path.join(fixture, "settings.json")},
    artifactRepo: {
      providerCredentialRootDirectory: path.join(fixture, "credentials"),
      huggingFaceTokenConfigFilePath: path.join(fixture, "no-legacy-token.json"),
      huggingFaceFetchImplementation: unexpectedProvider,
      huggingFaceHubClient: {fileExists: unexpectedProvider, uploadFile: unexpectedProvider, downloadFile: unexpectedProvider},
    },
    logSink() {}, now: () => now,
  });
  try {
    host.registerApi({app, storageRootDirectory: storageRoot, runtimeRootDirectory: path.join(fixture, "runtime")});
    await host.waitForAssetFoundation();
    const registry = host.getInternalAssetRegistry();
    assert.ok(registry);
    for (const id of [workspaceId, otherWorkspaceId]) {
      await registry.workspaceRepositories.workspaceRepository.saveWorkspace({workspaceId: id, organizationId,
        displayName: id, status: "active", createdAt: now, updatedAt: now});
    }
    const registration = app.post.mock.calls.find(call => call[0] === "/api/ingestion/tasks/execute");
    assert.ok(registration);
    type Response = {status(code: number): Response; json(value: ApiIngestionTaskExecuteResponse): void};
    const handler = registration.at(-1) as (request: {body: unknown}, response: Response) => Promise<void>;
    assert.equal(typeof handler, "function");
    async function invoke(command: IngestionTaskTransportCommand, selected: string = workspaceId) {
      let status = 0;
      let payload: ApiIngestionTaskExecuteResponse | undefined;
      const response: Response = {status(code) {status = code; return response;}, json(value) {payload = value;}};
      await handler({body: {workspaceId: selected, command}}, response);
      assert.ok(payload);
      return {status, payload};
    }
    const bytes = Buffer.from("question,answer\nWhat powers solar panels?,Light\n");
    const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const created = await invoke({action: "create-files", files: [{fileName: "energy.csv", mediaType: "text/csv", sizeBytes: bytes.length}]});
    assert.equal(created.status, 200);
    assert.ok(created.payload.ok && created.payload.value.kind === "task");
    const task = created.payload.value.task;
    const file = task.files[0]!;
    const append: IngestionTaskTransportCommand = {action: "append-chunk", taskId: task.taskId, fileId: file.fileId,
      chunkIndex: 0, expectedOffset: 0, bytes, sha256};
    const foreign = await invoke(append, otherWorkspaceId);
    assert.equal(foreign.payload.ok, false);
    const repository = createStructuredIngestionAcquisitionRepository(scopedDocuments);
    assert.equal((await repository.readTask(workspaceId, task.taskId))?.files[0]?.acceptedBytes, 0);
    assert.equal(await repository.readTask(otherWorkspaceId, task.taskId), undefined);
    assert.equal((await invoke(append)).payload.ok, true);
    const finalized = await invoke({action: "finalize-file", taskId: task.taskId, fileId: file.fileId, sha256});
    assert.equal(finalized.status, 200);
    assert.ok(finalized.payload.ok && finalized.payload.value.kind === "task");
    assert.equal(finalized.payload.value.task.status, "succeeded");
    const output = finalized.payload.value.task.files[0]!.output!;
    assert.match(output.key, /^workspaces\/workspace-a\/artifacts\/files\/ingestion\/[a-f0-9]{32}$/);
    assert.deepEqual(await readFile(path.join(storageRoot, "organizations", organizationId, output.key)), bytes);
    await assert.rejects(readFile(path.join(storageRoot, output.key)), {code: "ENOENT"});
    const context = {workspaceId, organizationId, principalId: "principal-a"};
    const bindings = createLocalArtifactStorageBindingAdapter({rootDirectory: storageRoot, documents: scopedDocuments});
    const origin = await bindings.readArtifactStorageBindings({workspaceId, artifactId: output.key}, context);
    assert.ok(origin.ok);
    assert.equal(origin.value.bindings.length, 1);
    assert.equal(origin.value.bindings[0]!.role, "primary");
    assert.deepEqual(origin.value.bindings[0]!.backing, {kind: "artifact-object", provider: "local-filesystem", locator: output.key, revision: undefined});
    const catalog = createLocalArtifactCatalogPersistenceAdapter({rootDirectory: storageRoot, documents: scopedDocuments});
    const record = await catalog.readArtifactCatalogRecord({workspaceId, storageKey: output.key}, context);
    assert.ok(record.ok);
    assert.equal(record.value.record.workspaceId, workspaceId);
    assert.equal(record.value.record.checksum?.value, sha256.slice(7));
    const snapshot = await repository.readSourceSnapshot(workspaceId, output.sourceSnapshotId as never);
    assert.equal(snapshot?.rawArtifactKey, output.key);
    assert.equal(snapshot?.contentDigest, sha256);
    contextAvailable = false;
    const unavailable = await invoke({action: "create-files", files: [{fileName: "denied.csv", mediaType: "text/csv", sizeBytes: bytes.length}]});
    assert.equal(unavailable.payload.ok, false);
    assert.equal((await repository.listTasks(workspaceId)).length, 1);
    assert.equal(providerCalls, 0);
    assert.doesNotMatch(JSON.stringify(finalized.payload), /server-owned-source|[A-Z]:\\/);
  } finally {
    contextAvailable = true;
    // Retain fixtures if shutdown fails; never remove live host state.
    await host.closeRuntimeDatabases();
    const target = await realpath(fixture);
    assert.equal(target, allocated);
    assert.equal(path.dirname(target), parent);
    assert.ok(path.basename(target).startsWith("server-owned-source-"));
    await rm(target, {recursive: true, force: true});
  }
});
