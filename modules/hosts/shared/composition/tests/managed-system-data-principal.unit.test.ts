import { createOrganizationId, type OrganizationMembership, type OrganizationRequestContext } from "../../../../contracts/organization";
import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { createManagedSystemDataPrincipal } from "../composeSystemData";

const organizationId = createOrganizationId("organization-a");
const otherOrganizationId = createOrganizationId("organization-b");
const principalId = "person-a";
const active: OrganizationMembership = {
  organizationId, principalId, role: "operator", status: "active",
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
};

describe("managed system data principal", () => {
  it("resolves only the active member of the authenticated request organization", async () => {
    const getCurrentOrganizationContext = () => ({ organizationId, principalId });
    const readMembership = testDouble.fn(async (_input: { organizationId: typeof organizationId; principalId: string }) => active as OrganizationMembership | undefined);
    const resolve = createManagedSystemDataPrincipal({ getCurrentOrganizationContext }, { readMembership });
    expect(await resolve("person-b")).toBeUndefined();
    expect(readMembership.mock.calls.length).toBe(0);
    expect(await resolve(principalId)).toEqual({ actorId: principalId, roles: ["operator"], authenticated: true });
    expect(readMembership.mock.calls).toEqual([[{ organizationId, principalId }]]);

    for (const member of [undefined, { ...active, status: "suspended" as const },
      { ...active, organizationId: otherOrganizationId }, { ...active, principalId: "person-b" }]) {
      readMembership.mockImplementationOnce(async () => member);
      expect(await resolve(principalId)).toBeUndefined();
    }
    expect(await createManagedSystemDataPrincipal({ getCurrentOrganizationContext })(principalId)).toBeUndefined();
  });

  it("denies if the request authority changes during the membership read", async () => {
    for (const next of [undefined, { organizationId: otherOrganizationId, principalId },
      { organizationId, principalId: "person-b" }]) {
      let context: OrganizationRequestContext | undefined = { organizationId, principalId };
      const resolve = createManagedSystemDataPrincipal({ getCurrentOrganizationContext: () => context }, {
        readMembership: async () => { context = next; return active; },
      });
      expect(await resolve(principalId)).toBeUndefined();
    }
  });
});
