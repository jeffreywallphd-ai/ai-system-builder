import { describe, expect, it } from "../../../testing/node-test";

import { normalizeAssetId } from "../../asset";
import { normalizeAssetCompositionPlanId } from "../../asset-composition";
import { createWorkspaceId } from "../../workspace";
import {
  SYSTEM_BUILDER_COMPOSITION_TYPES,
  SYSTEM_BUILDER_STATUSES,
  isSystemBuilderSystemId,
  normalizeSystemBuilderCompositionType,
  normalizeSystemBuilderStatus,
  normalizeSystemBuilderSystemId,
  type SystemBuilderRecord,
} from "..";

function record(): SystemBuilderRecord {
  const rootRef = { kind: "asset-instance" as const, id: normalizeAssetId("instance.assistant.primary") };
  return {
    systemId: normalizeSystemBuilderSystemId("system.research-assistant"),
    targetWorkspaceId: createWorkspaceId("workspace.research"),
    name: "Research assistant",
    status: "in-composition",
    revision: 1,
    composition: {
      compositionId: normalizeAssetId("composition.research-assistant"),
      compositionType: "system",
      displayName: "Research assistant",
      version: "0.1.0",
      lifecycleStatus: "draft",
      rootInstanceRefs: [rootRef],
      instanceRefs: [rootRef],
      provenance: { sourceKind: "human-authored", authorship: "human-authored" },
      validationSummary: { status: "not-validated", issueCount: 0 },
    },
    sourceCompositionPlanId: normalizeAssetCompositionPlanId("plan.research-assistant"),
    systemDefinitionRef: {
      kind: "asset-definition",
      id: normalizeAssetId("definition.system.research-assistant"),
      version: "0.1.0",
    },
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    createdBy: "user-1",
    updatedBy: "user-1",
  };
}

describe("System Builder contract baseline", () => {
  it("specializes AssetComposition for systems and systems of subsystems", () => {
    expect([...SYSTEM_BUILDER_COMPOSITION_TYPES]).toEqual(["system", "system-of-subsystems"]);
    expect(normalizeSystemBuilderCompositionType(" System ")).toBe("system");
    expect(() => normalizeSystemBuilderCompositionType("workflow")).toThrow();
    expect(record().composition.validationSummary?.status).toBe("not-validated");
  });

  it("uses design-time construction statuses rather than software or runtime statuses", () => {
    expect([...SYSTEM_BUILDER_STATUSES]).toEqual([
      "draft",
      "in-composition",
      "blocked",
      "ready-for-validation",
      "validated",
      "archived",
    ]);
    expect(normalizeSystemBuilderStatus(" Ready-For-Validation ")).toBe("ready-for-validation");
    for (const operationalStatus of ["healthy", "running", "stopped", "installed", "failed"]) {
      expect(() => normalizeSystemBuilderStatus(operationalStatus)).toThrow();
    }
  });

  it("keeps system records workspace-scoped and free of operational software fields", () => {
    const system = record();
    expect(system.targetWorkspaceId).toBe("workspace.research");
    expect(system.sourceCompositionPlanId).toBe("plan.research-assistant");
    for (const forbiddenField of [
      "softwareStatus",
      "runtimeStatus",
      "hostStatus",
      "installerStatus",
      "pythonStatus",
      "comfyUiStatus",
      "cpuUsagePercent",
      "memoryUsagePercent",
    ]) {
      expect(forbiddenField in system).toBe(false);
    }
  });

  it("normalizes safe ids and rejects paths, locators, and token-like values", () => {
    expect(normalizeSystemBuilderSystemId(" system.valid ")).toBe("system.valid");
    for (const unsafe of ["../system", "C:\\system", "https://example.test/system", "token_secret"]) {
      expect(isSystemBuilderSystemId(unsafe)).toBe(false);
      expect(() => normalizeSystemBuilderSystemId(unsafe)).toThrow();
    }
  });
});
