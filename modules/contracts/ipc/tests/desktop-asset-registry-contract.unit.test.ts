import { describe, expect, expectTypeOf, it } from "../../../testing/node-test";
import { normalizeAssetId } from "../../asset";
import type {
  AssetDefinitionCard,
  AssetDefinitionDetail,
  AssetRegistryListResult,
  AssetRegistryResourceBackedViewCard,
} from "../../../application/services/asset/asset-registry-read-facade.types";
import {
  DESKTOP_ASSET_DEFINITIONS_LIST_OPERATION,
  DESKTOP_ASSET_DEFINITIONS_LIST_REQUEST_CHANNEL,
  DESKTOP_ASSET_DEFINITIONS_LIST_RESPONSE_CHANNEL,
  DESKTOP_ASSET_DEFINITION_READ_OPERATION,
  DESKTOP_ASSET_DEFINITION_READ_REQUEST_CHANNEL,
  DESKTOP_ASSET_DEFINITION_READ_RESPONSE_CHANNEL,
  DESKTOP_ASSET_DEFINITION_VERSION_READ_OPERATION,
  DESKTOP_ASSET_DEFINITION_VERSION_READ_REQUEST_CHANNEL,
  DESKTOP_ASSET_DEFINITION_VERSION_READ_RESPONSE_CHANNEL,
  DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_OPERATION,
  DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_REQUEST_CHANNEL,
  DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_RESPONSE_CHANNEL,
  DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_OPERATION,
  DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_REQUEST_CHANNEL,
  DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_RESPONSE_CHANNEL,
  DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_OPERATION,
  DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_REQUEST_CHANNEL,
  DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_RESPONSE_CHANNEL,
  DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_OPERATION,
  DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_REQUEST_CHANNEL,
  DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_RESPONSE_CHANNEL,
  DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_OPERATION,
  DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL,
  DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_RESPONSE_CHANNEL,
  DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_OPERATION,
  DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL,
  DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_RESPONSE_CHANNEL,
  createDesktopAssetDefinitionReadRequest,
  createDesktopAssetDefinitionReadSuccessResponse,
  createDesktopAssetDefinitionVersionReadRequest,
  createDesktopAssetMutationSuccessResponse,
  createDesktopAssetRegisterResourceBackedViewRequest,
  createDesktopAssetResourceBackedViewReadRequest,
  createDesktopAssetResourceBackedViewsListRequest,
  createDesktopAssetResourceBackedViewsListSuccessResponse,
  createDesktopAssetDefinitionsListRequest,
  createDesktopAssetDefinitionsListSuccessResponse,
  getDesktopAssetDefinitionReadChannel,
  getDesktopAssetDefinitionVersionReadChannel,
  getDesktopAssetResourceBackedViewReadChannel,
  getDesktopAssetResourceBackedViewsListChannel,
  getDesktopAssetDefinitionsListChannel,
  type DesktopAssetDefinitionReadResponse,
  type DesktopAssetDefinitionsListResponse,
} from "../desktop-asset-registry-contract";

describe("desktop asset registry IPC contract", () => {
  it("uses stable operation identities", () => {
    expect(DESKTOP_ASSET_DEFINITIONS_LIST_OPERATION).toBe("asset.definitions-list");
    expect(DESKTOP_ASSET_DEFINITION_READ_OPERATION).toBe("asset.definition-read");
    expect(DESKTOP_ASSET_DEFINITION_VERSION_READ_OPERATION).toBe("asset.definition-version-read");
    expect(DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_OPERATION).toBe("asset.resource-backed-views-list");
    expect(DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_OPERATION).toBe("asset.resource-backed-view-read");
    expect(DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_OPERATION).toBe("asset.register-resource-backed-view");
    expect(DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_OPERATION).toBe("asset.finalize-generated-output");
    expect(DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_OPERATION).toBe("asset.import-external-repository-object");
    expect(DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_OPERATION).toBe("asset.localize-external-repository-object");
  });

  it("derives request and response channels from operation identities", () => {
    expect(DESKTOP_ASSET_DEFINITIONS_LIST_REQUEST_CHANNEL.value).toBe("ipc.asset.definitions-list.request");
    expect(DESKTOP_ASSET_DEFINITIONS_LIST_RESPONSE_CHANNEL.value).toBe("ipc.asset.definitions-list.response");
    expect(DESKTOP_ASSET_DEFINITION_READ_REQUEST_CHANNEL.value).toBe("ipc.asset.definition-read.request");
    expect(DESKTOP_ASSET_DEFINITION_READ_RESPONSE_CHANNEL.value).toBe("ipc.asset.definition-read.response");
    expect(DESKTOP_ASSET_DEFINITION_VERSION_READ_REQUEST_CHANNEL.value).toBe("ipc.asset.definition-version-read.request");
    expect(DESKTOP_ASSET_DEFINITION_VERSION_READ_RESPONSE_CHANNEL.value).toBe("ipc.asset.definition-version-read.response");
    expect(DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_REQUEST_CHANNEL.value).toBe("ipc.asset.resource-backed-views-list.request");
    expect(DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_RESPONSE_CHANNEL.value).toBe("ipc.asset.resource-backed-views-list.response");
    expect(DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_REQUEST_CHANNEL.value).toBe("ipc.asset.resource-backed-view-read.request");
    expect(DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_RESPONSE_CHANNEL.value).toBe("ipc.asset.resource-backed-view-read.response");
    expect(DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_REQUEST_CHANNEL.value).toBe("ipc.asset.register-resource-backed-view.request");
    expect(DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_RESPONSE_CHANNEL.value).toBe("ipc.asset.register-resource-backed-view.response");
    expect(DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_REQUEST_CHANNEL.value).toBe("ipc.asset.finalize-generated-output.request");
    expect(DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_RESPONSE_CHANNEL.value).toBe("ipc.asset.finalize-generated-output.response");
    expect(DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL.value).toBe("ipc.asset.import-external-repository-object.request");
    expect(DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_RESPONSE_CHANNEL.value).toBe("ipc.asset.import-external-repository-object.response");
    expect(DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL.value).toBe("ipc.asset.localize-external-repository-object.request");
    expect(DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_RESPONSE_CHANNEL.value).toBe("ipc.asset.localize-external-repository-object.response");
    expect(getDesktopAssetDefinitionsListChannel("request")).toBe(DESKTOP_ASSET_DEFINITIONS_LIST_REQUEST_CHANNEL);
    expect(getDesktopAssetDefinitionReadChannel("response")).toBe(DESKTOP_ASSET_DEFINITION_READ_RESPONSE_CHANNEL);
    expect(getDesktopAssetDefinitionVersionReadChannel("request")).toBe(DESKTOP_ASSET_DEFINITION_VERSION_READ_REQUEST_CHANNEL);
    expect(getDesktopAssetResourceBackedViewsListChannel("request")).toBe(DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_REQUEST_CHANNEL);
    expect(getDesktopAssetResourceBackedViewReadChannel("response")).toBe(DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_RESPONSE_CHANNEL);
  });

  it("uses existing IPC request and response envelope conventions", () => {
    const request = createDesktopAssetDefinitionsListRequest(
      {
        searchText: "workflow",
        builtIn: "built-in",
        boundary: { host: "desktop", source: "desktop.renderer.asset-registry" },
      },
      { requestId: "req-assets", correlationId: "corr-assets" },
    );
    const response = createDesktopAssetDefinitionsListSuccessResponse({ items: [] }, {
      requestId: request.requestId,
      correlationId: request.correlationId,
    });

    expect(request).toMatchObject({
      ok: undefined,
      operation: "asset.definitions-list",
      channel: "ipc.asset.definitions-list.request",
      requestId: "req-assets",
      correlationId: "corr-assets",
    });
    expect(response).toMatchObject({
      ok: true,
      operation: "asset.definitions-list",
      channel: "ipc.asset.definitions-list.response",
      requestId: "req-assets",
      correlationId: "corr-assets",
      value: { items: [] },
    });
  });

  it("wraps Asset Registry read facade models instead of redefining asset semantics", () => {
    expectTypeOf<DesktopAssetDefinitionsListResponse>().toEqualTypeOf<import("../ipc-response").IpcResponse<
      AssetRegistryListResult<AssetDefinitionCard>,
      Record<string, unknown>,
      typeof DESKTOP_ASSET_DEFINITIONS_LIST_OPERATION,
      Record<string, never>,
      typeof DESKTOP_ASSET_DEFINITIONS_LIST_RESPONSE_CHANNEL.value
    >>();
    expectTypeOf<DesktopAssetDefinitionReadResponse>().toEqualTypeOf<import("../ipc-response").IpcResponse<
      AssetDefinitionDetail,
      Record<string, unknown>,
      typeof DESKTOP_ASSET_DEFINITION_READ_OPERATION,
      Record<string, never>,
      typeof DESKTOP_ASSET_DEFINITION_READ_RESPONSE_CHANNEL.value
    >>();

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
    expect(createDesktopAssetDefinitionsListSuccessResponse({ items: [card] })).toMatchObject({
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
  });

  it("preserves request metadata for read and version-read helpers", () => {
    const read = createDesktopAssetDefinitionReadRequest(
      { definitionId: "builtin.workflow", expand: ["metadata"], boundary: { host: "desktop", source: "renderer" } },
      { requestId: "read-1", correlationId: "corr-1" },
    );
    const version = createDesktopAssetDefinitionVersionReadRequest(
      { definitionId: "builtin.workflow", version: "1.0.0", boundary: { host: "desktop", source: "renderer" } },
      { requestId: "read-version-1", correlationId: "corr-version-1" },
    );
    const response = createDesktopAssetDefinitionReadSuccessResponse({
      definition: {
        definitionId: "builtin.workflow",
        assetType: "workflow",
        assetFamily: "behavioral",
        version: "1.0.0",
        displayName: "Workflow",
        description: "Workflow definition",
        lifecycleStatus: "published",
        provenance: { sourceKind: "system-generated", createdAt: "2026-05-08T00:00:00.000Z" },
      },
    }, { requestId: read.requestId, correlationId: read.correlationId });

    expect(read.requestId).toBe("read-1");
    expect(version.correlationId).toBe("corr-version-1");
    expect(response).toMatchObject({ requestId: "read-1", correlationId: "corr-1" });
  });

  it("wraps resource-backed read helpers without mutation channels", () => {
    const request = createDesktopAssetResourceBackedViewsListRequest({
      searchText: "generated",
      viewKinds: ["generated-output"],
      boundary: { host: "desktop", source: "renderer" },
    }, { requestId: "rv-list" });
    const read = createDesktopAssetResourceBackedViewReadRequest({
      viewId: " asset-view.generated-output.internal.1 ",
      expand: ["metadata"],
      boundary: { host: "desktop", source: "renderer" },
    });
    const response = createDesktopAssetResourceBackedViewsListSuccessResponse({
      items: [{ viewId: "asset-view.generated-output.internal.1", viewKind: "generated-output" }],
    });

    expect(request).toMatchObject({
      operation: "asset.resource-backed-views-list",
      channel: "ipc.asset.resource-backed-views-list.request",
      requestId: "rv-list",
    });
    expect(read).toMatchObject({
      operation: "asset.resource-backed-view-read",
      payload: { viewId: "asset-view.generated-output.internal.1" },
    });
    expect(response).toMatchObject({ ok: true, operation: "asset.resource-backed-views-list" });
    expectTypeOf<typeof response>().toExtend<import("../ipc-response").IpcResponse<
      AssetRegistryListResult<AssetRegistryResourceBackedViewCard>,
      Record<string, unknown>,
      typeof DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_OPERATION,
      Record<string, never>,
      typeof DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_RESPONSE_CHANNEL.value
    >>();
  });

  it("wraps approved mutation commands and results without arbitrary editor channels", () => {
    const command = {
      operation: "asset.register-resource-backed-view" as const,
      viewId: "asset-view.artifact.1",
      approval: { userConfirmed: true, confirmationKind: "register-resource-backed-view" as const },
      actor: { initiatedBy: "human" as const },
    };
    const request = createDesktopAssetRegisterResourceBackedViewRequest(command, { requestId: "mut-r1", correlationId: "mut-c1" });
    const response = createDesktopAssetMutationSuccessResponse(DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_RESPONSE_CHANNEL, {
      ok: true,
      operation: "asset.register-resource-backed-view",
      status: "created",
    }, { requestId: "mut-r1", correlationId: "mut-c1" });
    const channelText = [
      DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL.value,
    ].join(" ");

    expect(request).toMatchObject({ operation: "asset.register-resource-backed-view", channel: "ipc.asset.register-resource-backed-view.request", payload: command });
    expect(response).toMatchObject({ ok: true, operation: "asset.register-resource-backed-view", channel: "ipc.asset.register-resource-backed-view.response" });
    expect(/create|update|delete|patch|edit|seed|execute|run|scan/i.test(channelText)).toBe(false);
  });

  it("does not export arbitrary asset editor operation identities", () => {
    const exportedNames = Object.keys({
      DESKTOP_ASSET_DEFINITIONS_LIST_OPERATION,
      DESKTOP_ASSET_DEFINITION_READ_OPERATION,
      DESKTOP_ASSET_DEFINITION_VERSION_READ_OPERATION,
      DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_OPERATION,
      DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_OPERATION,
      DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_OPERATION,
      DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_OPERATION,
      DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_OPERATION,
      DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_OPERATION,
    });
    expect(/CREATE|UPDATE|DELETE|PATCH|EDIT|SEED|PUBLISH|EXECUTE|RUN|SCAN|SYNC|REPAIR|INSTALL|START|TRAIN|VALIDATE/i.test(exportedNames.join(" "))).toBe(false);
  });
});
