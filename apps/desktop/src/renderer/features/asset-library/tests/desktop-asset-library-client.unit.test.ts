import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, testDouble } from "../../../../../../../modules/testing/node-test";
import { createDesktopAssetLibraryClient } from "../api/desktopAssetLibraryClient";

function setDesktopApi(api: Record<string, unknown>): void {
  (globalThis as unknown as { window?: Record<string, unknown> }).window = { desktopApi: api };
}

function success(value: unknown) {
  return { ok: true, value };
}

function failure(code: string, message: string, details?: unknown) {
  return { ok: false, error: { code, message, details }, requestId: "req-1", correlationId: "corr-1" };
}

function detailValue() {
  return {
    definition: {
      definitionId: "builtin.document",
      version: "1.0.0",
      assetType: "document",
      assetFamily: "resource-backed",
      displayName: "Document",
      description: "Document descriptor",
      lifecycleStatus: "published",
      provenance: { sourceKind: "system-generated", updatedAt: "2026-05-02T00:00:00.000Z" },
    },
    builtIn: true,
  };
}

function resourceViewValue() {
  return {
    view: {
      viewId: "asset-view.generated-output.internal.1",
      viewKind: "generated-output",
      assetType: "image",
      assetFamily: "resource-backed",
      displayName: "Generated output",
      summary: "Generated output view; not finalized or registered.",
      metadata: { finalized: false, registered: false },
    },
  };
}

function api(overrides: Record<string, unknown> = {}) {
  return {
    listAssetDefinitions: testDouble.fn().mockResolvedValue(success({ items: [] })),
    readAssetDefinition: testDouble.fn().mockResolvedValue(success(detailValue())),
    readAssetDefinitionVersion: testDouble.fn().mockResolvedValue(success(detailValue())),
    listAssetResourceBackedViews: testDouble.fn().mockResolvedValue(success({ items: [] })),
    readAssetResourceBackedView: testDouble.fn().mockResolvedValue(success(resourceViewValue())),
    registerResourceBackedViewAsAsset: testDouble.fn().mockResolvedValue(success({ ok: true, operation: "asset.register-resource-backed-view", status: "created" })),
    finalizeGeneratedOutputAsAsset: testDouble.fn().mockResolvedValue(success({ ok: true, operation: "asset.finalize-generated-output", status: "created" })),
    importExternalRepositoryObjectAsAsset: testDouble.fn().mockResolvedValue(success({ ok: true, operation: "asset.import-external-repository-object", status: "created" })),
    localizeExternalRepositoryObjectAsAsset: testDouble.fn().mockResolvedValue(success({ ok: true, operation: "asset.localize-external-repository-object", status: "created" })),
    ...overrides,
  };
}

describe("desktop asset library client", () => {
  it("calls read-only desktopApi methods and maps successful list responses", async () => {
    const apiBridge = api({
      listAssetDefinitions: testDouble.fn().mockResolvedValue(success({
        items: [{
          definitionId: "builtin.document",
          version: "1.0.0",
          assetType: "document",
          assetFamily: "resource-backed",
          displayName: "Document",
          lifecycleStatus: "published",
          builtIn: true,
        }],
      })),
    });
    setDesktopApi(apiBridge);

    const client = createDesktopAssetLibraryClient();
    const result = await client.listAssetDefinitions({ searchText: "doc", builtIn: "built-in", limit: 10 });

    expect(apiBridge.listAssetDefinitions).toHaveBeenCalledWith({ searchText: "doc", builtIn: "built-in", limit: 10 });
    expect(result).toMatchObject({
      ok: true,
      value: { items: [{ id: "builtin.document@1.0.0", builtIn: true }] },
    });
  });

  it("maps successful detail and version responses", async () => {
    const apiBridge = api();
    setDesktopApi(apiBridge);

    const client = createDesktopAssetLibraryClient();
    const detail = await client.readAssetDefinition({ definitionId: "builtin.document" }, { expand: ["aiContext"] });
    const version = await client.readAssetDefinitionVersion({ definitionId: "builtin.document", version: "1.0.0" }, { includeValidation: true });

    expect(apiBridge.readAssetDefinition).toHaveBeenCalledWith({ definitionId: "builtin.document", expand: ["aiContext"] });
    expect(apiBridge.readAssetDefinitionVersion).toHaveBeenCalledWith({ definitionId: "builtin.document", version: "1.0.0", includeValidation: true });
    expect(detail).toMatchObject({ ok: true, value: { definitionId: "builtin.document" } });
    expect(version).toMatchObject({ ok: true, value: { version: "1.0.0" } });
  });

  it("omits validation flags from default detail requests", async () => {
    const apiBridge = api();
    setDesktopApi(apiBridge);

    const client = createDesktopAssetLibraryClient();
    await client.readAssetDefinition({ definitionId: "builtin.document" });
    await client.readAssetDefinitionVersion({ definitionId: "builtin.document", version: "1.0.0" });

    expect(apiBridge.readAssetDefinition).toHaveBeenCalledWith({ definitionId: "builtin.document" });
    expect(apiBridge.readAssetDefinitionVersion).toHaveBeenCalledWith({ definitionId: "builtin.document", version: "1.0.0" });
  });

  it("calls read-only resource-backed view preload methods", async () => {
    const apiBridge = api({
      listAssetResourceBackedViews: testDouble.fn().mockResolvedValue(success({ items: [resourceViewValue().view] })),
      readAssetResourceBackedView: testDouble.fn().mockResolvedValue(success(resourceViewValue())),
    });
    setDesktopApi(apiBridge);

    const client = createDesktopAssetLibraryClient();
    const list = await client.listAssetResourceBackedViews({ searchText: "generated", limit: 10 });
    const detail = await client.readAssetResourceBackedView({ viewId: "asset-view.generated-output.internal.1" }, { expand: ["metadata"] });

    expect(apiBridge.listAssetResourceBackedViews).toHaveBeenCalledWith({ searchText: "generated", limit: 10 });
    expect(apiBridge.readAssetResourceBackedView).toHaveBeenCalledWith({ viewId: "asset-view.generated-output.internal.1", expand: ["metadata"] });
    expect(list).toMatchObject({ ok: true, value: { items: [{ registrationStatusLabel: "Not finalized or registered" }] } });
    expect(detail).toMatchObject({ ok: true, value: { registrationStatusLabel: "Not finalized or registered" } });
  });

  it("calls controlled mutation preload methods and sanitizes mutation results", async () => {
    const apiBridge = api({
      finalizeGeneratedOutputAsAsset: testDouble.fn().mockResolvedValue(success({
        ok: false,
        operation: "asset.finalize-generated-output",
        failure: {
          code: "internal",
          message: "stack at C:\\Users\\name\\secret",
          operation: "asset.finalize-generated-output",
          diagnostics: [{ severity: "error", code: "raw", message: "C:\\Users\\name\\secret" }],
        },
      })),
    });
    setDesktopApi(apiBridge);

    const client = createDesktopAssetLibraryClient();
    const command = {
      operation: "asset.finalize-generated-output" as const,
      viewId: "asset-view.generated-output.internal.1",
      approval: {
        userConfirmed: true,
        confirmationKind: "finalize-generated-output" as const,
        allowFilesystemWrite: true,
        allowPartialCompletion: true,
      },
      actor: { initiatedBy: "human" as const, automationSafe: false },
    };
    const result = await client.finalizeGeneratedOutputAsAsset(command);

    expect(apiBridge.finalizeGeneratedOutputAsAsset).toHaveBeenCalledWith(command);
    expect(result).toMatchObject({
      ok: true,
      value: {
        ok: false,
        operation: "asset.finalize-generated-output",
        failure: { code: "internal", message: "Something went wrong while completing this action." },
      },
    });
    expect(JSON.stringify(result)).not.toContain("C:\\Users\\name\\secret");
  });

  it("maps validation, not-found, and internal failures safely", async () => {
    const apiBridge = api({
      listAssetDefinitions: testDouble.fn().mockResolvedValue(failure("validation", "Invalid query.", {
        fieldIssues: [{ field: "limit", message: "Must be under 100." }],
      })),
      readAssetDefinition: testDouble.fn().mockResolvedValue(failure("not-found", "missing /tmp/secret")),
      readAssetDefinitionVersion: testDouble.fn().mockResolvedValue(failure("internal", "stack at C:\\Users\\name\\secret")),
    });
    setDesktopApi(apiBridge);

    const client = createDesktopAssetLibraryClient();
    const validation = await client.listAssetDefinitions({ limit: 999 });
    const notFound = await client.readAssetDefinition({ definitionId: "missing" });
    const internal = await client.readAssetDefinitionVersion({ definitionId: "builtin.document", version: "9.9.9" });

    expect(validation).toMatchObject({
      ok: false,
      error: { code: "validation", message: "Invalid query.", fieldIssues: [{ field: "limit", message: "Must be under 100." }] },
    });
    expect(notFound).toMatchObject({ ok: false, error: { code: "not-found", message: "Asset definition was not found." } });
    expect(internal).toMatchObject({ ok: false, error: { code: "internal", message: "Unable to read Asset Library data." } });
    expect(JSON.stringify(internal).includes("C:\\Users\\name\\secret")).toBe(false);
  });

  it("exposes only controlled mutations and no arbitrary mutation or execution methods", () => {
    setDesktopApi({
      ...api(),
    });
    const client = createDesktopAssetLibraryClient() as unknown as Record<string, unknown>;

    for (const method of ["createAssetDefinition", "updateAssetDefinition", "deleteAssetDefinition", "seedBuiltInAssetDefinitions", "importAsset", "finalizeAsset", "scanResources", "executeAsset"]) {
      expect(client[method]).toBeUndefined();
    }
    expect(typeof client.registerResourceBackedViewAsAsset).toBe("function");
    expect(typeof client.finalizeGeneratedOutputAsAsset).toBe("function");
    expect(typeof client.importExternalRepositoryObjectAsAsset).toBe("function");
    expect(typeof client.localizeExternalRepositoryObjectAsAsset).toBe("function");
  });

  it("does not import forbidden application, host, persistence, or transport handler modules", () => {
    const source = readFileSync(join(process.cwd(), "apps/desktop/src/renderer/features/asset-library/api/desktopAssetLibraryClient.ts"), "utf8");

    expect(source).not.toContain("modules/application");
    expect(source).not.toContain("modules/hosts");
    expect(source).not.toContain("adapters/persistence");
    expect(source).not.toContain("ipc-electron");
  });
});
