import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "../../../modules/testing/node-test";

function readSourceFile(relativePath: string): string {
  return readFileSync(resolve(relativePath), "utf8");
}

describe("hugging face adapter TypeScript regression guards", () => {
  it("keeps the adapter factory as a runtime export so webpack/ts-loader always has emitted JavaScript", () => {
    const source = readSourceFile(
      "modules/adapters/storage/huggingface/createHuggingFaceArtifactRepoStorageAdapter.ts",
    );

    expect(source).toContain("export function createHuggingFaceArtifactRepoStorageAdapter(");
    expect(source).toContain("return {");
    expect(source).toContain("hasArtifactInRepo,");
    expect(source).toContain("storeArtifactInRepo,");
    expect(source).toContain("retrieveArtifactFromRepo,");
  });

  it("keeps explicit method parameter types for repo-browser methods used by desktop webpack compilation", () => {
    const source = readSourceFile(
      "modules/adapters/storage/huggingface/createHuggingFaceArtifactRepoStorageAdapter.ts",
    );

    expect(source).toContain("const listNamespaceDatasets: HuggingFaceRepoBrowserPort[\"listNamespaceDatasets\"] = async (");
    expect(source).toContain("namespace: string,");
    expect(source).toContain("const listDatasetParquetFiles: HuggingFaceRepoBrowserPort[\"listDatasetParquetFiles\"] = async (");
    expect(source).toContain("input: { repository: string; revision?: string },");
  });

  it("keeps explicit port-method type bindings on adapter methods to avoid object-literal contextual typing regressions", () => {
    const source = readSourceFile(
      "modules/adapters/storage/huggingface/createHuggingFaceArtifactRepoStorageAdapter.ts",
    );

    expect(source).toContain("const hasArtifactInRepo: ArtifactRepoStoragePort[\"hasArtifactInRepo\"] = async");
    expect(source).toContain("const storeArtifactInRepo: ArtifactRepoStoragePort[\"storeArtifactInRepo\"] = async");
    expect(source).toContain("const retrieveArtifactFromRepo: ArtifactRepoStoragePort[\"retrieveArtifactFromRepo\"] = async");
    expect(source).toContain("const listNamespaceDatasets: HuggingFaceRepoBrowserPort[\"listNamespaceDatasets\"] = async");
    expect(source).toContain("const listDatasetParquetFiles: HuggingFaceRepoBrowserPort[\"listDatasetParquetFiles\"] = async");
  });
});
