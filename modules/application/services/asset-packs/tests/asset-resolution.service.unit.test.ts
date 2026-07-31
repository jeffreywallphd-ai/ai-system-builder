import * as assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import type {
  AssetDefinition,
  AssetPackOverrideRule,
  AssetReference,
  AssetResolutionRequest,
  AssetSourceLayer,
} from "../../../../contracts/asset";
import {
  resolveAssetDefinition,
  SYSTEM_FOUNDATION_PACK_MANIFEST,
} from "..";

const SYSTEM_TEXT_FIELD_REF: AssetReference = {
  kind: "asset-definition-version",
  id: "builtin.form.text-field" as never,
  version: "1.0.0",
};
const USER_TEXT_FIELD_REF: AssetReference = {
  kind: "asset-definition-version",
  id: "user.form.text-field" as never,
  version: "1.0.0",
};
const IMPORTED_TEXT_FIELD_REF: AssetReference = {
  kind: "asset-definition-version",
  id: "imported.form.text-field" as never,
  version: "1.0.0",
};

function definition(input: {
  readonly id: string;
  readonly version?: string;
  readonly displayName?: string;
  readonly sourceLayer?: AssetSourceLayer;
  readonly lifecycleStatus?: AssetDefinition["lifecycleStatus"];
}): AssetDefinition {
  return {
    definitionId: input.id as never,
    assetType: "ui-component",
    assetFamily: "structural",
    version: input.version ?? "1.0.0",
    displayName: input.displayName ?? input.id,
    description: "Safe resolver fixture definition.",
    lifecycleStatus: input.lifecycleStatus ?? "published",
    reviewStatus: "approved",
    provenance: {
      sourceKind: "system-generated",
      authorship: "human-authored",
    },
    metadata: {
      sourceLayer: input.sourceLayer ?? "system-default",
      fixtureOnly: true,
    },
  };
}

function overrideRule(input: {
  readonly ruleId: string;
  readonly targetRef?: AssetReference;
  readonly replacementRef?: AssetReference;
  readonly priority?: number;
  readonly sourceLayer?: AssetSourceLayer;
  readonly enabled?: boolean;
}): AssetPackOverrideRule {
  return {
    ruleId: input.ruleId,
    targetRef: input.targetRef ?? {
      kind: "asset-definition",
      id: SYSTEM_TEXT_FIELD_REF.id,
    },
    replacementRef: input.replacementRef ?? USER_TEXT_FIELD_REF,
    scope: "workspace",
    sourceLayer: input.sourceLayer ?? "workspace-pack",
    priority: input.priority ?? 10,
    enabled: input.enabled ?? true,
    conflictPolicy: input.enabled === false ? "disabled" : "prefer-replacement",
    reason: "Safe fixture rule.",
    metadata: {
      fixtureOnly: true,
    },
  };
}

function semanticRequest(
  allowOverrides: boolean,
  sourceLayerPreference?: readonly AssetSourceLayer[],
): AssetResolutionRequest {
  return {
    requestedRef: { kind: "asset-definition", id: SYSTEM_TEXT_FIELD_REF.id },
    mode: "semantic",
    scope: "workspace",
    allowOverrides,
    includeTrace: true,
    ...(sourceLayerPreference ? { sourceLayerPreference } : {}),
  };
}

function exactRequest(allowOverrides?: boolean): AssetResolutionRequest {
  return {
    requestedRef: SYSTEM_TEXT_FIELD_REF,
    mode: "exact",
    ...(typeof allowOverrides === "boolean" ? { allowOverrides } : {}),
    includeTrace: true,
  };
}

const systemTextField = definition({
  id: "builtin.form.text-field",
  sourceLayer: "system-default",
  displayName: "System Text Field",
});
const userTextField = definition({
  id: "user.form.text-field",
  sourceLayer: "user-override",
  displayName: "User Text Field",
});
const importedTextField = definition({
  id: "imported.form.text-field",
  sourceLayer: "imported-pack",
  displayName: "Imported Text Field",
});

function codes(result: ReturnType<typeof resolveAssetDefinition>): readonly string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

function traceText(result: ReturnType<typeof resolveAssetDefinition>): string {
  return JSON.stringify(result.trace);
}

function serialized(value: unknown): string {
  return JSON.stringify(value).toLowerCase();
}

function combinedSource(relativeDir: string): string {
  const root = process.cwd();
  const stack = [join(root, relativeDir)];
  const sources: string[] = [];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      const stats = statSync(path);
      if (stats.isDirectory()) {
        if (!["node_modules", "dist", "build", "coverage"].includes(entry)) stack.push(path);
        continue;
      }
      if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry) && !/\.unit\.test\.(?:ts|tsx|js|jsx)$/.test(entry)) {
        sources.push(readFileSync(path, "utf8"));
      }
    }
  }
  return sources.join("\n");
}

describe("asset resolution service exact resolution", () => {
  it("resolves an exact matching definition", () => {
    const result = resolveAssetDefinition({
      request: exactRequest(),
      definitions: [systemTextField],
    });

    assert.equal(result.resolvedDefinition, systemTextField);
    assert.deepEqual(result.resolvedRef, SYSTEM_TEXT_FIELD_REF);
    assert.deepEqual(result.appliedOverrideRuleIds, []);
  });

  it("ignores overrides by default for exact references", () => {
    const result = resolveAssetDefinition({
      request: exactRequest(),
      definitions: [systemTextField, userTextField],
      overrideRules: [overrideRule({ ruleId: "workspace.text-field.override" })],
    });

    assert.equal(result.resolvedDefinition, systemTextField);
    assert.deepEqual(result.appliedOverrideRuleIds, []);
    assert.match(traceText(result), /overrides-skipped/);
  });

  it("returns not-found when the exact candidate is missing", () => {
    const result = resolveAssetDefinition({
      request: exactRequest(),
      definitions: [userTextField],
    });

    assert.equal(result.resolvedDefinition, undefined);
    assert.deepEqual(codes(result), ["asset-resolution.not-found"]);
  });

  it("returns a duplicate conflict without deterministic ordering", () => {
    const duplicate = definition({
      id: "builtin.form.text-field",
      sourceLayer: "workspace-pack",
    });
    const result = resolveAssetDefinition({
      request: exactRequest(),
      definitions: [systemTextField, duplicate],
    });

    assert.equal(result.resolvedDefinition, undefined);
    assert.deepEqual(codes(result), ["asset-resolution.duplicate-exact-candidates"]);
    assert.equal(result.conflicts[0]?.candidateRefs.length, 2);
  });

  it("can apply an override to an exact request only when explicitly allowed", () => {
    const result = resolveAssetDefinition({
      request: exactRequest(true),
      definitions: [systemTextField, userTextField],
      overrideRules: [
        overrideRule({
          ruleId: "workspace.text-field.exact-override",
          targetRef: SYSTEM_TEXT_FIELD_REF,
          replacementRef: USER_TEXT_FIELD_REF,
        }),
      ],
    });

    assert.equal(result.resolvedDefinition, userTextField);
    assert.deepEqual(result.appliedOverrideRuleIds, [
      "workspace.text-field.exact-override",
    ]);
  });
});

describe("asset resolution service semantic/default resolution", () => {
  it("resolves a semantic reference by definition ID", () => {
    const result = resolveAssetDefinition({
      request: semanticRequest(false),
      definitions: [systemTextField],
    });

    assert.equal(result.resolvedDefinition, systemTextField);
    assert.deepEqual(result.resolvedRef, SYSTEM_TEXT_FIELD_REF);
  });

  it("chooses the highest safe version when deterministic", () => {
    const oldDefinition = definition({ id: "builtin.form.text-field", version: "1.0.0" });
    const newDefinition = definition({ id: "builtin.form.text-field", version: "1.2.0" });
    const result = resolveAssetDefinition({
      request: semanticRequest(false),
      definitions: [oldDefinition, newDefinition],
    });

    assert.equal(result.resolvedDefinition, newDefinition);
    assert.equal(result.resolvedRef?.version, "1.2.0");
  });

  it("returns conflict when version choice is ambiguous", () => {
    const alphaDefinition = definition({ id: "builtin.form.text-field", version: "1.0.alpha" });
    const betaDefinition = definition({ id: "builtin.form.text-field", version: "1.0.beta" });
    const result = resolveAssetDefinition({
      request: semanticRequest(false),
      definitions: [alphaDefinition, betaDefinition],
    });

    assert.equal(result.resolvedDefinition, undefined);
    assert.deepEqual(codes(result), ["asset-resolution.semantic-candidate-conflict"]);
  });

  it("ignores disabled override rules", () => {
    const result = resolveAssetDefinition({
      request: semanticRequest(true),
      definitions: [systemTextField, userTextField],
      overrideRules: [
        overrideRule({
          ruleId: "workspace.text-field.disabled",
          enabled: false,
        }),
      ],
    });

    assert.equal(result.resolvedDefinition, systemTextField);
    assert.deepEqual(result.appliedOverrideRuleIds, []);
  });

  it("applies one enabled matching override when overrides are allowed", () => {
    const result = resolveAssetDefinition({
      request: semanticRequest(true),
      definitions: [systemTextField, userTextField],
      overrideRules: [overrideRule({ ruleId: "workspace.text-field.override" })],
    });

    assert.equal(result.resolvedDefinition, userTextField);
    assert.deepEqual(result.appliedOverrideRuleIds, ["workspace.text-field.override"]);
  });

  it("ignores overrides when allowOverrides is false", () => {
    const result = resolveAssetDefinition({
      request: semanticRequest(false),
      definitions: [systemTextField, userTextField],
      overrideRules: [overrideRule({ ruleId: "workspace.text-field.override" })],
    });

    assert.equal(result.resolvedDefinition, systemTextField);
    assert.deepEqual(result.appliedOverrideRuleIds, []);
    assert.match(traceText(result), /overrides-skipped/);
  });

  it("returns conflict for equal-priority matching overrides", () => {
    const result = resolveAssetDefinition({
      request: semanticRequest(true),
      definitions: [systemTextField, userTextField, importedTextField],
      overrideRules: [
        overrideRule({
          ruleId: "workspace.text-field.user",
          replacementRef: USER_TEXT_FIELD_REF,
          priority: 20,
        }),
        overrideRule({
          ruleId: "workspace.text-field.imported",
          replacementRef: IMPORTED_TEXT_FIELD_REF,
          sourceLayer: "imported-pack",
          priority: 20,
        }),
      ],
    });

    assert.equal(result.resolvedDefinition, undefined);
    assert.deepEqual(codes(result), ["asset-resolution.override-conflict"]);
    assert.deepEqual(result.conflicts[0]?.overrideRuleIds, [
      "workspace.text-field.imported",
      "workspace.text-field.user",
    ]);
  });

  it("uses priority to choose one override", () => {
    const result = resolveAssetDefinition({
      request: semanticRequest(true),
      definitions: [systemTextField, userTextField, importedTextField],
      overrideRules: [
        overrideRule({
          ruleId: "workspace.text-field.low",
          replacementRef: IMPORTED_TEXT_FIELD_REF,
          sourceLayer: "imported-pack",
          priority: 1,
        }),
        overrideRule({
          ruleId: "workspace.text-field.high",
          replacementRef: USER_TEXT_FIELD_REF,
          priority: 50,
        }),
      ],
    });

    assert.equal(result.resolvedDefinition, userTextField);
    assert.deepEqual(result.appliedOverrideRuleIds, ["workspace.text-field.high"]);
  });

  it("uses source-layer order only when explicitly supplied", () => {
    const workspaceDefinition = definition({
      id: "builtin.form.text-field",
      version: "1.0.0",
      sourceLayer: "workspace-pack",
    });
    const unordered = resolveAssetDefinition({
      request: semanticRequest(false),
      definitions: [systemTextField, workspaceDefinition],
    });
    const ordered = resolveAssetDefinition({
      request: semanticRequest(false, ["workspace-pack", "system-default"]),
      definitions: [systemTextField, workspaceDefinition],
    });

    assert.equal(unordered.resolvedDefinition, undefined);
    assert.deepEqual(codes(unordered), ["asset-resolution.semantic-candidate-conflict"]);
    assert.equal(ordered.resolvedDefinition, workspaceDefinition);
  });

  it("returns a missing-replacement diagnostic with no resolved definition", () => {
    const result = resolveAssetDefinition({
      request: semanticRequest(true),
      definitions: [systemTextField],
      overrideRules: [
        overrideRule({
          ruleId: "workspace.text-field.missing",
          replacementRef: USER_TEXT_FIELD_REF,
        }),
      ],
    });

    assert.equal(result.resolvedDefinition, undefined);
    assert.deepEqual(result.appliedOverrideRuleIds, ["workspace.text-field.missing"]);
    assert.deepEqual(codes(result), ["asset-resolution.missing-replacement"]);
  });

  it("selects the replacement without mutating the target definition", () => {
    const before = structuredClone(systemTextField);
    const result = resolveAssetDefinition({
      request: semanticRequest(true),
      definitions: [systemTextField, userTextField],
      overrideRules: [overrideRule({ ruleId: "workspace.text-field.override" })],
    });

    assert.equal(result.resolvedDefinition, userTextField);
    assert.deepEqual(systemTextField, before);
  });
});

describe("asset resolution service trace and diagnostics", () => {
  it("includes exact and semantic mode trace steps", () => {
    const exact = resolveAssetDefinition({
      request: exactRequest(),
      definitions: [systemTextField],
    });
    const semantic = resolveAssetDefinition({
      request: semanticRequest(false),
      definitions: [systemTextField],
    });

    assert.match(traceText(exact), /exact-mode-selected/);
    assert.match(traceText(semantic), /semantic-mode-selected/);
  });

  it("includes skipped overrides when disabled", () => {
    const result = resolveAssetDefinition({
      request: semanticRequest(false),
      definitions: [systemTextField],
    });

    assert.match(traceText(result), /overrides-skipped/);
  });

  it("includes the applied override rule ID", () => {
    const result = resolveAssetDefinition({
      request: semanticRequest(true),
      definitions: [systemTextField, userTextField],
      overrideRules: [overrideRule({ ruleId: "workspace.text-field.override" })],
    });

    assert.match(traceText(result), /workspace\.text-field\.override/);
  });

  it("keeps conflict diagnostics deterministic", () => {
    const request = semanticRequest(true);
    const rules = [
      overrideRule({
        ruleId: "workspace.text-field.user",
        replacementRef: USER_TEXT_FIELD_REF,
        priority: 20,
      }),
      overrideRule({
        ruleId: "workspace.text-field.imported",
        replacementRef: IMPORTED_TEXT_FIELD_REF,
        sourceLayer: "imported-pack",
        priority: 20,
      }),
    ];
    const first = resolveAssetDefinition({
      request,
      definitions: [systemTextField, userTextField, importedTextField],
      overrideRules: rules,
    });
    const second = resolveAssetDefinition({
      request,
      definitions: [systemTextField, userTextField, importedTextField],
      overrideRules: [...rules].reverse(),
    });

    assert.deepEqual(first.conflicts, second.conflicts);
    assert.deepEqual(first.diagnostics, second.diagnostics);
  });

  it("sanitizes diagnostics and excludes unsafe values", () => {
    const unsafeReplacementRef: AssetReference = {
      kind: "asset-definition-version",
      id: "user.form.text-field" as never,
      version: "1.0.0",
      label: "C:\\Users\\private\\token.txt",
      metadata: {
        token: "Bearer abc123",
        localPath: "C:\\Users\\private",
      },
    };
    const result = resolveAssetDefinition({
      request: semanticRequest(true),
      definitions: [systemTextField],
      overrideRules: [
        overrideRule({
          ruleId: "workspace.text-field.missing",
          replacementRef: unsafeReplacementRef,
        }),
      ],
    });
    const output = serialized({ diagnostics: result.diagnostics, conflicts: result.conflicts });

    for (const unsafe of [
      "c:\\",
      "bearer",
      "token",
      "localpath",
      "secret",
      "base64",
      "workflowjson",
      "providerpayload",
      "process.env",
    ]) {
      assert.equal(output.includes(unsafe), false, unsafe);
    }
  });

  it("keeps resolvedDefinition as an internal application result with sanitized public diagnostics and trace", () => {
    const result = resolveAssetDefinition({
      request: semanticRequest(false),
      definitions: [systemTextField],
    });
    const publicSafeOutput = serialized({
      requestedRef: result.requestedRef,
      resolvedRef: result.resolvedRef,
      appliedOverrideRuleIds: result.appliedOverrideRuleIds,
      diagnostics: result.diagnostics,
      conflicts: result.conflicts,
      trace: result.trace,
    });

    assert.equal(result.resolvedDefinition, systemTextField);
    assert.equal(publicSafeOutput.includes("resolveddefinition"), false);
    assert.equal(publicSafeOutput.includes("c:\\"), false);
    assert.equal(publicSafeOutput.includes("token"), false);
    assert.equal(publicSafeOutput.includes("providerpayload"), false);
  });
});

describe("asset resolution service boundaries", () => {
  it("imports no adapters, hosts, API, IPC, preload, UI, runtime, providers, filesystem, or network modules", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "modules/application/services/asset-packs/asset-resolution.service.ts",
      ),
      "utf8",
    );

    for (const forbidden of [
      "modules/adapters",
      "../../../adapters",
      "modules/hosts",
      "../../../hosts",
      "contracts/api",
      "contracts/ipc",
      "api-express",
      "ipc-electron",
      "electron",
      "express",
      "preload",
      "renderer",
      "thin-client",
      "modules/ui",
      "../../../ui",
      "contracts/runtime",
      "contracts/storage",
      "contracts/persistence",
      "@huggingface",
      "openai",
      "node:fs",
      "node:path",
      "fetch(",
    ]) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
  });

  it("does not mutate input arrays, definitions, or rules", () => {
    const definitions = [systemTextField, userTextField];
    const rules = [overrideRule({ ruleId: "workspace.text-field.override" })];
    const before = structuredClone({ definitions, rules });

    resolveAssetDefinition({
      request: semanticRequest(true),
      definitions,
      overrideRules: rules,
    });

    assert.deepEqual({ definitions, rules }, before);
  });

  it("does not expose install, seeding, persistence, network, provider, runtime, or storage behavior", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "modules/application/services/asset-packs/asset-resolution.service.ts",
      ),
      "utf8",
    );

    for (const forbidden of [
      "installSystem",
      "seed",
      "RepositoryPort",
      "persistence",
      "local-asset-record-store",
      "scan",
      "provider",
      "runtime",
      "network",
      "download",
      "upload",
      "readFile",
      "writeFile",
      "startRuntime",
      "execute",
    ]) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
  });

  it("has no public route, IPC, preload, or UI resolver exposure", () => {
    const publicSource = [
      "modules/contracts/api",
      "modules/contracts/ipc",
      "modules/adapters/transport/api-express",
      "modules/adapters/transport/ipc-electron",
      "apps/desktop/src/preload",
      "apps/desktop/src/renderer",
      "apps/thin-client/src",
      "modules/ui/shared/asset-library",
    ].map(combinedSource).join("\n");

    assert.doesNotMatch(publicSource, /\bresolveAssetDefinition\b/i);
    assert.doesNotMatch(publicSource, /\bresolvedDefinition\b/i);
    assert.doesNotMatch(publicSource, /\/api\/(?:asset-resolver|assets\/resolve|assets\/resolver)/i);
    assert.doesNotMatch(publicSource, /ipc\.asset\.(?:resolve|resolver)/i);
  });
});

describe("asset resolution service with system foundation pack definitions", () => {
  it("resolves a system.foundation definition exactly by definition ref", () => {
    const textFieldEntry = SYSTEM_FOUNDATION_PACK_MANIFEST.assets.find(
      (entry) => entry.definitionRef.id === SYSTEM_TEXT_FIELD_REF.id,
    );
    assert.ok(textFieldEntry);
    const result = resolveAssetDefinition({
      request: {
        requestedRef: textFieldEntry.definitionRef,
        mode: "exact",
        includeTrace: true,
      },
      definitions: SYSTEM_FOUNDATION_PACK_MANIFEST.assets.map((entry) => entry.definition),
      manifests: [SYSTEM_FOUNDATION_PACK_MANIFEST],
    });

    assert.equal(result.resolvedDefinition, textFieldEntry.definition);
    assert.equal(result.resolvedDefinition?.metadata?.sourcePackId, "system.foundation");
  });

  it("resolves a semantic system.foundation request without overrides", () => {
    const textFieldEntry = SYSTEM_FOUNDATION_PACK_MANIFEST.assets.find(
      (entry) => entry.definitionRef.id === SYSTEM_TEXT_FIELD_REF.id,
    );
    assert.ok(textFieldEntry);
    const result = resolveAssetDefinition({
      request: {
        requestedRef: { kind: "asset-definition", id: textFieldEntry.definitionRef.id },
        mode: "semantic",
        allowOverrides: false,
        includeTrace: true,
      },
      definitions: SYSTEM_FOUNDATION_PACK_MANIFEST.assets.map((entry) => entry.definition),
      manifests: [SYSTEM_FOUNDATION_PACK_MANIFEST],
    });

    assert.equal(result.resolvedDefinition, textFieldEntry.definition);
  });

  it("can target a system foundation definition with a fixture override without mutating the original", () => {
    const textFieldEntry = SYSTEM_FOUNDATION_PACK_MANIFEST.assets.find(
      (entry) => entry.definitionRef.id === SYSTEM_TEXT_FIELD_REF.id,
    );
    assert.ok(textFieldEntry);
    const original = structuredClone(textFieldEntry.definition);
    const replacement = definition({
      id: "user.form.text-field",
      sourceLayer: "user-override",
    });
    const result = resolveAssetDefinition({
      request: {
        requestedRef: { kind: "asset-definition", id: textFieldEntry.definitionRef.id },
        mode: "semantic",
        scope: "workspace",
        allowOverrides: true,
        includeTrace: true,
      },
      definitions: [
        ...SYSTEM_FOUNDATION_PACK_MANIFEST.assets.map((entry) => entry.definition),
        replacement,
      ],
      manifests: [SYSTEM_FOUNDATION_PACK_MANIFEST],
      overrideRules: [
        overrideRule({
          ruleId: "workspace.foundation.text-field",
          targetRef: { kind: "asset-definition", id: textFieldEntry.definitionRef.id },
          replacementRef: USER_TEXT_FIELD_REF,
        }),
      ],
    });

    assert.equal(result.resolvedDefinition, replacement);
    assert.deepEqual(textFieldEntry.definition, original);
    assert.equal(textFieldEntry.definition.metadata?.sourcePackId, "system.foundation");
  });

  it("keeps source pack metadata on the resolved foundation definition and has no shipped overrides", () => {
    const result = resolveAssetDefinition({
      request: {
        requestedRef: SYSTEM_FOUNDATION_PACK_MANIFEST.assets[0]!.definitionRef,
        mode: "exact",
        includeTrace: true,
      },
      definitions: SYSTEM_FOUNDATION_PACK_MANIFEST.assets.map((entry) => entry.definition),
      manifests: [SYSTEM_FOUNDATION_PACK_MANIFEST],
    });

    assert.equal(result.resolvedDefinition?.metadata?.sourcePackId, "system.foundation");
    assert.equal(result.resolvedDefinition?.metadata?.sourcePackVersion, "1.0.0");
    assert.deepEqual(SYSTEM_FOUNDATION_PACK_MANIFEST.overrideRules, []);
  });
});
