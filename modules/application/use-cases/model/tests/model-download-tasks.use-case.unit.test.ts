import type { BigIntStats } from "node:fs";
import { lstat, mkdtemp, readFile, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Request, Response } from "express";
import { createLocalModelRegistryAdapter } from "../../../../adapters/persistence/model";
import { createInMemoryStructuredDocumentStore, createOrganizationContextStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { registerModelManagementApiRoutes, type ModelManagementExpressRoutePort } from "../../../../adapters/transport/api-express/model/registerModelManagementApiRoutes";
import { createExpressSecurityMiddleware } from "../../../../adapters/transport/api-express/security/createExpressSecurityMiddleware";
import { createExpressOrganizationContextScope } from "../../../../adapters/transport/api-express/security/expressOrganizationContextScope";
import { createOrganizationId } from "../../../../contracts/organization";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { TaskType, type RuntimeTaskRecord } from "../../../../contracts/runtime";
import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import type { ModelDownloadCompletionPort, ModelRegistryPort } from "../../../ports/model";
import type { RuntimeTaskRegistryPort } from "../../../ports/runtime";
import { ModelDownloadTasksUseCase } from "../model-download-tasks.use-case";
import { OwnedTaskReconcilerService } from "../../../services/runtime/owned-task-reconciler.service";

describe("ModelDownloadTasksUseCase", () => {
  const workspaceId = createWorkspaceId("workspace.downloads");
  for (const status of ["succeeded", "failed", "cancelled"] as const) it(`observes download ${status} without a renderer or automatic registration`, async () => {
    const reconciler = new OwnedTaskReconcilerService();
    const { useCase, setTask, completion, registerDownloadedModel } = createFixture(reconciler);
    await useCase.start({ workspaceId, provider: "huggingface", modelId: "org/model" });
    setTask({ status }); await reconciler.reconcileNow();
    expect(reconciler.status.pending).toBe(0); expect(completion.readCompletedModelDownload).not.toHaveBeenCalled(); expect(registerDownloadedModel).not.toHaveBeenCalled();
  });

  it("starts a short-lived registry task with a safe model payload", async () => {
    const { useCase, registry } = createFixture();
    const result = await useCase.start({
      workspaceId,
      provider: "huggingface",
      modelId: " org/model ",
      displayName: " Model ",
    });

    expect(result.activity).toMatchObject({ requestId: "download-1", workspaceId, modelId: "org/model", displayName: "Model", status: "queued" });
    expect(registry.startTask).toHaveBeenCalledWith({
      workspaceId,
      taskType: TaskType.MODEL_DOWNLOAD,
      concurrencyClass: "io",
      payload: { provider: "transformers", modelId: "org/model", inferenceMode: undefined, taskTags: undefined, artifactForm: undefined },
    });
  });

  it("projects authoritative progress without details or private payload data", async () => {
    const { useCase, setTask } = createFixture();
    await useCase.start({ workspaceId, provider: "huggingface", modelId: "org/model" });
    setTask({ status: "running", progress: { message: "Downloading", current: 25, total: 100, percent: 25, unit: "bytes", details: { token: "secret", path: "C:\\private" } }, data: { modelHandle: "private/handle" } });

    const result = await useCase.read({ workspaceId, requestId: "download-1" });

    expect(result.activity.progress).toEqual({ message: "Downloading", current: 25, total: 100, percent: 25, unit: "bytes" });
    expect(JSON.stringify(result)).not.toContain("modelHandle");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("keeps reads pure and registers exactly once through explicit authorized completion", async () => {
    const { useCase, setTask, completion, registerDownloadedModel } = createFixture();
    await useCase.start({ workspaceId, provider: "huggingface", modelId: "org/model", displayName: "Model" });
    setTask({ status: "succeeded", completedAt: "2026-07-29T12:01:00.000Z" });

    const [first, second] = await Promise.all([
      useCase.read({ workspaceId, requestId: "download-1" }),
      useCase.read({ workspaceId, requestId: "download-1" }),
    ]);

    expect(first.activity.status).toBe("succeeded");
    expect(second.activity.model).toBeUndefined();
    await useCase.list({ workspaceId, includeCompleted: true });
    expect(completion.readCompletedModelDownload).toHaveBeenCalledTimes(0);
    expect(registerDownloadedModel).toHaveBeenCalledTimes(0);
    await Promise.all([
      useCase.complete({ workspaceId, requestId: "download-1" }, { modelWriteAuthorized: true }),
      useCase.complete({ workspaceId, requestId: "download-1" }, { modelWriteAuthorized: true }),
    ]);
    const completed = await useCase.read({ workspaceId, requestId: "download-1" });
    expect(completed.activity.model?.modelRecordId).toBe("registered-model");
    expect(completion.readCompletedModelDownload).toHaveBeenCalledTimes(1);
    expect(registerDownloadedModel).toHaveBeenCalledTimes(1);
    expect(registerDownloadedModel.mock.calls[0]?.[0]?.localPath).toBe("C:\\cache\\org-model");
    expect(JSON.stringify(first.activity)).not.toContain("C:\\cache");
  });

  it("keeps authenticated model route reads pure and registers only in the original owner's partition", async () => {
    const fixture = createFixture();
    const scope = createExpressOrganizationContextScope();
    const documents = createInMemoryStructuredDocumentStore();
    const modelRegistry = createLocalModelRegistryAdapter({
      filePath: "unused-in-memory-model-registry.json",
      documents: createOrganizationContextStructuredDocumentStore(documents, scope),
      discovery: { enabled: false },
    });
    const register = testDouble.fn<ModelRegistryPort["registerDownloadedModel"]>(async (command) => {
      await Promise.resolve();
      expect(scope.getCurrentOrganizationContext()).toMatchObject({ organizationId: "org.a", principalId: "principal.a" });
      return modelRegistry.registerDownloadedModel(command);
    });
    const status = testDouble.fn((requestId: string) => fixture.registry.getTaskStatus(requestId));
    const useCase = new ModelDownloadTasksUseCase({
      runtimeTaskRegistry: { ...fixture.registry, getTaskStatus: status },
      modelDownloadCompletion: fixture.completion,
      modelRegistry: { ...modelRegistry, registerDownloadedModel: register },
    });
    const security = createExpressSecurityMiddleware({
      mode: "lan-https-token", authRequired: true, httpsRequired: true,
      organizationContextScope: scope, tenantPlacement: { mode: "pooled" },
      async verifyToken({ token }) {
        if (token !== "fixture-reader" && token !== "fixture-writer" && token !== "fixture-peer") {
          throw new Error("Unexpected fixture identity.");
        }
        return { authenticated: true, authMethod: "bearer-token", principal: {
          principalId: token === "fixture-peer" ? "principal.b" : "principal.a",
          kind: "device", roles: [], scopes: token === "fixture-reader" ? ["model:read"] : ["model:read", "model:write"],
        } };
      },
    });
    const routes = new Map<string, Parameters<ModelManagementExpressRoutePort["post"]>[1]>();
    const unused = { async execute(): Promise<never> { throw new Error("Unexpected model operation."); } };
    registerModelManagementApiRoutes({
      app: { post: (path, handler) => { routes.set(path, handler); } },
      browseModelsUseCase: unused, getModelDetailsUseCase: unused, listModelsUseCase: unused,
      saveModelReferenceUseCase: unused, downloadModelUseCase: unused,
      updateModelRecordUseCase: unused, deleteModelRecordUseCase: unused, modelDownloadTasksUseCase: useCase,
    });
    async function send(operation: "start" | "read" | "list" | "complete", body: object,
      identity: { token?: string; organizationId?: string } = {}) {
      const path = `/api/model/download/${operation}`;
      const handler = routes.get(path);
      if (!handler) throw new Error(`Fixture route is missing: ${operation}`);
      let bodyReads = 0, statusCode = 200;
      let payload: unknown;
      const request = {
        method: "POST", path, protocol: "https",
        headers: { authorization: `Bearer ${identity.token ?? "fixture-writer"}`, "x-organization-id": identity.organizationId ?? "org.a" },
        get body() { bodyReads++; return body; },
      };
      const response = {
        status(code: number) { statusCode = code; return response; },
        json(value: unknown) { payload = value; },
      };
      let action: Promise<void> | undefined;
      await security(request as unknown as Request, response as unknown as Response, () => { action = handler(request, response); });
      await action;
      return { statusCode, payload, bodyReads };
    }
    const task = { workspaceId, requestId: "download-1" };
    expect(await send("start", { workspaceId, provider: "huggingface", modelId: "org/model",
      organizationId: "org.b", principalId: "principal.b" })).toMatchObject({
      statusCode: 200, payload: { ok: true, value: { activity: { ...task, status: "queued" } } },
    });
    fixture.setTask({ status: "succeeded" });
    const reader = { token: "fixture-reader" };
    expect(await send("read", task, reader)).toMatchObject({ statusCode: 200,
      payload: { ok: true, value: { activity: { ...task, status: "succeeded" } } } });
    expect(await send("list", { workspaceId, includeCompleted: true }, reader)).toMatchObject({ statusCode: 200,
      payload: { ok: true, value: { activities: [{ ...task, status: "succeeded" }] } } });
    expect(status).toHaveBeenCalledTimes(1);
    expect(await send("complete", task, reader)).toMatchObject({ statusCode: 403, bodyReads: 0, payload: { ok: false } });
    const spoofed = { ...task, organizationId: "org.a", principalId: "principal.a", modelWriteAuthorized: true };
    for (const denial of [
      await send("complete", spoofed, { organizationId: "org.b" }),
      await send("complete", spoofed, { token: "fixture-peer" }),
      await send("complete", { ...task, workspaceId: "workspace.other" }),
      await send("complete", { ...task, requestId: "stale-download" }),
    ]) {
      expect(denial.statusCode >= 400).toBe(true);
      expect(denial.payload).toMatchObject({ ok: false });
    }
    expect(status).toHaveBeenCalledTimes(1);
    expect(fixture.completion.readCompletedModelDownload).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    const [first, duplicate] = await Promise.all([send("complete", task), send("complete", task)]);
    expect(first).toMatchObject({ statusCode: 200, payload: { ok: true, value: { activity: {
      ...task, model: { workspaceId, modelId: "org/model", lifecycleStatus: "downloaded" },
    } } } });
    expect(duplicate.payload).toEqual(first.payload);
    expect((await send("complete", task)).payload).toEqual(first.payload);
    expect(JSON.stringify(first.payload)).not.toContain("localPath");
    expect(fixture.completion.readCompletedModelDownload).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledTimes(1);
    for (const [organizationId, expected] of [["org.a", 1], ["org.b", 0]] as const) {
      const records = await scope.runWithOrganizationContext({ organizationId: createOrganizationId(organizationId),
        principalId: "principal.a" }, () => modelRegistry.listModels({ workspaceId }));
      expect(records.models.length).toBe(expected);
    }
  });

  it("denies cross-workspace reads before touching the registry", async () => {
    const { useCase, registry } = createFixture();
    await useCase.start({ workspaceId, provider: "huggingface", modelId: "org/model" });
    const otherWorkspace = createWorkspaceId("workspace.other");

    await expect(useCase.read({ workspaceId: otherWorkspace, requestId: "download-1" })).rejects.toThrow("not found in this workspace");
    expect(registry.getTaskStatus).not.toHaveBeenCalled();
  });

  it("does not replace or cancel the original owner if the runtime reuses a task ID", async () => {
    const { useCase, registry, setTask, completion, registerDownloadedModel } = createFixture();
    const owner = { organizationId: "org.a", principalId: "person.a", modelWriteAuthorized: true };
    const other = { ...owner, organizationId: "org.b" };
    const input = { workspaceId, provider: "huggingface" as const, modelId: "org/model" };
    const first = await useCase.start(input, owner);
    const identity = { workspaceId, requestId: first.activity.requestId };
    await expect(useCase.start(input, other)).rejects.toThrow("could not be admitted");
    expect(registry.cancelTask).not.toHaveBeenCalled();
    setTask({ status: "succeeded" });
    await expect(useCase.complete(identity, other)).rejects.toThrow("not found in this workspace");
    expect(registry.getTaskStatus).not.toHaveBeenCalled();
    expect(completion.readCompletedModelDownload).not.toHaveBeenCalled();
    expect(registerDownloadedModel).not.toHaveBeenCalled();
    expect((await useCase.complete(identity, owner)).activity.model?.modelRecordId).toBe("registered-model");
    expect(registerDownloadedModel).toHaveBeenCalledTimes(1);
  });

  it("does not accept late status, list, or cancel results after an ID is reused", async () => {
    const status = hold<RuntimeTaskRecord>();
    const list = hold<Awaited<ReturnType<RuntimeTaskRegistryPort["listTasks"]>>>();
    const cancel = hold<Awaited<ReturnType<RuntimeTaskRegistryPort["cancelTask"]>>>();
    const fixture = createRetirementFixture({
      getTaskStatus: () => status.result, listTasks: () => list.result, cancelTask: () => cancel.result,
    });
    const { useCase, owner, identity, task } = fixture;
    await fixture.start();
    const pending = Promise.allSettled([
      useCase.read(identity, owner),
      useCase.complete(identity, owner),
      useCase.cancel(identity, owner),
    ]);
    const listed = useCase.list({ workspaceId: identity.workspaceId, includeCompleted: true }, owner);
    await fixture.evict();
    await fixture.reuse(owner);
    status.resolve(task);
    list.resolve({ tasks: [task] });
    cancel.resolve({ requestId: identity.requestId, cancelled: true, status: "cancelled" });
    for (const result of await pending) {
      expect(result).toMatchObject({ status: "rejected", reason: { message: "Model download task was not found in this workspace." } });
    }
    expect(await listed).toEqual({ activities: [] });
    expect(fixture.registerDownloadedModel).not.toHaveBeenCalled();
  });

  it("does not start a registry write when a completion payload arrives after retirement", async () => {
    const started = hold<void>();
    const payload = hold<Awaited<ReturnType<ModelDownloadCompletionPort["readCompletedModelDownload"]>>>();
    const fixture = createRetirementFixture({}, { readCompletedModelDownload: () => { started.resolve(); return payload.result; } });
    const { useCase, owner, identity } = fixture;
    await fixture.start();
    const pending = Promise.allSettled([useCase.complete(identity, owner)]);
    await started.result;
    await fixture.evict();
    await fixture.reuse(fixture.otherOwner);
    payload.resolve({ modelId: "org/model", provider: "transformers", downloaded: true, fromCache: false, localPath: "C:\\cache\\fixture" });
    expect((await pending)[0]).toMatchObject({ status: "rejected", reason: { message: "Model download task was not found in this workspace." } });
    expect(fixture.registerDownloadedModel).not.toHaveBeenCalled();
  });

  it("does not attach a late authorized registry result to a new owner of the same ID", async () => {
    const started = hold<void>();
    const written = hold<void>();
    const original = createFixture();
    const register = testDouble.fn<ModelRegistryPort["registerDownloadedModel"]>(async (request) => {
      started.resolve();
      await written.result;
      return original.registerDownloadedModel(request);
    });
    const fixture = createRetirementFixture({}, undefined, register);
    const { useCase, owner, otherOwner, identity } = fixture;
    await fixture.start();
    const pending = Promise.allSettled([useCase.complete(identity, owner)]);
    await started.result;
    await fixture.evict();
    await fixture.reuse(otherOwner);
    written.resolve();
    expect((await pending)[0]).toMatchObject({ status: "rejected", reason: { message: "Model download task was not found in this workspace." } });
    expect(register).toHaveBeenCalledTimes(1);
    const replacement = await useCase.read(identity, otherOwner);
    expect(replacement.activity).toMatchObject({ modelId: "org/replacement", status: "succeeded" });
    expect(replacement.activity.model).toBeUndefined();
  });

  it("keeps an evicted ID reserved until its original runtime observer settles", async () => {
    const reconciler = new OwnedTaskReconcilerService();
    let terminal = false;
    const fixture = createRetirementFixture({
      getTaskStatus: async (requestId) => ({ ...fixture.task, requestId, status: terminal && requestId === fixture.identity.requestId ? "succeeded" : "running" }),
    }, undefined, undefined, reconciler);
    try {
      await fixture.start();
      await fixture.evict();
      await expect(fixture.reuse(fixture.otherOwner)).rejects.toThrow("could not be admitted");
      terminal = true;
      await reconciler.reconcileNow();
      expect((await fixture.reuse(fixture.otherOwner)).activity.modelId).toBe("org/replacement");
    } finally {
      reconciler.stopObservation();
    }
  });

  it("keeps an evicted ID reserved when terminal observation races a pending cancellation", async () => {
    const reconciler = new OwnedTaskReconcilerService();
    const startReply = hold<void>();
    const cancellationStarted = hold<void>();
    const cancellationReply = hold<Awaited<ReturnType<RuntimeTaskRegistryPort["cancelTask"]>>>();
    let terminal = false;
    let originalCancelCalls = 0;
    const fixture = createRetirementFixture({
      getTaskStatus: async (requestId) => ({ ...fixture.task, requestId, status: terminal && requestId === fixture.identity.requestId ? "succeeded" : "running" }),
      cancelTask: async (requestId) => {
        if (requestId !== fixture.identity.requestId) return { requestId, status: "running", cancelled: false };
        originalCancelCalls++;
        cancellationStarted.resolve();
        return cancellationReply.result;
      },
    }, undefined, undefined, reconciler);
    await fixture.start();
    await fixture.evict();
    const duplicate = Promise.allSettled([fixture.reuse(fixture.otherOwner, startReply.result)]);
    const shutdown = reconciler.cancelAndReconcile();
    try {
      await cancellationStarted.result;
      terminal = true;
      await reconciler.reconcileNow();
      startReply.resolve();
      expect((await duplicate)[0]).toMatchObject({ status: "rejected", reason: { message: "The model download task could not be admitted." } });
      expect(originalCancelCalls).toBe(1);
    } finally {
      startReply.resolve();
      cancellationReply.resolve({ requestId: fixture.identity.requestId, status: "cancelled", cancelled: true });
      await shutdown;
      reconciler.stopObservation();
    }
  });

  it("preserves a saved registry and denies stale completion after reopening the controller", async () => {
    const { registry, setTask, completion } = createFixture();
    const owner = { organizationId: "org.a", principalId: "person.a", modelWriteAuthorized: true };
    const parent = await realpath(tmpdir());
    const root = await mkdtemp(join(parent, "download-replay-"));
    const folder = await lstat(root, { bigint: true });
    expect(folder.isDirectory() && !folder.isSymbolicLink() && folder.ino !== 0n).toBe(true);
    const filePath = join(root, "models.json");
    let written: BigIntStats | undefined;
    try {
      const store = (date: string) => createLocalModelRegistryAdapter({
        filePath, discovery: { enabled: false }, now: () => date,
      });
      const original = store("2026-11-06T12:00:00.000Z");
      const originalWrite = testDouble.fn(original.registerDownloadedModel);
      const current = new ModelDownloadTasksUseCase({
        runtimeTaskRegistry: registry, modelDownloadCompletion: completion,
        modelRegistry: { ...original, registerDownloadedModel: originalWrite },
      });
      const started = await current.start({ workspaceId, provider: "huggingface", modelId: "org/model" }, owner);
      const identity = { workspaceId, requestId: started.activity.requestId };
      setTask({ status: "succeeded" });
      const [registered] = await Promise.all([current.complete(identity, owner), current.complete(identity, owner)]);
      written = await lstat(filePath, { bigint: true });
      expect(originalWrite).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(registered.activity)).not.toContain('"localPath":');
      const originalBytes = await readFile(filePath);

      const reopened = store("2026-11-06T12:30:00.000Z");
      const read = testDouble.fn(registry.getTaskStatus);
      const list = testDouble.fn(registry.listTasks);
      const readCompletion = testDouble.fn(completion.readCompletedModelDownload);
      const write = testDouble.fn(reopened.registerDownloadedModel);
      const fresh = new ModelDownloadTasksUseCase({
        runtimeTaskRegistry: { ...registry, getTaskStatus: read, listTasks: list },
        modelDownloadCompletion: { readCompletedModelDownload: readCompletion },
        modelRegistry: { ...reopened, registerDownloadedModel: write },
      });
      for (const replay of [owner, { ...owner, modelWriteAuthorized: false }, { ...owner, organizationId: "org.b" }]) {
        await expect(fresh.complete(identity, replay)).rejects.toThrow();
        await expect(fresh.read(identity, replay)).rejects.toThrow("not found in this workspace");
        expect(await fresh.list({ workspaceId, includeCompleted: true }, replay)).toEqual({ activities: [] });
      }
      expect(read).not.toHaveBeenCalled();
      expect(list).not.toHaveBeenCalled();
      expect(readCompletion).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      expect((await reopened.listModels({ workspaceId })).models.map((model) => model.modelRecordId)).toEqual([
        registered.activity.model?.modelRecordId,
      ]);
      expect(await readFile(filePath)).toEqual(originalBytes);
    } finally {
      expect(dirname(root)).toBe(parent);
      expect(await realpath(root)).toBe(root);
      const currentFolder = await lstat(root, { bigint: true });
      expect(currentFolder.isDirectory() && currentFolder.dev === folder.dev && currentFolder.ino === folder.ino).toBe(true);
      if (written) {
        expect(await readdir(root)).toEqual(["models.json"]);
        const currentFile = await lstat(filePath, { bigint: true });
        expect(currentFile.isFile() && currentFile.dev === written.dev && currentFile.ino === written.ino && written.ino !== 0n).toBe(true);
        await unlink(filePath);
      } else {
        expect(await readdir(root)).toEqual([]);
      }
      await rmdir(root);
    }
  });

  it("keeps the original organization and user while the runtime admits a download", async () => {
    const { useCase, registry } = createFixture();
    const admitted = hold<Awaited<ReturnType<RuntimeTaskRegistryPort["startTask"]>>>();
    registry.startTask = () => admitted.result;
    const owner = { organizationId: "org.a", principalId: "person.a" };
    const mutable = { ...owner };
    const starting = useCase.start({ workspaceId, provider: "huggingface", modelId: "org/model" }, mutable);
    Object.assign(mutable, { organizationId: "org.b", principalId: "person.b" });
    admitted.resolve({ requestId: "download-1", status: "queued" });
    await starting;

    const identity = { workspaceId, requestId: "download-1" };
    await expect(useCase.read(identity, mutable)).rejects.toThrow("not found in this workspace");
    expect(registry.getTaskStatus).not.toHaveBeenCalled();
    expect((await useCase.read(identity, owner)).activity.requestId).toBe(identity.requestId);
  });

  it("uses the admitted metadata when a download is later registered", async () => {
    const { useCase, registry, setTask, registerDownloadedModel } = createFixture();
    const admitted = hold<Awaited<ReturnType<RuntimeTaskRegistryPort["startTask"]>>>();
    registry.startTask = () => admitted.result;
    const owner = { organizationId: "org.a", principalId: "person.a", modelWriteAuthorized: true };
    const metadata = { notes: { label: "Original" } };
    const starting = useCase.start({ workspaceId, provider: "huggingface", modelId: "org/model", metadata }, owner);
    metadata.notes.label = "Changed";
    admitted.resolve({ requestId: "download-1", status: "queued" });
    await starting;
    setTask({ status: "succeeded" });
    await useCase.complete({ workspaceId, requestId: "download-1" }, owner);

    expect(registerDownloadedModel).toHaveBeenCalledTimes(1);
    expect(registerDownloadedModel.mock.calls[0]?.[0]?.metadata).toMatchObject({ notes: { label: "Original" } });
  });

  it("keeps lists within the originally authorized owner when the registry replies late", async () => {
    const { useCase, registry } = createFixture();
    const first = { organizationId: "org.a", principalId: "person.a" };
    const second = { organizationId: "org.b", principalId: "person.b" };
    let next = 0;
    registry.startTask = async () => ({ requestId: `download-${++next}`, status: "queued" });
    for (const owner of [first, second]) await useCase.start({ workspaceId, provider: "huggingface", modelId: "org/model" }, owner);
    const listed = hold<Awaited<ReturnType<RuntimeTaskRegistryPort["listTasks"]>>>();
    registry.listTasks = () => listed.result;
    const mutable = { ...first };
    const listing = useCase.list({ workspaceId }, mutable);
    Object.assign(mutable, second);
    listed.resolve({ tasks: [1, 2].map(id => ({ requestId: `download-${id}`, workspaceId, taskType: TaskType.MODEL_DOWNLOAD, status: "queued", concurrencyClass: "io" })) });
    expect((await listing).activities.map(activity => activity.requestId)).toEqual(["download-1"]);
  });

  it("keeps cancellation confirmation in the original owner scope", async () => {
    const { useCase, registry, setTask } = createFixture();
    const mutable = { organizationId: "org.a", principalId: "person.a" };
    await useCase.start({ workspaceId, provider: "huggingface", modelId: "org/model" }, mutable);
    const acknowledgement = hold<Awaited<ReturnType<RuntimeTaskRegistryPort["cancelTask"]>>>();
    registry.cancelTask = () => acknowledgement.result;
    const cancelling = useCase.cancel({ workspaceId, requestId: "download-1" }, mutable);
    mutable.principalId = "person.b";
    setTask({ status: "cancelled" });
    acknowledgement.resolve({ requestId: "download-1", cancelled: true, status: "cancelled" });
    expect(await cancelling).toMatchObject({ cancelled: true, activity: { requestId: "download-1", status: "cancelled" } });
  });

  for (const patch of [
    { requestId: "download-other" },
    { workspaceId: createWorkspaceId("workspace.other") },
    { taskType: TaskType.MODEL_TRAINING },
  ]) it(`rejects substituted task identity before completion effects: ${Object.keys(patch)[0]}`, async () => {
    const { useCase, setTask, completion, registerDownloadedModel } = createFixture();
    await useCase.start({ workspaceId, provider: "huggingface", modelId: "org/model" });
    setTask({ status: "succeeded", ...patch });
    await expect(useCase.read({ workspaceId, requestId: "download-1" })).rejects.toThrow("not found in this workspace");
    await expect(useCase.complete({ workspaceId, requestId: "download-1" }, { modelWriteAuthorized: true })).rejects.toThrow("not found in this workspace");
    expect(completion.readCompletedModelDownload).not.toHaveBeenCalled();
    expect(registerDownloadedModel).not.toHaveBeenCalled();
    setTask({ requestId: "download-1", workspaceId, taskType: TaskType.MODEL_DOWNLOAD });
    await useCase.complete({ workspaceId, requestId: "download-1" }, { modelWriteAuthorized: true });
    expect(completion.readCompletedModelDownload).toHaveBeenCalledTimes(1);
    expect(registerDownloadedModel).toHaveBeenCalledTimes(1);
  });

  it("filters substituted task types from owned download lists", async () => {
    const { useCase, setTask, completion, registerDownloadedModel } = createFixture();
    await useCase.start({ workspaceId, provider: "huggingface", modelId: "org/model" });
    setTask({ taskType: TaskType.MODEL_TRAINING, status: "succeeded" });
    expect((await useCase.list({ workspaceId, includeCompleted: true })).activities).toEqual([]);
    expect(completion.readCompletedModelDownload).not.toHaveBeenCalled();
    expect(registerDownloadedModel).not.toHaveBeenCalled();
    setTask({ taskType: TaskType.MODEL_DOWNLOAD });
    expect((await useCase.list({ workspaceId, includeCompleted: true })).activities.length).toBe(1);
  });

  it("never confirms a cancellation acknowledgement for another task", async () => {
    const { useCase, setTask, registry, completion, registerDownloadedModel } = createFixture();
    await useCase.start({ workspaceId, provider: "huggingface", modelId: "org/model" });
    setTask({ requestId: "download-other", status: "cancelled" });
    await expect(useCase.cancel({ workspaceId, requestId: "download-1" })).rejects.toThrow("cancellation could not be confirmed");
    expect(registry.cancelTask).toHaveBeenCalledWith("download-1");
    expect(registry.getTaskStatus).not.toHaveBeenCalled();
    expect(completion.readCompletedModelDownload).not.toHaveBeenCalled();
    expect(registerDownloadedModel).not.toHaveBeenCalled();
    setTask({ requestId: "download-1" });
    expect((await useCase.cancel({ workspaceId, requestId: "download-1" })).cancelled).toBe(true);
  });

  it("redacts runtime failure paths and secret-like values", async () => {
    const { useCase, setTask } = createFixture();
    await useCase.start({ workspaceId, provider: "huggingface", modelId: "org/model" });
    setTask({ status: "failed", error: { code: "download_failed", message: "token=hidden at C:\\private\\model" } });
    const result = await useCase.read({ workspaceId, requestId: "download-1" });
    expect(result.activity.error?.message).toContain("token=[redacted]");
    expect(result.activity.error?.message).toContain("[local path]");
    expect(JSON.stringify(result)).not.toContain("hidden");
    expect(JSON.stringify(result)).not.toContain("C:\\private");
  });
});

function hold<T>() {
  let resolve!: (value: T) => void;
  const result = new Promise<T>((settle) => { resolve = settle; });
  return { result, resolve };
}

function createFixture(taskReconciler?: OwnedTaskReconcilerService) {
  const workspaceId = createWorkspaceId("workspace.downloads");
  let task: RuntimeTaskRecord = {
    requestId: "download-1",
    workspaceId,
    taskType: TaskType.MODEL_DOWNLOAD,
    status: "queued",
    concurrencyClass: "io",
  };
  const registry: RuntimeTaskRegistryPort = {
    startTask: testDouble.fn(async () => ({ requestId: "download-1", status: "queued" })),
    getTaskStatus: testDouble.fn(async () => task),
    cancelTask: testDouble.fn(async () => ({ requestId: task.requestId, cancelled: true, status: "cancelled" })),
    listTasks: testDouble.fn(async () => ({ tasks: [task] })),
  };
  const completion = {
    readCompletedModelDownload: testDouble.fn(async () => ({
      provider: "transformers" as const,
      modelId: "org/model",
      downloaded: true,
      fromCache: false,
      localPath: "C:\\cache\\org-model",
    })),
  };
  const registerDownloadedModel = testDouble.fn<ModelRegistryPort["registerDownloadedModel"]>(async (request) => ({
    model: {
      workspaceId: request.workspaceId,
      modelRecordId: "registered-model",
      displayName: request.displayName,
      source: "huggingface",
      lifecycleStatus: "downloaded",
      artifactForm: request.artifactForm,
      provider: request.provider,
      modelId: request.modelId,
      localPath: request.localPath,
      createdAt: "2026-07-29T12:01:00.000Z",
    },
  }));
  const modelRegistry = {
    registerDownloadedModel,
  } as unknown as ModelRegistryPort;
  return {
    useCase: new ModelDownloadTasksUseCase({ taskReconciler, runtimeTaskRegistry: registry, modelDownloadCompletion: completion, modelRegistry, now: () => "2026-07-29T12:00:00.000Z" }),
    registry,
    completion,
    registerDownloadedModel,
    setTask(patch: Partial<RuntimeTaskRecord>) { task = { ...task, ...patch }; },
  };
}

function createRetirementFixture(
  runtime: Partial<RuntimeTaskRegistryPort> = {},
  completion?: ModelDownloadCompletionPort,
  register?: ModelRegistryPort["registerDownloadedModel"],
  taskReconciler?: OwnedTaskReconcilerService,
) {
  const base = createFixture();
  const workspaceId = createWorkspaceId("workspace.downloads");
  const identity = { workspaceId, requestId: "download-1" };
  const owner = { organizationId: "org.a", principalId: "person.a", modelWriteAuthorized: true };
  const otherOwner = { ...owner, organizationId: "org.b" };
  const task: RuntimeTaskRecord = { ...identity, taskType: TaskType.MODEL_DOWNLOAD, concurrencyClass: "io", status: "succeeded" };
  const input = { workspaceId, provider: "huggingface" as const, modelId: "org/model" };
  let next = identity.requestId;
  let nextReply: Promise<void> | undefined;
  const registerDownloadedModel = register ?? base.registerDownloadedModel;
  const useCase = new ModelDownloadTasksUseCase({
    runtimeTaskRegistry: {
      ...base.registry,
      getTaskStatus: async () => task,
      ...runtime,
      startTask: async () => {
        const requestId = next;
        const reply = nextReply;
        nextReply = undefined;
        if (reply) await reply;
        return { requestId, status: "queued" };
      },
    },
    modelDownloadCompletion: completion ?? base.completion,
    modelRegistry: { registerDownloadedModel } as ModelRegistryPort,
    taskReconciler,
  });
  return {
    useCase, identity, owner, otherOwner, task, registerDownloadedModel,
    start: () => useCase.start(input, owner),
    async evict() {
      for (let index = 0; index < 100; index++) {
        next = "fixture-download-" + index;
        await useCase.start(input, otherOwner);
      }
    },
    reuse(authority: typeof owner, reply?: Promise<void>) {
      next = identity.requestId;
      nextReply = reply;
      return useCase.start({ ...input, modelId: "org/replacement" }, authority);
    },
  };
}


it("rejects missing write authority and changed execution identity before runtime or registration", async () => {
  const { useCase, registry, setTask, registerDownloadedModel } = createFixture();
  const workspaceId = createWorkspaceId("workspace.downloads");
  const owner = { organizationId: "org.a", principalId: "person.a", modelWriteAuthorized: true };
  await useCase.start({ workspaceId, provider: "huggingface", modelId: "org/model" }, owner);
  setTask({ status: "succeeded" });
  for (const other of [{ ...owner, modelWriteAuthorized: false }, { ...owner, organizationId: "org.b" }, { ...owner, principalId: "person.b" }, undefined]) {
    await expect(useCase.complete({ workspaceId, requestId: "download-1" }, other)).rejects.toThrow();
  }
  expect(registry.getTaskStatus).toHaveBeenCalledTimes(0);
  expect(registerDownloadedModel).toHaveBeenCalledTimes(0);
  await expect(useCase.read({ workspaceId, requestId: "download-1" }, { organizationId: "org.b", principalId: "person.a" })).rejects.toThrow();
  expect(registry.getTaskStatus).toHaveBeenCalledTimes(0);
});
