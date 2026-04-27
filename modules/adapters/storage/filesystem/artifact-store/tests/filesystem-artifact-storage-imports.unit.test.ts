import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "../../../../../testing/node-test";

describe("filesystem artifact storage adapter imports", () => {
  it("does not depend on artifact-browser read adapter internals", () => {
    const filePath = resolve(
      "modules/adapters/storage/filesystem/artifact-store/createFilesystemArtifactStorageAdapter.ts",
    );
    const source = readFileSync(filePath, "utf8");

    expect(source.includes("./createFilesystemArtifactBrowserReadAdapter")).toBe(false);
    expect(source.includes("from \"./createFilesystemArtifactBrowserReadAdapter\"")).toBe(false);
  });

  it("remains in artifact-object family and does not implement artifact-repo operations", () => {
    const filePath = resolve(
      "modules/adapters/storage/filesystem/artifact-store/createFilesystemArtifactStorageAdapter.ts",
    );
    const source = readFileSync(filePath, "utf8");

    expect(source.includes("storeArtifactInRepo")).toBe(false);
    expect(source.includes("retrieveArtifactFromRepo")).toBe(false);
    expect(source.includes("hasArtifactInRepo")).toBe(false);
  });

  it("keeps filesystem storage naming explicitly artifact-object with backward-compatible aliasing", () => {
    const filePath = resolve(
      "modules/adapters/storage/filesystem/artifact-store/createFilesystemArtifactStorageAdapter.ts",
    );
    const source = readFileSync(filePath, "utf8");

    expect(source.includes("createFilesystemArtifactObjectStorageAdapter")).toBe(true);
    expect(source.includes("createFilesystemArtifactStorageAdapter")).toBe(true);
  });
});
