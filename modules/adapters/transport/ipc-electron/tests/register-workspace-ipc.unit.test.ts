import assert from "node:assert/strict";
import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { DESKTOP_WORKSPACE_SUMMARY_REQUEST_CHANNEL, DESKTOP_WORKSPACE_CREATE_REQUEST_CHANNEL, DESKTOP_WORKSPACE_LIST_REQUEST_CHANNEL, DESKTOP_WORKSPACE_SELECTION_CLEAR_REQUEST_CHANNEL, DESKTOP_WORKSPACE_SELECTION_READ_REQUEST_CHANNEL, DESKTOP_WORKSPACE_SELECTION_SAVE_REQUEST_CHANNEL } from "../../../../contracts/ipc";
import { registerWorkspaceIpc } from "../workspace/registerWorkspaceIpc";

describe("registerWorkspaceIpc", () => {
  it("registers workspace create/list/select and bounded summary channels and calls the create use case", async () => {
    const handlers = new Map<string, any>();
    const ipcMain = { handle: testDouble.fn((channel: string, handler: any) => handlers.set(channel, handler)) };
    const workspaceId = createWorkspaceId("workspace.generated-ipc");
    const workspace = { workspaceId, displayName: "Project", status: "active", createdAt: "2026-05-14T00:00:00.000Z", updatedAt: "2026-05-14T00:00:00.000Z" } as const;
    const createWorkspaceUseCase = { execute: testDouble.fn(async () => ({ status: "created", workspace, activeSelection: { workspaceId }, systemPackActivations: [{ packId: "system.foundation", packVersion: "1.0.0" }], issues: [], diagnostics: [] })) } as any;
    registerWorkspaceIpc({ ipcMain, workspaceRepository: { listWorkspaces: testDouble.fn(async () => [workspace]), readWorkspace: testDouble.fn(async () => workspace) } as any, workspaceSelectionRepository: { readActiveWorkspaceSelection: testDouble.fn(async () => ({ workspaceId })), saveActiveWorkspaceSelection: testDouble.fn(async () => undefined), clearActiveWorkspaceSelection: testDouble.fn(async () => undefined) } as any, createWorkspaceUseCase });
    expect([...handlers.keys()].sort()).toEqual([DESKTOP_WORKSPACE_SUMMARY_REQUEST_CHANNEL.value, DESKTOP_WORKSPACE_LIST_REQUEST_CHANNEL.value, DESKTOP_WORKSPACE_CREATE_REQUEST_CHANNEL.value, DESKTOP_WORKSPACE_SELECTION_READ_REQUEST_CHANNEL.value, DESKTOP_WORKSPACE_SELECTION_SAVE_REQUEST_CHANNEL.value, DESKTOP_WORKSPACE_SELECTION_CLEAR_REQUEST_CHANNEL.value].sort());
    assert.doesNotMatch(JSON.stringify([...handlers.keys()]), /install|import|export|artifact|image|model|data/i);
    const result = await handlers.get(DESKTOP_WORKSPACE_CREATE_REQUEST_CHANNEL.value)({}, { payload: { command: { displayName: "Project", includeSystemFoundationAssets: true }, selectAfterCreate: true } });
    expect(createWorkspaceUseCase.execute).toHaveBeenCalledWith({ command: { displayName: "Project", includeSystemFoundationAssets: true }, selectAfterCreate: true });
    expect(result).toMatchObject({ ok: true, value: { workspace: { workspaceId }, systemPackActivations: [{ packId: "system.foundation", packVersion: "1.0.0" }] } });
  });
});

it("requires a trusted summary sender and independently normalizes requests", async () => {
 const handlers=new Map<string,any>(); let calls=0; let trusted=false;
 registerWorkspaceIpc({ipcMain:{handle:(channel,handler)=>{handlers.set(channel,handler);}}, workspaceRepository:{} as any,workspaceSelectionRepository:{} as any,createWorkspaceUseCase:{} as any,
 summarySenderTrust:{isTrustedSender:()=>trusted},readWorkspaceSummary:{async execute(request){calls++;return {schemaVersion:"workspace-summary-v1",...request,metrics:{modelsInstalled:{status:"available",value:1},modelsTrained:{status:"unavailable"}}};}}});
 const handler=handlers.get(DESKTOP_WORKSPACE_SUMMARY_REQUEST_CHANNEL.value);
 expect((await handler({}, {payload:{workspaceId:"workspace.a",page:"models"}})).ok).toBe(false); expect(calls).toBe(0);
 trusted=true;
 expect((await handler({}, {payload:{workspaceId:"workspace.a",page:"models",scope:"spoof"}})).ok).toBe(false); expect(calls).toBe(0);
 const result=await handler({}, {payload:{workspaceId:"workspace.a",page:"models"}});expect(result.ok).toBe(true);expect(calls).toBe(1);
});
