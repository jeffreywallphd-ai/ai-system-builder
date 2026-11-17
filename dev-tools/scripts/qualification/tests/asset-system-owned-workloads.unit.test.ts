import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCatalogWorkload } from "../asset-system-catalog-workload";
import { createCoreWorkloads } from "../asset-system-core-workloads";
import { createReleaseWorkloads } from "../asset-system-release-workloads";
import { createVerifiedMemoryArtifactSink, fixtureWorkspace } from "../asset-system-workload-fixtures";

test("owned probes exercise declared production workloads and fail on exhausted runtime fixtures", async () => {
  const catalog = await createCatalogWorkload(await mkdtemp(path.join(tmpdir(), "owned-catalog-")));
  await catalog();
  for (const run of Object.values(await createCoreWorkloads())) await run();
  const release = await createReleaseWorkloads(1);
  await release["system.preview"](); await release["runtime.handoff"]();
  await assert.rejects(release["runtime.handoff"](), /exhausted/);
});

test("fixture sink verifies immutable content, byte counts and expected digests", async () => {
  const sink = createVerifiedMemoryArtifactSink();
  const descriptor = await sink.port.putImmutable({workspaceId: fixtureWorkspace, kind: "manifest", mediaType: "application/json", content: "{}"});
  assert.equal(new TextDecoder().decode(await sink.port.readVerified(fixtureWorkspace, descriptor)), "{}");
  await assert.rejects(sink.port.putImmutable({workspaceId: fixtureWorkspace, kind: "manifest", mediaType: "application/json", content: "changed", expectedDigest: descriptor.digest}));
  sink.contents.set(descriptor.digest, new TextEncoder().encode("tampered"));
  await assert.rejects(sink.port.readVerified(fixtureWorkspace, descriptor));
});
