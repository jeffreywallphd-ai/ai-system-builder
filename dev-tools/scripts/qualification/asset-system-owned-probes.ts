import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCatalogWorkload } from "./asset-system-catalog-workload";
import { createCoreWorkloads } from "./asset-system-core-workloads";
import { createReleaseWorkloads } from "./asset-system-release-workloads";
// The CLI captures this snapshot before importing workload modules and rechecks after timing.
import { readAssetSystemSourceIdentity } from "./asset-system-source-identity.mjs";

/** Preparation is excluded from timing; every operation asserts its real result. */
export async function createQualificationProbeSet(context?: {sourceRevision: string}) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const sourceRevision = context?.sourceRevision ?? await readAssetSystemSourceIdentity(root);
  const scratchParent = path.join(root, ".local-codex", "t");
  await mkdir(scratchParent, {recursive: true});
  const scratch = await mkdtemp(path.join(scratchParent, "asset-probe-"));
  return {
    environmentId: `local-${process.platform}-node${process.versions.node.split(".")[0]}-fixture`,
    sourceRevision,
    iterations: 30, warmupIterations: 5,
    probes: {"catalog.browse": await createCatalogWorkload(scratch), ...await createCoreWorkloads(), ...await createReleaseWorkloads(35)},
  };
}
