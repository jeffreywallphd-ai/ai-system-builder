import { describe, expect, it } from "../../../testing/node-test";
import * as api from "..";

describe("user-library api contracts", () => {
  it("exports user-library operation constants", () => {
    expect(api.API_USER_LIBRARY_PROMOTE_OPERATION).toBe("user-library.promote-workspace-asset");
    expect(api.API_USER_LIBRARY_LINK_OPERATION).toBe("user-library.link-asset-to-workspace");
    expect(api.API_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_OPERATION).toBe("user-library.list-workspace-effective-sources");
  });

  it("requires explicit workspace context for workspace-scoped requests", () => {
    const request = api.createApiWorkspaceUserLibraryLinkListRequest({ workspaceId: " workspace-a " as never });
    expect(request.payload.workspaceId).toBe("workspace-a");
  });
});
