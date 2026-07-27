import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { registerAssetMutationApiRoutes, type ExpressAssetMutationRoutePort } from "../asset-registry/registerAssetMutationApiRoutes";

function response() {
  const json = testDouble.fn();
  const status = testDouble.fn();
  const res: any = { status: status.mockImplementation(() => res), json };
  return { res, json, status };
}

function appAndHandlers() {
  const handlers = new Map<string, any>();
  const app = {
    post: testDouble.fn((path, handler) => handlers.set(path, handler)),
    get: testDouble.fn(),
    put: testDouble.fn(),
    patch: testDouble.fn(),
    delete: testDouble.fn(),
  } as any as ExpressAssetMutationRoutePort & Record<string, ReturnType<typeof testDouble.fn>>;
  return { app, handlers };
}

function useCase(result: any = { ok: true, operation: "asset.register-resource-backed-view", status: "created" }) {
  return { execute: testDouble.fn(async () => result) };
}

function command(operation: string, extra: Record<string, unknown> = {}) {
  return {
    operation,
    workspaceId: "workspace-a",
    viewId: "asset-view.external.1",
    approval: { userConfirmed: true, confirmationKind: "register-resource-backed-view" },
    actor: { initiatedBy: "human" },
    ...extra,
  };
}

const UNSAFE = /\/tmp|C:\\|Bearer|token|secret|password|stack|base64|bytes|provider payload|raw exception/i;

describe("registerAssetMutationApiRoutes", () => {
  it("registers only the four approved POST mutation routes", () => {
    const { app } = appAndHandlers();
    registerAssetMutationApiRoutes({
      app,
      registerResourceBackedViewAsAsset: useCase() as any,
      finalizeGeneratedOutputAsAsset: useCase() as any,
      importExternalRepositoryObjectAsAsset: useCase() as any,
      localizeExternalRepositoryObjectAsAsset: useCase() as any,
    });

    expect(app.post.mock.calls.map((call: any) => call[0])).toEqual([
      "/api/assets/register-resource-backed-view",
      "/api/assets/finalize-generated-output",
      "/api/assets/import-external-repository-object",
      "/api/assets/localize-external-repository-object",
    ]);
    expect(app.get).not.toHaveBeenCalled();
    expect(app.put).not.toHaveBeenCalled();
    expect(app.patch).not.toHaveBeenCalled();
    expect(app.delete).not.toHaveBeenCalled();
  });

  it("calls the matching narrow use case and preserves safe metadata", async () => {
    const { app, handlers } = appAndHandlers();
    const register = useCase({ ok: true, operation: "asset.register-resource-backed-view", status: "created" });
    registerAssetMutationApiRoutes({
      app,
      registerResourceBackedViewAsAsset: register as any,
      finalizeGeneratedOutputAsAsset: useCase() as any,
      importExternalRepositoryObjectAsAsset: useCase() as any,
      localizeExternalRepositoryObjectAsAsset: useCase() as any,
    });
    const { res, status, json } = response();

    await handlers.get("/api/assets/register-resource-backed-view")({
      headers: { "x-request-id": "hdr-r", "x-correlation-id": "hdr-c", "x-idempotency-key": "idem-1" },
      body: command("asset.register-resource-backed-view", { context: { correlationId: "cmd-c" } }),
    }, res);

    expect(register.execute.mock.calls[0]?.[0]).toMatchObject({
      operation: "asset.register-resource-backed-view",
      context: { requestId: "hdr-r", correlationId: "cmd-c", idempotencyKey: "idem-1" },
    });
    expect(status).toHaveBeenCalledWith(201);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ ok: true, requestId: "hdr-r", correlationId: "cmd-c", value: { ok: true, status: "created" } });
  });

  it("routes finalize, import, and localize to their corresponding use cases", async () => {
    const { app, handlers } = appAndHandlers();
    const finalize = useCase({ ok: true, operation: "asset.finalize-generated-output", status: "existing" });
    const importObject = useCase({ ok: true, operation: "asset.import-external-repository-object", status: "existing" });
    const localize = useCase({ ok: true, operation: "asset.localize-external-repository-object", status: "existing" });
    registerAssetMutationApiRoutes({
      app,
      registerResourceBackedViewAsAsset: useCase() as any,
      finalizeGeneratedOutputAsAsset: finalize as any,
      importExternalRepositoryObjectAsAsset: importObject as any,
      localizeExternalRepositoryObjectAsAsset: localize as any,
    });

    await handlers.get("/api/assets/finalize-generated-output")({ headers: {}, body: command("asset.finalize-generated-output", { generatedOutputId: "out-1", viewId: undefined }) }, response().res);
    await handlers.get("/api/assets/import-external-repository-object")({ headers: {}, body: command("asset.import-external-repository-object") }, response().res);
    await handlers.get("/api/assets/localize-external-repository-object")({ headers: {}, body: command("asset.localize-external-repository-object") }, response().res);

    expect(finalize.execute).toHaveBeenCalledTimes(1);
    expect(importObject.execute).toHaveBeenCalledTimes(1);
    expect(localize.execute).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed and mismatched commands before calling use cases", async () => {
    const { app, handlers } = appAndHandlers();
    const register = useCase();
    registerAssetMutationApiRoutes({
      app,
      registerResourceBackedViewAsAsset: register as any,
      finalizeGeneratedOutputAsAsset: useCase() as any,
      importExternalRepositoryObjectAsAsset: useCase() as any,
      localizeExternalRepositoryObjectAsAsset: useCase() as any,
    });

    for (const body of [null, { ...command("asset.finalize-generated-output") }, { ...command("asset.register-resource-backed-view"), viewId: "" }, { ...command("asset.register-resource-backed-view"), actor: undefined }, { ...command("asset.register-resource-backed-view"), context: { requestId: 1 } }]) {
      const { res, status, json } = response();
      await handlers.get("/api/assets/register-resource-backed-view")({ headers: {}, body }, res);
      expect(status).toHaveBeenCalledWith(400);
      expect(json.mock.calls[0]?.[0]).toMatchObject({ ok: false, error: { code: "validation" } });
    }
    expect(register.execute).not.toHaveBeenCalled();
  });

  it("maps mutation failures to sanitized failure envelopes", async () => {
    const cases = [
      ["validation", 400, "validation"],
      ["approval-required", 412, "validation"],
      ["permission", 403, "forbidden"],
      ["not-found", 404, "not-found"],
      ["conflict", 409, "conflict"],
      ["unavailable", 503, "unavailable"],
      ["partial-failure", 409, "conflict"],
      ["internal", 500, "internal"],
    ] as const;

    for (const [failureCode, httpStatus, envelopeCode] of cases) {
      const { app, handlers } = appAndHandlers();
      registerAssetMutationApiRoutes({
        app,
        registerResourceBackedViewAsAsset: useCase({
          ok: false,
          operation: "asset.register-resource-backed-view",
          failure: { code: failureCode, operation: "asset.register-resource-backed-view", message: `${failureCode} failed`, safeDetails: { token: "Bearer secret", safe: "yes" } },
        }) as any,
        finalizeGeneratedOutputAsAsset: useCase() as any,
        importExternalRepositoryObjectAsAsset: useCase() as any,
        localizeExternalRepositoryObjectAsAsset: useCase() as any,
      });
      const { res, status, json } = response();
      await handlers.get("/api/assets/register-resource-backed-view")({ headers: {}, body: command("asset.register-resource-backed-view") }, res);

      expect(status).toHaveBeenCalledWith(httpStatus);
      expect(json.mock.calls[0]?.[0]).toMatchObject({ ok: false, error: { code: envelopeCode, details: { mutationFailureCode: failureCode } } });
      expect(UNSAFE.test(JSON.stringify(json.mock.calls[0]?.[0]))).toBe(false);
    }
  });

  it("sanitizes unexpected thrown errors", async () => {
    const { app, handlers } = appAndHandlers();
    registerAssetMutationApiRoutes({
      app,
      registerResourceBackedViewAsAsset: { execute: testDouble.fn(async () => { throw new Error("raw exception /tmp/root Bearer token secret stack base64 bytes provider payload"); }) } as any,
      finalizeGeneratedOutputAsAsset: useCase() as any,
      importExternalRepositoryObjectAsAsset: useCase() as any,
      localizeExternalRepositoryObjectAsAsset: useCase() as any,
    });
    const { res, status, json } = response();
    await handlers.get("/api/assets/register-resource-backed-view")({ headers: { "x-request-id": "r" }, body: command("asset.register-resource-backed-view") }, res);

    expect(status).toHaveBeenCalledWith(500);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ ok: false, requestId: "r", error: { code: "internal" } });
    expect(UNSAFE.test(JSON.stringify(json.mock.calls[0]?.[0]))).toBe(false);
  });
});
