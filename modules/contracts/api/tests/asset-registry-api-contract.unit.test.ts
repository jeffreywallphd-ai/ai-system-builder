import { describe, expect, expectTypeOf, it } from "../../../testing/node-test";
import { normalizeAssetId } from "../../asset";
import type { AssetDefinitionCard, AssetDefinitionDetail, AssetRegistryListResult } from "../../../application/services/asset/asset-registry-read-facade.types";
import {
  API_ASSET_DEFINITION_READ_OPERATION,
  API_ASSET_DEFINITION_VERSION_READ_OPERATION,
  API_ASSET_DEFINITIONS_LIST_OPERATION,
  API_ASSET_RESOURCE_BACKED_VIEW_READ_OPERATION,
  API_ASSET_RESOURCE_BACKED_VIEWS_LIST_OPERATION,
  API_ASSET_REGISTER_RESOURCE_BACKED_VIEW_OPERATION,
  API_ASSET_FINALIZE_GENERATED_OUTPUT_OPERATION,
  API_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_OPERATION,
  API_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_OPERATION,
  API_ASSET_MUTATION_ROUTES,
  createApiAssetDefinitionReadFailureResponse,
  createApiAssetDefinitionReadRequest,
  createApiAssetDefinitionReadSuccessResponse,
  createApiAssetDefinitionVersionReadRequest,
  createApiAssetMutationSuccessResponse,
  createApiAssetRegisterResourceBackedViewRequest,
  createApiAssetResourceBackedViewReadRequest,
  createApiAssetResourceBackedViewsListRequest,
  createApiAssetResourceBackedViewsListSuccessResponse,
  createApiAssetDefinitionsListRequest,
  createApiAssetDefinitionsListSuccessResponse,
  type ApiAssetDefinitionReadResponse,
  type ApiAssetDefinitionsListResponse,
} from "../asset-registry-api-contract";

describe("asset registry API contract", () => {
  it("keeps stable read-only operation identities", () => {
    expect(API_ASSET_DEFINITIONS_LIST_OPERATION).toBe("asset.definitions-list");
    expect(API_ASSET_DEFINITION_READ_OPERATION).toBe("asset.definition-read");
    expect(API_ASSET_DEFINITION_VERSION_READ_OPERATION).toBe("asset.definition-version-read");
    expect(API_ASSET_RESOURCE_BACKED_VIEWS_LIST_OPERATION).toBe("asset.resource-backed-views-list");
    expect(API_ASSET_RESOURCE_BACKED_VIEW_READ_OPERATION).toBe("asset.resource-backed-view-read");
    expect(API_ASSET_REGISTER_RESOURCE_BACKED_VIEW_OPERATION).toBe("asset.register-resource-backed-view");
    expect(API_ASSET_FINALIZE_GENERATED_OUTPUT_OPERATION).toBe("asset.finalize-generated-output");
    expect(API_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_OPERATION).toBe("asset.import-external-repository-object");
    expect(API_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_OPERATION).toBe("asset.localize-external-repository-object");
  });

  it("uses the shared API envelope conventions with request metadata", () => {
    const request = createApiAssetDefinitionsListRequest({ q: "workflow", includeMetadata: true }, { requestId: "r1", correlationId: "c1" });
    const response = createApiAssetDefinitionsListSuccessResponse({ items: [] }, { requestId: "r1", correlationId: "c1" });

    expect(request).toMatchObject({ operation: "asset.definitions-list", requestId: "r1", correlationId: "c1", payload: { q: "workflow" } });
    expect(response).toMatchObject({ ok: true, operation: "asset.definitions-list", requestId: "r1", correlationId: "c1", value: { items: [] } });
  });

  it("wraps Asset Registry read-facade read models in API responses", () => {
    expectTypeOf<ApiAssetDefinitionsListResponse>().toExtend<{ value?: AssetRegistryListResult<AssetDefinitionCard> }>();
    expectTypeOf<ApiAssetDefinitionReadResponse>().toExtend<{ value?: AssetDefinitionDetail }>();

    const card: AssetDefinitionCard = {
      definitionRef: { kind: "asset-definition-version", id: normalizeAssetId("definition.system"), version: "1.0.0" },
      definitionId: "definition.system",
      version: "1.0.0",
      assetType: "tool",
      assetFamily: "behavioral",
      displayName: "System component",
      lifecycleStatus: "published",
      sourcePackId: "system.foundation",
      sourcePackVersion: "1.0.0",
      sourcePackDisplayName: "System Foundation",
      sourceKind: "system",
      sourceLayer: "system-default",
      trustStatus: "system-trusted",
      packCategoryId: "ui-structure",
      packCategoryDisplayName: "UI Structure",
      systemDefault: true,
    };
    expect(createApiAssetDefinitionsListSuccessResponse({ items: [card] })).toMatchObject({
      ok: true,
      value: {
        items: [{
          sourcePackId: "system.foundation",
          sourcePackDisplayName: "System Foundation",
          sourceLayer: "system-default",
          packCategoryDisplayName: "UI Structure",
          systemDefault: true,
        }],
      },
    });

    const detail: AssetDefinitionDetail = {
      definition: {
        definitionId: "asset.one" as any,
        assetType: "workflow",
        assetFamily: "behavioral",
        version: "1.0.0",
        displayName: "Asset One",
        lifecycleStatus: "published",
      } as any,
    };
    expect(createApiAssetDefinitionReadSuccessResponse(detail)).toMatchObject({ ok: true, value: detail });
  });

  it("wraps resource-backed view reads in the shared API envelope", () => {
    const request = createApiAssetResourceBackedViewsListRequest({ q: "generated", viewKind: ["generated-output"] }, { requestId: "rv1" });
    const read = createApiAssetResourceBackedViewReadRequest({ viewId: " asset-view.generated-output.internal.1 ", expand: ["metadata"] });
    const response = createApiAssetResourceBackedViewsListSuccessResponse({
      items: [{ viewId: "asset-view.generated-output.internal.1", viewKind: "generated-output", displayName: "Generated output" }],
    });

    expect(request).toMatchObject({ operation: "asset.resource-backed-views-list", requestId: "rv1", payload: { q: "generated" } });
    expect(read).toMatchObject({ operation: "asset.resource-backed-view-read", payload: { viewId: "asset-view.generated-output.internal.1" } });
    expect(response).toMatchObject({ ok: true, operation: "asset.resource-backed-views-list" });
  });

  it("defines only the four approved POST mutation routes", () => {
    expect(Object.values(API_ASSET_MUTATION_ROUTES).map((route) => [route.method, route.path, route.operation])).toEqual([
      ["POST", "/api/assets/register-resource-backed-view", "asset.register-resource-backed-view"],
      ["POST", "/api/assets/finalize-generated-output", "asset.finalize-generated-output"],
      ["POST", "/api/assets/import-external-repository-object", "asset.import-external-repository-object"],
      ["POST", "/api/assets/localize-external-repository-object", "asset.localize-external-repository-object"],
    ]);
    expect(/create|update|delete|patch|edit|seed|execute|run|scan/i.test(JSON.stringify(API_ASSET_MUTATION_ROUTES))).toBe(false);
  });

  it("wraps approved mutation commands and results in API envelopes", () => {
    const command = {
      operation: "asset.register-resource-backed-view" as const,
      viewId: "asset-view.artifact.1",
      approval: { userConfirmed: true, confirmationKind: "register-resource-backed-view" as const },
      actor: { initiatedBy: "human" as const },
    };
    const request = createApiAssetRegisterResourceBackedViewRequest(command, { requestId: "mut-r1", correlationId: "mut-c1" });
    const response = createApiAssetMutationSuccessResponse("asset.register-resource-backed-view", {
      ok: true,
      operation: "asset.register-resource-backed-view",
      status: "created",
    }, { requestId: "mut-r1", correlationId: "mut-c1" });

    expect(request).toMatchObject({ operation: "asset.register-resource-backed-view", payload: command, requestId: "mut-r1", correlationId: "mut-c1" });
    expect(response).toMatchObject({ ok: true, operation: "asset.register-resource-backed-view", value: { ok: true, status: "created" } });
  });

  it("does not export arbitrary asset editor operation identities", async () => {
    const exportedNames = Object.keys(await import("../asset-registry-api-contract"));
    expect(exportedNames.filter((name) => name.includes("OPERATION")).some((name) => /(CREATE|UPDATE|DELETE|PATCH|EDIT|SEED|PUBLISH|EXECUTE|RUN|SCAN|SYNC|REPAIR|INSTALL|START|TRAIN|VALIDATE)/.test(name))).toBe(false);
  });

  it("normalizes definition read requests and returns failure envelopes through shared API helpers", () => {
    expect(createApiAssetDefinitionReadRequest({ definitionId: " builtin.workflow ", version: " 1.0.0 " })).toMatchObject({
      ok: undefined,
      operation: "asset.definition-read",
      payload: { definitionId: "builtin.workflow", version: "1.0.0" },
    });
    expect(createApiAssetDefinitionVersionReadRequest({ definitionId: "builtin.workflow", version: "1.0.0" })).toMatchObject({ operation: "asset.definition-version-read" });
    expect(createApiAssetDefinitionReadFailureResponse("not-found", "Missing.", { requestId: "r404" })).toMatchObject({
      ok: false,
      requestId: "r404",
      error: { code: "not-found", kind: "client", message: "Missing." },
    });
  });
});
