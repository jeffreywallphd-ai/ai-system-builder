import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  findAdmissionDriftViolations,
  findAssetSystemFitnessViolations,
  findExecutableMetadataViolations,
  findRendererBoundaryViolations,
  findRoutePolicyViolations,
} from "../check-asset-system-fitness.mjs";
import { readAssetSystemQualificationConfig } from "../../qualification/asset-system-qualification-core.mjs";

const repoRoot = process.cwd();
const config = readAssetSystemQualificationConfig(
  path.resolve(repoRoot, "dev-tools/config/asset-system-qualification.json"),
);

test("asset/system architecture fitness passes the current production tree", () => {
  assert.deepEqual(findAssetSystemFitnessViolations({ repoRoot }), []);
});

test("fitness rules detect executable metadata and renderer access to privileged layers", () => {
  assert.equal(
    findExecutableMetadataViolations(
      new Map([
        [
          "modules/contracts/asset/malicious.ts",
          "export interface Bad { readonly executableBytes: Uint8Array }",
        ],
      ]),
    )[0]?.rule,
    "executable-metadata",
  );
  assert.equal(
    findRendererBoundaryViolations(
      new Map([
        [
          "apps/desktop/src/renderer/feature.ts",
          'import { adapter } from "../../../../modules/adapters/example";',
        ],
      ]),
    )[0]?.rule,
    "renderer-boundary",
  );
});

test("fitness rules detect missing route policy and admission-limit drift", () => {
  const routes = new Map([
    [
      "modules/adapters/transport/api-express/system-build/register.ts",
      'app.post("/api/systems/unprotected", handler);',
    ],
    [
      "modules/adapters/transport/api-express/security/apiRouteSecurityPolicy.ts",
      "export const policies = [];",
    ],
  ]);
  assert.equal(findRoutePolicyViolations(routes)[0]?.rule, "route-policy");
  const changed = {
    ...config,
    admissionControls: config.admissionControls.map((control) =>
      control.id === "execution"
        ? {
            ...control,
            limits: { ...control.limits, maximumConcurrentRuns: 5 },
          }
        : control,
    ),
  };
  assert.equal(
    findAdmissionDriftViolations(changed)[0]?.rule,
    "admission-drift",
  );
});
