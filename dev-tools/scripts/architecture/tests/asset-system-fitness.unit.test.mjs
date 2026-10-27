import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  findAdmissionDriftViolations,
  findAssetSystemFitnessViolations,
  findExecutableMetadataViolations,
  findRendererBoundaryViolations,
  findRequiredAnchorViolations,
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

test("multiline admission anchors accept Windows line endings while detecting value drift", () => {
  const target = "modules/application/services/system-review/release-bound-system-review-definition.service.ts";
  const files = new Map([[target, "1,\r\n        200\r\n1_024,\r\n        8_388_608"]]);
  assert.deepEqual(findRequiredAnchorViolations(files).filter(item => item.path === target), []);
  files.set(target, "1,\r\n        201\r\n1_024,\r\n        8_388_608");
  assert.equal(findRequiredAnchorViolations(files).filter(item => item.path === target).length, 1);
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

const packageContractPath = "modules/contracts/asset-package/asset-package-contracts.ts";
const packageInspectorPath = "modules/adapters/package/aisb/createAisbPackageInspector.ts";
const packageAnchors = files => findRequiredAnchorViolations(files).filter(item => [packageContractPath, packageInspectorPath].includes(item.path));
const packageSources = () => new Map([packageContractPath, packageInspectorPath].map(name => [name, readFileSync(path.resolve(repoRoot, name), "utf8")]));

test("package upload fitness pins the shared 32 MiB value and rejects declaration drift", () => {
  const files = packageSources();
  assert.deepEqual(packageAnchors(files), []);
  files.set(packageContractPath, files.get(packageContractPath).replace("ASSET_PACKAGE_DEFAULT_MAX_BYTES = 32 * 1024 * 1024", "ASSET_PACKAGE_DEFAULT_MAX_BYTES = 64 * 1024 * 1024"));
  assert.ok(packageAnchors(files).some(item => item.path === packageContractPath && item.rule === "admission-source-drift"));
  files.delete(packageContractPath);
  assert.ok(packageAnchors(files).some(item => item.path === packageContractPath));
});

test("package upload fitness rejects a different inspector default binding", () => {
  const binding = "maxPackageBytes: ASSET_PACKAGE_DEFAULT_MAX_BYTES";
  const contractImport = 'import { ASSET_PACKAGE_DEFAULT_MAX_BYTES } from "../../../contracts/asset-package";';
  for (const [original, replacement] of [[binding, "maxPackageBytes: 64 * 1024 * 1024"], [binding, "maxPackageBytes: OTHER_UPLOAD_BUDGET"], [contractImport, contractImport.replace("/asset-package", "/asset")], [contractImport, ""]]) {
    const files = packageSources();
    files.set(packageInspectorPath, files.get(packageInspectorPath).replace(original, replacement));
    assert.ok(packageAnchors(files).some(item => item.path === packageInspectorPath && item.rule === "admission-source-drift"));
  }
});
