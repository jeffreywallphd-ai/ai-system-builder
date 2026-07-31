import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, testDouble } from "../../../../../../modules/testing/node-test";
import { createApiAssetLibraryClient } from "../api/apiAssetLibraryClient";

function installBrowserStubs(fetchMock: (...args: any[]) => unknown): void {
  (globalThis as { localStorage?: any }).localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  };
  (globalThis as { fetch?: typeof fetch }).fetch = fetchMock as typeof fetch;
}

function response(status: number, body: unknown) {
  return {
    status,
    json: testDouble.fn().mockResolvedValue(body),
  };
}

function queuedFetch(responses: readonly unknown[]) {
  const queue = [...responses];
  return testDouble.fn((..._args: any[]) => Promise.resolve(queue.shift()));
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
      provenance: { sourceKind: "system-generated" },
    },
    builtIn: true,
  };
}

function resourceViewValue() {
  return {
    view: {
      viewId: "asset-view.external-repository-object.internal.1",
      viewKind: "external-repository-object",
      assetType: "data-source",
      assetFamily: "resource-backed",
      displayName: "External object",
      summary: "External repository object view; not imported or registered.",
      metadata: { imported: false, registered: false },
    },
  };
}

describe("api asset library client", () => {
  it("calls GET-only asset definition routes and serializes query params", async () => {
    const fetchMock = testDouble.fn().mockResolvedValue(response(200, { ok: true, value: { items: [] } }));
    installBrowserStubs(fetchMock);

    const client = createApiAssetLibraryClient({ apiBaseUrl: "/api" });
    await client.listAssetDefinitions({
      searchText: "doc",
      assetTypes: ["document"],
      assetFamilies: ["resource-backed"],
      lifecycleStatuses: ["published"],
      builtIn: "built-in",
      limit: 25,
      cursor: "next",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/assets/definitions?q=doc&assetType=document&assetFamily=resource-backed&lifecycleStatus=published&builtIn=built-in&limit=25&cursor=next");
    expect((init as RequestInit).method).toBe("GET");
  });

  it("maps successful list and detail responses", async () => {
    const fetchMock = queuedFetch([
      response(200, {
        ok: true,
        value: {
          items: [{
            definitionId: "builtin.document",
            version: "1.0.0",
            assetType: "document",
            assetFamily: "resource-backed",
            displayName: "Document",
            lifecycleStatus: "published",
            builtIn: true,
          }],
        },
      }),
      response(200, { ok: true, value: detailValue() }),
      response(200, { ok: true, value: detailValue() }),
    ]);
    installBrowserStubs(fetchMock);

    const client = createApiAssetLibraryClient({ apiBaseUrl: "/api" });
    const list = await client.listAssetDefinitions();
    const detail = await client.readAssetDefinition({ definitionId: "builtin.document" }, { expand: ["aiContext", "metadata"] });
    const version = await client.readAssetDefinitionVersion({ definitionId: "builtin.document", version: "1.0.0" }, { includeValidation: true });

    expect(list).toMatchObject({ ok: true, value: { items: [{ id: "builtin.document@1.0.0" }] } });
    expect(detail).toMatchObject({ ok: true, value: { builtIn: true, definitionId: "builtin.document" } });
    expect(version).toMatchObject({ ok: true, value: { version: "1.0.0" } });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/assets/definitions/builtin.document?expand=aiContext%2Cmetadata");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/assets/definitions/builtin.document/versions/1.0.0?includeValidation=true");
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).method).toBe("GET");
    }
  });

  it("omits validation query flags from default detail requests", async () => {
    const fetchMock = queuedFetch([
      response(200, { ok: true, value: detailValue() }),
      response(200, { ok: true, value: detailValue() }),
    ]);
    installBrowserStubs(fetchMock);

    const client = createApiAssetLibraryClient({ apiBaseUrl: "/api" });
    await client.readAssetDefinition({ definitionId: "builtin.document" });
    await client.readAssetDefinitionVersion({ definitionId: "builtin.document", version: "1.0.0" });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/assets/definitions/builtin.document");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/assets/definitions/builtin.document/versions/1.0.0");
  });

  it("calls GET-only resource-backed view routes and maps unregistered status labels", async () => {
    const fetchMock = queuedFetch([
      response(200, { ok: true, value: { items: [resourceViewValue().view] } }),
      response(200, { ok: true, value: resourceViewValue() }),
    ]);
    installBrowserStubs(fetchMock);

    const client = createApiAssetLibraryClient({ apiBaseUrl: "/api" });
    const list = await client.listAssetResourceBackedViews({ searchText: "external", viewKinds: ["external-repository-object"], limit: 10 });
    const detail = await client.readAssetResourceBackedView({ viewId: "asset-view.external-repository-object.internal.1" }, { expand: ["metadata", "resourceBackings"] });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/assets/resource-backed-views?q=external&viewKind=external-repository-object&limit=10");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/assets/resource-backed-views/asset-view.external-repository-object.internal.1?expand=metadata%2CresourceBackings");
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).method).toBe("GET");
    }
    expect(list).toMatchObject({ ok: true, value: { items: [{ registrationStatusLabel: "Not imported or registered" }] } });
    expect(detail).toMatchObject({ ok: true, value: { registrationStatusLabel: "Not imported or registered" } });
  });

  it("maps validation, not-found, and internal failures safely", async () => {
    const fetchMock = queuedFetch([
      response(400, {
        ok: false,
        error: { code: "validation", message: "Invalid asset definitions query.", details: { fieldIssues: [{ field: "limit", message: "Must be under 100." }] } },
      }),
      response(404, {
        ok: false,
        error: { code: "not-found", message: "Asset definition was not found at /tmp/secret." },
      }),
      response(500, {
        ok: false,
        error: { code: "internal", message: "stack C:\\Users\\name\\secret" },
      }),
    ]);
    installBrowserStubs(fetchMock);

    const client = createApiAssetLibraryClient({ apiBaseUrl: "/api" });
    const validation = await client.listAssetDefinitions({ limit: 999 });
    const notFound = await client.readAssetDefinition({ definitionId: "missing" });
    const internal = await client.readAssetDefinitionVersion({ definitionId: "missing", version: "9.9.9" });

    expect(validation).toMatchObject({
      ok: false,
      error: { code: "validation", message: "Invalid asset definitions query.", status: 400 },
    });
    expect(notFound).toMatchObject({
      ok: false,
      error: { code: "not-found", message: "Asset definition was not found.", status: 404 },
    });
    expect(internal).toMatchObject({
      ok: false,
      error: { code: "internal", message: "Unable to read Asset Library data.", status: 500 },
    });
    expect(JSON.stringify(internal).includes("C:\\Users\\name\\secret")).toBe(false);
  });

  it("posts controlled mutation commands and sanitizes mutation results", async () => {
    const fetchMock = queuedFetch([
      response(200, {
        ok: true,
        value: {
          ok: false,
          operation: "asset.import-external-repository-object",
          failure: {
            code: "internal",
            message: "stack at C:\\Users\\name\\secret",
            operation: "asset.import-external-repository-object",
            diagnostics: [{ severity: "error", code: "raw", message: "Bearer secret" }],
          },
        },
      }),
    ]);
    installBrowserStubs(fetchMock);

    const client = createApiAssetLibraryClient({ apiBaseUrl: "/api" });
    const command = {
      operation: "asset.import-external-repository-object" as const,
      viewId: "asset-view.external-repository-object.internal.1",
      importMode: "remote-reference" as const,
      approval: {
        userConfirmed: true,
        confirmationKind: "import-external-object" as const,
        allowNetworkAccess: true,
        allowCredentialUse: true,
        allowFilesystemWrite: true,
        allowPartialCompletion: true,
      },
      actor: { initiatedBy: "human" as const, automationSafe: false, thinClientSafe: true },
    };
    const result = await client.importExternalRepositoryObjectAsAsset(command);

    expect(fetchMock.mock.calls[0][0]).toBe("/api/assets/import-external-repository-object");
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST");
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual(command);
    expect(result).toMatchObject({
      ok: true,
      value: {
        ok: false,
        operation: "asset.import-external-repository-object",
        failure: { code: "internal", message: "Something went wrong while completing this action." },
      },
    });
    expect(JSON.stringify(result)).not.toContain("C:\\Users\\name\\secret");
    expect(JSON.stringify(result)).not.toContain("Bearer secret");
  });

  it("exposes only controlled mutations and no arbitrary mutation or execution methods", () => {
    const fetchMock = testDouble.fn().mockResolvedValue(response(200, { ok: true, value: { items: [] } }));
    installBrowserStubs(fetchMock);
    const client = createApiAssetLibraryClient() as unknown as Record<string, unknown>;

    for (const method of ["createAssetDefinition", "updateAssetDefinition", "deleteAssetDefinition", "seedBuiltInAssetDefinitions", "importAsset", "finalizeAsset", "scanResources", "executeAsset"]) {
      expect(client[method]).toBeUndefined();
    }
    expect(typeof client.registerResourceBackedViewAsAsset).toBe("function");
    expect(typeof client.finalizeGeneratedOutputAsAsset).toBe("function");
    expect(typeof client.importExternalRepositoryObjectAsAsset).toBe("function");
    expect(typeof client.localizeExternalRepositoryObjectAsAsset).toBe("function");
  });

  it("does not import server handlers, application services, host composition, or persistence adapters", () => {
    const source = readFileSync(join(process.cwd(), "apps/thin-client/src/features/asset-library/api/apiAssetLibraryClient.ts"), "utf8");

    expect(source).not.toContain("modules/application");
    expect(source).not.toContain("api-express");
    expect(source).not.toContain("modules/hosts");
    expect(source).not.toContain("adapters/persistence");
  });
});
