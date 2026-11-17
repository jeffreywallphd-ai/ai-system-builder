import assert from "node:assert/strict";
import test from "node:test";
import { InspectAssetPackageUseCase, AdmitAssetPackageUseCase, ActivateAssetPackageUseCase, DisableAssetPackageUseCase, RollbackAssetPackageUseCase, ListAssetPackagesUseCase } from "..";

const workspaceId = "workspace.package-test";
const at = "2026-10-27T16:00:00.000Z";
const digest = `sha256:${"a".repeat(64)}`;
const signal = () => {
  let resolve!: () => void;
  return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
};

for (const operation of ["inspect", "admit", "activate", "disable", "rollback", "list"] as const) {
  for (const mode of ["absent", "throwing", "denied"] as const) {
    test(`${operation}: ${mode} workspace authority denies before protected effects`, async () => {
      let effects = 0, admissions = 0;
      const effect = () => { effects++; throw new Error("Protected effect reached"); };
      const repository = new Proxy({}, { get: () => effect });
      const policy = mode === "absent" ? undefined : { async authorize(owner: string, name: string, scope: string) {
        admissions++;
        assert.equal(owner, workspaceId);
        assert.equal(name, `asset-package.${operation}`);
        assert.equal(scope, operation === "list" ? "asset:read" : "asset:write");
        throw new Error(mode === "throwing" ? "private policy detail" : "denied");
      } };
      const options: any = { workspaceAccess: policy, inspector: repository, repository, packages: repository, artifacts: repository, trust: repository, definitions: repository, implementations: repository, backingResources: repository, nextInspectionId: effect, now: effect };
      const command: any = { workspaceId, recordId: "package.original", inspectionId: "inspection.original", actorId: "original-actor", packageDigest: digest, approvalScope: "workspace", approvedCapabilities: [], bytes: new Uint8Array([1, 2, 3]) };
      let useCase: any;
      if (operation === "inspect") useCase = new InspectAssetPackageUseCase(options);
      if (operation === "admit") useCase = new AdmitAssetPackageUseCase(options);
      if (operation === "activate") useCase = new ActivateAssetPackageUseCase(repository as any, repository as any, effect, policy as any);
      if (operation === "disable") useCase = new DisableAssetPackageUseCase(repository as any, repository as any, effect, policy as any);
      if (operation === "rollback") useCase = new RollbackAssetPackageUseCase(repository as any, repository as any, policy as any);
      if (operation === "list") useCase = new ListAssetPackagesUseCase(repository as any, policy as any);
      if (operation === "list") await assert.rejects(useCase.execute(workspaceId), /Workspace asset access is unavailable or forbidden/);
      else {
        const result = await useCase.execute(command);
        assert.equal(result.ok, false);
        assert.equal(result.error.code, "package-workspace-forbidden");
        assert.equal(result.error.message, "Workspace asset access is unavailable or forbidden.");
        assert.ok(!JSON.stringify(result).includes("private policy detail"));
      }
      assert.equal(effects, 0);
      assert.equal(admissions, mode === "absent" ? 0 : 1);
    });
  }
}

test("inspect owns workspace, actor and Buffer bytes across authorization and inspection waits", async () => {
  const admitted = signal(), allow = signal(), inspecting = signal(), finishInspection = signal();
  const effects: string[] = [], inspected: any[] = [], stored: any[] = [], saved: any[] = [];
  const bytes = Buffer.from([10, 20, 30]);
  const command: any = { workspaceId, actorId: "original-actor", bytes };
  const useCase = new InspectAssetPackageUseCase({
    workspaceAccess: { async authorize(owner, name, scope) { assert.equal(owner, workspaceId); assert.equal(name, "asset-package.inspect"); assert.equal(scope, "asset:write"); admitted.resolve(); await allow.promise; } },
    nextInspectionId: () => { effects.push("id"); return "inspection.original"; }, now: () => { effects.push("clock"); return at; },
    inspector: { async inspect(input: any) { effects.push("inspect"); inspected.push({ ...input, bytes: [...input.bytes] }); inspecting.resolve(); await finishInspection.promise; return { container: {}, entries: [], summary: { issues: [], inspectionId: input.inspectionId } } as any; } },
    artifacts: { async putImmutable(input: any) { stored.push({ ...input, content: [...input.content] }); return { artifactId: "artifact.test", digest, sizeBytes: input.content.byteLength }; } } as any,
    repository: { async saveInspection(input: any) { saved.push(input); } } as any,
  });
  const pending = useCase.execute(command);
  try {
    await admitted.promise;
    assert.deepEqual(effects, []);
    command.workspaceId = "workspace.foreign"; command.actorId = "changed-actor"; command.bytes = Buffer.from([99]); bytes.fill(88);
    allow.resolve(); await inspecting.promise;
    bytes.fill(77); command.workspaceId = "workspace.other";
    finishInspection.resolve();
    assert.equal((await pending).ok, true);
    assert.equal(inspected[0].workspaceId, workspaceId);
    assert.deepEqual(inspected[0].bytes, [10, 20, 30]);
    assert.equal(stored[0].workspaceId, workspaceId);
    assert.deepEqual(stored[0].content, [10, 20, 30]);
    assert.equal(saved[0].workspaceId, workspaceId);
    assert.equal(saved[0].createdBy, "original-actor");
  } finally { allow.resolve(); finishInspection.resolve(); await pending; }
});

test("admit owns identity, digest, scope, actor and capability consent across policy and repository waits", async () => {
  const admitted = signal(), allow = signal(), reading = signal(), finishRead = signal();
  const consent = ["needed"], reads: any[] = [], saves: any[] = [], listed: any[] = [];
  const command: any = { workspaceId, inspectionId: "inspection.original", packageDigest: digest, approvalScope: "workspace", approvedCapabilities: consent, actorId: "original-actor" };
  const inspection: any = { summary: { packageDigest: digest, inspectedAt: at }, artifact: { artifactId: "artifact.test", digest, sizeBytes: 1, mediaType: "application/octet-stream" } };
  const useCase = new AdmitAssetPackageUseCase({
    workspaceAccess: { async authorize(owner, name, scope) { assert.equal(owner, workspaceId); assert.equal(name, "asset-package.admit"); assert.equal(scope, "asset:write"); admitted.resolve(); await allow.promise; } },
    packages: { async readInspection(...args: any[]) { reads.push(args); reading.resolve(); await finishRead.promise; return inspection; }, async listPackages(owner: string) { listed.push(owner); return []; }, async savePackage(value: any) { saves.push(value); return value; } } as any,
    artifacts: { async readVerified(owner: string) { assert.equal(owner, workspaceId); return new Uint8Array([1]); } } as any,
    inspector: { async inspect(input: any) { assert.equal(input.workspaceId, workspaceId); assert.equal(input.inspectionId, "inspection.original"); return { summary: { packageDigest: digest, eligibleForAdmission: true, requestedCapabilities: ["needed"] }, entries: [], container: { manifest: { packageId: "package.test", version: "1.0.0", displayName: "Capture fixture", requestedCapabilities: ["needed"], semanticManifest: { assets: [] }, implementations: [] } } }; } } as any,
    trust: { async verify() { return { provenanceStatus: "verified", sbomStatus: "verified", signatureStatus: "unsigned" }; } } as any,
    definitions: {} as any, implementations: {} as any, backingResources: {} as any, now: () => at,
  });
  const pending = useCase.execute(command);
  try {
    await admitted.promise;
    command.workspaceId = "workspace.foreign"; command.inspectionId = "inspection.changed"; command.packageDigest = `sha256:${"b".repeat(64)}`; command.approvalScope = "organization"; command.actorId = "changed-actor"; consent[0] = "other";
    allow.resolve(); await reading.promise;
    consent.length = 0; command.workspaceId = "workspace.other";
    finishRead.resolve();
    const result = await pending;
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(reads, [[workspaceId, "inspection.original"]]);
    assert.deepEqual(listed, [workspaceId]);
    assert.equal(saves.length, 1);
    assert.equal(saves[0].workspaceId, workspaceId);
    assert.equal(saves[0].packageDigest, digest);
    assert.equal(saves[0].admittedBy, "original-actor");
    assert.equal(saves[0].trustLevel, "workspace-approved");
  } finally { allow.resolve(); finishRead.resolve(); await pending; }
});

for (const operation of ["activate", "disable", "rollback"] as const) test(`${operation} owns workspace, record and actor across policy and repository waits`, async () => {
  const admitted = signal(), allow = signal(), reading = signal(), finishRead = signal();
  const reads: any[] = [], writes: any[] = [], delegated: any[] = [];
  const command: any = { workspaceId, recordId: "package.original", actorId: "original-actor" };
  const policy = { async authorize(owner: string, name: string, scope: string) { assert.equal(owner, workspaceId); assert.equal(name, `asset-package.${operation}`); assert.equal(scope, "asset:write"); admitted.resolve(); await allow.promise; } };
  const record = { workspaceId, recordId: "package.original", packageId: "package.test", status: "installed", revision: 1, previousActiveRecordId: "package.previous" };
  const packages: any = { async readPackage(...args: any[]) { reads.push(args); reading.resolve(); await finishRead.promise; return record; }, async listPackages(owner: string) { assert.equal(owner, workspaceId); return []; }, async updatePackage(next: any, revision: number) { writes.push({ next, revision }); return next; } };
  const implementations: any = { async listReleases(owner: string) { assert.equal(owner, workspaceId); return []; }, async listBindings(owner: string) { assert.equal(owner, workspaceId); return []; } };
  const useCase = operation === "activate" ? new ActivateAssetPackageUseCase(packages, implementations, () => at, policy as any) : operation === "disable" ? new DisableAssetPackageUseCase(packages, implementations, () => at, policy as any) : new RollbackAssetPackageUseCase(packages, { async execute(next: any) { delegated.push(next); return { ok: true, value: record }; } } as any, policy as any);
  const pending = useCase.execute(command);
  try {
    await admitted.promise;
    command.workspaceId = "workspace.foreign"; command.recordId = "package.changed"; command.actorId = "changed-actor";
    allow.resolve(); await reading.promise;
    command.workspaceId = "workspace.other"; command.actorId = "later-actor";
    finishRead.resolve();
    assert.equal((await pending).ok, true);
    assert.deepEqual(reads, [[workspaceId, "package.original"]]);
    if (operation === "rollback") assert.deepEqual(delegated, [{ workspaceId, recordId: "package.previous", actorId: "original-actor" }]);
    else {
      assert.equal(writes.length, 1);
      assert.equal(writes[0].next.workspaceId, workspaceId);
      assert.equal(writes[0].next.recordId, "package.original");
      assert.equal(writes[0].revision, 1);
      assert.equal(writes[0].next.status, operation === "activate" ? "active" : "disabled");
      if (operation === "activate") assert.equal(writes[0].next.activatedBy, "original-actor");
    }
  } finally { allow.resolve(); finishRead.resolve(); await pending; }
});
