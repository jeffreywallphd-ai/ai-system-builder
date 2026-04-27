import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "../../../testing/node-test";

const USE_CASE_FILES = [
  "../browse-artifacts.use-case.ts",
  "../read-artifact-detail.use-case.ts",
  "../read-artifact-content.use-case.ts",
] as const;

describe("artifact browser read use-case dependency boundaries", () => {
  it("does not import transport-specialized contract families into application use cases", () => {
    for (const relativePath of USE_CASE_FILES) {
      const typeScriptPath = fileURLToPath(new URL(relativePath, import.meta.url));
      const sourcePath = existsSync(typeScriptPath)
        ? typeScriptPath
        : typeScriptPath.replace(/\.ts$/, ".js");
      const source = readFileSync(sourcePath, "utf8");

      expect(source).not.toContain('from "../../contracts/ipc"');
      expect(source).not.toContain('from "../../contracts/api"');
      expect(source).not.toContain('from "../../contracts/host"');
    }
  });
});
