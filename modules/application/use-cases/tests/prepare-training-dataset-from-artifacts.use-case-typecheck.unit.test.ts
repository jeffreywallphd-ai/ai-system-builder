import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as ts from "typescript";

import { describe, expect, it } from "../../../testing/node-test";

function readSourceFile(relativePath: string): string {
  return readFileSync(resolve(relativePath), "utf8");
}

describe("prepare training dataset TypeScript regression guards", () => {
  it("emits no TypeScript diagnostics for the use-case and its boundary contracts", () => {
    const repoRoot = resolve(".");
    const targetFile = resolve("modules/application/use-cases/prepare-training-dataset-from-artifacts.use-case.ts");
    const configFile = ts.readConfigFile(resolve("tsconfig.json"), ts.sys.readFile);
    if (configFile.error) {
      throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
    }

    const parsedConfig = ts.parseJsonConfigFileContent(
      {
        ...configFile.config,
        files: ["modules/application/use-cases/prepare-training-dataset-from-artifacts.use-case.ts"],
        include: [],
      },
      ts.sys,
      repoRoot,
    );
    const program = ts.createProgram({
      rootNames: parsedConfig.fileNames,
      options: {
        ...parsedConfig.options,
        incremental: false,
        noEmit: true,
      },
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    const messages = diagnostics.map((diagnostic) => {
      const location = diagnostic.file && diagnostic.start !== undefined
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
        : undefined;
      const fileName = diagnostic.file ? diagnostic.file.fileName.replace(`${repoRoot}\\`, "") : "unknown";
      const prefix = location ? `${fileName}:${location.line + 1}:${location.character + 1}` : fileName;
      return `${prefix} - ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`;
    });

    expect(messages).toEqual([]);
  });

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

