import { describe, expect, it } from "../../../../testing/node-test";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type { ArtifactObjectStoragePort } from "../../../../application/ports/storage";
import { createAssetImplementationArtifactAdapter } from "../createAssetImplementationArtifactAdapter";

describe("asset implementation artifact adapter", () => {
  it("uses contained deterministic keys while returning only safe opaque descriptors", async () => {
    let storedKey = "";
    let stored: Uint8Array<ArrayBufferLike> = new Uint8Array();
    const storage: ArtifactObjectStoragePort = {
      async storeArtifact(request) {
        storedKey = request.descriptor.key ?? "";
        stored = request.content as Uint8Array;
        return {
          ok: true,
          value: {
            key: storedKey as never,
            mediaType: request.descriptor.mediaType,
            sizeBytes: stored.byteLength,
          },
        };
      },
      async retrieveArtifact<TContent>(
        request: Parameters<ArtifactObjectStoragePort["retrieveArtifact"]>[0],
      ) {
        return {
          ok: true,
          value: {
            descriptor: { key: request.key },
            content: stored as unknown as TContent,
          },
        };
      },
      async hasArtifact() {
        return { ok: true, value: { exists: true } };
      },
      async deleteArtifact() {
        return { ok: true, value: { deleted: true } };
      },
    };
    const adapter = createAssetImplementationArtifactAdapter(storage);
    const workspaceId = createWorkspaceId("workspace-a");
    const descriptor = await adapter.putImmutable({
      workspaceId,
      kind: "source",
      content: "export const value = 1;",
      mediaType: "text/typescript",
    });
    expect(storedKey).toMatch(
      /^workspaces\/workspace-a\/asset-implementations\/source\/[a-f0-9]{64}$/,
    );
    expect(JSON.stringify(descriptor)).not.toMatch(
      /storageKey|workspaces\/|localPath|sourceCode|contentBase64|\"bytes\"/i,
    );
    expect(
      new TextDecoder().decode(
        await adapter.readVerified(workspaceId, descriptor),
      ),
    ).toBe("export const value = 1;");
  });

  it("rejects a mismatched expected digest and tampered reads", async () => {
    const storage: ArtifactObjectStoragePort = {
      async storeArtifact(request) {
        return { ok: true, value: { key: request.descriptor.key as never } };
      },
      async retrieveArtifact<TContent>(
        request: Parameters<ArtifactObjectStoragePort["retrieveArtifact"]>[0],
      ) {
        return {
          ok: true,
          value: {
            descriptor: { key: request.key },
            content: new Uint8Array([9]) as unknown as TContent,
          },
        };
      },
      async hasArtifact() {
        return { ok: true, value: { exists: true } };
      },
      async deleteArtifact() {
        return { ok: true, value: { deleted: true } };
      },
    };
    const adapter = createAssetImplementationArtifactAdapter(storage);
    const workspaceId = createWorkspaceId("workspace-a");
    await expect(
      adapter.putImmutable({
        workspaceId,
        kind: "bundle",
        content: new Uint8Array([1]),
        mediaType: "application/octet-stream",
        expectedDigest: `sha256:${"0".repeat(64)}`,
      }),
    ).rejects.toThrow(/digest/);
    await expect(
      adapter.readVerified(workspaceId, {
        artifactId: "implementation-artifact:bundle:aaaaaaaa" as never,
        kind: "bundle",
        digest: `sha256:${"a".repeat(64)}`,
        mediaType: "application/octet-stream",
        sizeBytes: 1,
      }),
    ).rejects.toThrow(/verification/);
  });
});
