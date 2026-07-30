import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createOrganizationId } from "../../../../contracts/organization";
import { composeServerProviderCredentials } from "../composeServerProviderCredentials";

const orgA = createOrganizationId("org-a");

function managedOptions(root: string, migrationOrganizationId?: string) {
  return {
    organizationContext: {
      getCurrentOrganizationContext: () => ({
        organizationId: orgA,
        principalId: "principal-a",
      }),
    },
    organizationAuthorizer: { execute: async () => undefined },
    credentialRootDirectory: join(root, "provider-credentials"),
    legacyTokenFilePath: join(root, "legacy-token.json"),
    migrationOrganizationId,
    now: () => "2026-07-27T01:00:00.000Z",
  };
}

describe("composeServerProviderCredentials", () => {
  it("does not bind a legacy managed token without an explicit target organization", async () => {
    const root = await mkdtemp(join(tmpdir(), "server-provider-credentials-"));
    writeFileSync(join(root, "legacy-token.json"), JSON.stringify({ token: "hf_unassigned" }));
    const credentials = composeServerProviderCredentials(managedOptions(root));

    await credentials.waitForMigration();
    assert.deepEqual(await credentials.getHuggingFaceTokenStatus(), { configured: false });
    assert.equal(existsSync(join(root, "legacy-token.json")), true);
  });

  it("migrates and retires a legacy token only when an organization is explicitly assigned", async () => {
    const root = await mkdtemp(join(tmpdir(), "server-provider-credentials-"));
    writeFileSync(join(root, "legacy-token.json"), JSON.stringify({ token: "hf_assigned_1234" }));
    const migrations: string[] = [];
    const credentials = composeServerProviderCredentials({
      ...managedOptions(root, "org-a"),
      onMigration: ({ organizationId }) => migrations.push(organizationId),
    });

    await credentials.waitForMigration();
    assert.equal(existsSync(join(root, "legacy-token.json")), false);
    assert.equal(
      (await readFile(join(root, "provider-credentials", "org-a", "huggingface.json"), "utf8")).includes("hf_assigned_1234"),
      true,
    );
    assert.deepEqual(await credentials.getHuggingFaceTokenStatus(), {
      configured: true,
      maskedToken: "****1234",
    });
    assert.deepEqual(migrations, ["org-a"]);
  });
});

