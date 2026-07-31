import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import {
  DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_REQUEST_CHANNEL,
  DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL,
  DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL,
  DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_REQUEST_CHANNEL,
  createDesktopAssetFinalizeGeneratedOutputRequest,
  createDesktopAssetImportExternalRepositoryObjectRequest,
  createDesktopAssetLocalizeExternalRepositoryObjectRequest,
  createDesktopAssetRegisterResourceBackedViewRequest,
} from "../../../../contracts/ipc";
import {
  createDesktopAssetFinalizeGeneratedOutputIpcHandler,
  createDesktopAssetImportExternalRepositoryObjectIpcHandler,
  createDesktopAssetLocalizeExternalRepositoryObjectIpcHandler,
  createDesktopAssetRegisterResourceBackedViewIpcHandler,
  registerAssetMutationIpc,
} from "../asset-registry/registerAssetMutationIpc";

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

describe("registerAssetMutationIpc", () => {
  it("registers only the four approved mutation channels", () => {
    const channels: string[] = [];
    registerAssetMutationIpc({
      ipcMain: { handle: testDouble.fn((channel: string) => channels.push(channel)) },
      registerResourceBackedViewAsAsset: useCase() as any,
      finalizeGeneratedOutputAsAsset: useCase() as any,
      importExternalRepositoryObjectAsAsset: useCase() as any,
      localizeExternalRepositoryObjectAsAsset: useCase() as any,
    });

    expect(channels).toEqual([
      DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL.value,
    ]);
    expect(/create|update|delete|patch|edit|seed|execute|run|scan/i.test(channels.join(" "))).toBe(false);
  });

  it("calls register use case and preserves request context", async () => {
    const register = useCase({ ok: true, operation: "asset.register-resource-backed-view", status: "created" });
    const handler = createDesktopAssetRegisterResourceBackedViewIpcHandler({ registerResourceBackedViewAsAsset: register as any });
    const request = createDesktopAssetRegisterResourceBackedViewRequest(
      command("asset.register-resource-backed-view", { context: { correlationId: "cmd-c" } }) as any,
      { requestId: "r1", correlationId: "ipc-c" },
    );

    const response = await handler({}, request);

    expect(register.execute.mock.calls[0]?.[0]).toMatchObject({ context: { requestId: "r1", correlationId: "cmd-c" } });
    expect(response).toMatchObject({ ok: true, requestId: "r1", correlationId: "cmd-c", value: { status: "created" } });
  });

  it("routes finalize, import, and localize to their use cases", async () => {
    const finalize = useCase({ ok: true, operation: "asset.finalize-generated-output", status: "existing" });
    const importObject = useCase({ ok: true, operation: "asset.import-external-repository-object", status: "existing" });
    const localize = useCase({ ok: true, operation: "asset.localize-external-repository-object", status: "existing" });

    await createDesktopAssetFinalizeGeneratedOutputIpcHandler({ finalizeGeneratedOutputAsAsset: finalize as any })(
      {},
      createDesktopAssetFinalizeGeneratedOutputRequest(command("asset.finalize-generated-output", { generatedOutputId: "out-1", viewId: undefined }) as any),
    );
    await createDesktopAssetImportExternalRepositoryObjectIpcHandler({ importExternalRepositoryObjectAsAsset: importObject as any })(
      {},
      createDesktopAssetImportExternalRepositoryObjectRequest(command("asset.import-external-repository-object") as any),
    );
    await createDesktopAssetLocalizeExternalRepositoryObjectIpcHandler({ localizeExternalRepositoryObjectAsAsset: localize as any })(
      {},
      createDesktopAssetLocalizeExternalRepositoryObjectRequest(command("asset.localize-external-repository-object") as any),
    );

    expect(finalize.execute).toHaveBeenCalledTimes(1);
    expect(importObject.execute).toHaveBeenCalledTimes(1);
    expect(localize.execute).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed payloads before calling use cases", async () => {
    const register = useCase();
    const handler = createDesktopAssetRegisterResourceBackedViewIpcHandler({ registerResourceBackedViewAsAsset: register as any });
    for (const payload of [null, command("asset.finalize-generated-output"), { ...command("asset.register-resource-backed-view"), viewId: "" }, { ...command("asset.register-resource-backed-view"), approval: undefined }, { ...command("asset.register-resource-backed-view"), context: { requestId: 1 } }]) {
      const response = await handler({}, { payload, requestId: "r" } as any);
      expect(response).toMatchObject({ ok: false, requestId: "r", error: { code: "validation" } });
    }
    expect(register.execute).not.toHaveBeenCalled();
  });

  it("maps mutation failures into sanitized IPC failure envelopes", async () => {
    const cases = [
      ["validation", "validation"],
      ["approval-required", "validation"],
      ["permission", "forbidden"],
      ["not-found", "not-found"],
      ["conflict", "conflict"],
      ["unavailable", "unavailable"],
      ["partial-failure", "conflict"],
      ["internal", "internal"],
    ] as const;

    for (const [failureCode, envelopeCode] of cases) {
      const handler = createDesktopAssetRegisterResourceBackedViewIpcHandler({
        registerResourceBackedViewAsAsset: useCase({
          ok: false,
          operation: "asset.register-resource-backed-view",
          failure: { code: failureCode, operation: "asset.register-resource-backed-view", message: "failed", safeDetails: { token: "Bearer secret", safe: "yes" } },
        }) as any,
      });
      const response = await handler({}, createDesktopAssetRegisterResourceBackedViewRequest(command("asset.register-resource-backed-view") as any));
      expect(response).toMatchObject({ ok: false, error: { code: envelopeCode, details: { mutationFailureCode: failureCode } } });
      expect(UNSAFE.test(JSON.stringify(response))).toBe(false);
    }
  });

  it("sanitizes thrown use-case errors", async () => {
    const handler = createDesktopAssetRegisterResourceBackedViewIpcHandler({
      registerResourceBackedViewAsAsset: { execute: testDouble.fn(async () => { throw new Error("raw exception /tmp/root Bearer token secret stack base64 bytes provider payload"); }) } as any,
    });

    const response = await handler({}, createDesktopAssetRegisterResourceBackedViewRequest(command("asset.register-resource-backed-view") as any, { requestId: "r" }));

    expect(response).toMatchObject({ ok: false, requestId: "r", error: { code: "internal" } });
    expect(UNSAFE.test(JSON.stringify(response))).toBe(false);
  });
});
