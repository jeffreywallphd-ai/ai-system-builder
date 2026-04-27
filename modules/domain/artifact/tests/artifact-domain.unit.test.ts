import { describe, expect, it } from "../../../testing/node-test";
import {
  encodeArtifactRepoBackingLocator,
  type ArtifactStorageBinding,
} from "../../../contracts/storage";
import { Artifact, ArtifactBacking, ArtifactId, SystemArtifactIdFactory } from "..";

describe("ArtifactId", () => {
  it("normalizes text and compares by canonical internal id", () => {
    const left = ArtifactId.from("  Artifacts/ABC-123  ");
    const right = ArtifactId.from("artifacts/abc-123");

    expect(left.toString()).toBe("artifacts/abc-123");
    expect(left.equals(right)).toBe(true);
  });

  it("generates system-owned ids that are not derived from repo coordinates", () => {
    const generated = ArtifactId.generate({
      now: () => new Date("2026-04-18T12:34:56.000Z"),
      randomSuffix: () => "XYZ123",
    });

    expect(generated.toString()).toBe("artifacts/20260418123456-xyz123");
    expect(generated.toString().startsWith("imports/")).toBe(false);
  });

  it("rejects invalid ids", () => {
    expect(() => ArtifactId.from("../outside")).toThrow();
  });

  it("keeps id generation policy behind system artifact id factory seam", () => {
    const artifactIdFactory = new SystemArtifactIdFactory();
    const created = artifactIdFactory.createArtifactId();
    expect(created.toString().startsWith("artifacts/")).toBe(true);
  });
});

describe("ArtifactBacking", () => {
  it("enforces repo-role semantics and stores verification state", () => {
    const backing = ArtifactBacking.from({
      kind: "artifact-repo",
      provider: "huggingface",
      locator: "openai/demo/images/cat.png",
      role: "imported-source",
      verification: {
        exists: true,
        verifiedAt: "2026-04-18T10:00:00.000Z",
      },
      target: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "images/cat.png",
      },
    });

    expect(backing.verification).toEqual({
      exists: true,
      verifiedAt: "2026-04-18T10:00:00.000Z",
    });
    expect(backing.resolvedTarget()).toMatchObject({
      repository: "openai/demo",
      path: "images/cat.png",
    });
  });

  it("resolves legacy repo target identity from locator", () => {
    const backing = ArtifactBacking.from({
      kind: "artifact-repo",
      provider: "huggingface",
      locator: "openai/demo/images/legacy.png",
      role: "published",
      revision: "main",
    });

    expect(backing.resolvedTarget()).toEqual({
      provider: "huggingface",
      repository: "openai/demo",
      path: "images/legacy.png",
      revision: "main",
    });
  });
});

describe("Artifact", () => {
  it("attaches and updates logically equivalent backings without duplicates", () => {
    const id = ArtifactId.from("artifacts/abc");
    const locator = encodeArtifactRepoBackingLocator({
      repository: "openai/demo",
      path: "images/cat.png",
    });

    const first = ArtifactBacking.from({
      kind: "artifact-repo",
      provider: "huggingface",
      locator,
      role: "published",
      createdAt: "2026-04-18T10:00:00.000Z",
      target: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "images/cat.png",
        revision: "main",
      },
      verification: { exists: false, verifiedAt: "2026-04-18T10:00:00.000Z" },
    });
    const updated = first.withVerification({
      exists: true,
      verifiedAt: "2026-04-18T11:00:00.000Z",
    }, "2026-04-18T11:00:00.000Z");

    const artifact = Artifact.create({ id, artifactFamily: "image", backings: [first] });
    artifact.attachOrUpdateBacking(updated);

    const backings = artifact.getBackings();
    expect(backings.length).toBe(1);
    expect(backings[0]?.verification?.exists).toBe(true);
    expect(artifact.latestBackingForRole("published")?.createdAt).toBe("2026-04-18T11:00:00.000Z");
  });

  it("bridges compatibility for legacy bindings while keeping system-owned artifact identity explicit", () => {
    const legacyBinding: ArtifactStorageBinding = {
      artifactId: "imports/huggingface/openai/demo/main/images/cat.png",
      role: "imported-source",
      createdAt: "2026-04-18T10:00:00.000Z",
      backing: {
        kind: "artifact-repo",
        provider: "huggingface",
        locator: "openai/demo/images/cat.png",
        revision: "main",
      },
    };

    const artifact = Artifact.fromStorageBindings({
      artifactId: legacyBinding.artifactId,
      artifactFamily: "image",
      bindings: [legacyBinding],
    });

    expect(artifact.id.toString()).toBe("imports/huggingface/openai/demo/main/images/cat.png");
    expect(artifact.latestBackingForRole("imported-source")?.resolvedTarget()).toMatchObject({
      repository: "openai/demo",
      path: "images/cat.png",
    });

    const newArtifact = Artifact.create({
      id: ArtifactId.generate({
        now: () => new Date("2026-04-18T12:00:00.000Z"),
        randomSuffix: () => "abc123",
      }),
      artifactFamily: "image",
    });
    expect(newArtifact.id.toString()).toBe("artifacts/20260418120000-abc123");
  });
});
