import assert from "node:assert/strict";
import test from "node:test";
import { ASSET_PACKAGE_DEFAULT_MAX_BYTES } from "../../../../contracts/asset-package";
import { capturePackageInspection, capturePackageAdmission, capturePackageActivation } from "../../../services/asset-package/capture-package-commands";
import { InspectAssetPackageUseCase } from "..";
import { createAisbPackageInspector } from "../../../../adapters/package/aisb";
import { createPackageFixture } from "../../../../testing/fixtures/asset-package-fixture";

const workspaceId = "workspace.snapshots" as never;

test("inspection copies only the supplied Buffer view and ignores its custom iterator", () => {
  const parent = Buffer.from([0, 10, 20, 30, 255]), view = parent.subarray(1, 4);
  let iterated = 0;
  Object.defineProperty(view, Symbol.iterator, { value: () => { iterated++; throw new Error("Caller iterator used"); } });
  const result = capturePackageInspection({ workspaceId, actorId: "author", bytes: view });
  parent.fill(99);
  assert.deepEqual([...result.bytes], [10, 20, 30]);
  assert.equal(iterated, 0);
  assert.notEqual(result.bytes.buffer, parent.buffer);
});

test("inspection admits the existing exact production byte ceiling", () => {
  const bytes = new Uint8Array(ASSET_PACKAGE_DEFAULT_MAX_BYTES);
  bytes[bytes.length - 1] = 42;
  const result = capturePackageInspection({ workspaceId, actorId: "author", bytes });
  assert.equal(result.bytes.byteLength, ASSET_PACKAGE_DEFAULT_MAX_BYTES);
  assert.equal(result.bytes[result.bytes.length - 1], 42);
  assert.notEqual(result.bytes.buffer, bytes.buffer);
});

test("oversized bytes cannot hide their size or reach authorization, inspection, artifacts, IDs or clock", async () => {
  const bytes = new Uint8Array(ASSET_PACKAGE_DEFAULT_MAX_BYTES + 1);
  Object.defineProperty(bytes, "byteLength", { value: 0 });
  let effects = 0;
  const effect = () => { effects++; throw new Error("Protected effect reached"); };
  const port = new Proxy({}, { get: () => effect });
  const useCase = new InspectAssetPackageUseCase({ workspaceAccess: { authorize: effect }, inspector: port, artifacts: port, repository: port, nextInspectionId: effect, now: effect } as any);
  const result = await useCase.execute({ workspaceId, actorId: "author", bytes });
  assert.deepEqual(result, { ok: false, error: { code: "package-inspection-rejected", message: "Package could not be safely quarantined." } });
  assert.equal(effects, 0);
});

for (const bytes of [undefined, null, new DataView(new ArrayBuffer(1)), new Proxy(new Uint8Array([1]), {})]) test(`malformed byte input ${Object.prototype.toString.call(bytes)} is safely refused`, () => {
  assert.throws(() => capturePackageInspection({ workspaceId, actorId: "author", bytes: bytes as any }));
});

test("admission and activation own only their fixed fields and independent consent", () => {
  const approvedCapabilities = ["state:read"];
  const input: any = { workspaceId, actorId: "author", inspectionId: "inspection.original", packageDigest: `sha256:${"a".repeat(64)}`, approvalScope: "workspace", approvedCapabilities, recordId: "package.original", unexpectedAuthority: true };
  const admission = capturePackageAdmission(input), activation = capturePackageActivation(input);
  approvedCapabilities.length = 0; input.workspaceId = "foreign"; input.actorId = "other";
  assert.deepEqual(admission.approvedCapabilities, ["state:read"]);
  assert.equal(admission.workspaceId, workspaceId);
  assert.equal(admission.actorId, "author");
  assert.deepEqual(Object.keys(admission).sort(), ["actorId", "approvalScope", "approvedCapabilities", "inspectionId", "packageDigest", "workspaceId"]);
  assert.deepEqual(activation, { workspaceId, recordId: "package.original", actorId: "author" });
});

test("promoting the default preserves explicitly configured inspector limits, including larger direct-inspector budgets", async () => {
  const fixture = await createPackageFixture();
  const small = await createAisbPackageInspector({ maxPackageBytes: 16 }).inspect({ workspaceId, inspectionId: "small", inspectedAt: "2026-10-27T16:00:00.000Z", bytes: fixture.bytes });
  assert.equal(small.container, undefined);
  assert.ok(small.summary.issues.some(issue => issue.code === "package.size.exceeded"));
  const bytes = Buffer.alloc(ASSET_PACKAGE_DEFAULT_MAX_BYTES + 1, 32);
  bytes.set(fixture.bytes);
  const input = { workspaceId, inspectionId: "large", inspectedAt: "2026-10-27T16:00:00.000Z", bytes };
  const ordinary = await createAisbPackageInspector().inspect(input);
  assert.equal(ordinary.container, undefined);
  assert.ok(ordinary.summary.issues.some(issue => issue.code === "package.size.exceeded"));
  const configured = await createAisbPackageInspector({ maxPackageBytes: bytes.length }).inspect(input);
  assert.ok(configured.container);
  assert.equal(configured.summary.eligibleForAdmission, true);
  assert.ok(!configured.summary.issues.some(issue => issue.code === "package.size.exceeded"));
  assert.throws(() => capturePackageInspection({ ...input, actorId: "author" }), /inspection limit/);
});
