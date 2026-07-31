import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultDatasetQualityPolicyProvider } from "../default-dataset-quality-policy-provider.service";

describe("createDefaultDatasetQualityPolicyProvider", () => {
  it("keeps mandatory checks enabled and scopes organization requests", async () => {
    const provider = createDefaultDatasetQualityPolicyProvider({
      allowedLanguages: ["en", "fr"],
      requireLicenseMetadata: true,
      excludedBenchmarkIds: ["benchmark-a"],
      maxRowsPerSource: 500,
    });

    const policy = await provider.resolveDatasetQualityPolicy({
      workspaceId: "workspace-a",
      organizationId: "organization-a",
      requestedPolicy: {
        preset: "strict",
        allowedLanguages: ["fr"],
        excludedBenchmarkIds: ["benchmark-b"],
        maxRowsPerSource: 750,
      },
    });

    assert.equal(policy.scope, "organization");
    assert.equal(policy.preset, "strict");
    assert.deepEqual(policy.allowedLanguages, ["fr"]);
    assert.deepEqual(policy.excludedBenchmarkIds, [
      "benchmark-a",
      "benchmark-b",
    ]);
    assert.equal(policy.maxRowsPerSource, 500);
    assert.equal(policy.requireLicenseMetadata, true);
    assert.deepEqual(policy.mandatoryChecks, {
      sourceAssociation: true,
      schema: true,
      exactDuplicates: true,
      fuzzyDuplicates: true,
      sensitivePersonalData: true,
      secretLikeContent: true,
      splitLeakage: true,
    });
  });

  it("rejects attempts to broaden the host language policy", async () => {
    const provider = createDefaultDatasetQualityPolicyProvider({
      allowedLanguages: ["en"],
    });

    await assert.rejects(
      provider.resolveDatasetQualityPolicy({
        workspaceId: "workspace-a",
        requestedPolicy: {
          preset: "recommended",
          allowedLanguages: ["fr"],
        },
      }),
      /not allowed by the data quality policy/,
    );
  });

  it("rejects unsafe or unbounded policy inputs", async () => {
    const provider = createDefaultDatasetQualityPolicyProvider();

    await assert.rejects(
      provider.resolveDatasetQualityPolicy({
        workspaceId: "workspace-a",
        requestedPolicy: {
          preset: "recommended",
          excludedBenchmarkIds: ["../unsafe"],
        },
      }),
      /safe identifiers/,
    );
    await assert.rejects(
      provider.resolveDatasetQualityPolicy({
        workspaceId: "workspace-a",
        requestedPolicy: {
          preset: "recommended",
          maxRowsPerSource: 0,
        },
      }),
      /between 1 and 1000000/,
    );
  });
});
