import assert from "node:assert/strict";
import { createWorkspaceAssetAuthoringReaders } from "../../../../application/services/asset/workspace-asset-authoring-readers";
import type { Request } from "express";
import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { registerAssetAuthoringApiRoutes } from "../asset-authoring/registerAssetAuthoringApiRoutes";
import { setExpressAuthContext } from "../security/expressAuthContext";

function authenticatedRequest<T extends object>(request: T, principalId = "principal-1"): T {
  setExpressAuthContext(request as Request, {
    authenticated: true,
    authMethod: "oidc-bearer",
    principal: {
      principalId,
      kind: "user",
      displayName: "Test principal",
      roles: ["organization-member"],
      scopes: ["asset:write"],
    },
  });
  return request;
}

function response() {
  const json = testDouble.fn();
  const status = testDouble.fn();
  const res: any = { status: status.mockImplementation(() => res), json };
  return { res, json, status };
}

function appAndHandlers() {
  const handlers = new Map<string, any>();
  const app = {
    get: testDouble.fn((path, handler) => handlers.set(`GET ${path}`, handler)),
    post: testDouble.fn((path, handler) => handlers.set(`POST ${path}`, handler)),
    patch: testDouble.fn((path, handler) => handlers.set(`PATCH ${path}`, handler)),
  };
  return { app, handlers };
}

describe("registerAssetAuthoringApiRoutes", () => {
  it("registers the implemented Phase 8 authoring routes", () => {
    const { app } = appAndHandlers();
    registerAssetAuthoringApiRoutes({ app });
    expect(app.get.mock.calls.map((call: any) => call[0])).toEqual([
      "/api/asset-authoring/workspaces/:workspaceId/authored-assets",
      "/api/asset-authoring/workspaces/:workspaceId/authored-assets/:authoredAssetId",
      "/api/asset-authoring/workspaces/:workspaceId/drafts",
      "/api/asset-authoring/workspaces/:workspaceId/drafts/:draftId",
      "/api/asset-authoring/workspaces/:workspaceId/revisions",
      "/api/asset-authoring/workspaces/:workspaceId/revisions/:revisionId",
      "/api/asset-authoring/workspaces/:workspaceId/overrides",
      "/api/asset-authoring/workspaces/:workspaceId/overrides/:overrideId",
      "/api/asset-authoring/workspaces/:workspaceId/effective-summaries",
      "/api/asset-authoring/workspaces/:workspaceId/customization-targets",
      "/api/asset-authoring/workspaces/:workspaceId/customization-targets/:implementationReleaseId",
      "/api/asset-authoring/workspaces/:workspaceId/derived-customizations",
      "/api/asset-authoring/workspaces/:workspaceId/derived-customizations/:customizationId",
    ]);
  });

  it("maps route parameters and safe editable fields into draft commands", async () => {
    const { app, handlers } = appAndHandlers();
    const createAssetDraftUseCase = { execute: testDouble.fn(async (command) => ({ kind: "success", value: { draftId: "draft-1", ...command } })) };
    const publishAssetDraftUseCase = { execute: testDouble.fn(async (command) => ({ kind: "success", value: { revisionId: "revision-1", ...command } })) };
    registerAssetAuthoringApiRoutes({ app, createAssetDraftUseCase: createAssetDraftUseCase as any, publishAssetDraftUseCase: publishAssetDraftUseCase as any });

    const create = response();
    await handlers.get("POST /api/asset-authoring/workspaces/:workspaceId/drafts")(
      authenticatedRequest({ params: { workspaceId: "workspace-a" }, body: { draftEditableValues: { "display-name": "Workflow", classification: "workflow-asset", tags: ["flow"] } } }),
      create.res,
    );
    expect(create.status.mock.calls[0][0]).toBe(200);
    expect(createAssetDraftUseCase.execute.mock.calls[0][0]).toMatchObject({ targetWorkspaceId: "workspace-a", draftEditableValues: { "display-name": "Workflow", classification: "workflow-asset", tags: ["flow"] } });

    const publish = response();
    await handlers.get("POST /api/asset-authoring/workspaces/:workspaceId/drafts/:draftId/publish")(
      authenticatedRequest({ params: { workspaceId: "workspace-a", draftId: "draft-1" }, body: {} }),
      publish.res,
    );
    expect(publish.status.mock.calls[0][0]).toBe(200);
    expect(publishAssetDraftUseCase.execute.mock.calls[0][0]).toMatchObject({ targetWorkspaceId: "workspace-a", draftId: "draft-1" });
  });

  it("returns API-shaped list payloads for drafts and authored assets", async () => {
    const { app, handlers } = appAndHandlers();
    registerAssetAuthoringApiRoutes({
      app,
      authoredAssetRepository: { listAuthoredAssetRecords: testDouble.fn(async () => ({ records: [{ authoredAssetId: "asset-1" }], nextCursor: "next-asset" })) } as any,
      assetDraftRepository: { listAssetDraftRecords: testDouble.fn(async () => ({ records: [{ draftId: "draft-1" }], nextCursor: "next-draft" })) } as any,
    });

    const authored = response();
    await handlers.get("GET /api/asset-authoring/workspaces/:workspaceId/authored-assets")({ params: { workspaceId: "workspace-a" }, query: {} }, authored.res);
    expect(authored.json.mock.calls[0][0].value).toEqual({ assets: [{ authoredAssetId: "asset-1" }], nextCursor: "next-asset" });

    const drafts = response();
    await handlers.get("GET /api/asset-authoring/workspaces/:workspaceId/drafts")({ params: { workspaceId: "workspace-a" }, query: {} }, drafts.res);
    expect(drafts.json.mock.calls[0][0].value).toEqual({ drafts: [{ draftId: "draft-1" }], nextCursor: "next-draft" });
  });

  it("exposes exact backing resources and attributes mutations to the authenticated actor", async () => {
    const { app, handlers } = appAndHandlers();
    const listTargets = testDouble.fn(async (_query: unknown) => ({ targets: [{ displayName: "Button" }] }));
    const readTarget = testDouble.fn(async () => ({ displayName: "Button", backingResources: [{ path: "frontend/component.tsx", role: "frontend-structure", mediaType: "text/typescript", content: "export const Button = true;", editable: true, sizeCharacters: 27 }] }));
    const create = testDouble.fn(async (command) => ({ kind: "success", value: { customizationId: "customization-1", createdBy: command.actorId } }));
    registerAssetAuthoringApiRoutes({ app, derivedCustomizations: { listTargets, readTarget, create } as any });
    const listed = response();
    await handlers.get("GET /api/asset-authoring/workspaces/:workspaceId/customization-targets")({ params: { workspaceId: "workspace-a" }, query: { text: "button" } }, listed.res);
    expect(listTargets.mock.calls[0][0]).toMatchObject({ workspaceId: "workspace-a", text: "button" });
    const detail = response();
    await handlers.get("GET /api/asset-authoring/workspaces/:workspaceId/customization-targets/:implementationReleaseId")({ params: { workspaceId: "workspace-a", implementationReleaseId: "implementation-release.button.1" }, query: { definitionId: "builtin.button", definitionVersion: "1.0.0" } }, detail.res);
    expect(detail.json.mock.calls[0][0].value.backingResources[0]).toMatchObject({ path: "frontend/component.tsx", content: "export const Button = true;" });
    const created = response();
    await handlers.get("POST /api/asset-authoring/workspaces/:workspaceId/derived-customizations")(authenticatedRequest({ params: { workspaceId: "workspace-a" }, body: { actorId: "renderer-spoof", semanticPatch: {} } }), created.res);
    expect(create.mock.calls[0][0]).toMatchObject({ workspaceId: "workspace-a", actorId: "principal-1" });
  });

  it("rejects mutation requests without an authenticated principal context", async () => {
    const { app, handlers } = appAndHandlers();
    const create = testDouble.fn();
    registerAssetAuthoringApiRoutes({ app, derivedCustomizations: { create } as any });
    const result = response();

    await expect(
      handlers.get("POST /api/asset-authoring/workspaces/:workspaceId/derived-customizations")(
        { params: { workspaceId: "workspace-a" }, body: { actorId: "renderer-spoof", semanticPatch: {} } },
        result.res,
      ),
    ).rejects.toThrow("Authenticated principal context is required.");
    expect(create).not.toHaveBeenCalled();
  });
});

const legacyReadCases = [
  {
    "tag": "LIST_AUTHORED_ASSETS",
    "repository": "authoredAssetRepository",
    "method": "listAuthoredAssetRecords",
    "suffix": "authored-assets",
    "key": "assets",
    "operation": "list-authored-assets",
    "payload": {
      "workspaceId": "workspace.legacy-test",
      "limit": 2,
      "cursor": "fixture-cursor",
      "status": "draft"
    },
    "params": {
      "workspaceId": "workspace.legacy-test"
    },
    "query": {
      "limit": "2",
      "cursor": "fixture-cursor",
      "status": "draft"
    },
    "item": {
      "workspaceId": "workspace.legacy-test"
    },
    "ipcArgs": [
      {
        "workspaceId": "workspace.legacy-test",
        "limit": 2,
        "cursor": "fixture-cursor",
        "status": "draft"
      }
    ]
  },
  {
    "tag": "READ_AUTHORED_ASSET",
    "repository": "authoredAssetRepository",
    "method": "readAuthoredAssetRecordByWorkspace",
    "suffix": "authored-assets/:authoredAssetId",
    "key": null,
    "operation": "read-authored-asset",
    "payload": {
      "workspaceId": "workspace.legacy-test",
      "authoredAssetId": "authored.test"
    },
    "params": {
      "workspaceId": "workspace.legacy-test",
      "authoredAssetId": "authored.test"
    },
    "query": {},
    "item": {
      "workspaceId": "workspace.legacy-test",
      "authoredAssetId": "authored.test"
    },
    "ipcArgs": [
      "workspace.legacy-test",
      "authored.test"
    ]
  },
  {
    "tag": "LIST_DRAFTS",
    "repository": "assetDraftRepository",
    "method": "listAssetDraftRecords",
    "suffix": "drafts",
    "key": "drafts",
    "operation": "list-drafts",
    "payload": {
      "targetWorkspaceId": "workspace.legacy-test",
      "limit": 2,
      "cursor": "fixture-cursor",
      "status": "draft"
    },
    "params": {
      "workspaceId": "workspace.legacy-test"
    },
    "query": {
      "limit": "2",
      "cursor": "fixture-cursor",
      "status": "draft"
    },
    "item": {
      "targetWorkspaceId": "workspace.legacy-test"
    },
    "ipcArgs": [
      {
        "limit": 2,
        "cursor": "fixture-cursor",
        "status": "draft",
        "workspaceId": "workspace.legacy-test"
      }
    ]
  },
  {
    "tag": "READ_DRAFT",
    "repository": "assetDraftRepository",
    "method": "readAssetDraftRecord",
    "suffix": "drafts/:draftId",
    "key": null,
    "operation": "read-draft",
    "payload": {
      "targetWorkspaceId": "workspace.legacy-test",
      "draftId": "draft.test"
    },
    "params": {
      "workspaceId": "workspace.legacy-test",
      "draftId": "draft.test"
    },
    "query": {},
    "item": {
      "targetWorkspaceId": "workspace.legacy-test",
      "draftId": "draft.test"
    },
    "ipcArgs": [
      "workspace.legacy-test",
      "draft.test"
    ]
  },
  {
    "tag": "LIST_REVISIONS",
    "repository": "assetRevisionRepository",
    "method": "listAssetRevisionRecords",
    "suffix": "revisions",
    "key": "revisions",
    "operation": "list-revisions",
    "payload": {
      "workspaceId": "workspace.legacy-test",
      "authoredAssetId": "authored.test",
      "limit": 2,
      "cursor": "fixture-cursor",
      "status": "draft"
    },
    "params": {
      "workspaceId": "workspace.legacy-test"
    },
    "query": {
      "authoredAssetId": "authored.test",
      "limit": "2",
      "cursor": "fixture-cursor",
      "status": "draft"
    },
    "item": {
      "workspaceId": "workspace.legacy-test",
      "authoredAssetId": "authored.test"
    },
    "ipcArgs": [
      {
        "workspaceId": "workspace.legacy-test",
        "authoredAssetId": "authored.test",
        "limit": 2,
        "cursor": "fixture-cursor",
        "status": "draft"
      }
    ]
  },
  {
    "tag": "READ_REVISION",
    "repository": "assetRevisionRepository",
    "method": "readAssetRevisionRecord",
    "suffix": "revisions/:revisionId",
    "key": null,
    "operation": "read-revision",
    "payload": {
      "workspaceId": "workspace.legacy-test",
      "revisionId": "revision.test",
      "authoredAssetId": "authored.test"
    },
    "params": {
      "workspaceId": "workspace.legacy-test",
      "revisionId": "revision.test"
    },
    "query": {
      "authoredAssetId": "authored.test"
    },
    "item": {
      "workspaceId": "workspace.legacy-test",
      "revisionId": "revision.test",
      "authoredAssetId": "authored.test"
    },
    "ipcArgs": [
      "workspace.legacy-test",
      "authored.test",
      "revision.test"
    ]
  },
  {
    "tag": "LIST_OVERRIDES",
    "repository": "assetOverrideRepository",
    "method": "listAssetOverrideRecords",
    "suffix": "overrides",
    "key": "overrides",
    "operation": "list-overrides",
    "payload": {
      "targetWorkspaceId": "workspace.legacy-test",
      "limit": 2,
      "cursor": "fixture-cursor",
      "status": "draft",
      "conflictStatus": "none"
    },
    "params": {
      "workspaceId": "workspace.legacy-test"
    },
    "query": {
      "limit": "2",
      "cursor": "fixture-cursor",
      "status": "draft",
      "conflictStatus": "none"
    },
    "item": {
      "targetWorkspaceId": "workspace.legacy-test"
    },
    "ipcArgs": [
      {
        "targetWorkspaceId": "workspace.legacy-test",
        "limit": 2,
        "cursor": "fixture-cursor",
        "status": "draft",
        "conflictStatus": "none"
      }
    ]
  },
  {
    "tag": "READ_OVERRIDE",
    "repository": "assetOverrideRepository",
    "method": "readAssetOverrideRecord",
    "suffix": "overrides/:overrideId",
    "key": null,
    "operation": "read-override",
    "payload": {
      "targetWorkspaceId": "workspace.legacy-test",
      "overrideId": "override.test"
    },
    "params": {
      "workspaceId": "workspace.legacy-test",
      "overrideId": "override.test"
    },
    "query": {},
    "item": {
      "targetWorkspaceId": "workspace.legacy-test",
      "overrideId": "override.test"
    },
    "ipcArgs": [
      "workspace.legacy-test",
      "override.test"
    ]
  }
] as const;

for (const fixture of legacyReadCases) it(`legacy API ${fixture.operation}: safe authority denial, positive mapping and revalidation`, async () => {
  const {app, handlers} = appAndHandlers();
  let allowed = false, effects = 0;
  const authorizations: unknown[] = [];
  const item = fixture.item;
  const repository = {[fixture.method]: async (...args: any[]) => {
    effects++;
    assert.deepEqual(args, fixture.ipcArgs);
    return fixture.key ? {records: [item], nextCursor: "next-fixture"} : item;
  }};
  const readers = createWorkspaceAssetAuthoringReaders({
    workspaceAccess: {async authorize(workspaceId: unknown, operation: string, scope: string) {
      authorizations.push([workspaceId, operation, scope]);
      if (!allowed) throw new Error("private policy detail");
    }}, authoredAssetRepository: repository, assetDraftRepository: repository,
    assetRevisionRepository: repository, assetOverrideRepository: repository,
  } as any);
  registerAssetAuthoringApiRoutes({app, ...readers});
  const handler = handlers.get(`GET /api/asset-authoring/workspaces/:workspaceId/${fixture.suffix}`);
  for (const state of [false, true, false]) {
    allowed = state;
    const result = response();
    await handler(authenticatedRequest({params: fixture.params, query: fixture.query}), result.res);
    const body = result.json.mock.calls[0][0];
    assert.equal(body.ok, state);
    assert.equal(body.operation, `asset-authoring.${fixture.operation}`);
    assert.equal(result.status.mock.calls[0][0], state ? 200 : 503);
    if (state) assert.deepEqual(body.value, fixture.key ? {[fixture.key]: [item], nextCursor: "next-fixture"} : item);
    else {assert.equal(body.error.code, "unavailable"); assert.ok(!JSON.stringify(body).includes("private policy detail"));}
  }
  assert.equal(effects, 1);
  assert.deepEqual(authorizations, Array(3).fill(["workspace.legacy-test", `asset-authoring.${fixture.operation}`, "asset:read"]));
  const invalid = response(); await handler(authenticatedRequest({params: {}, query: {}}), invalid.res);
  assert.equal(invalid.json.mock.calls[0][0].error.code, "validation");
  assert.equal(authorizations.length, 3); assert.equal(effects, 1);
});
