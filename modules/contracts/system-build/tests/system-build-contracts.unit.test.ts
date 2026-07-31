import { describe, expect, it } from "../../../testing/node-test";
import { normalizeSystemBuildArtifactId, normalizeSystemBuildDigest, normalizeSystemBuildId, normalizeSystemReleaseId } from "..";

describe("system build contracts", () => {
  it("accepts content-addressed safe identities and sha256 digests", () => {
    expect(normalizeSystemBuildId("build.system.1")).toBe("build.system.1");
    expect(normalizeSystemReleaseId("release:abc123")).toBe("release:abc123");
    expect(normalizeSystemBuildArtifactId("artifact:manifest:abc123")).toBe("artifact:manifest:abc123");
    expect(normalizeSystemBuildDigest(`sha256:${"a".repeat(64)}`)).toBe(`sha256:${"a".repeat(64)}`);
  });

  it("rejects paths, traversal, and malformed digests", () => {
    expect(() => normalizeSystemBuildId("../build")).toThrow();
    expect(() => normalizeSystemReleaseId("C:\\release")).toThrow();
    expect(() => normalizeSystemBuildDigest("sha256:short")).toThrow();
  });
});
