import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../testing/node-test";
import type { ImageGenerationRequest } from "../../../../contracts/image-generation";
import {
  TaskType,
  createRuntimeCapabilityStatus,
} from "../../../../contracts/runtime";
import type { RuntimeTaskRegistryPort } from "../../../ports/runtime";
import { GenerateImageUseCase } from "../generate-image.use-case";
import {ImageGenerationTaskAuthorityService} from "../../../services/image/image-generation-task-authority.service";
import {OwnedTaskReconcilerService} from "../../../services/runtime/owned-task-reconciler.service";
import type {ApplicationRequestContext} from "../../../ports";

function createRuntimeTaskRegistryFake(): RuntimeTaskRegistryPort {
  return {
    startTask: testDouble.fn(async () => ({
      requestId: "img-req-1",
      status: "queued",
      metadata: { engine: "comfyui" },
    })),
    getTaskStatus: testDouble.fn(async () => ({
      requestId: "img-req-1",
      workspaceId: "workspace-a" as never,
      taskType: TaskType.IMAGE_GENERATION,
      status: "running",
      concurrencyClass: "unknown",
    })),
    cancelTask: testDouble.fn(async () => ({
      requestId: "img-req-1",
      status: "cancelled",
      cancelled: true,
    })),
    listTasks: testDouble.fn(async () => ({ tasks: [] })),
  };
}

describe("GenerateImageUseCase", () => {
  it('detaches admitted request data before authority and model awaits',async()=>{
    const runtimeTaskRegistry=createRuntimeTaskRegistryFake();
    const request:ImageGenerationRequest={prompt:'Original',latentSource:{kind:'artifact',artifactId:'before.latent'},faceId:{enabled:true,references:[{artifactId:'before.face'}]},engineHints:{quality:'balanced'}};
    const useCase=new GenerateImageUseCase({runtimeTaskRegistry,createRequestId:()=> 'img-req-1',taskAuthority:{reserve:async()=>{
      request.prompt='x'.repeat(10_001);request.latentSource={kind:'artifact',artifactId:'after.latent'};
      request.faceId!.references[0].artifactId='after.face';request.engineHints!.quality='changed';
      return{accept(){},release(){}};
    },assertOwned:async()=>{}} as never});
    await useCase.startImageGeneration(request,{workspaceId:'workspace-a'});
    const payload=(runtimeTaskRegistry.startTask as ReturnType<typeof testDouble.fn>).mock.calls[0][0].payload;
    expect(payload).toMatchObject({prompt:'Original',latentSource:{artifactId:'before.latent'},faceId:{references:[{artifactId:'before.face'}]},engineHints:{quality:'balanced'}});
  });
  const validRequest: ImageGenerationRequest = {
    prompt: "cinematic portrait",
    width: 1024,
    height: 1024,
    steps: 28,
  };

  it("rejects empty prompt", async () => {
    const useCase = createUseCase({
      runtimeTaskRegistry: createRuntimeTaskRegistryFake(),
    });
    await expect(
      useCase.startImageGeneration(
        { ...validRequest, prompt: "   " },
        { workspaceId: "workspace-a" },
      ),
    ).rejects.toThrow("Image generation requires a non-empty prompt.");
  });

  it("rejects generation work that exceeds prompt, dimension, step, and batch budgets", async () => {
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    const useCase = createUseCase({ runtimeTaskRegistry });

    await expect(
      useCase.startImageGeneration(
        { ...validRequest, prompt: "x".repeat(10_001) },
        { workspaceId: "workspace-a" },
      ),
    ).rejects.toThrow("maximum length");
    await expect(
      useCase.startImageGeneration(
        { ...validRequest, width: 4_097 },
        { workspaceId: "workspace-a" },
      ),
    ).rejects.toThrow("width");
    await expect(
      useCase.startImageGeneration(
        { ...validRequest, steps: 201 },
        { workspaceId: "workspace-a" },
      ),
    ).rejects.toThrow("steps");
    await expect(
      useCase.startImageGeneration(
        { ...validRequest, numImages: 9 },
        { workspaceId: "workspace-a" },
      ),
    ).rejects.toThrow("image count");
    expect(runtimeTaskRegistry.startTask).not.toHaveBeenCalled();
  });

  it("prepares the runtime and checks image-generation readiness before starting runtime task", async () => {
    const calls: string[] = [];
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    const runtimeCapabilityGuard = {
      requireCapabilityReady: testDouble.fn(async () => {
        calls.push("guard.ready");
        return createRuntimeCapabilityStatus({
          capabilityId: "image-generation",
          status: "ready",
        });
      }),
    };
    const modelCheckpointResolver = {
      resolveCheckpoint: testDouble.fn(async () => {
        calls.push("runtime.prepare");
        return {};
      }),
    };
    const useCase = createUseCase({
      runtimeTaskRegistry,
      runtimeCapabilityGuard,
      modelCheckpointResolver,
    });

    await useCase.startImageGeneration(validRequest, {
      workspaceId: "workspace-a",
    });

    expect(runtimeCapabilityGuard.requireCapabilityReady).toHaveBeenCalledWith(
      "image-generation",
    );
    expect(runtimeTaskRegistry.startTask).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["runtime.prepare", "guard.ready"]);
  });

  it("prepares the runtime before reporting unavailable readiness and does not submit a task", async () => {
    const calls: string[] = [];
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    const unavailable = new Error(
      "Runtime capability 'image-generation' is starting.",
    ) as Error & { code: "unavailable"; details: Record<string, unknown> };
    unavailable.code = "unavailable";
    unavailable.name = "RuntimeCapabilityUnavailableError";
    unavailable.details = {
      capabilityId: "image-generation",
      status: "starting",
      recommendedActions: ["wait"],
    };
    const useCase = createUseCase({
      runtimeTaskRegistry,
      modelCheckpointResolver: {
        resolveCheckpoint: testDouble.fn(async () => {
          calls.push("runtime.prepare");
          return {};
        }),
      },
      runtimeCapabilityGuard: {
        requireCapabilityReady: testDouble.fn(async () => {
          calls.push("guard.unavailable");
          throw unavailable;
        }),
      },
    });

    await useCase
      .startImageGeneration(validRequest, { workspaceId: "workspace-a" })
      .catch((error) => expect(error).toMatchObject({ code: "unavailable" }));
    expect(runtimeTaskRegistry.startTask).not.toHaveBeenCalled();
    expect(calls).toEqual(["runtime.prepare", "guard.unavailable"]);
  });

  it("resolves selected model into checkpoint before runtime submission", async () => {
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    const useCase = createUseCase({
      runtimeTaskRegistry,
      modelCheckpointResolver: {
        resolveCheckpoint: testDouble.fn(async () => ({
          checkpoint: "sdxl.safetensors",
        })),
      },
    });

    await useCase.startImageGeneration(
      { ...validRequest, model: "record-123" },
      { workspaceId: "workspace-a" },
    );
    expect(
      (runtimeTaskRegistry.startTask as ReturnType<typeof testDouble.fn>).mock
        .calls[0]?.[0],
    ).toMatchObject({ payload: { model: "sdxl.safetensors" } });
  });

  it("does not let request hints reconfigure the shared runtime", async () => {
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    const resolveCheckpoint = testDouble.fn(async () => ({
      checkpoint: "sdxl.safetensors",
    }));
    const useCase = createUseCase({
      runtimeTaskRegistry,
      modelCheckpointResolver: { resolveCheckpoint },
      runtimeCapabilityGuard: {
        requireCapabilityReady: testDouble.fn(async () =>
          createRuntimeCapabilityStatus({
            capabilityId: "image-generation",
            status: "ready",
          }),
        ),
      },
    });

    await useCase.startImageGeneration(
      {
        ...validRequest,
        model: "record-123",
        engineHints: { runtimeDeviceMode: "directml" },
      },
      { workspaceId: "workspace-a" },
    );

    expect(resolveCheckpoint).toHaveBeenCalledWith({
      selectedModel: "record-123",
      workspaceId: "workspace-a",
      taskTag: "text-to-image",
    });
    expect(
      (runtimeTaskRegistry.startTask as ReturnType<typeof testDouble.fn>).mock
        .calls[0]?.[0]?.payload,
    ).not.toMatchObject({ engineHints: { runtimeDeviceMode: "directml" } });
  });

  it("passes through already-valid checkpoint filenames", async () => {
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    const useCase = createUseCase({
      runtimeTaskRegistry,
      modelCheckpointResolver: {
        resolveCheckpoint: testDouble.fn(async () => ({
          checkpoint: "existing.safetensors",
        })),
      },
    });
    await useCase.startImageGeneration(
      { ...validRequest, model: "existing.safetensors" },
      { workspaceId: "workspace-a" },
    );
    expect(
      (runtimeTaskRegistry.startTask as ReturnType<typeof testDouble.fn>).mock
        .calls[0]?.[0],
    ).toMatchObject({ payload: { model: "existing.safetensors" } });
  });
  it("read returns runtime task unchanged", async () => {
    const runtimeTaskRegistry = createRuntimeTaskRegistryFake();
    const useCase = createUseCase({ runtimeTaskRegistry });
    const result = await useCase.readImageGeneration("img-req-1", { workspaceId: "workspace-a" });
    expect(result).toEqual({
      requestId: "img-req-1",
      workspaceId: "workspace-a" as never,
      taskType: TaskType.IMAGE_GENERATION,
      status: "running",
      concurrencyClass: "unknown",
    });
  });

  it("does not import runtime adapter or HTTP client implementation details", async () => {
    const source = await readFile(
      "modules/application/use-cases/image-generation/generate-image.use-case.ts",
      "utf-8",
    );
    for (const fragment of [
      "adapters/runtime/comfyui",
      "createComfyUi",
      "ComfyUi",
      "axios",
      "fetch(",
    ]) {
      expect(source.includes(fragment)).toBe(false);
    }
  });
});

function createUseCase(dependencies: Omit<ConstructorParameters<typeof GenerateImageUseCase>[0], "taskAuthority" | "createRequestId">) {
  return new GenerateImageUseCase({ ...dependencies, createRequestId: () => "img-req-1", taskAuthority: { reserve: async () => ({ accept() {}, release() {} }), assertOwned: async () => {} } as never });
}

function scopedImageFixture(taskReconciler?: OwnedTaskReconcilerService) {
  type Stage = "authority" | "model" | "readiness" | "read";
  const context: ApplicationRequestContext = {workspaceId: "workspace-a", organizationId: "org-a" as never, principalId: "principal-a"};
  const state = {mutateAt: "" as Stage | "", allowed: true, runtimeReads: 0, statusWorkspace: "workspace-a",
    statusRequest: "img-req-1", statusType: TaskType.IMAGE_GENERATION};
  const starts: Parameters<RuntimeTaskRegistryPort["startTask"]>[0][] = [];
  const readRequests: string[] = [], cancelRequests: string[] = [];
  const startReply = {requestId: "img-req-1", status: "queued" as const};
  const modelScopes: {workspaceId?: string}[] = [];
  const mutate = () => {context.workspaceId = "workspace-b"; context.organizationId = "org-b" as never;};
  const stage = (value: Stage) => {if (state.mutateAt === value) mutate();};
  const taskAuthority = new ImageGenerationTaskAuthorityService({
    organizationContextProvider: {getCurrentOrganizationContext: () => ({organizationId: "org-a", principalId: "principal-a"})} as never,
    workspaceRepository: {readWorkspace: async (workspaceId: string) => ({workspaceId, status: "active"})} as never,
    workspaceAuthorization: {async authorizeWorkspaceOperation(input) {
      if (!state.allowed) throw Error("Synthetic access denial");
      stage(input.operation === "image-generation.read" ? "read" : "authority");
    }},
  });
  const runtimeTaskRegistry: RuntimeTaskRegistryPort = {
    async startTask(command) {starts.push(command); return startReply;},
    async getTaskStatus(requestId) {readRequests.push(requestId); state.runtimeReads++; return {requestId: state.statusRequest,
      workspaceId: state.statusWorkspace as never, taskType: state.statusType, status: "succeeded", concurrencyClass: "unknown"};},
    async cancelTask(requestId) {cancelRequests.push(requestId); return {requestId: "img-req-1", status: "cancelled", cancelled: true};},
    async listTasks() {return {tasks: []};},
  };
  const useCase = new GenerateImageUseCase({taskAuthority, runtimeTaskRegistry, taskReconciler, createRequestId: () => "img-req-1",
    modelCheckpointResolver: {async resolveCheckpoint(input) {modelScopes.push({...input}); stage("model"); return {checkpoint: "synthetic.safetensors"};}},
    runtimeCapabilityGuard: {async requireCapabilityReady() {stage("readiness"); return createRuntimeCapabilityStatus({capabilityId: "image-generation", status: "ready"});}},
  });
  const start = () => useCase.startImageGeneration({prompt: "Synthetic image prompt", width: 64, height: 64, steps: 1}, context);
  return {context, state, starts, modelScopes, useCase, start, mutate, startReply, readRequests, cancelRequests};
}

for (const stage of ["authority", "model", "readiness"] as const) {
  it(`image caller scope remains original through ${stage} await`, async () => {
    const f = scopedImageFixture(); f.state.mutateAt = stage;
    await f.start();
    assert.equal(f.context.workspaceId, "workspace-b"); assert.equal(f.context.organizationId, "org-b");
    assert.equal(f.modelScopes[0].workspaceId, "workspace-a");
    assert.equal(f.starts.length, 1); assert.equal(f.starts[0].workspaceId, "workspace-a");
    assert.deepEqual(f.starts[0].metadata, {workspaceId: "workspace-a", organizationId: "org-a"});
    const payload = f.starts[0].payload;
    assert.ok(payload && typeof payload === "object" && "model" in payload);
    assert.equal(payload.model, "synthetic.safetensors");
  });
}

it("image caller scope mutation cannot reject the original authorized read", async () => {
  const f = scopedImageFixture(); await f.start(); f.state.mutateAt = "read";
  const result = await f.useCase.readImageGeneration("img-req-1", f.context);
  assert.equal(f.context.workspaceId, "workspace-b");
  assert.equal("workspaceId" in result && result.workspaceId, "workspace-a");
});

for (const wrong of ["workspace", "request", "type"] as const) {
  it(`image caller scope cannot admit a foreign runtime ${wrong}`, async () => {
    const f = scopedImageFixture(); await f.start(); f.state.mutateAt = "read";
    if (wrong === "workspace") f.state.statusWorkspace = "workspace-b";
    if (wrong === "request") f.state.statusRequest = "img-foreign";
    if (wrong === "type") f.state.statusType = TaskType.MODEL_TRAINING;
    await assert.rejects(f.useCase.readImageGeneration("img-req-1", f.context), /not found/);
  });
}

for (const wrong of ["workspace", "request", "type"] as const) {
  it(`image owned reconciliation retains the original task when runtime ${wrong} differs`, async () => {
    const lifecycle = new OwnedTaskReconcilerService();
    try {
      const f = scopedImageFixture(lifecycle); await f.start(); f.mutate();
      if (wrong === "workspace") f.state.statusWorkspace = "workspace-b";
      if (wrong === "request") f.state.statusRequest = "img-foreign";
      if (wrong === "type") f.state.statusType = TaskType.MODEL_TRAINING;
      await lifecycle.reconcileNow(); assert.equal(lifecycle.status.pending, 1);
      f.state.statusWorkspace = "workspace-a"; f.state.statusRequest = "img-req-1"; f.state.statusType = TaskType.IMAGE_GENERATION;
      await lifecycle.reconcileNow(); assert.equal(lifecycle.status.pending, 0);
    } finally {lifecycle.stopObservation();}
  });
}

it("image current policy denial still precedes runtime start and read", async () => {
  const deniedStart = scopedImageFixture(); deniedStart.state.allowed = false;
  await assert.rejects(deniedStart.start(), /forbidden/);
  assert.equal(deniedStart.starts.length, 0); assert.equal(deniedStart.modelScopes.length, 0);
  const deniedRead = scopedImageFixture(); await deniedRead.start(); deniedRead.state.allowed = false;
  await assert.rejects(deniedRead.useCase.readImageGeneration("img-req-1", deniedRead.context), /forbidden/);
  assert.equal(deniedRead.state.runtimeReads, 0);
});

it("image owned lifecycle keeps original runtime id after accepted-reply mutation", async () => {
  const lifecycle = new OwnedTaskReconcilerService();
  try {
    const f = scopedImageFixture(lifecycle); await f.start(); f.startReply.requestId = "img-foreign";
    await lifecycle.cancelAndReconcile();
    assert.deepEqual(f.cancelRequests, ["img-req-1"]); assert.deepEqual(f.readRequests, ["img-req-1"]);
    assert.equal(lifecycle.status.pending, 0);
  } finally {lifecycle.stopObservation();}
});
