import { describe, expect, it } from "../../../../testing/node-test";
import { resolveServerSystemDeploymentProfile } from "../composeServerHost";

describe("server system deployment profile", () => {
  it("maps managed persistence shapes onto the finite release compatibility profiles", () => {
    expect(
      resolveServerSystemDeploymentProfile({
        DEPLOYMENT_SHAPE: "campus-server",
      }),
    ).toBe("campus-server");
    expect(
      resolveServerSystemDeploymentProfile({
        DEPLOYMENT_SHAPE: "corporate-server",
      }),
    ).toBe("campus-server");
    expect(
      resolveServerSystemDeploymentProfile({ DEPLOYMENT_SHAPE: "cloud" }),
    ).toBe("cloud-server");
    expect(resolveServerSystemDeploymentProfile({})).toBe("campus-server");
  });
});
