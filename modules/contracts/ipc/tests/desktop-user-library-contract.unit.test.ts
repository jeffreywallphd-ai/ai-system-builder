import { describe, expect, it } from "../../../testing/node-test";
import * as ipc from "..";

describe("desktop user-library ipc contracts", () => {
  it("exports user-library operation/channel constants", () => {
    expect(ipc.DESKTOP_USER_LIBRARY_PROMOTE_OPERATION).toBe("user-library.promote-workspace-asset");
    expect(ipc.DESKTOP_USER_LIBRARY_PROMOTE_REQUEST_CHANNEL.value).toBe("ipc.user-library.promote-workspace-asset.request");
  });

  it("requires explicit workspace context for workspace-scoped requests", () => {
    const request = ipc.createDesktopWorkspaceEffectiveAssetSourceListRequest({ workspaceId: " workspace-a " as never });
    expect(request.payload.workspaceId).toBe("workspace-a");
  });
});
