import type { Request } from "express";
import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../../testing/node-test";
import { DESKTOP_SYSTEM_BUILDER_CHANNELS } from "../../../../../contracts/ipc";
import { registerSystemBuilderIpc } from "../../../ipc-electron/system-builder/registerSystemBuilderIpc";
import { setExpressAuthContext } from "../../security/expressAuthContext";
import { registerSystemBuilderApiRoutes } from "../registerSystemBuilderApiRoutes";

function authenticatedRequest<T extends object>(request: T): T {
  setExpressAuthContext(request as Request, {
    authenticated: true,
    authMethod: "oidc-bearer",
    principal: {
      principalId: "person-1",
      kind: "user",
      roles: ["organization-member"],
      scopes: ["system:write"],
    },
  });
  return request;
}

const services = () =>
  ({
    create: {
      execute: testDouble.fn(async (value: any) => ({ ok: true, value })),
    },
    listTemplates: { execute: testDouble.fn(async () => []) },
    createFromTemplate: {
      execute: testDouble.fn(async (value: any) => ({ ok: true, value })),
    },
    list: { execute: testDouble.fn(async () => []) },
    listManagement: {
      execute: testDouble.fn(async (value: any) => ({
        ok: true,
        value: { items: [], totalCount: 0, query: value },
      })),
    },
    read: {
      execute: testDouble.fn(async () => ({
        ok: false,
        error: { code: "system-builder.not-found", message: "Not found" },
      })),
    },
    rename: {
      execute: testDouble.fn(async (value: any) => ({ ok: true, value })),
    },
    archive: {
      execute: testDouble.fn(async (value: any) => ({ ok: true, value })),
    },
    restore: {
      execute: testDouble.fn(async (value: any) => ({ ok: true, value })),
    },
    clone: {
      execute: testDouble.fn(async (value: any) => ({ ok: true, value })),
    },
    saveRevision: {
      execute: testDouble.fn(async (value: any) => ({ ok: true, value })),
    },
    readRevision: {
      execute: testDouble.fn(async () => ({
        ok: false,
        error: {
          code: "system-builder.revision-not-found",
          message: "Not found",
        },
      })),
    },
    listRevisions: { execute: testDouble.fn(async () => []) },
    listComposerAssets: {
      execute: testDouble.fn(async (value: any) => ({
        ok: true,
        value: { items: [], query: value },
      })),
    },
    readComposerAsset: {
      execute: testDouble.fn(async (value: any) => ({
        ok: true,
        value,
      })),
    },
    listModelOptions: {
      execute: testDouble.fn(async (value: any) => ({
        ok: true,
        value: { options: [], query: value },
      })),
    },
    previewLayoutChange: {
      execute: testDouble.fn(async (value: any) => ({ ok: true, value })),
    },
    previewFoundationUpgrade: {
      execute: testDouble.fn(async (value: any) => ({ ok: true, value })),
    },
    upgradeFoundation: {
      execute: testDouble.fn(async (value: any) => ({ ok: true, value })),
    },
  }) as any;

describe("System Builder transport parity", () => {
  it("exposes the complete revision-safe operation family through API and IPC", async () => {
    const routes = {
      get: new Map<string, any>(),
      post: new Map<string, any>(),
    };
    const api = services();
    registerSystemBuilderApiRoutes({
      app: {
        get: (path, handler) => routes.get.set(path, handler),
        post: (path, handler) => routes.post.set(path, handler),
      },
      ...api,
    });
    expect([...routes.get.keys(), ...routes.post.keys()].sort()).toEqual(
      [
        "/api/systems",
        "/api/systems/archive",
        "/api/systems/clone",
        "/api/systems/composer/assets",
        "/api/systems/composer/asset",
        "/api/systems/composer/model-options",
        "/api/systems/manage",
        "/api/systems/layout-change/preview",
        "/api/systems/foundation-upgrade/preview",
        "/api/systems/foundation-upgrade",
        "/api/systems/create",
        "/api/systems/rename",
        "/api/systems/templates",
        "/api/systems/create-from-template",
        "/api/systems/restore",
        "/api/systems/revision",
        "/api/systems/revisions",
        "/api/systems/revisions/save",
        "/api/systems/system",
      ].sort(),
    );
    const response: any = {
      status: testDouble.fn(() => response),
      json: testDouble.fn(),
    };
    await routes.post.get("/api/systems/create")(
      authenticatedRequest({
        body: { workspaceId: "workspace-a", name: "Portal" },
      }),
      response,
    );
    expect(api.create.execute.mock.calls[0][0]).toMatchObject({
      workspaceId: "workspace-a",
      name: "Portal",
      actorId: "person-1",
    });
    await routes.get.get("/api/systems/manage")(
      {
        query: {
          workspaceId: "workspace-a",
          view: "draft-changes",
          sort: "name-asc",
          limit: "25",
        },
      },
      response,
    );
    expect(api.listManagement.execute.mock.calls[0][0]).toMatchObject({
      workspaceId: "workspace-a",
      view: "draft-changes",
      sort: "name-asc",
      limit: 25,
    });
    await routes.get.get("/api/systems/composer/assets")(
      {
        query: {
          workspaceId: "workspace-a",
          parentDefinitionId: "builtin.layout.application.standard",
          parentVersion: "2.0.0",
          slotId: "content",
          compatibleOnly: "true",
          limit: "20",
        },
      },
      response,
    );
    expect(api.listComposerAssets.execute.mock.calls[0][0]).toMatchObject({
      workspaceId: "workspace-a",
      parentDefinitionRef: {
        kind: "asset-definition-version",
        id: "builtin.layout.application.standard",
        version: "2.0.0",
      },
      slotId: "content",
      compatibleOnly: true,
      limit: 20,
    });
    await routes.get.get("/api/systems/composer/asset")(
      {
        query: {
          workspaceId: "workspace-a",
          definitionId: "builtin.ui.card",
          version: "3.0.0",
        },
      },
      response,
    );
    expect(api.readComposerAsset.execute.mock.calls[0][0]).toMatchObject({
      workspaceId: "workspace-a",
      definitionRef: {
        kind: "asset-definition-version",
        id: "builtin.ui.card",
        version: "3.0.0",
      },
    });
    await routes.get.get("/api/systems/composer/model-options")(
      { query: { workspaceId: "workspace-a" } },
      response,
    );
    expect(api.listModelOptions.execute.mock.calls[0][0]).toMatchObject({
      workspaceId: "workspace-a",
    });
    const slotPayload = {
      workspaceId: "workspace-a",
      systemId: "system-1",
      expectedRecordRevision: 1,
      composition: {},
      instances: [],
      bindings: [],
      structure: {
        schemaVersion: "system-builder-structure.v1",
        profile: "interactive",
        layoutPresetRef: {
          kind: "asset-definition-version",
          id: "builtin.layout.application.standard",
          version: "2.0.0",
        },
      },
      placements: [
        {
          schemaVersion: "asset-placement.v1",
          placementId: "placement.root-shell",
          parentInstanceRef: { kind: "asset-instance", id: "root" },
          slotId: "application-shell",
          childInstanceRef: { kind: "asset-instance", id: "shell" },
          order: 0,
        },
      ],
    };
    await routes.post.get("/api/systems/revisions/save")(
      authenticatedRequest({
        body: slotPayload,
      }),
      response,
    );
    expect(api.saveRevision.execute.mock.calls[0][0]).toMatchObject({
      structure: slotPayload.structure,
      placements: slotPayload.placements,
      actorId: "person-1",
    });
    await routes.post.get("/api/systems/layout-change/preview")(
      authenticatedRequest({
        body: {
          ...slotPayload,
          targetLayoutPresetRef: {
            kind: "asset-definition-version",
            id: "builtin.layout.application.minimal",
            version: "2.0.0",
          },
        },
      }),
      response,
    );
    expect(api.previewLayoutChange.execute.mock.calls[0][0]).toMatchObject({
      workspaceId: "workspace-a",
      systemId: "system-1",
      actorId: "person-1",
      targetLayoutPresetRef: {
        id: "builtin.layout.application.minimal",
      },
    });
    await routes.post.get("/api/systems/foundation-upgrade/preview")(
      authenticatedRequest({
        body: {
          workspaceId: "workspace-a",
          systemId: "system-1",
          expectedRecordRevision: 1,
        },
      }),
      response,
    );
    expect(api.previewFoundationUpgrade.execute.mock.calls[0][0]).toMatchObject(
      {
        workspaceId: "workspace-a",
        systemId: "system-1",
        expectedRecordRevision: 1,
        actorId: "person-1",
      },
    );
    await routes.post.get("/api/systems/foundation-upgrade")(
      authenticatedRequest({
        body: {
          workspaceId: "workspace-a",
          systemId: "system-1",
          expectedRecordRevision: 1,
          sourceRevisionId: "system-1.r1",
        },
      }),
      response,
    );
    expect(api.upgradeFoundation.execute.mock.calls[0][0]).toMatchObject({
      workspaceId: "workspace-a",
      systemId: "system-1",
      sourceRevisionId: "system-1.r1",
      actorId: "person-1",
    });

    const handlers = new Map<string, any>();
    const ipc = services();
    registerSystemBuilderIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      ...ipc,
    });
    expect([...handlers.keys()].sort()).toEqual(
      Object.values(DESKTOP_SYSTEM_BUILDER_CHANNELS)
        .map((entry) => entry.request.value)
        .sort(),
    );
    await handlers.get(DESKTOP_SYSTEM_BUILDER_CHANNELS.create.request.value)(
      {},
      { payload: { workspaceId: "workspace-a", name: "Portal" } },
    );
    expect(ipc.create.execute.mock.calls[0][0]).toMatchObject({
      workspaceId: "workspace-a",
      actorId: "local-user",
    });
    await handlers.get(
      DESKTOP_SYSTEM_BUILDER_CHANNELS.listManagement.request.value,
    )(
      {},
      {
        payload: {
          workspaceId: "workspace-a",
          searchText: "portal",
          view: "published",
          limit: 10,
        },
      },
    );
    expect(ipc.listManagement.execute.mock.calls[0][0]).toMatchObject({
      workspaceId: "workspace-a",
      searchText: "portal",
      view: "published",
      limit: 10,
    });
    await handlers.get(
      DESKTOP_SYSTEM_BUILDER_CHANNELS.listComposerAssets.request.value,
    )(
      {},
      {
        payload: {
          workspaceId: "workspace-a",
          searchText: "card",
          limit: 10,
        },
      },
    );
    expect(ipc.listComposerAssets.execute.mock.calls[0][0]).toMatchObject({
      workspaceId: "workspace-a",
      searchText: "card",
      limit: 10,
    });
    await handlers.get(
      DESKTOP_SYSTEM_BUILDER_CHANNELS.readComposerAsset.request.value,
    )(
      {},
      {
        payload: {
          workspaceId: "workspace-a",
          definitionRef: {
            kind: "asset-definition-version",
            id: "builtin.ui.card",
            version: "3.0.0",
          },
        },
      },
    );
    expect(ipc.readComposerAsset.execute.mock.calls[0][0]).toMatchObject({
      workspaceId: "workspace-a",
      definitionRef: {
        kind: "asset-definition-version",
        id: "builtin.ui.card",
        version: "3.0.0",
      },
    });
    await handlers.get(
      DESKTOP_SYSTEM_BUILDER_CHANNELS.listModelOptions.request.value,
    )(
      {},
      { payload: { workspaceId: "workspace-a" } },
    );
    expect(ipc.listModelOptions.execute.mock.calls[0][0]).toMatchObject({
      workspaceId: "workspace-a",
    });
    await handlers.get(
      DESKTOP_SYSTEM_BUILDER_CHANNELS.saveRevision.request.value,
    )({}, { payload: slotPayload });
    expect(ipc.saveRevision.execute.mock.calls[0][0]).toMatchObject({
      structure: slotPayload.structure,
      placements: slotPayload.placements,
      actorId: "local-user",
    });
    await handlers.get(
      DESKTOP_SYSTEM_BUILDER_CHANNELS.previewLayoutChange.request.value,
    )(
      {},
      {
        payload: {
          ...slotPayload,
          targetLayoutPresetRef: {
            kind: "asset-definition-version",
            id: "builtin.layout.application.minimal",
            version: "2.0.0",
          },
        },
      },
    );
    expect(ipc.previewLayoutChange.execute.mock.calls[0][0]).toMatchObject({
      workspaceId: "workspace-a",
      systemId: "system-1",
      actorId: "local-user",
    });
    await handlers.get(
      DESKTOP_SYSTEM_BUILDER_CHANNELS.previewFoundationUpgrade.request.value,
    )(
      {},
      {
        payload: {
          workspaceId: "workspace-a",
          systemId: "system-1",
          expectedRecordRevision: 1,
        },
      },
    );
    expect(ipc.previewFoundationUpgrade.execute.mock.calls[0][0]).toMatchObject(
      {
        workspaceId: "workspace-a",
        systemId: "system-1",
        actorId: "local-user",
      },
    );
    await handlers.get(
      DESKTOP_SYSTEM_BUILDER_CHANNELS.upgradeFoundation.request.value,
    )(
      {},
      {
        payload: {
          workspaceId: "workspace-a",
          systemId: "system-1",
          expectedRecordRevision: 1,
          sourceRevisionId: "system-1.r1",
        },
      },
    );
    expect(ipc.upgradeFoundation.execute.mock.calls[0][0]).toMatchObject({
      workspaceId: "workspace-a",
      systemId: "system-1",
      sourceRevisionId: "system-1.r1",
      actorId: "local-user",
    });
  });

  it("maps missing systems to 404 without exposing internal errors", async () => {
    const routes = {
      get: new Map<string, any>(),
      post: new Map<string, any>(),
    };
    registerSystemBuilderApiRoutes({
      app: {
        get: (path, handler) => routes.get.set(path, handler),
        post: (path, handler) => routes.post.set(path, handler),
      },
      ...services(),
    });
    const response: any = {
      status: testDouble.fn(() => response),
      json: testDouble.fn(),
    };
    await routes.get.get("/api/systems/system")(
      { query: { workspaceId: "workspace-a", systemId: "missing" } },
      response,
    );
    expect(response.status.mock.calls[0][0]).toBe(404);
  });
});
