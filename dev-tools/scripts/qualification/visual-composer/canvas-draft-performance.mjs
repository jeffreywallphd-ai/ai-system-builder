import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertAssetSystemSourceIdentity, readAssetSystemSourceIdentity } from "../asset-system-source-identity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
// Capture before evaluating measured implementation code; changes during module
// loading must not bind stale loaded code to a newer on-disk source identity.
const sourceRevision = await readAssetSystemSourceIdentity(root);
const {
  addSystemComposerAsset, buildSystemComposerTree, commitSystemComposerDraft,
  createSystemComposerDraftHistory, flattenSystemComposerTree,
  redoSystemComposerDraft, reparentSystemComposerAsset, undoSystemComposerDraft,
} = await import("../../../../modules/ui/shared/system-builder/systemComposerDraft.ts");
await assertAssetSystemSourceIdentity(root, sourceRevision);
const counts = [50, 200, 500];
const definitionIds = ["builtin.ui.card", "builtin.form.text-field", "builtin.display.status-badge", "builtin.display.progress-indicator"];
const reference = id => ({ kind: "asset-instance", id });

/** Fixed synthetic broad tree. This measures draft algorithms, not release validity or UI paint. */
export function canvasPerformanceFixture(count) {
  if (!counts.includes(count)) throw new Error("Choose a fixed qualified workload size.");
  const instances = Array.from({ length: count }, (_, index) => ({
    instanceId: `instance.measure.${index}`, definitionRef: { kind: "asset-definition-version", id: definitionIds[index % definitionIds.length], version: "3.0.0" },
    displayName: `Synthetic component ${index}`, lifecycleStatus: "draft",
    selectedConfiguration: { title: `Synthetic ${index}`, enabled: true }, provenance: { sourceKind: "human-authored" },
  }));
  const placements = instances.slice(1).map((instance, index) => ({
    schemaVersion: "asset-placement.v1", placementId: `placement.measure.${index + 1}`,
    parentInstanceRef: reference(index < 5 ? instances[0].instanceId : instances[1 + index % 5].instanceId),
    childInstanceRef: reference(instance.instanceId), slotId: "content", order: index < 5 ? index : Math.floor((index - 5) / 5),
  }));
  return { instances, placements, bindings: [] };
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { samples: sorted.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1] };
}

export function measureCanvasDraftOperations() {
  return counts.map(count => {
    const fixture = canvasPerformanceFixture(count);
    assert.equal(flattenSystemComposerTree(buildSystemComposerTree(fixture, [reference(fixture.instances[0].instanceId)])).length, count);
    const timings = { edit: [], undo: [], redo: [], add: [], move: [], tree: [] };
    for (let round = -2; round < 7; round += 1) {
      let history = createSystemComposerDraftHistory(fixture);
      const time = (operation, action) => {
        const start = performance.now(); action();
        if (round >= 0) timings[operation].push(performance.now() - start);
      };
      for (let edit = 0; edit < 30; edit += 1) {
        time("edit", () => { history = commitSystemComposerDraft(history, {
          ...history.present, instances: history.present.instances.map((instance, index) => index === count - 1 ? { ...instance, selectedConfiguration: { title: `Edit ${edit}`, enabled: true } } : instance),
        }); });
      }
      assert.equal(history.present.instances[count - 1].selectedConfiguration.title, "Edit 29");
      for (let edit = 0; edit < 30; edit += 1) time("undo", () => { history = undoSystemComposerDraft(history); });
      assert.deepEqual(history.present, fixture);
      for (let edit = 0; edit < 30; edit += 1) time("redo", () => { history = redoSystemComposerDraft(history); });
      assert.equal(history.present.instances[count - 1].selectedConfiguration.title, "Edit 29");
      const original = history.present;
      for (let iteration = 0; iteration < 30; iteration += 1) {
        time("tree", () => { assert.equal(flattenSystemComposerTree(buildSystemComposerTree(original, [reference(fixture.instances[0].instanceId)])).length, count); });
        time("add", () => {
          const result = addSystemComposerAsset(original, { asset: { definitionRef: fixture.instances[2].definitionRef, definitionId: definitionIds[1], displayName: "Synthetic field" }, compositionId: "composition.measure", parentInstanceId: fixture.instances[1].instanceId, slotId: "content", instanceId: "instance.measure.new" });
          assert.equal(result.ok, true); assert.equal(result.value.instances.length, count + 1);
          const changed = commitSystemComposerDraft(history, result.value);
          assert.equal(changed.present.instances.length, count + 1);
        });
        time("move", () => {
          const result = reparentSystemComposerAsset(original, { instanceId: fixture.instances[count - 1].instanceId, parentInstanceId: fixture.instances[0].instanceId, slotId: "content", order: 1 });
          assert.equal(result.ok, true);
          const changed = commitSystemComposerDraft(history, result.value);
          const placement = changed.present.placements.find(item => item.childInstanceRef.id === fixture.instances[count - 1].instanceId);
          assert.equal(placement.parentInstanceRef.id, fixture.instances[0].instanceId); assert.equal(placement.order, 1);
        });
      }
    }
    return { instanceCount: count, warmupRounds: 2, measuredRounds: 7, operations: Object.fromEntries(Object.entries(timings).map(([key, values]) => [key, summarize(values)])) };
  });
}

async function main() {
  const label = process.argv[2];
  if (process.argv.length !== 3 || !["baseline", "candidate"].includes(label)) throw new Error("Use baseline or candidate; output location is fixed.");
  await assertAssetSystemSourceIdentity(root, sourceRevision);
  const measurements = measureCanvasDraftOperations();
  await assertAssetSystemSourceIdentity(root, sourceRevision);
  const record = { schemaVersion: "canvas-draft-performance-v1", label, environmentId: `local-${process.platform}-${process.arch}-node${process.versions.node}`, sourceRevision,
    harnessDigest: createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex"),
    measuredAt: new Date().toISOString(), evidenceKind: "local-production-draft-algorithms-not-browser-paint", measurements };
  const folder = path.join(root, "artifacts/qualification/visual-composer/performance");
  await mkdir(folder, { recursive: true });
  const filename = `${label}-${Date.now()}-${sourceRevision.slice(7, 19)}.json`;
  await writeFile(path.join(folder, filename), JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ artifact: `artifacts/qualification/visual-composer/performance/${filename}`, measurements }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
