import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "../../../testing/node-test";

import * as artifactUploadContracts from "..";

describe("artifact upload contracts policy surface", () => {
  it("does not expose browser/html formatting helpers from contracts", () => {
    expect("toHtmlFileAcceptAttribute" in artifactUploadContracts).toBe(false);
  });

  it("keeps artifact upload policy as transport shape declarations only", () => {
    const policyFile = readFileSync(resolve("modules/contracts/artifact-upload/artifact-upload-policy.ts"), "utf8");
    expect(policyFile).not.toContain("toHtmlFileAcceptAttribute");
  });
});
