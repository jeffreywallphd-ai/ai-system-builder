import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ARTIFACT_PROVIDER_ATTEMPT_LIMIT, ARTIFACT_PROVIDER_OBSERVATION_FILE, createFunctionalArtifactProviderTripwire } from "../visual-composer/functional-artifact-provider-tripwire";
import { functionalHostLayout } from "../visual-composer/functional-host-launch-plan.mjs";

const run = "functional-provider-tripwire-20261110", source = "source." + "a".repeat(64);
test("every provider operation refuses without reading or retaining request fields", async () => {
  const guard = createFunctionalArtifactProviderTripwire(process.cwd(), run, source);
  let reads = 0;
  const forbidden = () => { reads++; throw new Error("SYNTHETIC_PRIVATE_REQUEST_CANARY"); };
  const request = new Proxy({}, { get: forbidden, ownKeys: forbidden, getPrototypeOf: forbidden });
  const before = guard.snapshot();
  await assert.rejects(guard.transport.fetchImplementation(request as never, request as never), /Provider transport is disabled/);
  for (const name of ["fileExists", "uploadFile", "downloadFile", "commit"] as const) {
    await assert.rejects(guard.transport.hubClient[name](request as never), /Provider transport is disabled/);
  }
  await assert.rejects(async () => { for await (const _ of guard.transport.hubClient.listFiles(request as never)) assert.fail("Unexpected provider file."); }, /Provider transport is disabled/);
  assert.equal(reads, 0);
  assert.deepEqual(guard.snapshot().attempts, { fetch: 1, fileExists: 1, uploadFile: 1, downloadFile: 1, commit: 1, listFiles: 1 });
  assert.equal(guard.snapshot().total_attempts, 6);
  assert.equal(before.total_attempts, 0);
  assert.equal(JSON.stringify(guard.snapshot()).includes("SYNTHETIC_PRIVATE_REQUEST_CANARY"), false);
  for (const value of [guard, guard.transport, guard.transport.hubClient, before, before.attempts, guard.snapshot()]) assert.ok(Object.isFrozen(value));
  assert.equal(Reflect.set(before.attempts, "fetch", 10), false);
  assert.equal(before.attempts.fetch, 0);
});
test("attempt counts saturate visibly and cannot be reset through snapshots", async () => {
  const guard = createFunctionalArtifactProviderTripwire(process.cwd(), run, source);
  for (let i = 0; i < ARTIFACT_PROVIDER_ATTEMPT_LIMIT + 2; i++) await assert.rejects(guard.transport.fetchImplementation("https://synthetic.invalid"));
  const result = guard.snapshot();
  assert.equal(result.attempts.fetch, ARTIFACT_PROVIDER_ATTEMPT_LIMIT);
  assert.equal(result.total_attempts, ARTIFACT_PROVIDER_ATTEMPT_LIMIT);
  assert.equal(result.limit_reached, true);
  assert.equal(result.qualification_granted, false);
});
test("the fixed observation is bounded, source-bound and exclusive", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "artifact-tripwire-observation-"));
  try {
    const guard = createFunctionalArtifactProviderTripwire(root, run, source);
    const layout = functionalHostLayout(root, run, source);
    await assert.rejects(guard.writeObservation()); // No parent creation or fallback output.
    await mkdir(layout.serverRuntimeRoot, { recursive: true });
    await guard.writeObservation();
    const output = path.join(layout.serverRuntimeRoot, ARTIFACT_PROVIDER_OBSERVATION_FILE);
    const bytes = await readFile(output);
    assert.ok(bytes.length <= 2048);
    const value = JSON.parse(bytes.toString("utf8"));
    assert.deepEqual(value, { ...guard.snapshot(), observation_frontier: "after-awaited-server-shutdown",
      guard_installed: true, server_creation_returned: true, server_shutdown_returned: true });
    assert.equal(value.run_id, run); assert.equal(value.source_revision, source);
    assert.equal(value.total_attempts, 0); assert.equal(value.request_arguments_recorded, false);
    assert.equal(value.controlled_transport_prevented, true); assert.equal(value.qualification_granted, false);
    assert.equal(value.transport_scope, "artifact-hub-and-metadata-fetch");
    assert.equal(value.brokered_retrieval_qualified, false);
    assert.equal(bytes.includes(Buffer.from(root)), false);
    await assert.rejects(guard.writeObservation(), { code: "EEXIST" });
    assert.deepEqual(await readFile(output), bytes);
    await rm(output);
    await writeFile(output, "synthetic-existing-file", { flag: "wx" });
    await assert.rejects(guard.writeObservation(), { code: "EEXIST" });
    assert.equal(await readFile(output, "utf8"), "synthetic-existing-file");
  } finally { await rm(root, { recursive: true }); }
});
test("invalid run and source identifiers cannot select an observation destination", () => {
  for (const [id, revision] of [["../outside", source], [run, "source.not-a-hash"], [run + "\n", source]]) {
    assert.throws(() => createFunctionalArtifactProviderTripwire(process.cwd(), id, revision));
  }
});
