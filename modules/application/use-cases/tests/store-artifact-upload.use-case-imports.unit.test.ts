import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "../../../testing/node-test";

describe("StoreArtifactUploadUseCase dependency boundaries", () => {
  it("does not import transport-specialized contract families into the application use case", () => {
    const useCaseTypeScriptPath = fileURLToPath(
      new URL("../store-artifact-upload.use-case.ts", import.meta.url),
    );
    const useCasePath = existsSync(useCaseTypeScriptPath)
      ? useCaseTypeScriptPath
      : useCaseTypeScriptPath.replace(/\.ts$/, ".js");
    const source = readFileSync(useCasePath, "utf8");

    expect(source).not.toContain('from "../../contracts/ipc"');
    expect(source).not.toContain('from "../../contracts/api"');
    expect(source).not.toContain('from "../../contracts/host"');
  });
});
