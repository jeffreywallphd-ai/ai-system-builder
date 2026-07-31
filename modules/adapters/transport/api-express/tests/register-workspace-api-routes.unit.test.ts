import assert from "node:assert/strict";
import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { registerWorkspaceApiRoutes } from "../workspace/registerWorkspaceApiRoutes";

function appAndHandlers() { const handlers = { get: new Map<string, any>(), post: new Map<string, any>() }; const app = { get: testDouble.fn((path: string, handler: any) => handlers.get.set(path, handler)), post: testDouble.fn((path: string, handler: any) => handlers.post.set(path, handler)) }; return { app, handlers }; }
function response() { const json = testDouble.fn(); const res = { status: testDouble.fn(() => res), json }; return { res, json, status: res.status }; }

describe("registerWorkspaceApiRoutes", () => {
  it("exposes only create/list/select workspace routes and calls the create use case", async () => {
    const { app, handlers } = appAndHandlers();
    const workspaceId = createWorkspaceId("workspace.generated-api");
    const workspace = { workspaceId, displayName: "Project", status: "active", createdAt: "2026-05-14T00:00:00.000Z", updatedAt: "2026-05-14T00:00:00.000Z" } as const;
    const workspaceRepository = { listWorkspaces: testDouble.fn(async () => [workspace]), readWorkspace: testDouble.fn(async () => workspace) } as any;
    const workspaceSelectionRepository = { readActiveWorkspaceSelection: testDouble.fn(async () => ({ workspaceId })), saveActiveWorkspaceSelection: testDouble.fn(async () => undefined), clearActiveWorkspaceSelection: testDouble.fn(async () => undefined) } as any;
    const createWorkspaceUseCase = { execute: testDouble.fn(async () => ({ status: "created", workspace, activeSelection: { workspaceId }, systemPackActivations: [{ packId: "system.foundation", packVersion: "1.0.0" }], issues: [], diagnostics: [] })) } as any;
    registerWorkspaceApiRoutes({ app, workspaceRepository, workspaceSelectionRepository, createWorkspaceUseCase });
    expect([...handlers.get.keys(), ...handlers.post.keys()].sort()).toEqual(["/api/workspaces", "/api/workspaces", "/api/workspaces/active-selection", "/api/workspaces/active-selection", "/api/workspaces/active-selection/clear"].sort());
    assert.doesNotMatch(JSON.stringify([...handlers.get.keys(), ...handlers.post.keys()]), /install|import|export|artifact|image|model|data/i);
    const create = response();
    await handlers.post.get("/api/workspaces")({ headers: {}, body: { command: { displayName: "Project", includeSystemFoundationAssets: true }, selectAfterCreate: true } }, create.res);
    expect(createWorkspaceUseCase.execute).toHaveBeenCalledWith({ command: { displayName: "Project", includeSystemFoundationAssets: true }, selectAfterCreate: true });
    expect(create.status).toHaveBeenCalledWith(201);
    expect(create.json.mock.calls[0][0]).toMatchObject({ ok: true, value: { workspace: { workspaceId }, systemPackActivations: [{ packId: "system.foundation", packVersion: "1.0.0" }] } });
  });
});
