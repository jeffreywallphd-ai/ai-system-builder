import assert from "node:assert/strict";
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {test} from "node:test";
import {assertCurrentContextWorker, startManagedReferenceHost} from "../visual-composer/managed-reference-host";
import {contextLeaseRetirementConfirmed} from "../visual-composer/e2e/headless-context-workflow";

test("Context revoke proof requires affirmative retirement, never an unavailable or denied status", () => {
  for (const value of [{ok: true, value: {kind: "ended"}}, {ok: true, value: {kind: "request", request: {status: "ended"}}}])
    assert.equal(contextLeaseRetirementConfirmed(value), true);
  for (const value of [{}, {ok: false, code: "headless.unavailable"}, {ok: false, code: "headless.forbidden"},
    {ok: false, value: {kind: "ended"}}, {ok: true, value: {kind: "request", request: {status: "active"}}},
    {ok: true, value: {kind: "other", request: {status: "ended"}}}, {ok: true, value: {kind: "request"}}, {ok: true}])
    assert.equal(contextLeaseRetirementConfirmed(value), false);
});

test("Managed Context mode refuses unrelated fixture configurations before allocating an owned host", async () => {
  for (const options of [{headlessContext: true}, {headlessContext: true, headlessAgent: true, headlessBrowser: true},
    {headlessContext: true, headlessAgent: true, headlessPlanReview: true}]) {
    await assert.rejects(startManagedReferenceHost("", options), {name: "AssertionError"});
  }
});

test("Managed Context freshness compares each fixed packaged worker file to its actual source", async () => {
  const base = path.resolve(".local-codex/t"); await mkdir(base, {recursive: true});
  const root = await mkdtemp(path.join(base, "managed-context-freshness-"));
  const names = ["main.py", "models.py", "tasks/context_generation.py", "tasks/context_artifact_operation.py", "tasks/local_text_generation.py"];
  const source = path.join(root, "modules/adapters/runtime/python/worker"), target = path.join(root, "out/ai-system-builder-win32-x64/resources/worker");
  try {
    for (const name of names) {
      for (const folder of [source, target]) {await mkdir(path.dirname(path.join(folder, name)), {recursive: true}); await writeFile(path.join(folder, name), "# fixed synthetic worker\n");}
    }
    await assertCurrentContextWorker(root);
    for (const name of names) {
      await writeFile(path.join(target, name), "# changed\n");
      await assert.rejects(assertCurrentContextWorker(root), /Rebuild the packaged worker/);
      await writeFile(path.join(target, name), "# fixed synthetic worker\n");
    }
    await writeFile(path.join(target, names[0]), Buffer.alloc(1024 ** 2 + 1));
    await assert.rejects(assertCurrentContextWorker(root), {name: "AssertionError"});
  } finally {assert.equal(path.dirname(root), base); await rm(root, {recursive: true});}
});

test("Managed Context keeps installed input opt-in, seeds once and uses independent actual credentials and shutdown", async () => {
  const host = await readFile("dev-tools/scripts/qualification/visual-composer/managed-reference-host.ts", "utf8");
  for (const required of ["options.headlessContext ? async", "!contextSeedReserved", "contextSeedReserved = true",
    "verifyManagedContextFixtureModel", 'workspace.status === "active"', "forOrganization(organizationId)",
    "registry.registerDownloadedModel", "...(options.headlessContext ? {seedContextModel} : {})", "assertCurrentContextWorker(root)"])
    assert.ok(host.includes(required), required);
  assert.ok(host.includes("HF_HOME: environment.HF_HUB_CACHE, TRANSFORMERS_CACHE: environment.HF_HUB_CACHE"));
  const start = host.indexOf("const seedContextModel ="), end = host.indexOf("const common =", start);
  assert.ok(start >= 0 && end > start);
  for (const forbidden of ["saveExecutionApproval", "saveHeadless", "saveContext", "getContextStart", "saveTask"])
    assert.ok(!host.slice(start, end).includes(forbidden));
  const runner = await readFile("dev-tools/scripts/qualification/visual-composer/managed-headless-context.ts", "utf8");
  for (const required of ["headlessContext: true", "fixture.seedContextModel(workspaceId)", "StdioClientTransport",
    "presentation ? agent!.access : agent!.planReview!", "NODE_EXTRA_CA_CERTS: agent!.caFile", 'serviceWorkers: "block"',
    'dataButtonLabel: "Artifacts"', "runHeadlessContextWorkflow", "route.abort()", "await fixture.stop()", "await client.close()",
    "await browser?.close()", 'flag: "wx"', "safeQualificationFailureType"])
    assert.ok(runner.includes(required), required);
  for (const forbidden of ["ignoreHTTPSErrors", "NODE_TLS_REJECT_UNAUTHORIZED", "tracing.start", "page.screenshot", "recordVideo"])
    assert.ok(!runner.includes(forbidden), forbidden);
});
