import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "../../../testing/node-test";

describe("artifact intake classification service dependency boundaries", () => {
  it("does not import artifact contracts", () => {
    const sourceTypeScriptPath = fileURLToPath(
      new URL("../artifact-intake-classification-service.ts", import.meta.url),
    );
    const sourcePath = existsSync(sourceTypeScriptPath)
      ? sourceTypeScriptPath
      : sourceTypeScriptPath.replace(/\.ts$/, ".js");
    const source = readFileSync(sourcePath, "utf8");

    expect(source).not.toContain("../../contracts/artifact");
    expect(source).not.toContain("ArtifactKind");
  });
});
