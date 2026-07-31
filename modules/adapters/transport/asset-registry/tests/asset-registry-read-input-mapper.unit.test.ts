import { describe, expect, it } from "../../../../testing/node-test";
import {
  parseAssetRegistryDefinitionListInput,
  parseAssetRegistryDefinitionReadInput,
  toAssetRegistryDefinitionReference,
  toAssetRegistryFacadeListQuery,
  toAssetRegistryReadOptions,
} from "../assetRegistryReadInputMapper";

describe("assetRegistryReadInputMapper", () => {
  it("normalizes API query input into the shared facade list query", () => {
    const input = parseAssetRegistryDefinitionListInput({
      q: " workflow ",
      assetType: "workflow,tool",
      assetFamily: "behavioral",
      lifecycleStatus: "published",
      builtIn: "built-in",
      limit: "10",
      cursor: "abc-123",
      includeMetadata: "true",
    }, "api-query");

    expect(toAssetRegistryFacadeListQuery(input)).toEqual({
      searchText: "workflow",
      assetTypes: ["workflow", "tool"],
      assetFamilies: ["behavioral"],
      lifecycleStatuses: ["published"],
      includeBuiltIns: undefined,
      includeCustom: false,
      includeMetadata: true,
      limit: 10,
      cursor: "abc-123",
      workspaceId: undefined,
    });
  });

  it("normalizes IPC payload input into the same shared facade list query", () => {
    const input = parseAssetRegistryDefinitionListInput({
      searchText: " workflow ",
      assetTypes: ["workflow", "tool"],
      assetFamilies: ["behavioral"],
      lifecycleStatuses: ["published"],
      builtIn: "custom",
      limit: 10,
      cursor: "abc-123",
      includeMetadata: false,
    }, "ipc-payload");

    expect(toAssetRegistryFacadeListQuery(input)).toEqual({
      searchText: "workflow",
      assetTypes: ["workflow", "tool"],
      assetFamilies: ["behavioral"],
      lifecycleStatuses: ["published"],
      includeBuiltIns: false,
      includeCustom: undefined,
      includeMetadata: false,
      limit: 10,
      cursor: "abc-123",
      workspaceId: undefined,
    });
  });

  it("rejects malformed public list filters before facade defaults apply", () => {
    const invalidCases: readonly [string, unknown, "api-query" | "ipc-payload"][] = [
      ["invalid asset type", { assetType: "bad" }, "api-query"],
      ["invalid asset family", { assetFamily: "bad" }, "api-query"],
      ["invalid lifecycle status", { lifecycleStatus: "bad" }, "api-query"],
      ["invalid built-in filter", { builtIn: "yes" }, "api-query"],
      ["invalid API boolean", { includeMetadata: "yes" }, "api-query"],
      ["invalid API limit", { limit: "0" }, "api-query"],
      ["malformed API cursor", { cursor: "/tmp/path" }, "api-query"],
      ["invalid IPC asset type", { assetTypes: ["bad"] }, "ipc-payload"],
      ["invalid IPC boolean", { includeMetadata: "true" }, "ipc-payload"],
      ["invalid IPC limit", { limit: 0 }, "ipc-payload"],
      ["malformed IPC cursor", { cursor: "C:\\tmp\\cursor" }, "ipc-payload"],
    ];

    for (const [, input, shape] of invalidCases) {
      expect(() => parseAssetRegistryDefinitionListInput(input, shape)).toThrow();
    }
  });

  it("normalizes definition read input into reference and read options", () => {
    const input = parseAssetRegistryDefinitionReadInput({
      definitionId: " builtin.workflow ",
      version: " 1.0.0 ",
      expand: ["aiContext", "metadata", "ports"],
      includeValidation: true,
    }, "ipc-payload");

    expect(toAssetRegistryDefinitionReference(input)).toEqual({
      kind: "asset-definition",
      id: "builtin.workflow",
      version: "1.0.0",
    });
    expect(toAssetRegistryReadOptions(input)).toEqual({
      includeValidation: true,
      includeAiContext: true,
      includeConfigurationSchema: false,
      includePorts: true,
      includeRequirements: false,
      includeMetadata: true,
      workspaceId: undefined,
    });
  });

  it("rejects invalid read inputs and expansion keys", () => {
    expect(() => parseAssetRegistryDefinitionReadInput({ definitionId: "/tmp/asset" }, "ipc-payload")).toThrow();
    expect(() => parseAssetRegistryDefinitionReadInput({ definitionId: "builtin.workflow", expand: ["secret"] }, "ipc-payload")).toThrow();
    expect(() => parseAssetRegistryDefinitionReadInput({ definitionId: "builtin.workflow", includeValidation: "true" }, "ipc-payload")).toThrow();
    expect(() => parseAssetRegistryDefinitionReadInput({ definitionId: "builtin.workflow" }, "ipc-payload", { requireVersion: true })).toThrow();
    expect(() => parseAssetRegistryDefinitionReadInput({ definitionId: "builtin.workflow", includeValidation: "yes" }, "api-query")).toThrow();
  });
});
