import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createOrganizationId } from "../../../../contracts/organization";
import type { AuthorizationRequest } from "../../../../contracts/security";
import type { ProviderCredentialStorePort } from "../../../ports/security";
import {
  createProviderCredentialApplicationSecretsAdapter,
  ManageOrganizationProviderCredentialService,
} from "../manage-organization-provider-credential.service";

const orgA = createOrganizationId("org-a");
const orgB = createOrganizationId("org-b");
const now = "2026-07-27T01:00:00.000Z";

function fixture() {
  let activeOrganizationId = orgA;
  const records = new Map<string, Awaited<ReturnType<ProviderCredentialStorePort["readProviderCredential"]>>>();
  const authorizations: AuthorizationRequest[] = [];
  const store: ProviderCredentialStorePort = {
    async readProviderCredential(request) {
      return records.get(`${request.organizationId}:${request.provider}`);
    },
    async writeProviderCredential(record) {
      records.set(`${record.organizationId}:${record.provider}`, record);
    },
    async deleteProviderCredential(request) {
      records.delete(`${request.organizationId}:${request.provider}`);
    },
  };
  const service = new ManageOrganizationProviderCredentialService({
    organizationContext: {
      getCurrentOrganizationContext: () => ({
        organizationId: activeOrganizationId,
        principalId: "principal-a",
        requestId: "request-a",
      }),
    },
    authorizer: {
      async execute(request) {
        authorizations.push(request);
      },
    },
    credentials: store,
    now: () => now,
  });
  return {
    service,
    authorizations,
    selectOrganization(organizationId: typeof orgA) {
      activeOrganizationId = organizationId;
    },
  };
}

describe("ManageOrganizationProviderCredentialService", () => {
  it("isolates credentials by the authenticated organization and never returns a raw secret in status", async () => {
    const test = fixture();
    await test.service.setCredential("huggingface", "hf_org_a_secret_1234");

    assert.deepEqual(await test.service.getStatus("huggingface"), {
      configured: true,
      maskedToken: "****1234",
    });
    assert.equal(
      JSON.stringify(await test.service.getStatus("huggingface")).includes("hf_org_a_secret"),
      false,
    );

    test.selectOrganization(orgB);
    assert.deepEqual(await test.service.getStatus("huggingface"), { configured: false });
    test.selectOrganization(orgA);
    assert.equal(
      await test.service.resolveCredentialForUse("huggingface"),
      "hf_org_a_secret_1234",
    );
  });

  it("authorizes status, write, use, and delete with credential-specific scopes and resources", async () => {
    const test = fixture();
    await test.service.setCredential("huggingface", "hf_secret");
    await test.service.getStatus("huggingface");
    await test.service.resolveCredentialForUse("huggingface");
    await test.service.clearCredential("huggingface");

    assert.deepEqual(
      test.authorizations.map((request) => request.requiredScopes[0]),
      [
        "provider-credential:write",
        "provider-credential:read",
        "provider-credential:use",
        "provider-credential:write",
      ],
    );
    assert.ok(test.authorizations.every((request) =>
      request.resource?.kind === "provider-credential" &&
      request.resource.organizationId === orgA &&
      request.resource.requiresOrganizationOwnership === true));
  });

  it("backs the managed settings secret without introducing a second global secret slot", async () => {
    const test = fixture();
    const secrets = createProviderCredentialApplicationSecretsAdapter(test.service);
    await secrets.setSecret("huggingface.token", "hf_settings_5678");
    assert.equal(await secrets.hasSecret("huggingface.token"), true);
    assert.equal(await secrets.getSecret("huggingface.token"), "hf_settings_5678");
    await secrets.clearSecret("huggingface.token");
    assert.equal(await secrets.hasSecret("huggingface.token"), false);
  });

  it("fails closed when no managed organization context is active", async () => {
    const service = new ManageOrganizationProviderCredentialService({
      organizationContext: { getCurrentOrganizationContext: () => undefined },
      authorizer: { execute: async () => undefined },
      credentials: {
        readProviderCredential: async () => undefined,
        writeProviderCredential: async () => undefined,
        deleteProviderCredential: async () => undefined,
      },
    });
    await assert.rejects(
      () => service.getStatus("huggingface"),
      /Managed provider credential context is required/,
    );
  });
});

