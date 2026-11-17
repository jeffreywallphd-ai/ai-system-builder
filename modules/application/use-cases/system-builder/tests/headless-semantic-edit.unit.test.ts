import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createStructuredSystemBuilderRepository } from "../../../../adapters/persistence/system-builder";
import type { AssetReference } from "../../../../contracts/asset";
import { HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessSemanticEdit } from "../../../../contracts/headless";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { SYSTEM_FOUNDATION_PACK_V3_MANIFEST } from "../../../services/asset-packs/system-packs";
import { ValidateSystemBuilderRevisionService } from "../../../services/system-builder";
import { HeadlessSemanticEditUseCase } from "../headless-semantic-edit.use-case";
import { CreateSystemBuilderSystemUseCase, SaveSystemBuilderRevisionUseCase } from "../system-builder-use-cases";

const host = (() => {
  const value = "41a96fc3-d2b8-4414-bd29-00059badc72d";
  if (!isHeadlessHostIncarnationId(value)) throw new Error("Invalid test host identity");
  return value;
})();
const workspaceId = createWorkspaceId("fixture-headless-workspace");
const actorId = "fixture-actor";
const now = () => "2026-11-13T15:00:00.000Z";
const idempotencyKey = "a6f56324-2051-462c-b45b-d9b49bf6dd4a";
const readExactDefinition = async (reference: AssetReference) =>
  SYSTEM_FOUNDATION_PACK_V3_MANIFEST.assets.map(({ definition }) => definition)
    .find((definition) => definition.definitionId === reference.id && definition.version === reference.version);

async function setup() {
  const repository = createStructuredSystemBuilderRepository(createInMemoryStructuredDocumentStore());
  const validator = new ValidateSystemBuilderRevisionService({ readExactDefinition }, now);
  const dependencies = { repository, validator, now, generateSystemId: () => "fixture-headless" };
  const created = await new CreateSystemBuilderSystemUseCase(dependencies).execute({ workspaceId, name: "Fixture", actorId });
  assert.ok(created.ok);
  const { systemId, currentRevisionId } = created.value;
  assert.ok(currentRevisionId);
  const revision = await repository.readRevision(workspaceId, systemId, currentRevisionId);
  assert.ok(revision);
  assert.equal(created.value.status, "validated");
  const page = revision.instances.find(({ definitionRef }) => definitionRef.id === "builtin.layout.page.single");
  assert.ok(page);
  const save = new SaveSystemBuilderRevisionUseCase(dependencies);
  const flags = { admitted: true, application: true, denyWriteNumber: 0, writes: 0, reads: 0 };
  const service = new HeadlessSemanticEditUseCase({
    systems: { readRecord: (...args) => { flags.reads++; return repository.readRecord(...args); }, readRevision: repository.readRevision },
    access: { async authorize(requested, _operation, scope) {
      if (scope === "asset:write") flags.writes++;
      if (requested !== workspaceId || !flags.application || (scope === "asset:write" && flags.denyWriteNumber === flags.writes)) {
        throw new Error("fixture denied");
      }
    } },
    resolveDefinition: async (requested, reference) => requested === workspaceId ? readExactDefinition(reference) : undefined,
    validator,
    saveRevision: save,
    digest: (input) => createHash("sha256").update(input).digest("hex"),
  });
  const authority = { hostIncarnationId: host, actorId, canUse: async () => flags.admitted };
  const request = (edits: readonly HeadlessSemanticEdit[], base = revision) => ({
    version: HEADLESS_CONTRACT_VERSION,
    operation: "systems.preview-edits",
    input: { workspaceId, systemId, hostIncarnationId: host, baseRecordRevision: base.revisionNumber,
      baseRevisionId: base.revisionId, edits },
  });
  const add = (instanceId: string, order: number, parentInstanceId = page.instanceId): HeadlessSemanticEdit => ({
    kind: "add", instanceId, definitionId: "builtin.ui.container", version: "3.0.0",
    configuration: { label: "Fixture container" }, parentInstanceId, slotId: "content", order,
  });
  const preview = async (candidate: ReturnType<typeof request>) => {
    const result = await service.execute(candidate, authority);
    assert.ok(result.ok, !result.ok ? result.error.code : undefined);
    assert.equal(result.value.kind, "preview");
    return result.value;
  };
  const apply = (candidate: ReturnType<typeof request>, previewDigest: string) => service.execute({
    ...candidate, operation: "systems.apply-edits", input: { ...candidate.input, previewDigest, idempotencyKey },
  }, authority);
  return { repository, service, authority, flags, page, systemId, revision, request, add, preview, apply };
}

test("previews without writes, then applies an exact validated edit batch as one new immutable revision", async () => {
  const fixture = await setup();
  const request = fixture.request([
    fixture.add("fixture.first", 0),
    fixture.add("fixture.second", 1),
    { kind: "configure", instanceId: "fixture.first", values: { label: "First area" } },
    { kind: "move", instanceId: "fixture.second", parentInstanceId: "fixture.first", slotId: "content", order: 0 },
  ]);
  const preview = await fixture.preview(request);
  assert.deepEqual(preview.removedInstanceIds, []);
  assert.deepEqual(await fixture.repository.listRevisions(workspaceId, fixture.systemId), [fixture.revision]);
  const wrong = await fixture.apply(request, "f".repeat(64));
  assert.equal(wrong.ok, false);
  const applied = await fixture.apply(request, preview.previewDigest);
  assert.ok(applied.ok);
  assert.deepEqual(applied.value, { kind: "applied", revisionId: "fixture-headless.r2", recordRevision: 2 });
  const [updated, original] = await fixture.repository.listRevisions(workspaceId, fixture.systemId);
  assert.deepEqual(original, fixture.revision);
  assert.equal(updated.instances.find((item) => item.instanceId === "fixture.first")?.selectedConfiguration?.label, "First area");
  assert.equal(updated.placements?.find((item) => item.childInstanceRef.id === "fixture.second")?.parentInstanceRef.id, "fixture.first");
  const remove = fixture.request([{ kind: "remove", instanceId: "fixture.first" }], updated);
  const removal = await fixture.preview(remove);
  assert.deepEqual(removal.removedInstanceIds, ["fixture.first", "fixture.second"]);
  assert.equal((await fixture.repository.listRevisions(workspaceId, fixture.systemId)).length, 2);
});

test("denies access before reading and denies loss of authority immediately before the commit", async () => {
  const fixture = await setup();
  const request = fixture.request([fixture.add("fixture.denied", 0)]);
  fixture.flags.admitted = false;
  const denied = await fixture.service.execute(request, fixture.authority);
  assert.ok(!denied.ok);
  assert.equal(denied.error.code, "headless.forbidden");
  assert.equal(fixture.flags.reads, 0);
  fixture.flags.admitted = true;
  const preview = await fixture.preview(request);
  fixture.flags.denyWriteNumber = 3;
  const revoked = await fixture.apply(request, preview.previewDigest);
  assert.ok(!revoked.ok);
  assert.equal(revoked.error.code, "headless.forbidden");
  assert.equal(fixture.flags.writes, 3);
  assert.equal((await fixture.repository.listRevisions(workspaceId, fixture.systemId)).length, 1);
});

test("rejects protected structure, unknown definitions, disallowed placement, and a competing save", async () => {
  const fixture = await setup();
  const request = fixture.request([fixture.add("fixture.valid", 0)]);
  for (const edit of [
    { kind: "remove", instanceId: fixture.page.instanceId },
    { ...fixture.add("fixture.missing", 0), version: "9.0.0" },
    { ...fixture.add("fixture.bad-slot", 0), slotId: "missing-slot" },
    { ...fixture.add("fixture.secret", 0), configuration: { apiKey: "fixture" } },
    { ...fixture.add("fixture.unknown", 0), configuration: { unrecognizedSetting: true } },
  ]) {
    const invalid = await fixture.service.execute({ ...request, input: { ...request.input, edits: [edit] } }, fixture.authority);
    assert.ok(!invalid.ok);
    assert.equal(invalid.error.code, "headless.invalid-edit-batch");
  }
  const preview = await fixture.preview(request);
  const concurrent = await Promise.all([fixture.apply(request, preview.previewDigest), fixture.apply(request, preview.previewDigest)]);
  assert.equal(concurrent.filter((result) => result.ok).length, 1);
  const losing = concurrent.find((result) => !result.ok);
  assert.ok(losing && !losing.ok);
  assert.equal(losing.error.code, "headless.stale-revision");
  assert.equal((await fixture.repository.listRevisions(workspaceId, fixture.systemId)).length, 2);
});

test("keeps the first required page protected even after a second page fills the same slot", async () => {
  const fixture = await setup();
  const shell = fixture.revision.placements?.find((edge) => edge.childInstanceRef.id === fixture.page.instanceId);
  assert.ok(shell);
  const request = fixture.request([{
    kind: "add", instanceId: "fixture.second-page", definitionId: "builtin.layout.page.single", version: "3.0.0",
    configuration: { title: "Second page" }, parentInstanceId: shell.parentInstanceRef.id, slotId: shell.slotId, order: 1,
  }]);
  const preview = await fixture.preview(request);
  assert.ok((await fixture.apply(request, preview.previewDigest)).ok);
  const [updated] = await fixture.repository.listRevisions(workspaceId, fixture.systemId);
  const attempt = fixture.request([{ kind: "remove", instanceId: fixture.page.instanceId }], updated);
  const denied = await fixture.service.execute(attempt, fixture.authority);
  assert.ok(!denied.ok);
  assert.equal(denied.error.code, "headless.invalid-edit-batch");
  const optional = await fixture.preview(fixture.request([{ kind: "remove", instanceId: "fixture.second-page" }], updated));
  assert.deepEqual(optional.removedInstanceIds, ["fixture.second-page"]);
});

test("validates connections against the actual exact asset ports and previews their removal", async () => {
  const fixture = await setup();
  const add = (instanceId: string, order: number) => ({
    ...fixture.add(instanceId, order), definitionId: "builtin.ui.collapsible-section", configuration: {},
  } as HeadlessSemanticEdit);
  const connect = { kind: "connect", bindingId: "fixture.event", bindingKind: "event",
    sourceInstanceId: "fixture.source", sourcePortId: "expanded-state-changed",
    targetInstanceId: "fixture.target", targetPortId: "expanded-state-changed" } as const;
  const parents = [add("fixture.source", 0), add("fixture.target", 1)];
  const incompatible = await fixture.service.execute(
    fixture.request([...parents, { ...connect, targetPortId: "children" }]), fixture.authority,
  );
  assert.ok(!incompatible.ok);
  assert.equal(incompatible.error.code, "headless.invalid-edit-batch");
  const request = fixture.request([...parents, connect]);
  const preview = await fixture.preview(request);
  assert.ok((await fixture.apply(request, preview.previewDigest)).ok);
  const [updated] = await fixture.repository.listRevisions(workspaceId, fixture.systemId);
  assert.equal(updated.bindings[0]?.bindingId, "fixture.event");
  const remove = await fixture.preview(fixture.request([{ kind: "remove", instanceId: "fixture.source" }], updated));
  assert.deepEqual(remove.removedBindingIds, ["fixture.event"]);
  assert.equal((await fixture.repository.readRevision(workspaceId, fixture.systemId, updated.revisionId))?.bindings.length, 1);
});
