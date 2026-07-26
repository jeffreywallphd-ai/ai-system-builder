import { describe, expect, it } from "../../../testing/node-test";
import * as contract from "../desktop-asset-authoring-contract";

describe("desktop asset-authoring IPC contract", () => {
  it("exports phase 8a request/response channels", () => {
    expect(contract.DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_REQUEST_CHANNEL.value).toBe("ipc.asset-authoring.create-draft.request");
    expect(contract.DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_RESPONSE_CHANNEL.value).toBe("ipc.asset-authoring.list-effective-summaries.response");
    expect(contract.DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.listTargets.request.value).toBe("ipc.asset-authoring.list-customization-targets.request");
    expect(contract.DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS.publish.response.value).toBe("ipc.asset-authoring.publish-derived-customization.response");
  });
});
