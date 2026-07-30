import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../../../../modules/testing/node-test";
import { createDesktopSystemRunWorkflowClient } from "./desktopSystemRunWorkflowClient";

const source = {
  kind: "approved-release" as const,
  sourceId: "release-a",
  sourceDigest: `sha256:${"a".repeat(64)}`,
  label: "Release A",
};

function setDesktopApi(api: Record<string, unknown>): void {
  (globalThis as unknown as { window?: Record<string, unknown> }).window = {
    desktopApi: api,
  };
}

describe("desktop system run workflow client", () => {
  it("forwards only generic list, prepare, and invoke inputs", async () => {
    const list = testDouble.fn().mockResolvedValue({ ok: true, value: [] });
    const prepare = testDouble
      .fn()
      .mockResolvedValue({ ok: true, value: { snapshotRevision: "r1" } });
    const invoke = testDouble
      .fn()
      .mockResolvedValue({ ok: true, value: { snapshotRevision: "r2" } });
    setDesktopApi({
      listSystemRunWorkflowProfiles: list,
      prepareSystemRunWorkflow: prepare,
      invokeSystemRunWorkflow: invoke,
    });
    const client = createDesktopSystemRunWorkflowClient();
    await client.listProfiles({ workspaceId: "workspace-a" });
    await client.prepare({
      workspaceId: "workspace-a",
      profileId: "fixture.workflow@1.0.0",
      source,
    });
    await client.invoke({
      workspaceId: "workspace-a",
      profileId: "fixture.workflow@1.0.0",
      source,
      actionId: "refresh",
      operationId: "operation-1",
      expectedSnapshotRevision: "r1",
      values: {},
    });

    expect(list).toHaveBeenCalledWith({ workspaceId: "workspace-a" });
    expect(prepare).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      profileId: "fixture.workflow@1.0.0",
      source,
    });
    expect(invoke).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      profileId: "fixture.workflow@1.0.0",
      source,
      actionId: "refresh",
      operationId: "operation-1",
      expectedSnapshotRevision: "r1",
      values: {},
    });
  });

  it("maps sanitized transport failures and unavailable bridges", async () => {
    setDesktopApi({
      prepareSystemRunWorkflow: testDouble.fn().mockResolvedValue({
        ok: false,
        error: {
          code: "forbidden",
          message: "This workflow is not available.",
          details: { field: "profileId" },
        },
      }),
    });
    const denied = await createDesktopSystemRunWorkflowClient().prepare({
      workspaceId: "workspace-a",
      profileId: "fixture.workflow@1.0.0",
      source,
    });
    expect(denied).toEqual({
      ok: false,
      error: {
        code: "workflow.unauthorized",
        message: "This workflow is not available.",
        field: "profileId",
      },
    });

    setDesktopApi({});
    const unavailable =
      await createDesktopSystemRunWorkflowClient().listProfiles({
        workspaceId: "workspace-a",
      });
    expect(unavailable).toMatchObject({
      ok: false,
      error: { code: "workflow.failed" },
    });
  });
});
