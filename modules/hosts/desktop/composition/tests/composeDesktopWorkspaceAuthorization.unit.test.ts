import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { initializeLocalIdentityProfile } from "../../../../adapters/security/local-identity";
import { composeDesktopWorkspaceAuthorization } from "../composeDesktopWorkspaceAuthorization";

describe("composeDesktopWorkspaceAuthorization", () => {
  it("authorizes local owner capabilities and records the decision", async () => {
    const documents = createInMemoryStructuredDocumentStore();
    let sequence = 0;
    const localIdentity = await initializeLocalIdentityProfile({
      documents,
      organizationDisplayName: "Local Organization",
      principalDisplayName: "Local Owner",
      now: () => "2026-07-27T00:00:00.000Z",
      createId: () => `local-${++sequence}`,
    });
    const recordSecurityEvent = testDouble.fn().mockResolvedValue(undefined);
    const authorization = composeDesktopWorkspaceAuthorization({
      documents,
      localIdentity,
      audit: { recordSecurityEvent },
      now: () => "2026-07-27T00:00:00.000Z",
    });

    await authorization.authorizeWorkspaceOperation({
      workspace: {
        organizationId: localIdentity.organizationId,
        workspaceId: "workspace-a" as never,
        displayName: "Workspace A",
        status: "active",
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      },
      operation: "artifact.publish",
      requiredScopes: [
        "artifact:write",
        "provider-credential:use",
        "provider-repository:create",
      ],
    });

    expect(recordSecurityEvent).toHaveBeenCalledOnce();
    expect(recordSecurityEvent.mock.calls[0]?.[0]).toMatchObject({
      kind: "authz.allowed",
      principalId: localIdentity.principalId,
      organizationId: localIdentity.organizationId,
      operation: "artifact.publish",
      outcome: "allowed",
    });
  });
});
