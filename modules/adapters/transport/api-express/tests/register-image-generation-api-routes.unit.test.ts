import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { registerImageGenerationApiRoutes, type ExpressRoutePort } from "../image-generation/registerImageGenerationApiRoutes";
import { RuntimeCapabilityUnavailableError } from "../../../../application/services/runtime";
import { createRuntimeCapabilityStatus } from "../../../../contracts/runtime";
import { snapshotBoundedImageGenerationRequest, type ImageGenerationRequest } from "../../../../contracts/image-generation";
import type { ApplicationRequestContext } from "../../../../application/ports";

function response() { const json = testDouble.fn(); const status = testDouble.fn(); const res:any={status:status.mockImplementation(()=>res),json}; return {res,json,status}; }

describe("registerImageGenerationApiRoutes", () => {
  it("keeps workspace context separate from strict generation options", async () => {
    const handlers = new Map<string, Parameters<ExpressRoutePort["post"]>[1]>();
    const start = testDouble.fn(async (request: ImageGenerationRequest, _context?: ApplicationRequestContext) => {
      snapshotBoundedImageGenerationRequest(request); return { requestId: "image-result" };
    });
    registerImageGenerationApiRoutes({ app: { post: (path, handler) => { handlers.set(path, handler); } }, generateImageUseCase: { startImageGeneration: start, readImageGeneration: testDouble.fn(), cancelImageGeneration: testDouble.fn() } });
    const result = response();
    await handlers.get("/api/image-generation/start")!({ body: { workspaceId: "workspace-a", prompt: " cat ", seed: 0, width: 64 }, headers: { "x-request-id": "request-a", "x-correlation-id": "correlation-a" } }, result.res);
    expect(result.status).toHaveBeenCalledWith(200);
    expect(result.json.mock.calls[0]?.[0]).toMatchObject({ ok: true, requestId: "request-a", correlationId: "correlation-a", value: { requestId: "image-result" } });
    expect(start.mock.calls[0]?.[0]).toEqual({ prompt: "cat", seed: 0, width: 64 });
    expect(start.mock.calls[0]?.[1]).toMatchObject({ workspaceId: "workspace-a", requestId: "request-a", correlationId: "correlation-a" });
  });
  it("does not silently drop unknown generation fields while separating context", async () => {
    const handlers = new Map<string, Parameters<ExpressRoutePort["post"]>[1]>(); let admitted = 0;
    registerImageGenerationApiRoutes({ app: { post: (path, handler) => { handlers.set(path, handler); } }, generateImageUseCase: {
      startImageGeneration: async request => { snapshotBoundedImageGenerationRequest(request); admitted++; return { requestId: "unexpected" }; },
      readImageGeneration: testDouble.fn(), cancelImageGeneration: testDouble.fn(),
    } });
    const result = response(); await handlers.get("/api/image-generation/start")!({ body: { workspaceId: "workspace-a", prompt: "cat", unapprovedExecution: true } }, result.res);
    expect(admitted).toBe(0); expect(result.status).toHaveBeenCalledWith(500); expect(result.json.mock.calls[0]?.[0]).toMatchObject({ ok: false, error: { code: "internal", message: "Image generation request failed." } });
  });
  for (const malformed of ["prompt-accessor", "workspace-accessor", "model-accessor", "hidden-field"] as const) it(`denies ${malformed} generation data before context or diagnostic reads`, async () => {
    const handlers = new Map<string, Parameters<ExpressRoutePort["post"]>[1]>(); let reads = 0;
    const start = testDouble.fn();
    const logger = { info: testDouble.fn(), warn: testDouble.fn() };
    registerImageGenerationApiRoutes({ app: { post: (path, handler) => { handlers.set(path, handler); } }, logger, generateImageUseCase: { startImageGeneration: start, readImageGeneration: testDouble.fn(), cancelImageGeneration: testDouble.fn() } });
    const body = { workspaceId: "workspace-a", prompt: "cat" };
    if (malformed !== "hidden-field") Object.defineProperty(body, malformed === "workspace-accessor" ? "workspaceId" : malformed === "model-accessor" ? "model" : "prompt", { enumerable: true, get: () => { reads++; return "synthetic-private-value"; } });
    else Object.defineProperty(body, "unapprovedExecution", { value: true, enumerable: false });
    const result = response(); await handlers.get("/api/image-generation/start")!({ body, headers: { "x-request-id": "request-a", "x-correlation-id": "correlation-a" } }, result.res);
    expect(reads).toBe(0); expect(start).not.toHaveBeenCalled();
    expect(result.json.mock.calls[0]?.[0]).toMatchObject({ ok: false, requestId: "request-a", correlationId: "correlation-a" });
    expect(logger.warn).toHaveBeenCalled();
    expect(JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls])).not.toContain("synthetic-private-value");
  });
  it("logs model presence without copying a private selector or prompt", async () => {
    const handlers = new Map<string, Parameters<ExpressRoutePort["post"]>[1]>();
    const logger = { info: testDouble.fn(), warn: testDouble.fn() };
    registerImageGenerationApiRoutes({ app: { post: (path, handler) => { handlers.set(path, handler); } }, logger,
      generateImageUseCase: { startImageGeneration: testDouble.fn(async () => ({ requestId: "image-result" })), readImageGeneration: testDouble.fn(), cancelImageGeneration: testDouble.fn() } });
    const result = response();
    await handlers.get("/api/image-generation/start")!({ body: { workspaceId: "workspace-a", prompt: "synthetic private prompt", model: "C:/synthetic-private/model.safetensors" }, headers: { "x-correlation-id": "correlation-a" } }, result.res);
    expect(result.status).toHaveBeenCalledWith(200);
    expect(logger.info).toHaveBeenCalledWith("api.image-generation.request.received", expect.objectContaining({ hasModel: true, hasPrompt: true, correlationId: "correlation-a" }));
    const logs = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls]);
    expect(logs).not.toContain("C:/synthetic-private"); expect(logs).not.toContain("synthetic private prompt");
  });
  it("validates start/read/cancel/finalize request bodies", async () => {
    const handlers = new Map<string, any>();
    const app: ExpressRoutePort = { post: testDouble.fn((p,h)=>handlers.set(p,h)) };
    const generateImageUseCase = { startImageGeneration: testDouble.fn(), readImageGeneration: testDouble.fn(), cancelImageGeneration: testDouble.fn() } as any;
    registerImageGenerationApiRoutes({ app, generateImageUseCase });

    for (const path of ["/api/image-generation/start","/api/image-generation/read","/api/image-generation/cancel","/api/image-generation/finalize"]) {
      const { res, status, json } = response();
      await handlers.get(path)({ body: {}, headers: {} }, res);
      expect(status).toHaveBeenCalledWith(400);
      expect(json.mock.calls[json.mock.calls.length - 1]?.[0]).toMatchObject({ ok: false, error: { code: "validation" } });
    }
    expect(handlers.has("/api/image-generation/unload-model")).toBe(true);
  });

  it("maps domain failure codes to HTTP status codes", async () => {
    const handlers = new Map<string, any>();
    const app: ExpressRoutePort = { post: testDouble.fn((p,h)=>handlers.set(p,h)) };
    const generateImageUseCase = {
      startImageGeneration: testDouble.fn(async ()=>{ throw { code: "unavailable", message: "down" }; }),
      readImageGeneration: testDouble.fn(async ()=>{ throw { code: "not-found", message: "missing" }; }),
      cancelImageGeneration: testDouble.fn(async ()=>{ throw { code: "validation", message: "bad" }; }),
    } as any;
    registerImageGenerationApiRoutes({ app, generateImageUseCase });

    const a=response(); await handlers.get("/api/image-generation/start")({ body: { prompt: "x" }, headers: {} }, a.res); expect(a.status).toHaveBeenCalledWith(503);
    const b=response(); await handlers.get("/api/image-generation/read")({ body: { requestId: "r1" }, headers: {} }, b.res); expect(b.status).toHaveBeenCalledWith(404);
    const c=response(); await handlers.get("/api/image-generation/cancel")({ body: { requestId: "r1" }, headers: {} }, c.res); expect(c.status).toHaveBeenCalledWith(400);
  });


  it("maps runtime capability unavailable start failures to sanitized 503 details", async () => {
    const handlers = new Map<string, any>();
    const app: ExpressRoutePort = { post: testDouble.fn((p, h) => handlers.set(p, h)) };
    const logger = { info: testDouble.fn(), warn: testDouble.fn() };
    const unavailable = new RuntimeCapabilityUnavailableError(createRuntimeCapabilityStatus({
      capabilityId: "image-generation",
      status: "failed",
      summary: "Image generation runtime failed readiness checks.",
      reason: { code: "runtime.comfyui.failed", message: "raw stack /tmp/secret PATH=abc", category: "startup", retryable: true },
      recommendedActions: ["retry", "view-logs"],
    }));
    registerImageGenerationApiRoutes({
      app,
      logger,
      generateImageUseCase: { startImageGeneration: testDouble.fn(async () => { throw unavailable; }), readImageGeneration: testDouble.fn(), cancelImageGeneration: testDouble.fn() } as any,
    });

    const { res, status, json } = response();
    await handlers.get("/api/image-generation/start")({ body: { prompt: "x" }, headers: { "x-request-id": "req-1", "x-correlation-id": "corr-1" } }, res);

    expect(status).toHaveBeenCalledWith(503);
    const payload = json.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      ok: false,
      requestId: "req-1",
      correlationId: "corr-1",
      error: {
        code: "unavailable",
        message: "ComfyUI runtime is not ready.",
        details: { capabilityId: "image-generation", status: "failed", reason: { code: "runtime.comfyui.failed", category: "startup" }, recommendedActions: ["retry", "view-logs"] },
      },
    });
    expect(JSON.stringify(payload)).not.toContain("/tmp/secret");
    expect(JSON.stringify(payload)).not.toContain("PATH=abc");
    expect(logger.info).toHaveBeenCalledWith("api.image-generation.request.received", expect.objectContaining({ operation: "image-generation.start", clientSource: undefined }));
    expect(logger.warn).toHaveBeenCalledWith("api.image-generation.request.failed", expect.objectContaining({ operation: "image-generation.start", code: "unavailable", details: expect.objectContaining({ capabilityId: "image-generation" }) }));
  });

  it("sanitizes internal image-generation API failures while keeping validation actionable", async () => {
    const handlers = new Map<string, any>();
    const app: ExpressRoutePort = { post: testDouble.fn((p, h) => handlers.set(p, h)) };
    registerImageGenerationApiRoutes({
      app,
      generateImageUseCase: {
        startImageGeneration: testDouble.fn(async () => { throw new Error("adapter failed at /tmp/secret\nstack trace"); }),
        readImageGeneration: testDouble.fn(async () => { throw new Error("read failed at C:\\tmp\\secret"); }),
        cancelImageGeneration: testDouble.fn(),
      } as any,
    });

    const start = response();
    await handlers.get("/api/image-generation/start")({ body: { prompt: "x" }, headers: {} }, start.res);
    expect(start.status).toHaveBeenCalledWith(500);
    expect(start.json.mock.calls[0]?.[0]).toMatchObject({ ok: false, error: { code: "internal", message: "Image generation request failed." } });

    const read = response();
    await handlers.get("/api/image-generation/read")({ body: { requestId: "r1" }, headers: {} }, read.res);
    expect(read.status).toHaveBeenCalledWith(500);
    expect(read.json.mock.calls[0]?.[0]).toMatchObject({ ok: false, error: { code: "internal", message: "Image generation request failed." } });

    const validation = response();
    await handlers.get("/api/image-generation/read")({ body: {}, headers: {} }, validation.res);
    expect(validation.status).toHaveBeenCalledWith(400);
    expect(validation.json.mock.calls[0]?.[0]).toMatchObject({ ok: false, error: { code: "validation", message: "requestId is required." } });

    expect(JSON.stringify({ start: start.json.mock.calls[0]?.[0], read: read.json.mock.calls[0]?.[0] })).not.toContain("/tmp/secret");
    expect(JSON.stringify({ start: start.json.mock.calls[0]?.[0], read: read.json.mock.calls[0]?.[0] })).not.toContain("C:\\tmp\\secret");
    expect(JSON.stringify({ start: start.json.mock.calls[0]?.[0], read: read.json.mock.calls[0]?.[0] })).not.toContain("stack trace");
  });

  it("returns unavailable finalize response when orchestrator is absent", async () => {
    const handlers = new Map<string, any>();
    const app: ExpressRoutePort = { post: testDouble.fn((p,h)=>handlers.set(p,h)) };
    registerImageGenerationApiRoutes({ app, generateImageUseCase: { startImageGeneration: testDouble.fn(), readImageGeneration: testDouble.fn(), cancelImageGeneration: testDouble.fn() } as any });
    const { res, status, json } = response();
    await handlers.get('/api/image-generation/finalize')({ body: { requestId: 'r1' }, headers: {} }, res);
    expect(status).toHaveBeenCalledWith(200);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ ok: true, value: { finalized: false, reason: 'image generation finalization is unavailable' } });
  });

  it("maps unload-model route to runtime control port", async () => {
    const handlers = new Map<string, any>();
    const app: ExpressRoutePort = { post: testDouble.fn((p,h)=>handlers.set(p,h)) };
    const imageGenerationRuntimeControl = {
      unloadModel: testDouble.fn(async () => ({ unloaded: true, message: "released" })),
    };
    registerImageGenerationApiRoutes({
      app,
      generateImageUseCase: { startImageGeneration: testDouble.fn(), readImageGeneration: testDouble.fn(), cancelImageGeneration: testDouble.fn() } as any,
      imageGenerationRuntimeControl,
    });

    const { res, status, json } = response();
    await handlers.get("/api/image-generation/unload-model")({ body: {}, headers: {} }, res);

    expect(imageGenerationRuntimeControl.unloadModel).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith(200);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ ok: true, value: { unloaded: true, message: "released" } });
  });

  it("returns succeeded read records without mutating runtime outputs for preview", async () => {
    const handlers = new Map<string, any>();
    const app: ExpressRoutePort = { post: testDouble.fn((p, h) => handlers.set(p, h)) };
    const readTask = { requestId: "r1", taskType: "image-generation", status: "succeeded", concurrencyClass: "image-generation", data: { outputs: [{ fileName: "a.png", subfolder: "output" }] } };
    registerImageGenerationApiRoutes({
      app,
      generateImageUseCase: { startImageGeneration: testDouble.fn(), readImageGeneration: testDouble.fn(async () => readTask), cancelImageGeneration: testDouble.fn() } as any,
    });
    const { res, json } = response();
    await handlers.get("/api/image-generation/read")({ body: { requestId: "r1" }, headers: {} }, res);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ ok: true, value: readTask });
    expect(json.mock.calls[0]?.[0]?.value?.data?.outputs?.[0]?.contentBase64).toBeUndefined();
  });
});
