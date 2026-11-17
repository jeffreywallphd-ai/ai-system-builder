import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setExpressAuthContext } from "../../../../adapters/transport/api-express/security/expressAuthContext";
import { createStructuredOrganizationRepositories } from "../../../../adapters/persistence/organization";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { AuthorizeOperationService, createOrganizationAuthorizationPolicy } from "../../../../application/services/security";
import { createTenantPlacementConfig } from "../../../../contracts/config";
import { createOrganizationId } from "../../../../contracts/organization";
import { composeServerHost } from "../composeServerHost";

const org = createOrganizationId("org-forms");
const now = "2026-11-12T00:00:00.000Z";
const listPath = "/api/systems/published-forms";
const submitPath = "/api/systems/published-forms/submit";

test("the server root registers published forms only with its managed authorization context", { timeout: 30_000 }, async () => {
  const parent = await realpath(tmpdir());
  const folder = await realpath(await mkdtemp(path.join(parent, "server-form-registration-")));
  try {
    for (const configured of [false, true]) {
      const storageRootDirectory = path.join(folder, configured ? "owned" : "unconfigured");
      const documents = createInMemoryStructuredDocumentStore();
      const repositories = createStructuredOrganizationRepositories(documents);
      const policy = createOrganizationAuthorizationPolicy({
        organizations: repositories.organizations, memberships: repositories.memberships,
        tenantPlacement: createTenantPlacementConfig({ mode: "dedicated", organizationId: org }),
      });
      const host = composeServerHost({ env: { NODE_ENV: "test" },
        persistence: { documents, organizationDocuments: documents.forOrganization(org) },
        ...(configured ? {
          organizationContextProvider: { getCurrentOrganizationContext: () => ({ organizationId: org, principalId: "managed-form-author" }) },
          organizationAuthorizer: new AuthorizeOperationService(policy, { createEventId: () => "form-fixture-event", now: () => now }),
        } : {}),
        settings: { localSettingsFilePath: path.join(storageRootDirectory, "settings.json") },
        artifactRepo: { providerCredentialRootDirectory: path.join(storageRootDirectory, "credentials"),
          huggingFaceTokenConfigFilePath: path.join(storageRootDirectory, "no-token.json") },
        logSink() {}, now: () => now,
      });
      const get = new Map<string, unknown[]>();
      const post = new Map<string, unknown[]>();
      try {
        host.registerApi({ app: {
          get(route: string, ...handlers: unknown[]) { get.set(route, handlers); },
          post(route: string, ...handlers: unknown[]) { post.set(route, handlers); },
          patch() {}, delete() {},
        }, storageRootDirectory, runtimeRootDirectory: path.join(storageRootDirectory, "runtime") });
        await host.waitForAssetFoundation();
        assert.equal(get.has(listPath), configured);
        assert.equal(post.has(submitPath), configured);
        if (configured) {
          let status = 0;
          let result: unknown;
          const handlers = get.get(listPath)!;
          const handler = handlers[handlers.length - 1] as (input: unknown, res: unknown) => Promise<void>;
          const response = { status(code: number) { status = code; return response; }, json(value: unknown) { result = value; } };
          const request = { query: { workspaceId: "workspace-missing", releaseId: "system-release:" + "a".repeat(64) } };
          setExpressAuthContext(request as Parameters<typeof setExpressAuthContext>[0], {
            authenticated: true, authMethod: "oidc-bearer", principal: {
              principalId: "managed-form-author", kind: "user", roles: [], scopes: ["asset:read"],
            },
          });
          await handler(request, response);
          assert.equal(status, 403);
          assert.equal((result as { ok: boolean }).ok, false);
        }
      } finally {
        await host.closeRuntimeDatabases();
      }
    }
  } finally {
    const target = await realpath(folder);
    assert.equal(target, folder);
    assert.equal(path.dirname(target), parent);
    assert.ok(path.basename(target).startsWith("server-form-registration-"));
    await rm(target, { recursive: true, force: true });
  }
});
