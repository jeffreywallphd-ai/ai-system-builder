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
import type {ApprovedImageGenerationAdmission} from "../../../ports/image/approved-image-generation.port";

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
    statusRequest: "img-req-1", statusType: TaskType.IMAGE_GENERATION, onStart: () => {}, onReady: () => {}, readinessObserved: false};
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
    async startTask(command) {starts.push(command); state.onStart(); return startReply;},
    async getTaskStatus(requestId) {readRequests.push(requestId); state.runtimeReads++; return {requestId: state.statusRequest,
      workspaceId: state.statusWorkspace as never, taskType: state.statusType, status: "succeeded", concurrencyClass: "unknown"};},
    async cancelTask(requestId) {cancelRequests.push(requestId); return {requestId: "img-req-1", status: "cancelled", cancelled: true};},
    async listTasks() {return {tasks: []};},
  };
  const useCase = new GenerateImageUseCase({taskAuthority, runtimeTaskRegistry, taskReconciler, createRequestId: () => "img-req-1",
    modelCheckpointResolver: {async resolveCheckpoint(input) {modelScopes.push({...input}); stage("model"); return {checkpoint: "synthetic.safetensors"};}},
    runtimeCapabilityGuard: {async requireCapabilityReady() {state.onReady(); state.readinessObserved = true; stage("readiness"); return createRuntimeCapabilityStatus({capabilityId: "image-generation", status: "ready"});}},
  });
  const start = () => useCase.startImageGeneration({prompt: "Synthetic image prompt", width: 64, height: 64, steps: 1}, context);
  return {context, state, starts, modelScopes, useCase, start, mutate, startReply, readRequests, cancelRequests, taskAuthority};
}

function approvedImageFixture(lifecycle?: OwnedTaskReconcilerService) {
  const f = scopedImageFixture(lifecycle), resolved: unknown[] = [];
  const admission: {-readonly [K in keyof ApprovedImageGenerationAdmission]: ApprovedImageGenerationAdmission[K]} = {
    isCurrent: () => f.context.workspaceId === "workspace-a" && f.context.organizationId === "org-a",
    authorize: async () => f.state.allowed,
    async resolveCheckpoint(selected, fence) {
      await fence.authorize(); fence.assertCurrent(); resolved.push(selected);
      if (f.state.mutateAt === "model") f.mutate();
      await fence.authorize(); fence.assertCurrent(); return {checkpoint: "approved.safetensors"};
    },
  };
  const request: ImageGenerationRequest = {prompt: "Synthetic approved image", width: 64, height: 64, steps: 1, model: "model.saved-image"};
  const start = () => f.useCase.startApprovedImageGeneration(request, f.context, admission);
  return {...f, admission, request, resolved, approvedStart: start};
}

for (const stage of ["authority", "model", "readiness"] as const) {
  it(`approved image revocation at ${stage} prevents later runtime dispatch and releases unaccepted ownership`, async () => {
    const f = approvedImageFixture(); f.state.mutateAt = stage;
    await assert.rejects(f.approvedStart(), /Approved image generation is unavailable/);
    assert.equal(f.starts.length, 0); assert.equal(f.modelScopes.length, 0);
    f.state.mutateAt = ""; f.context.workspaceId = "workspace-a"; f.context.organizationId = "org-a" as never;
    await f.approvedStart(); assert.equal(f.starts.length, 1);
  });
}

it("approved image captures request and original scope before policy waits and never uses the generic resolver", async () => {
  const f = approvedImageFixture();
  f.admission.authorize = async () => {f.request.prompt = "Replaced private text"; f.request.model = "wrong-model"; return true;};
  await f.approvedStart(); assert.equal(f.modelScopes.length, 0); assert.equal(f.starts.length, 1);
  assert.deepEqual(f.resolved, [{selectedModel: "model.saved-image", workspaceId: "workspace-a", taskTag: "text-to-image"}]);
  const payload = f.starts[0].payload as ImageGenerationRequest;
  assert.equal(payload.prompt, "Synthetic approved image"); assert.equal(payload.model, "approved.safetensors");
  assert.equal(f.starts[0].workspaceId, "workspace-a");
});

it("approved image callback replacement or permission loss during a policy wait denies all later effects", async () => {
  for (const change of ["current", "authorize", "resolver", "deny", "throw"] as const) {
    const f = approvedImageFixture();
    f.admission.authorize = async () => {
      if (change === "current") f.admission.isCurrent = () => true;
      if (change === "authorize") f.admission.authorize = async () => true;
      if (change === "resolver") f.admission.resolveCheckpoint = async () => ({checkpoint: "other.safetensors"});
      if (change === "throw") throw Error("private policy details");
      return change !== "deny";
    };
    await assert.rejects(f.approvedStart(), /^Error: Approved image generation is unavailable\.$/);
    assert.equal(f.resolved.length, 0); assert.equal(f.starts.length, 0);
  }
});

it("approved image rejects missing, raw-path, executable and malformed checkpoint replies without fallback", async () => {
  for (const result of [{}, {checkpoint: "C:/private/model.safetensors"}, {checkpoint: "../model.safetensors"},
    {checkpoint: "model.ckpt"}, {checkpoint: "model.safetensors", raw: "private"}, {checkpoint: "x".repeat(241) + ".safetensors"}]) {
    const f = approvedImageFixture(); f.admission.resolveCheckpoint = async () => result;
    await assert.rejects(f.approvedStart(), /Approved image generation is unavailable/);
    assert.equal(f.modelScopes.length, 0); assert.equal(f.starts.length, 0);
  }
});

it("approved image refuses active admissions and async current predicates without invoking traps or leaking errors", async () => {
  const f = approvedImageFixture(); let traps = 0;
  const proxy = new Proxy(f.admission, {get() {traps++; throw Error("private admission");}});
  await assert.rejects(f.useCase.startApprovedImageGeneration(f.request, f.context, proxy), /Approved image generation is unavailable/);
  const accessor = {...f.admission}; Object.defineProperty(accessor, "authorize", {get() {traps++; throw Error("private admission");}});
  await assert.rejects(f.useCase.startApprovedImageGeneration(f.request, f.context, accessor), /Approved image generation is unavailable/);
  assert.equal(traps, 0);
  f.admission.isCurrent = (() => Promise.reject(Error("private current failure"))) as never;
  await assert.rejects(f.approvedStart(), /Approved image generation is unavailable/);
  assert.equal(f.starts.length, 0);
});

it("approved image retains original accepted task custody when permission is withdrawn during runtime acceptance", async () => {
  const f = approvedImageFixture(); f.state.onStart = () => {f.state.allowed = false;};
  const result = await f.approvedStart(); assert.equal(result.requestId, "img-req-1"); assert.equal(f.starts.length, 1);
  await assert.rejects(f.useCase.readImageGeneration(result.requestId, f.context), /forbidden/);
  f.state.allowed = true;
  const original = await f.useCase.readImageGeneration(result.requestId, f.context); assert.equal(original.requestId, result.requestId);
  await assert.rejects(f.approvedStart(), /ownership capacity/); assert.equal(f.starts.length, 1);
});

it("queued withdrawal after each awaited approval cannot cross any original effect handoff", async () => {
  const baseline = approvedImageFixture(); let boundaries = 0;
  baseline.admission.authorize = async () => {boundaries++; return true;};
  await baseline.approvedStart(); assert.ok(boundaries >= 4);
  for (let withdrawAt = 1; withdrawAt <= boundaries; withdrawAt++) {
    const f = approvedImageFixture(), lateEffects: string[] = [];
    let checks = 0, armed = false, withdrawn = false;
    const effect = (name: string) => {if (withdrawn) lateEffects.push(name);};
    f.admission.isCurrent = () => {
      if (armed) {armed = false; queueMicrotask(() => {withdrawn = true;});}
      return !withdrawn;
    };
    f.admission.authorize = async () => {if (++checks === withdrawAt) armed = true; return true;};
    const reserve = f.taskAuthority.reserve.bind(f.taskAuthority);
    f.taskAuthority.reserve = async (...args) => {effect("reservation"); return reserve(...args);};
    const resolve = f.admission.resolveCheckpoint;
    f.admission.resolveCheckpoint = async (selected, fence) => {effect("resolver"); return resolve(selected, fence);};
    f.state.onReady = () => effect("readiness"); f.state.onStart = () => effect("dispatch");
    await assert.rejects(f.approvedStart(), /Approved image generation is unavailable/);
    assert.equal(withdrawn, true); assert.deepEqual(lateEffects, [], "An original effect started after queued withdrawal.");
    assert.equal(f.starts.length, 0);
  }
});

it("approved image rechecks lifecycle acceptance after the final awaited policy check", async () => {
  const lifecycle = new OwnedTaskReconcilerService();
  try {
    const f = approvedImageFixture(lifecycle);
    f.admission.authorize = async () => {if (f.state.readinessObserved) lifecycle.stopAccepting(); return true;};
    await assert.rejects(f.approvedStart(), /Background task lifecycle is unavailable/);
    assert.equal(f.starts.length, 0); assert.equal(lifecycle.status.pending, 0);
  } finally {lifecycle.stopObservation();}
});

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
