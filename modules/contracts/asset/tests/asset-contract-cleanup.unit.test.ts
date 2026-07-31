import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "../../../testing/node-test";

import {
  ASSET_REQUIREMENT_HOST_KINDS,
  ASSET_REQUIREMENT_KINDS,
  ASSET_REQUIREMENT_PERMISSION_KINDS,
  ASSET_REQUIREMENT_SAFETY_STATUSES,
  ASSET_COMPOSITION_VALIDATION_STATUSES,
  ASSET_VALIDATION_SUMMARY_STATUSES,
  normalizeAssetRequirementHostKind,
  normalizeAssetRequirementKind,
  normalizeAssetRequirementPermissionKind,
  normalizeAssetId,
  normalizeAssetRequirementSafetyStatus,
  normalizeAssetValidationSummaryStatus,
  type AssetBinding,
  type AssetComposition,
  type AssetCompositionValidationSummary,
  type AssetDefinition,
  type AssetInstance,
  type AssetMetadata,
  type AssetPortContract,
  type AssetProvenance,
  type AssetReference,
  type AssetRequirement,
  type AssetValidationIssue,
  type AssetValidationSummary,
} from "..";
import type { RuntimeCapabilityId } from "../../runtime";

const assetContractRoot = join(process.cwd(), "modules/contracts/asset");

function readAssetContractSource(fileName: string): string {
  return readFileSync(join(assetContractRoot, fileName), "utf8");
}

function listAssetContractSourceFiles(): readonly string[] {
  return readdirSync(assetContractRoot)
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => join(assetContractRoot, entry));
}

function ref(kind: AssetReference["kind"], id: string): AssetReference {
  return { kind, id: normalizeAssetId(id) };
}

const safeMetadata: AssetMetadata = {
  tags: ["contract", "json-safe"],
  lifecycle: { transportSafe: true, persistenceSafe: true },
  ordinal: 1,
  nullable: null,
};

describe("asset metadata cleanup contracts", () => {
  it("keeps public asset metadata and validation details JSON-compatible", () => {
    const provenance: AssetProvenance = {
      sourceKind: "human-authored",
      metadata: safeMetadata,
    };
    const definition: AssetDefinition = {
      definitionId: "feature.contract.cleanup",
      assetType: "feature",
      assetFamily: "structural",
      version: "1.0.0",
      displayName: "Contract cleanup",
      description: "Definition with JSON-compatible metadata.",
      lifecycleStatus: "draft",
      provenance,
      metadata: safeMetadata,
    };
    const instance: AssetInstance = {
      instanceId: "instance.contract.cleanup",
      definitionRef: ref("asset-definition-version", "feature.contract.cleanup@1.0.0"),
      lifecycleStatus: "draft",
      provenance,
      metadata: safeMetadata,
    };
    const binding: AssetBinding = {
      bindingId: "binding.contract.cleanup",
      bindingKind: "resource",
      sourceRef: ref("asset-instance", "instance.contract.cleanup"),
      targetRef: ref("resource", "resource.contract.cleanup"),
      metadata: safeMetadata,
    };
    const composition: AssetComposition = {
      compositionId: "composition.contract.cleanup",
      compositionType: "feature",
      displayName: "Contract cleanup composition",
      version: "1.0.0",
      lifecycleStatus: "draft",
      rootInstanceRefs: [instance.definitionRef],
      instanceRefs: [ref("asset-instance", instance.instanceId)],
      provenance,
      metadata: safeMetadata,
    };
    const issue: AssetValidationIssue = {
      severity: "warning",
      category: "configuration",
      message: "Details are JSON-compatible descriptors.",
      details: safeMetadata,
    };

    expect(JSON.parse(JSON.stringify(definition.metadata))).toEqual(safeMetadata);
    expect(JSON.parse(JSON.stringify(instance.metadata))).toEqual(safeMetadata);
    expect(JSON.parse(JSON.stringify(binding.metadata))).toEqual(safeMetadata);
    expect(JSON.parse(JSON.stringify(composition.metadata))).toEqual(safeMetadata);
    expect(JSON.parse(JSON.stringify(provenance.metadata))).toEqual(safeMetadata);
    expect(JSON.parse(JSON.stringify(issue.details))).toEqual(safeMetadata);
  });

  it("does not leave raw unknown metadata/detail records in asset contract sources", () => {
    const offenders = listAssetContractSourceFiles()
      .map((filePath) => ({ filePath, source: readFileSync(filePath, "utf8") }))
      .filter(({ source }) => source.includes("Record<string, unknown>"))
      .map(({ filePath }) => filePath);

    expect(offenders).toEqual([]);
  });

  it("does not require unsafe raw metadata values in public cleanup fields", () => {
    const unsafeKeys = [
      "filePath",
      "localPath",
      "bytes",
      "buffer",
      "stream",
      "runtimeReadinessSnapshot",
      "handler",
      "token",
      "rawEnvironment",
      "adapterDetails",
    ];

    for (const value of [safeMetadata]) {
      for (const unsafeKey of unsafeKeys) {
        expect(unsafeKey in value).toBe(false);
      }
    }
  });
});

describe("asset requirement cleanup contracts", () => {
  it("exports normalized requirement vocabularies", () => {
    expect([...ASSET_REQUIREMENT_KINDS]).toEqual([
      "runtime-capability",
      "host",
      "permission",
      "network-access",
      "filesystem-access",
      "secret-access",
      "user-approval",
      "thin-client-safety",
      "automation-safety",
      "resource",
      "artifact",
      "external-provider",
      "custom",
    ]);
    expect([...ASSET_REQUIREMENT_HOST_KINDS]).toContain("server-backed-thin-client");
    expect([...ASSET_REQUIREMENT_PERMISSION_KINDS]).toContain("runtime-execution");
    expect([...ASSET_REQUIREMENT_SAFETY_STATUSES]).toEqual([
      "safe",
      "unsafe",
      "requires-review",
      "unknown",
    ]);
    expect(normalizeAssetRequirementKind(" Thin-Client-Safety ")).toBe(
      "thin-client-safety",
    );
    expect(normalizeAssetRequirementHostKind(" Desktop-Or-Server ")).toBe(
      "desktop-or-server",
    );
    expect(normalizeAssetRequirementPermissionKind(" Secret-Read ")).toBe(
      "secret-read",
    );
    expect(normalizeAssetRequirementSafetyStatus(" Requires-Review ")).toBe(
      "requires-review",
    );
  });

  it("lets definitions own inline requirements and keep external requirement refs separate", () => {
    const runtimeCapabilityId: RuntimeCapabilityId = "image-generation";
    const requirements: readonly AssetRequirement[] = [
      {
        requirementKind: "runtime-capability",
        required: true,
        runtimeCapabilityId,
        summary: "Requires image generation capability availability.",
      },
      { requirementKind: "host", required: true, hostKind: "server-backed-thin-client" },
      { requirementKind: "permission", required: true, permissionKind: "runtime-execution" },
      { requirementKind: "thin-client-safety", required: true, safetyStatus: "requires-review" },
      { requirementKind: "automation-safety", required: false, safetyStatus: "unknown" },
      { requirementKind: "resource", required: true, ref: ref("resource", "resource.training.input") },
      { requirementKind: "artifact", required: false, ref: ref("artifact", "artifact.generated.preview") },
      {
        requirementKind: "external-provider",
        required: false,
        ref: ref("external-repository-object", "provider.huggingface.model.summary"),
      },
    ];
    const definition: AssetDefinition = {
      definitionId: "feature.requirement.cleanup",
      assetType: "feature",
      assetFamily: "behavioral",
      version: "1.0.0",
      displayName: "Requirement cleanup",
      description: "Definition with inline declarative requirements.",
      lifecycleStatus: "draft",
      provenance: { sourceKind: "human-authored" },
      requirements,
      requirementRefs: [ref("asset-requirement", "requirement.reusable.runtime-policy")],
    };

    expect(definition.requirements?.[0]?.runtimeCapabilityId).toBe("image-generation");
    expect(definition.requirementRefs?.[0]?.id).toBe(
      "requirement.reusable.runtime-policy",
    );
    expect("runtimeReadinessSnapshot" in requirements[0]).toBe(false);
    expect("taskStatus" in requirements[0]).toBe(false);
    expect("enforce" in requirements[2]).toBe(false);
    expect(requirements[5]?.ref?.kind).toBe("resource");
    expect(requirements[6]?.ref?.kind).toBe("artifact");
    expect(requirements[7]?.ref?.kind).toBe("external-repository-object");
  });

  it("keeps requirement contracts declarative and free of host, adapter, UI, API, IPC, filesystem, and runtime adapter imports", () => {
    const requirementSource = readAssetContractSource("asset-requirement.ts");

    expect(requirementSource).toContain('import type { RuntimeCapabilityId } from "../runtime";');
    for (const forbiddenImport of [
      "modules/hosts",
      "modules/adapters",
      "modules/ui",
      "../host",
      "../api",
      "../ipc",
      "node:fs",
      "electron",
      "express",
      "runtime-adapter",
    ]) {
      expect(requirementSource.includes(forbiddenImport)).toBe(false);
    }
  });
});

describe("asset reference and validation summary cleanup contracts", () => {
  it("keeps AssetReference ids normalized instead of raw locator strings", () => {
    const referenceSource = readAssetContractSource("asset-reference.ts");

    expect(referenceSource).toContain("readonly id: AssetId;");
    expect(referenceSource).not.toContain("readonly id: AssetId | string;");
    expect(() => normalizeAssetId("https://example.test/schema.json")).toThrow();
    expect(() => normalizeAssetId("provider/repo/path")).toThrow();
  });

  it("uses AssetReference for semantic schema references", () => {
    const schemaRef = ref("asset-definition", "schema.dashboard.summary.input");
    const contract: AssetPortContract = {
      contractKind: "json",
      schemaRef,
    };
    const source = readAssetContractSource("asset-port-contract.ts");

    expect(contract.schemaRef).toEqual(schemaRef);
    expect(source).toContain("readonly schemaRef?: AssetReference;");
    expect(source).not.toContain("readonly schemaRef?: string;");
  });

  it("shares validation summary statuses across general and composition summaries", () => {
    expect([...ASSET_VALIDATION_SUMMARY_STATUSES]).toEqual([
      "not-validated",
      "valid",
      "valid-with-warnings",
      "invalid",
      "unknown",
    ]);
    expect(normalizeAssetValidationSummaryStatus(" Valid-With-Warnings ")).toBe(
      "valid-with-warnings",
    );

    const generalSummary: AssetValidationSummary = {
      status: "valid-with-warnings",
      issueCounts: { warning: 1 },
    };
    const compositionSummary: AssetCompositionValidationSummary = {
      status: "unknown",
      issueCount: 0,
    };

    expect(generalSummary.status).toBe("valid-with-warnings");
    expect(compositionSummary.status).toBe("unknown");
    expect(ASSET_COMPOSITION_VALIDATION_STATUSES).toBe(
      ASSET_VALIDATION_SUMMARY_STATUSES,
    );
    expect(ASSET_VALIDATION_SUMMARY_STATUSES.includes(compositionSummary.status)).toBe(true);
  });

  it("exports all new cleanup contracts through the asset family barrel", async () => {
    const barrelPath = join(assetContractRoot, "index.ts");

    expect(existsSync(barrelPath)).toBe(true);
    const barrel = readFileSync(barrelPath, "utf8");
    expect(barrel).toContain('export * from "./asset-metadata";');
    expect(barrel).toContain('export * from "./asset-requirement";');
    expect(barrel).toContain('export * from "./asset-validation-summary";');
  });
});
