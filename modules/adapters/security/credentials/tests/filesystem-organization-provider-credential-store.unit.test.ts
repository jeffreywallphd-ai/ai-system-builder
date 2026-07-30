import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createOrganizationId } from "../../../../contracts/organization";
import { createFilesystemOrganizationProviderCredentialStoreAdapter } from "../createFilesystemOrganizationProviderCredentialStoreAdapter";

const orgA = createOrganizationId("org-a");
const orgB = createOrganizationId("org-b");
const now = "2026-07-27T01:00:00.000Z";

describe("filesystem organization provider credential store", () => {
  it("keeps same-provider credentials in separate organization-owned files", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-credentials-"));
    const store = createFilesystemOrganizationProviderCredentialStoreAdapter(root);
    await store.writeProviderCredential({
      organizationId: orgA,
      provider: "huggingface",
      secret: "hf_org_a",
      updatedAt: now,
    });
    await store.writeProviderCredential({
      organizationId: orgB,
      provider: "huggingface",
      secret: "hf_org_b",
      updatedAt: now,
    });

    assert.equal((await store.readProviderCredential({ organizationId: orgA, provider: "huggingface" }))?.secret, "hf_org_a");
    assert.equal((await store.readProviderCredential({ organizationId: orgB, provider: "huggingface" }))?.secret, "hf_org_b");
    assert.equal((await readFile(join(root, "org-a", "huggingface.json"), "utf8")).includes("hf_org_b"), false);
  });

  it("rejects a credential file whose persisted owner does not match its directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-credentials-"));
    const store = createFilesystemOrganizationProviderCredentialStoreAdapter(root);
    await store.writeProviderCredential({
      organizationId: orgA,
      provider: "huggingface",
      secret: "hf_org_a",
      updatedAt: now,
    });
    await writeFile(join(root, "org-a", "huggingface.json"), JSON.stringify({
      organizationId: "org-b",
      provider: "huggingface",
      secret: "hf_tampered",
      updatedAt: now,
    }));

    await assert.rejects(
      () => store.readProviderCredential({ organizationId: orgA, provider: "huggingface" }),
      /belongs to another organization/,
    );
  });

  it("uses owner-only file permissions where POSIX modes are available", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-credentials-"));
    const store = createFilesystemOrganizationProviderCredentialStoreAdapter(root);
    await store.writeProviderCredential({
      organizationId: orgA,
      provider: "huggingface",
      secret: "hf_org_a",
      updatedAt: now,
    });
    if (process.platform !== "win32") {
      assert.equal((await stat(join(root, "org-a", "huggingface.json"))).mode & 0o777, 0o600);
    }
  });
});

