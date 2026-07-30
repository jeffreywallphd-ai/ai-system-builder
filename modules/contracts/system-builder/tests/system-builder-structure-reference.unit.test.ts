import { describe, expect, it } from "../../../testing/node-test";

import { normalizeAssetId } from "../../asset";
import {
  SYSTEM_BUILDER_STRUCTURE_SCHEMA_VERSION,
  normalizeSystemBuilderStructure,
} from "..";

describe("System Builder layout preset references", () => {
  it("rejects unsafe or unversioned layout identities", () => {
    expect(() =>
      normalizeSystemBuilderStructure({
        schemaVersion: SYSTEM_BUILDER_STRUCTURE_SCHEMA_VERSION,
        profile: "interactive",
        layoutPresetRef: {
          kind: "asset-definition-version",
          id: "../layout" as never,
          version: "2.0.0",
        },
      }),
    ).toThrow();
    expect(() =>
      normalizeSystemBuilderStructure({
        schemaVersion: SYSTEM_BUILDER_STRUCTURE_SCHEMA_VERSION,
        profile: "interactive",
        layoutPresetRef: {
          kind: "asset-definition",
          id: normalizeAssetId("builtin.layout.application.standard"),
        },
      }),
    ).toThrow(/exact definition version/i);
  });
});
