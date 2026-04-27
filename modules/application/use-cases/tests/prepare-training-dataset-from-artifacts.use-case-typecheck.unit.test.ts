import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "../../../testing/node-test";

function readSourceFile(relativePath: string): string {
  return readFileSync(resolve(relativePath), "utf8");
}

describe("prepare training dataset TypeScript regression guards", () => {
  it("keeps optional artifact repo storage narrowed via a local alias to avoid ts-loader emit-skip regressions", () => {
    const source = readSourceFile(
      "modules/application/use-cases/prepare-training-dataset-from-artifacts.use-case.ts",
    );

    expect(source).toContain("const artifactRepoStorage = this.artifactRepoStorage;");
    expect(source).toContain("if (!artifactRepoStorage) {");
    expect(source).toContain("artifactRepoStorage.storeArtifactInRepo(");
    expect(source).toContain("artifactRepoStorage.hasArtifactInRepo(");
    expect(source).not.toContain("this.artifactRepoStorage.storeArtifactInRepo(");
    expect(source).not.toContain("this.artifactRepoStorage.hasArtifactInRepo(");
  });

  it("keeps optional artifact catalog narrowed via a local alias in async read flow", () => {
    const source = readSourceFile(
      "modules/application/use-cases/prepare-training-dataset-from-artifacts.use-case.ts",
    );

    expect(source).toContain("const artifactCatalog = this.artifactCatalog;");
    expect(source).toContain("const catalogOriginalName = artifactCatalog");
    expect(source).toContain("artifactCatalog.readArtifactCatalogRecord(");
    expect(source).not.toContain("this.artifactCatalog.readArtifactCatalogRecord(");
  });

  it("reads repo publish targets from store descriptor contract shape", () => {
    const source = readSourceFile(
      "modules/application/use-cases/prepare-training-dataset-from-artifacts.use-case.ts",
    );

    expect(source).toContain("publishDataset.value.descriptor.target");
    expect(source).toContain("path: publishDatasetTarget.path ?? datasetPath");
    expect(source).not.toContain("publishDataset.value.target");
  });
});

