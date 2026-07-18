import { describe, expect, it, testDouble } from "../../../../../modules/testing/node-test";

import {
  DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_PUBLISH_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_PUBLISH_VERIFY_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_SOURCE_VERIFY_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_REGISTER_FROM_REPO_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_MEDIA_VIEW_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UNREGISTERED_DELETE_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL,
  createDesktopArtifactBrowseSuccessResponse,
  createDesktopArtifactPublishSuccessResponse,
  createDesktopArtifactPublishVerifySuccessResponse,
  createDesktopArtifactSourceVerifySuccessResponse,
  createDesktopArtifactRegisterFromRepoSuccessResponse,
  createDesktopArtifactLocalizeFromRepoSuccessResponse,
  createDesktopArtifactMediaViewSuccessResponse,
  createDesktopArtifactUnregisteredBrowseSuccessResponse,
  createDesktopArtifactUnregisteredRegisterSuccessResponse,
  createDesktopArtifactUnregisteredDeleteSuccessResponse,
  createDesktopArtifactUploadSuccessResponse,
  createIpcChannel,
  createIpcError,
  createIpcFailureResponse,
  DESKTOP_HUGGING_FACE_TOKEN_GET_REQUEST_CHANNEL,
  createDesktopHuggingFaceTokenGetSuccessResponse,
  DESKTOP_INGEST_WEBSITE_PAGE_REQUEST_CHANNEL,
  DESKTOP_INGEST_WEBSITE_PAGES_BATCH_REQUEST_CHANNEL,
  createDesktopIngestWebsitePageSuccessResponse,
  createDesktopIngestWebsitePagesBatchSuccessResponse,
  DESKTOP_DATASET_PREPARE_TRAINING_START_REQUEST_CHANNEL,
  DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_REQUEST_CHANNEL,
  createDesktopPrepareTrainingDatasetStartSuccessResponse,
  createDesktopPrepareTrainingDatasetTaskReadSuccessResponse,
  DESKTOP_RUNTIME_READINESS_READ_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_REFRESH_INVENTORY_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_LIST_INVENTORY_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_READ_INVENTORY_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_READ_LATEST_INVENTORY_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_SUMMARIZE_INVENTORY_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_CREATE_BINDING_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_VALIDATE_BINDING_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_LIST_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_CREATE_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_SELECTION_READ_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_SELECTION_SAVE_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_SELECTION_CLEAR_REQUEST_CHANNEL,
  createDesktopWorkspaceListSuccessResponse,
  createDesktopWorkspaceCreateSuccessResponse,
  createDesktopWorkspaceSelectionReadSuccessResponse,
  createDesktopWorkspaceSelectionSaveSuccessResponse,
  createDesktopWorkspaceSelectionClearSuccessResponse,
  DESKTOP_ASSET_DEFINITIONS_LIST_REQUEST_CHANNEL,
  DESKTOP_ASSET_DEFINITION_READ_REQUEST_CHANNEL,
  DESKTOP_ASSET_DEFINITION_VERSION_READ_REQUEST_CHANNEL,
  DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_REQUEST_CHANNEL,
  DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_REQUEST_CHANNEL,
  DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_REQUEST_CHANNEL,
  DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_REQUEST_CHANNEL,
  DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL,
  DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL,
  DESKTOP_PYTHON_RUNTIME_STATUS_READ_REQUEST_CHANNEL,
  DESKTOP_PYTHON_RUNTIME_CONTROL_REQUEST_CHANNEL,
  createDesktopRuntimeReadinessReadSuccessResponse,
  createDesktopRuntimeCapabilityStatusReadSuccessResponse,
  createDesktopAssetDefinitionsListSuccessResponse,
  createDesktopAssetDefinitionReadSuccessResponse,
  createDesktopAssetDefinitionVersionReadSuccessResponse,
  createDesktopAssetResourceBackedViewReadSuccessResponse,
  createDesktopAssetResourceBackedViewsListSuccessResponse,
  createDesktopAssetMutationSuccessResponse,
  DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_RESPONSE_CHANNEL,
  DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_RESPONSE_CHANNEL,
  DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_RESPONSE_CHANNEL,
  DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_RESPONSE_CHANNEL,
  createDesktopPythonRuntimeStatusReadSuccessResponse,
  createDesktopPythonRuntimeControlSuccessResponse,
  DESKTOP_MODEL_BROWSE_REQUEST_CHANNEL,
  DESKTOP_MODEL_DETAILS_READ_REQUEST_CHANNEL,
  DESKTOP_MODEL_LIST_REQUEST_CHANNEL,
  DESKTOP_MODEL_REFERENCE_SAVE_REQUEST_CHANNEL,
  DESKTOP_MODEL_DOWNLOAD_REQUEST_CHANNEL,
  DESKTOP_MODEL_RECORD_UPDATE_REQUEST_CHANNEL,
  DESKTOP_MODEL_RECORD_DELETE_REQUEST_CHANNEL,
  DESKTOP_MODEL_TRAIN_STATUS_REQUEST_CHANNEL,
  createDesktopModelBrowseSuccessResponse,
  createDesktopModelDetailsReadSuccessResponse,
  createDesktopModelListSuccessResponse,
  createDesktopModelReferenceSaveSuccessResponse,
  createDesktopModelDownloadSuccessResponse,
  createDesktopModelRecordUpdateSuccessResponse,
  createDesktopModelRecordDeleteSuccessResponse,
  createDesktopModelTrainSuccessResponse,
  createDesktopModelTrainStatusSuccessResponse,
  DESKTOP_CONVERSATION_EXECUTION_V2_CREATE_SESSION_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_APPROVE_SESSION_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_LIST_SESSIONS_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_READ_SESSION_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_READ_TRANSCRIPT_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_READ_TURN_ACTIVITY_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_SUBMIT_TURN_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_CANCEL_TURN_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_RETRY_TURN_REQUEST_CHANNEL,
  DESKTOP_SYSTEM_BUILDER_CHANNELS,
  DESKTOP_SYSTEM_DATA_CHANNELS,
  DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS,
  createIpcSuccessResponse,
} from "../../../../../modules/contracts/ipc";
import {
  DESKTOP_USER_LIBRARY_PROMOTE_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_LINK_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_COPY_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_IMPORT_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_ASSET_LIST_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_ASSET_READ_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_LINK_LIST_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_LINK_READ_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_PROMOTE_RESPONSE_CHANNEL,
  DESKTOP_USER_LIBRARY_LINK_RESPONSE_CHANNEL,
  DESKTOP_USER_LIBRARY_COPY_RESPONSE_CHANNEL,
  DESKTOP_USER_LIBRARY_IMPORT_RESPONSE_CHANNEL,
  DESKTOP_USER_LIBRARY_ASSET_LIST_RESPONSE_CHANNEL,
  DESKTOP_USER_LIBRARY_ASSET_READ_RESPONSE_CHANNEL,
  DESKTOP_USER_LIBRARY_LINK_LIST_RESPONSE_CHANNEL,
  DESKTOP_USER_LIBRARY_LINK_READ_RESPONSE_CHANNEL,
  DESKTOP_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_RESPONSE_CHANNEL,
  createDesktopUserLibraryOperationSuccessResponse,
} from "../../../../../modules/contracts/ipc";
import { createDesktopPreloadApi, type IpcRendererInvokePort } from "../exposedApi";

describe("desktop preload exposedApi bridge", () => {


  it("maps System Builder templates and release-bound data operations to dedicated IPC channels", async () => {
    const responses = [
      createIpcSuccessResponse(DESKTOP_SYSTEM_BUILDER_CHANNELS.listTemplates.response, []),
      createIpcSuccessResponse(DESKTOP_SYSTEM_BUILDER_CHANNELS.createFromTemplate.response, {}),
      createIpcSuccessResponse(DESKTOP_SYSTEM_DATA_CHANNELS.describe.response, {}),
      createIpcSuccessResponse(DESKTOP_SYSTEM_DATA_CHANNELS.create.response, {}),
      createIpcSuccessResponse(DESKTOP_SYSTEM_DATA_CHANNELS.read.response, {}),
      createIpcSuccessResponse(DESKTOP_SYSTEM_DATA_CHANNELS.update.response, {}),
      createIpcSuccessResponse(DESKTOP_SYSTEM_DATA_CHANNELS.list.response, {}),
      createIpcSuccessResponse(DESKTOP_SYSTEM_DATA_CHANNELS.listAudit.response, []),
    ];
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockImplementation(async () => responses.shift());
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });
    const context = { requestId: "request-system-data", correlationId: "correlation-system-data" };
    const binding = { workspaceId: "workspace.a", releaseId: "release.a", entityType: "service-request" };

    await api.listSystemBuilderTemplates({}, context);
    await api.createSystemBuilderFromTemplate({ workspaceId: "workspace.a", templateId: "reference.secured-data-entry@1.0.0", name: "Requests" }, context);
    await api.describeSystemDataForm(binding, context);
    await api.createSystemDataRecord({ ...binding, recordId: "record.a", values: { title: "First" } }, context);
    await api.readSystemDataRecord({ ...binding, recordId: "record.a" }, context);
    await api.updateSystemDataRecord({ ...binding, recordId: "record.a", expectedRevision: 1, values: { title: "Updated" } }, context);
    await api.listSystemDataRecords({ ...binding, limit: 25 }, context);
    await api.listSystemDataAudit({ ...binding, limit: 25 }, context);

    expect(invoke.mock.calls.map((call) => call[0])).toEqual([
      DESKTOP_SYSTEM_BUILDER_CHANNELS.listTemplates.request.value,
      DESKTOP_SYSTEM_BUILDER_CHANNELS.createFromTemplate.request.value,
      DESKTOP_SYSTEM_DATA_CHANNELS.describe.request.value,
      DESKTOP_SYSTEM_DATA_CHANNELS.create.request.value,
      DESKTOP_SYSTEM_DATA_CHANNELS.read.request.value,
      DESKTOP_SYSTEM_DATA_CHANNELS.update.request.value,
      DESKTOP_SYSTEM_DATA_CHANNELS.list.request.value,
      DESKTOP_SYSTEM_DATA_CHANNELS.listAudit.request.value,
    ]);
    expect(invoke.mock.calls[1]?.[1]).toMatchObject({ payload: { workspaceId: "workspace.a", templateId: "reference.secured-data-entry@1.0.0", name: "Requests" }, requestId: context.requestId, correlationId: context.correlationId });
  });
  it("maps conversation execution bridge calls to conversation IPC channels", async () => {
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue({ ok: true, value: {} });
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });
    await api.createConversationExecutionSessionFromPlan({ workspaceId: 'ws.1', sourceExecutionPlanId: 'ep.1' });
    await api.approveConversationSession({ workspaceId: 'ws.1', conversationSessionId: 's.1', executionApprovalId: 'ea.1' });
    await api.listConversationSessions({ workspaceId: 'ws.1' });
    await api.readConversationSession({ workspaceId: 'ws.1', conversationSessionId: 's.1' });
    await api.readConversationTranscript({ workspaceId: 'ws.1', conversationSessionId: 's.1' });
    await api.readConversationTurnActivity({ workspaceId: 'ws.1', conversationSessionId: 's.1', conversationTurnId: 't.1' });
    await api.submitConversationTurn({ workspaceId: 'ws.1', conversationSessionId: 's.1', text: 'hello', operationId: 'op.1' });
    await api.cancelConversationTurn({ workspaceId: 'ws.1', conversationSessionId: 's.1', conversationTurnId: 't.1', operationId: 'op.2' });
    await api.retryConversationTurn({ workspaceId: 'ws.1', conversationSessionId: 's.1', conversationTurnId: 't.1', operationId: 'op.3' });
    expect(invoke.mock.calls.map((call) => call[0])).toEqual([
      DESKTOP_CONVERSATION_EXECUTION_V2_CREATE_SESSION_REQUEST_CHANNEL.value,
      DESKTOP_CONVERSATION_EXECUTION_V2_APPROVE_SESSION_REQUEST_CHANNEL.value,
      DESKTOP_CONVERSATION_EXECUTION_V2_LIST_SESSIONS_REQUEST_CHANNEL.value,
      DESKTOP_CONVERSATION_EXECUTION_V2_READ_SESSION_REQUEST_CHANNEL.value,
      DESKTOP_CONVERSATION_EXECUTION_V2_READ_TRANSCRIPT_REQUEST_CHANNEL.value,
      DESKTOP_CONVERSATION_EXECUTION_V2_READ_TURN_ACTIVITY_REQUEST_CHANNEL.value,
      DESKTOP_CONVERSATION_EXECUTION_V2_SUBMIT_TURN_REQUEST_CHANNEL.value,
      DESKTOP_CONVERSATION_EXECUTION_V2_CANCEL_TURN_REQUEST_CHANNEL.value,
      DESKTOP_CONVERSATION_EXECUTION_V2_RETRY_TURN_REQUEST_CHANNEL.value,
    ]);
  });
  it("maps runtime readiness reads to dedicated request channel", async () => {
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
      createDesktopRuntimeReadinessReadSuccessResponse({
        status: "unknown",
        healthy: false,
        available: false,
        capabilities: [],
      }),
    );
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });
    const response = await api.readRuntimeReadiness({ requestId: "req-ready" });

    expect(response.ok).toBe(true);
    expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_RUNTIME_READINESS_READ_REQUEST_CHANNEL.value);
    expect(invoke.mock.calls[0]?.[1]).toMatchObject({
      requestId: "req-ready",
      payload: { boundary: { host: "desktop", source: "desktop.renderer.runtime-readiness" } },
    });
  });

  it("maps runtime capability status reads to dedicated request channel", async () => {
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
      createDesktopRuntimeCapabilityStatusReadSuccessResponse({
        capabilityId: "python-runtime",
        status: "ready",
        healthy: true,
        available: true,
      }),
    );
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });
    const response = await api.readRuntimeCapabilityStatus({ capabilityId: "python-runtime" });

    expect(response.ok).toBe(true);
    expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_REQUEST_CHANNEL.value);
    expect(invoke.mock.calls[0]?.[1]).toMatchObject({
      payload: {
        capabilityId: "python-runtime",
        boundary: { host: "desktop", source: "desktop.renderer.runtime-readiness" },
      },
    });
  });


  it("maps runtime readiness v2 IPC methods to dedicated channels", async () => {
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue({ ok: true, value: {} });
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });
    await api.refreshRuntimeReadinessInventory({ targetWorkspaceId: "workspace.a" }, { requestId: "r1" });
    await api.listRuntimeReadinessInventory({ targetWorkspaceId: "workspace.a" });
    await api.readRuntimeReadinessInventory({ targetWorkspaceId: "workspace.a", inventorySourceId: "source.a" });
    await api.readLatestRuntimeReadinessInventory({ targetWorkspaceId: "workspace.a", sourceKind: "desktop-runtime" });
    await api.summarizeRuntimeReadinessInventory({ targetWorkspaceId: "workspace.a" });
    await api.createRuntimeReadinessBinding({ targetWorkspaceId: "workspace.a", compositionPlanId: "plan.a" });
    await api.validateRuntimeReadinessBinding({ targetWorkspaceId: "workspace.a", readinessBindingId: "rrb.a" });
    expect(invoke.mock.calls.map((call) => call[0])).toEqual([
      DESKTOP_RUNTIME_READINESS_REFRESH_INVENTORY_REQUEST_CHANNEL.value,
      DESKTOP_RUNTIME_READINESS_LIST_INVENTORY_REQUEST_CHANNEL.value,
      DESKTOP_RUNTIME_READINESS_READ_INVENTORY_REQUEST_CHANNEL.value,
      DESKTOP_RUNTIME_READINESS_READ_LATEST_INVENTORY_REQUEST_CHANNEL.value,
      DESKTOP_RUNTIME_READINESS_SUMMARIZE_INVENTORY_REQUEST_CHANNEL.value,
      DESKTOP_RUNTIME_READINESS_CREATE_BINDING_REQUEST_CHANNEL.value,
      DESKTOP_RUNTIME_READINESS_VALIDATE_BINDING_REQUEST_CHANNEL.value,
    ]);
  });

  it("maps workspace list/create/selection bridge calls to minimal workspace IPC channels", async () => {
    const workspace = {
      workspaceId: "workspace.generated-preload",
      displayName: "Preload Workspace",
      status: "active",
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
    } as const;
    const responses = [
      createDesktopWorkspaceListSuccessResponse({ workspaces: [workspace] }),
      createDesktopWorkspaceCreateSuccessResponse({ workspace, activeSelection: { workspaceId: workspace.workspaceId } as never }),
      createDesktopWorkspaceSelectionReadSuccessResponse({ workspaceId: workspace.workspaceId } as never),
      createDesktopWorkspaceSelectionSaveSuccessResponse({ workspaceId: workspace.workspaceId } as never),
      createDesktopWorkspaceSelectionClearSuccessResponse({}),
    ];
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockImplementation(async () => responses.shift());
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

    await api.listWorkspaces({ requestId: "workspace-list" });
    await api.createWorkspace({ command: { displayName: "Preload Workspace", includeSystemFoundationAssets: true }, selectAfterCreate: true });
    await api.readActiveWorkspaceSelection();
    await api.saveActiveWorkspaceSelection({ workspaceId: workspace.workspaceId } as never);
    await api.clearActiveWorkspaceSelection();

    expect(invoke.mock.calls.map((call) => call[0])).toEqual([
      DESKTOP_WORKSPACE_LIST_REQUEST_CHANNEL.value,
      DESKTOP_WORKSPACE_CREATE_REQUEST_CHANNEL.value,
      DESKTOP_WORKSPACE_SELECTION_READ_REQUEST_CHANNEL.value,
      DESKTOP_WORKSPACE_SELECTION_SAVE_REQUEST_CHANNEL.value,
      DESKTOP_WORKSPACE_SELECTION_CLEAR_REQUEST_CHANNEL.value,
    ]);
    expect(JSON.stringify(invoke.mock.calls)).not.toContain("installer");
    expect(JSON.stringify(invoke.mock.calls)).not.toContain("import-pack");
  });

  it("maps effective projection list/read bridge calls to dedicated IPC channels", async () => {
    const responses = [
      { ok: true, value: { summaries: [] } },
      { ok: true, value: { projectionId: "projection.a" } },
    ];
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockImplementation(async () => responses.shift());
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });
    await api.listEffectiveAssetProjections({ workspaceId: "workspace.a", limit: 10, status: "ready" }, { requestId: "req-1" });
    await api.readEffectiveAssetProjection({ workspaceId: "workspace.a", projectionId: "projection.a" }, { requestId: "req-2" });
    const listCall = invoke.mock.calls.find((call) => call[0] === "effective-asset-projections:list");
    const readCall = invoke.mock.calls.find((call) => call[0] === "effective-asset-projections:read");
    expect(listCall?.[1]).toMatchObject({ payload: { targetWorkspaceId: "workspace.a", limit: 10, status: "ready" } });
    expect(readCall?.[1]).toMatchObject({ payload: { targetWorkspaceId: "workspace.a", projectionId: "projection.a" } });
  });
  it("reports projection refresh as deferred without invoking generic IPC", async () => {
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>();
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });
    const response = await api.refreshEffectiveAssetProjection({ workspaceId: "workspace.a", projectionId: "projection.a" });
    expect(response).toMatchObject({ ok: false, error: { code: "unsupported" } });
    expect(invoke.mock.calls.length).toBe(0);
  });

  it("maps asset definition list reads to the read-only asset registry request channel", async () => {
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
      createDesktopAssetDefinitionsListSuccessResponse({ items: [] }),
    );
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });
    const response = await api.listAssetDefinitions(
      { searchText: "workflow", builtIn: "built-in", limit: 5, includeMetadata: true },
      { requestId: "req-assets", correlationId: "corr-assets" },
    );

    expect(response.ok).toBe(true);
    expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_ASSET_DEFINITIONS_LIST_REQUEST_CHANNEL.value);
    expect(invoke.mock.calls[0]?.[1]).toMatchObject({
      requestId: "req-assets",
      correlationId: "corr-assets",
      operation: "asset.definitions-list",
      payload: {
        searchText: "workflow",
        builtIn: "built-in",
        limit: 5,
        includeMetadata: true,
        boundary: { host: "desktop", source: "desktop.renderer.asset-registry" },
      },
    });
  });

  it("maps asset definition detail reads to the read-only asset registry request channel", async () => {
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
      createDesktopAssetDefinitionReadSuccessResponse({
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
      }),
    );
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });
    const response = await api.readAssetDefinition({
      definitionId: "builtin.workflow",
      expand: ["metadata"],
      includeValidation: true,
    });

    expect(response.ok).toBe(true);
    expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_ASSET_DEFINITION_READ_REQUEST_CHANNEL.value);
    expect(invoke.mock.calls[0]?.[1]).toMatchObject({
      operation: "asset.definition-read",
      payload: {
        definitionId: "builtin.workflow",
        expand: ["metadata"],
        includeValidation: true,
        boundary: { host: "desktop", source: "desktop.renderer.asset-registry" },
      },
    });
  });

  it("maps asset definition version reads to the read-only asset registry request channel", async () => {
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
      createDesktopAssetDefinitionVersionReadSuccessResponse({
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
      }),
    );
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });
    const response = await api.readAssetDefinitionVersion({
      definitionId: "builtin.workflow",
      version: "1.0.0",
    });

    expect(response.ok).toBe(true);
    expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_ASSET_DEFINITION_VERSION_READ_REQUEST_CHANNEL.value);
    expect(invoke.mock.calls[0]?.[1]).toMatchObject({
      operation: "asset.definition-version-read",
      payload: {
        definitionId: "builtin.workflow",
        version: "1.0.0",
        boundary: { host: "desktop", source: "desktop.renderer.asset-registry" },
      },
    });
  });

  it("maps resource-backed view list and detail reads to read-only asset registry channels", async () => {
    const responses = [
      createDesktopAssetResourceBackedViewsListSuccessResponse({
        items: [{ viewId: "asset-view.generated-output.internal.1", viewKind: "generated-output", displayName: "Generated output" }],
      }),
      createDesktopAssetResourceBackedViewReadSuccessResponse({
        view: { viewId: "asset-view.generated-output.internal.1", viewKind: "generated-output", displayName: "Generated output" },
      }),
    ];
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockImplementation(async () => responses.shift());
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

    const list = await api.listAssetResourceBackedViews({ searchText: "generated", viewKinds: ["generated-output"], limit: 5 });
    const detail = await api.readAssetResourceBackedView({ viewId: "asset-view.generated-output.internal.1", expand: ["metadata"] });

    expect(list.ok).toBe(true);
    expect(detail.ok).toBe(true);
    expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_REQUEST_CHANNEL.value);
    expect(invoke.mock.calls[0]?.[1]).toMatchObject({
      operation: "asset.resource-backed-views-list",
      payload: {
        searchText: "generated",
        viewKinds: ["generated-output"],
        limit: 5,
        boundary: { host: "desktop", source: "desktop.renderer.asset-registry" },
      },
    });
    expect(invoke.mock.calls[1]?.[0]).toBe(DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_REQUEST_CHANNEL.value);
    expect(invoke.mock.calls[1]?.[1]).toMatchObject({
      operation: "asset.resource-backed-view-read",
      payload: {
        viewId: "asset-view.generated-output.internal.1",
        expand: ["metadata"],
        boundary: { host: "desktop", source: "desktop.renderer.asset-registry" },
      },
    });
  });

  it("maps approved asset mutation methods to dedicated IPC channels", async () => {
    const responses = [
      createDesktopAssetMutationSuccessResponse(DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_RESPONSE_CHANNEL, { ok: true, operation: "asset.register-resource-backed-view", status: "created" }),
      createDesktopAssetMutationSuccessResponse(DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_RESPONSE_CHANNEL, { ok: true, operation: "asset.finalize-generated-output", status: "existing" }),
      createDesktopAssetMutationSuccessResponse(DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_RESPONSE_CHANNEL, { ok: true, operation: "asset.import-external-repository-object", status: "existing" }),
      createDesktopAssetMutationSuccessResponse(DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_RESPONSE_CHANNEL, { ok: true, operation: "asset.localize-external-repository-object", status: "existing" }),
    ];
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockImplementation(async () => responses.shift());
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });
    const base = {
      viewId: "asset-view.external.1",
      approval: { userConfirmed: true, confirmationKind: "register-resource-backed-view" as const },
      actor: { initiatedBy: "human" as const },
    };

    await api.registerResourceBackedViewAsAsset({ ...base, operation: "asset.register-resource-backed-view" }, { requestId: "r1", correlationId: "c1", idempotencyKey: "idem-1" });
    await api.finalizeGeneratedOutputAsAsset({ operation: "asset.finalize-generated-output", generatedOutputId: "out-1", approval: base.approval, actor: base.actor }, { requestId: "r2" });
    await api.importExternalRepositoryObjectAsAsset({ ...base, operation: "asset.import-external-repository-object" });
    await api.localizeExternalRepositoryObjectAsAsset({ ...base, operation: "asset.localize-external-repository-object" });

    expect(invoke.mock.calls.map((call) => call[0])).toEqual([
      DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL.value,
      DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL.value,
    ]);
    expect(invoke.mock.calls[0]?.[1]).toMatchObject({
      requestId: "r1",
      correlationId: "c1",
      payload: { context: { requestId: "r1", correlationId: "c1", idempotencyKey: "idem-1" } },
    });
  });

  it("does not expose arbitrary asset mutation or seeding methods", () => {
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke: testDouble.fn() } });
    const methodNames = Object.keys(api);
    const forbiddenAssetMethods = [
      "createAsset",
      "updateAsset",
      "deleteAsset",
      "registerAsset",
      "seedAsset",
      "seedBuiltInAssetDefinitions",
      "importAsset",
      "finalizeAsset",
      "publishAsset",
      "executeAsset",
      "runAsset",
      "scanAssets",
      "syncAssets",
      "repairAsset",
      "installAsset",
      "startAsset",
      "trainAsset",
      "validateAsset",
    ];

    expect(methodNames).toContain("listAssetDefinitions");
    expect(methodNames).toContain("readAssetDefinition");
    expect(methodNames).toContain("readAssetDefinitionVersion");
    expect(methodNames).toContain("listAssetResourceBackedViews");
    expect(methodNames).toContain("readAssetResourceBackedView");
    expect(methodNames).toContain("registerResourceBackedViewAsAsset");
    expect(methodNames).toContain("finalizeGeneratedOutputAsAsset");
    expect(methodNames).toContain("importExternalRepositoryObjectAsAsset");
    expect(methodNames).toContain("localizeExternalRepositoryObjectAsAsset");
    for (const method of forbiddenAssetMethods) {
      expect(methodNames).not.toContain(method);
    }
  });

  it("maps hugging face token status bridge calls to dedicated request channel", async () => {
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
      createDesktopHuggingFaceTokenGetSuccessResponse({ configured: true, maskedToken: "••••1234" }),
    );
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });
    const response = await api.getHuggingFaceTokenStatus();

    expect(response.ok).toBe(true);
    expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_HUGGING_FACE_TOKEN_GET_REQUEST_CHANNEL.value);
  });

  it("maps bridge input into desktop upload request envelope and invokes request channel", async () => {
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
      createDesktopArtifactUploadSuccessResponse(
        {
          sourceKind: "upload",
          storage: {
            key: "uploads/kitten.png",
            mediaType: "image/png",
            sizeBytes: 4,
          },
        },
        {
          requestId: "req-upload-1",
          correlationId: "corr-upload-1",
        },
      ),
    );
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

    const response = await api.uploadArtifact(
      {
        fileName: " kitten.png ",
        mediaType: " image/png ",
        bytes: new Uint8Array([137, 80, 78, 71]),
        workspaceId: "workspace-a",
      },
      {
        requestId: "req-upload-1",
        correlationId: "corr-upload-1",
      },
    );

    expect(response.ok).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    const [channel, request] = invoke.mock.calls[0] as [string, { operation: string; payload: { boundary: { host: string; source: string } } }];
    expect(channel).toBe(DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL.value);
    expect(request.operation).toBe("artifact.upload");
    expect(request.payload.boundary).toEqual({ host: "desktop", source: "desktop.renderer.artifact-upload.form" });
  });

  it("maps artifact browse and media-view operations to separate request channels", async () => {
    const responses = [
      createDesktopArtifactBrowseSuccessResponse({ items: [] }),
      createDesktopArtifactMediaViewSuccessResponse({
        storageKey: "uploads/cat.png",
        mediaType: "image/png",
        bytes: new Uint8Array([1, 2]),
      }),
    ];
    let index = 0;
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockImplementation(async () => {
      const response = responses[index];
      index += 1;
      return response;
    });
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

    await api.browseArtifacts({}, { workspaceId: "workspace-a" });
    const mediaResponse = await api.readArtifactViewerMedia({ storageKey: "uploads/cat.png" }, { workspaceId: "workspace-a" });

    expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL.value);
    expect((invoke.mock.calls[0]?.[1] as { payload?: { artifactFamily?: string } } | undefined)?.payload?.artifactFamily).toBeUndefined();
    expect(invoke.mock.calls[1]?.[0]).toBe(DESKTOP_ARTIFACT_MEDIA_VIEW_REQUEST_CHANNEL.value);
    expect(mediaResponse.ok).toBe(true);
  });

  it("maps artifact browse family filter using the contract artifact-family union", async () => {
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
      createDesktopArtifactBrowseSuccessResponse({ items: [] }),
    );
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

    await api.browseArtifacts({ artifactFamily: "structured-text" }, { workspaceId: "workspace-a" });

    expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL.value);
    expect((invoke.mock.calls[0]?.[1] as { payload?: { artifactFamily?: string } } | undefined)?.payload?.artifactFamily).toBe("structured-text");
  });

  it("maps publish bridge calls to artifact publish request channel", async () => {
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
      createDesktopArtifactPublishSuccessResponse({
        target: {
          provider: "huggingface",
          repository: "openai/demo",
          path: "images/cat.png",
          revision: "main",
          locator: "openai/demo/images/cat.png",
        },
        verification: {
          exists: true,
          verifiedAt: "2026-04-17T00:00:00.000Z",
        },
      }),
    );
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

    const response = await api.publishArtifactToRepo({
      artifactId: "uploads/cat.png",
      target: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "images/cat.png",
      },
    });

    expect(response.ok).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_ARTIFACT_PUBLISH_REQUEST_CHANNEL.value);
  });

  it("throws when IPC returns a response envelope for the wrong operation or channel", async () => {
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
      createIpcFailureResponse(
        createIpcError(
          createIpcChannel("image.archive", "response"),
          "internal",
          "wrong channel",
        ),
      ),
    );
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

    await expect(
      api.uploadArtifact({
        fileName: "cat.png",
        mediaType: "image/png",
        bytes: new Uint8Array([1]),
        workspaceId: "workspace-a",
      }),
    ).rejects.toThrow("Received invalid desktop artifact upload IPC response envelope.");
  });
});


it("maps publish verify bridge calls to artifact publish verify request channel", async () => {
  const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
    createDesktopArtifactPublishVerifySuccessResponse({
      target: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "images/cat.png",
        revision: "main",
        locator: "openai/demo/images/cat.png",
      },
      verification: {
        exists: true,
        verifiedAt: "2026-04-17T00:00:00.000Z",
      },
    }),
  );
  const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

  await api.verifyPublishedArtifactBacking({ artifactId: "uploads/cat.png" });

  expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_ARTIFACT_PUBLISH_VERIFY_REQUEST_CHANNEL.value);
});

it("maps register-from-repo bridge calls to artifact register-from-repo request channel", async () => {
  const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
    createDesktopArtifactRegisterFromRepoSuccessResponse({
      artifactId: "imports/huggingface/openai/demo/main/images/cat.png",
      backing: {
        role: "imported-source",
        target: {
          provider: "huggingface",
          repository: "openai/demo",
          path: "images/cat.png",
          revision: "main",
          locator: "openai/demo/images/cat.png",
        },
        verification: {
          exists: true,
          verifiedAt: "2026-04-18T00:00:00.000Z",
        },
      },
    }),
  );
  const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

  await api.registerArtifactFromRepo({
    target: {
      provider: "huggingface",
      repository: "openai/demo",
      path: "images/cat.png",
    },
  });

  expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_ARTIFACT_REGISTER_FROM_REPO_REQUEST_CHANNEL.value);
  expect((invoke.mock.calls[0]?.[1] as { payload?: { artifactFamily?: string } } | undefined)?.payload?.artifactFamily).toBeUndefined();
});

it("maps localize-from-repo bridge calls to artifact localize-from-repo request channel", async () => {
  const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
    createDesktopArtifactLocalizeFromRepoSuccessResponse({
      artifactId: "artifacts/20260418000000-local01",
      localObject: {
        key: "artifacts/20260418000000-local01",
        mediaType: "image/png",
        sizeBytes: 3,
      },
      source: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "images/cat.png",
        revision: "main",
        locator: "openai/demo/images/cat.png",
      },
      localizedAt: "2026-04-18T00:00:00.000Z",
    }),
  );
  const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

  await api.localizeArtifactFromRepo({ artifactId: "artifacts/20260418000000-local01" });

  expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_REQUEST_CHANNEL.value);
});

it("maps source-verify bridge calls to artifact source-verify request channel", async () => {
  const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
    createDesktopArtifactSourceVerifySuccessResponse({
      target: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "images/cat.png",
        revision: "main",
        locator: "openai/demo/images/cat.png",
      },
      verification: {
        exists: true,
        verifiedAt: "2026-04-18T00:00:00.000Z",
      },
    }),
  );
  const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

  await api.verifyImportedArtifactSourceBacking({ artifactId: "artifacts/20260418000000-local01" });

  expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_ARTIFACT_SOURCE_VERIFY_REQUEST_CHANNEL.value);
});

it("maps unregistered artifact browse/register/delete bridge calls to dedicated request channels", async () => {
  const responses = [
    createDesktopArtifactUnregisteredBrowseSuccessResponse({ items: [] }),
    createDesktopArtifactUnregisteredRegisterSuccessResponse({ storageKey: "uploads/orphan.txt" }),
    createDesktopArtifactUnregisteredDeleteSuccessResponse({ storageKey: "uploads/orphan.txt" }),
  ];
  let index = 0;
  const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockImplementation(async () => {
    const response = responses[index];
    index += 1;
    return response;
  });
  const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

  await api.browseUnregisteredArtifacts({ workspaceId: "workspace-a" });
  await api.registerUnregisteredArtifact({ storageKey: "uploads/orphan.txt", workspaceId: "workspace-a" });
  await api.deleteUnregisteredArtifact({ storageKey: "uploads/orphan.txt", workspaceId: "workspace-a" });

  expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_REQUEST_CHANNEL.value);
  expect(invoke.mock.calls[1]?.[0]).toBe(DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_REQUEST_CHANNEL.value);
  expect(invoke.mock.calls[2]?.[0]).toBe(DESKTOP_ARTIFACT_UNREGISTERED_DELETE_REQUEST_CHANNEL.value);
  expect((invoke.mock.calls[0]?.[1] as { payload?: { workspaceId?: string } } | undefined)?.payload?.workspaceId).toBe("workspace-a");
  expect((invoke.mock.calls[1]?.[1] as { payload?: { workspaceId?: string } } | undefined)?.payload?.workspaceId).toBe("workspace-a");
  expect((invoke.mock.calls[2]?.[1] as { payload?: { workspaceId?: string } } | undefined)?.payload?.workspaceId).toBe("workspace-a");
});


it("maps website page ingestion bridge calls to dedicated IPC request channel", async () => {
  const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
    createDesktopIngestWebsitePageSuccessResponse({
      target: { url: "https://example.com" },
      resolvedUrl: "https://example.com",
      acquisitionMechanismUsed: "simple-http",
      sourceKind: "scrape",
    }),
  );
  const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

  const response = await api.ingestWebsitePage({ url: "https://example.com", mode: "automatic" });

  expect(response.ok).toBe(true);
  expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_INGEST_WEBSITE_PAGE_REQUEST_CHANNEL.value);
});

it("maps training dataset preparation bridge calls to dedicated IPC request channel", async () => {
  let invokeCallCount = 0;
  const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockImplementation(async () => {
    invokeCallCount += 1;
    if (invokeCallCount === 1) {
      return createDesktopPrepareTrainingDatasetStartSuccessResponse({
        requestId: "req-1",
        taskType: "prepare-training-dataset",
        accepted: true,
        status: "queued",
      });
    }
    return createDesktopPrepareTrainingDatasetTaskReadSuccessResponse({
      requestId: "req-1",
      taskType: "prepare-training-dataset",
      status: "running",
      progress: { message: "working", processed: 1, total: 2 },
    });
  });
  const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

  const startResponse = await api.startPrepareTrainingDataset({
    sourceArtifactIds: ["artifact-1"],
    recipe: {
      normalization: { targetFormat: "markdown" },
      chunking: { strategy: "character", chunkSize: 1_000, chunkOverlap: 200 },
      generation: {
        mode: "qa",
        model: { provider: "transformers", modelId: "Qwen/Qwen2.5-1.5B-Instruct" },
        promptTemplate: "Prompt: {{text}}",
      },
    },
    split: { trainRatio: 0.8, testRatio: 0.2, seed: 7, shuffle: true },
    output: { format: "jsonl" },
  });
  const readResponse = await api.readPrepareTrainingDatasetTask({ requestId: "req-1" });

  expect(startResponse.ok).toBe(true);
  expect(readResponse.ok).toBe(true);
  expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_DATASET_PREPARE_TRAINING_START_REQUEST_CHANNEL.value);
  expect(invoke.mock.calls[1]?.[0]).toBe(DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_REQUEST_CHANNEL.value);
});

it("maps website pages batch ingestion bridge calls to dedicated IPC request channel", async () => {
  const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(
    createDesktopIngestWebsitePagesBatchSuccessResponse({
      items: [],
      summary: { attempted: 0, succeeded: 0, failed: 0 },
    }),
  );
  const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

  const response = await api.ingestWebsitePagesBatch({
    targets: [{ url: "https://example.com/a" }, { url: "https://example.com/b" }],
    mode: "rendered",
  });

  expect(response.ok).toBe(true);
  expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_INGEST_WEBSITE_PAGES_BATCH_REQUEST_CHANNEL.value);
});

it("maps python runtime status/control bridge calls to dedicated IPC request channels", async () => {
  const responses = [
    createDesktopPythonRuntimeStatusReadSuccessResponse({
      supervisorStatus: "ready",
      healthy: true,
      runtimeStatus: "ready",
      capabilities: ["prepare-training-dataset"],
      logs: [],
    }),
    createDesktopPythonRuntimeControlSuccessResponse({
      supervisorStatus: "starting",
      healthy: false,
      runtimeStatus: "starting",
      capabilities: [],
      logs: [],
    }),
  ];
  let index = 0;
  const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockImplementation(async () => {
    const response = responses[index];
    index += 1;
    return response;
  });
  const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

  await api.readPythonRuntimeStatus();
  await api.controlPythonRuntime({ action: "restart" });

  expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_PYTHON_RUNTIME_STATUS_READ_REQUEST_CHANNEL.value);
  expect(invoke.mock.calls[1]?.[0]).toBe(DESKTOP_PYTHON_RUNTIME_CONTROL_REQUEST_CHANNEL.value);
});

it("maps application settings bridge calls to dedicated settings channels", async () => {
  const responses = [
    {
      ok: true,
      operation: "application-settings.list-definitions",
      channel: "ipc.application-settings.list-definitions.response",
      value: { definitions: [] },
    },
    {
      ok: true,
      operation: "application-settings.read",
      channel: "ipc.application-settings.read.response",
      value: { values: [{ key: "huggingface.token", configured: true, masked: true, maskedValue: "********" }] },
    },
    {
      ok: true,
      operation: "application-settings.resolve-model-default",
      channel: "ipc.application-settings.resolve-model-default.response",
      value: { resolved: { provider: "transformers", modelId: "google/flan-t5-small", inferenceMode: "text2text", source: "builtin" } },
    },
    {
      ok: true,
      operation: "application-settings.select-folder",
      channel: "ipc.application-settings.select-folder.response",
      value: { canceled: false, path: "C:\\models" },
    },
  ];
  let index = 0;
  const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockImplementation(async () => {
    const response = responses[index];
    index += 1;
    return response;
  });

  const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });
  await api.listApplicationSettingDefinitions();
  const read = await api.readApplicationSettings({ keys: ["huggingface.token"] });
  const resolved = await api.resolveModelDefault({ taskKey: "qaGeneration" });
  const selected = await api.selectApplicationSettingsFolder({ title: "Models" });

  expect(invoke.mock.calls[0]?.[0]).toBe("ipc.application-settings.list-definitions.request");
  expect(invoke.mock.calls[1]?.[0]).toBe("ipc.application-settings.read.request");
  expect(invoke.mock.calls[3]?.[0]).toBe("ipc.application-settings.select-folder.request");
  expect(read.value.values[0]?.maskedValue).toBe("********");
  expect(resolved.value.resolved.inferenceMode).toBe("text2text");
  expect(selected.value.path).toBe("C:\\models");
});

it("maps model management bridge calls to dedicated model channels", async () => {
  const responses = [
    createDesktopModelBrowseSuccessResponse({ models: [] }),
    createDesktopModelDetailsReadSuccessResponse({ model: { provider: "huggingface", modelId: "org/model", displayName: "Model" } }),
    createDesktopModelListSuccessResponse({ models: [] }),
    createDesktopModelReferenceSaveSuccessResponse({
      model: {
        modelRecordId: "m1",
        displayName: "Model",
        source: "huggingface",
        lifecycleStatus: "saved-reference",
        artifactForm: "full-model",
        provider: "huggingface",
        modelId: "org/model",
        createdAt: "2026-04-27T00:00:00.000Z",
      },
    }),
    createDesktopModelDownloadSuccessResponse({
      model: {
        modelRecordId: "m2",
        displayName: "Model",
        source: "huggingface",
        lifecycleStatus: "downloaded",
        artifactForm: "full-model",
        provider: "huggingface",
        modelId: "org/model",
        localPath: "/models/org/model",
        createdAt: "2026-04-27T00:01:00.000Z",
      },
      download: {
        provider: "transformers",
        modelId: "org/model",
        downloaded: true,
        fromCache: false,
        localPath: "/models/org/model",
      },
    }),
    createDesktopModelRecordUpdateSuccessResponse({
      model: {
        modelRecordId: "m1",
        displayName: "Model",
        source: "huggingface",
        lifecycleStatus: "saved-reference",
        artifactForm: "full-model",
        provider: "huggingface",
        modelId: "org/model",
        createdAt: "2026-04-27T00:00:00.000Z",
      },
    }),
    createDesktopModelRecordDeleteSuccessResponse({
      deletedModelRecordId: "m1",
      deletedRegistryRecord: true,
      deletedLocalFiles: false,
      deletedBackingArtifactIds: [],
    }),
    createDesktopModelTrainSuccessResponse({ runId: "run-1", status: "queued" }),
    createDesktopModelTrainStatusSuccessResponse({ runId: "run-1", status: "running", progress: { epoch: 0, totalEpochs: 1, batch: 0, totalBatches: 59 } }),
  ];
  let index = 0;
  const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockImplementation(async () => {
    const response = responses[index];
    index += 1;
    return response;
  });

  const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });
  await api.browseModels({ provider: "huggingface", query: "demo" });
  await api.getModelDetails({ provider: "huggingface", modelId: "org/model" });
  await api.listModels();
  await api.saveModelReference({ provider: "huggingface", modelId: "org/model" });
  await api.downloadModel({ provider: "huggingface", modelId: "org/model" });
  await api.updateModelRecord({ modelRecordId: "m1", patch: {} });
  await api.deleteModelRecord({ modelRecordId: "m1" });
  await api.trainModel({
    baseModel: { modelRecordId: "m1" },
    datasets: [{ artifactId: "dataset-1", splitRole: "train" }],
    method: "lora",
    commonParameters: {},
    output: { outputModelName: "demo-adapter", destination: { local: { enabled: true } } },
  });
  await api.readModelTrainingStatus({ runId: "run-1" });

  expect(invoke.mock.calls[0]?.[0]).toBe(DESKTOP_MODEL_BROWSE_REQUEST_CHANNEL.value);
  expect(invoke.mock.calls[1]?.[0]).toBe(DESKTOP_MODEL_DETAILS_READ_REQUEST_CHANNEL.value);
  expect(invoke.mock.calls[2]?.[0]).toBe(DESKTOP_MODEL_LIST_REQUEST_CHANNEL.value);
  expect(invoke.mock.calls[3]?.[0]).toBe(DESKTOP_MODEL_REFERENCE_SAVE_REQUEST_CHANNEL.value);
  expect(invoke.mock.calls[4]?.[0]).toBe(DESKTOP_MODEL_DOWNLOAD_REQUEST_CHANNEL.value);
  expect(invoke.mock.calls[5]?.[0]).toBe(DESKTOP_MODEL_RECORD_UPDATE_REQUEST_CHANNEL.value);
  expect(invoke.mock.calls[6]?.[0]).toBe(DESKTOP_MODEL_RECORD_DELETE_REQUEST_CHANNEL.value);
  expect(invoke.mock.calls[7]?.[0]).toBe("ipc.model.train.request");
  expect(invoke.mock.calls[8]?.[0]).toBe(DESKTOP_MODEL_TRAIN_STATUS_REQUEST_CHANNEL.value);
});


describe("desktop preload user-library bridge", () => {
  it("exposes narrow Phase 7 user-library methods on dedicated IPC channels", async () => {
    const responseByRequestChannel = new Map<string, unknown>([
      [DESKTOP_USER_LIBRARY_PROMOTE_REQUEST_CHANNEL.value, createDesktopUserLibraryOperationSuccessResponse(DESKTOP_USER_LIBRARY_PROMOTE_RESPONSE_CHANNEL, { ok: true })],
      [DESKTOP_USER_LIBRARY_LINK_REQUEST_CHANNEL.value, createDesktopUserLibraryOperationSuccessResponse(DESKTOP_USER_LIBRARY_LINK_RESPONSE_CHANNEL, { ok: true })],
      [DESKTOP_USER_LIBRARY_COPY_REQUEST_CHANNEL.value, createDesktopUserLibraryOperationSuccessResponse(DESKTOP_USER_LIBRARY_COPY_RESPONSE_CHANNEL, { ok: true })],
      [DESKTOP_USER_LIBRARY_IMPORT_REQUEST_CHANNEL.value, createDesktopUserLibraryOperationSuccessResponse(DESKTOP_USER_LIBRARY_IMPORT_RESPONSE_CHANNEL, { ok: true })],
      [DESKTOP_USER_LIBRARY_ASSET_LIST_REQUEST_CHANNEL.value, createDesktopUserLibraryOperationSuccessResponse(DESKTOP_USER_LIBRARY_ASSET_LIST_RESPONSE_CHANNEL, { assets: [] })],
      [DESKTOP_USER_LIBRARY_ASSET_READ_REQUEST_CHANNEL.value, createDesktopUserLibraryOperationSuccessResponse(DESKTOP_USER_LIBRARY_ASSET_READ_RESPONSE_CHANNEL, { userLibraryAssetId: "library.asset", version: "1.0.0", displayName: "Asset", status: "active" })],
      [DESKTOP_USER_LIBRARY_LINK_LIST_REQUEST_CHANNEL.value, createDesktopUserLibraryOperationSuccessResponse(DESKTOP_USER_LIBRARY_LINK_LIST_RESPONSE_CHANNEL, { links: [] })],
      [DESKTOP_USER_LIBRARY_LINK_READ_REQUEST_CHANNEL.value, createDesktopUserLibraryOperationSuccessResponse(DESKTOP_USER_LIBRARY_LINK_READ_RESPONSE_CHANNEL, { linkId: "link.alpha", targetWorkspaceId: "workspace.target", status: "active" })],
      [DESKTOP_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_REQUEST_CHANNEL.value, createDesktopUserLibraryOperationSuccessResponse(DESKTOP_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_RESPONSE_CHANNEL, { items: [] })],
    ]);
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockImplementation(async (channel: string) => responseByRequestChannel.get(channel));
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });

    await api.promoteWorkspaceAssetToUserLibrary({ sourceWorkspaceId: "workspace.source" as never, sourceAssetReference: { kind: "asset-definition", id: "asset.alpha" } as never, originWorkspaceBehavior: "keep-independent-workspace-copy" });
    await api.linkUserLibraryAssetToWorkspace({ targetWorkspaceId: "workspace.target" as never, userLibraryAssetReference: { assetId: "library.asset" as never, version: "1.0.0" as never }, versionSelection: { kind: "pinned-version", version: "1.0.0" }, propagationPolicy: "pinned-version" });
    await api.copyUserLibraryAssetToWorkspace({ targetWorkspaceId: "workspace.target" as never, userLibraryAssetReference: { assetId: "library.asset" as never, version: "1.0.0" as never }, selectedVersion: "1.0.0" as never });
    await api.importWorkspaceAssetToWorkspace({ sourceWorkspaceId: "workspace.source" as never, targetWorkspaceId: "workspace.target" as never, sourceAssetReference: { kind: "asset-definition", id: "asset.alpha" } as never });
    await api.listUserLibraryAssets();
    await api.readUserLibraryAsset({ userLibraryAssetId: "library.asset" });
    await api.listWorkspaceUserLibraryLinks({ workspaceId: "workspace.target" });
    await api.readWorkspaceUserLibraryLink({ workspaceId: "workspace.target", linkId: "link.alpha" });
    await api.readWorkspaceEffectiveAssetSources({ workspaceId: "workspace.target" });

    expect(invoke.mock.calls.map((call) => call[0])).toEqual([
      DESKTOP_USER_LIBRARY_PROMOTE_REQUEST_CHANNEL.value,
      DESKTOP_USER_LIBRARY_LINK_REQUEST_CHANNEL.value,
      DESKTOP_USER_LIBRARY_COPY_REQUEST_CHANNEL.value,
      DESKTOP_USER_LIBRARY_IMPORT_REQUEST_CHANNEL.value,
      DESKTOP_USER_LIBRARY_ASSET_LIST_REQUEST_CHANNEL.value,
      DESKTOP_USER_LIBRARY_ASSET_READ_REQUEST_CHANNEL.value,
      DESKTOP_USER_LIBRARY_LINK_LIST_REQUEST_CHANNEL.value,
      DESKTOP_USER_LIBRARY_LINK_READ_REQUEST_CHANNEL.value,
      DESKTOP_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_REQUEST_CHANNEL.value,
    ]);
    expect(Object.keys(api)).not.toContain("invoke");
    expect(Object.keys(api)).not.toContain("userLibraryAssetRepository");
  });
});


describe("desktop preload execution-plan bridge", () => {
  it("uses execution-plan IPC contract channels", async () => {
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue({ ok: true, value: {} });
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });
    await api.createExecutionPlan({ workspaceId: "ws.1", runtimeReadinessBindingId: "rrb.1" });
    await api.validateExecutionPlan({ workspaceId: "ws.1", executionPlanId: "ep.1" });
    await api.archiveExecutionPlan({ workspaceId: "ws.1", executionPlanId: "ep.1" });
    await api.listExecutionPlanSummaries({ workspaceId: "ws.1" });
    await api.readExecutionPlanDetail({ workspaceId: "ws.1", executionPlanId: "ep.1" });
    await api.listExecutionPlansForCompositionPlan({ workspaceId: "ws.1", compositionPlanId: "cp.1" });
    await api.readLatestExecutionPlanForCompositionPlan({ workspaceId: "ws.1", compositionPlanId: "cp.1" });
    await api.listExecutionPlansForRuntimeReadinessBinding({ workspaceId: "ws.1", runtimeReadinessBindingId: "rrb.1" });
    await api.readLatestExecutionPlanForRuntimeReadinessBinding({ workspaceId: "ws.1", runtimeReadinessBindingId: "rrb.1" });
    await api.listExecutionPlansNeedingAttention({ workspaceId: "ws.1" });
    await api.summarizeWorkspaceExecutionPlans({ workspaceId: "ws.1" });

    expect(invoke.mock.calls.map((call) => call[0])).toEqual([
      "ipc.execution-plans.create-plan.request",
      "ipc.execution-plans.validate-plan.request",
      "ipc.execution-plans.archive-plan.request",
      "ipc.execution-plans.list-summaries.request",
      "ipc.execution-plans.read-detail.request",
      "ipc.execution-plans.list-for-composition-plan.request",
      "ipc.execution-plans.read-latest-for-composition-plan.request",
      "ipc.execution-plans.list-for-runtime-readiness-binding.request",
      "ipc.execution-plans.read-latest-for-runtime-readiness-binding.request",
      "ipc.execution-plans.list-needing-attention.request",
      "ipc.execution-plans.summarize-workspace.request",
    ]);
  });
});

describe("desktop preload derived-customization bridge", () => {
  it("uses the allowlisted customization channels and preserves workspace context", async () => {
    const descriptor = DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.listTargets;
    const invoke = testDouble.fn<IpcRendererInvokePort["invoke"]>().mockResolvedValue(createIpcSuccessResponse(descriptor.response, { targets: [] }));
    const api = createDesktopPreloadApi({ ipcRenderer: { invoke } });
    await api.listAssetDerivedCustomizationTargets({ workspaceId: "workspace-a", text: "button" } as any, { requestId: "request-1" });
    expect(invoke.mock.calls[0]?.[0]).toBe(descriptor.request.value);
    expect(invoke.mock.calls[0]?.[1]).toMatchObject({ operation: descriptor.operation, channel: descriptor.request.value, requestId: "request-1", payload: { workspaceId: "workspace-a", text: "button" } });
  });
});
