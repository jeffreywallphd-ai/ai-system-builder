import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {lstat, mkdir, mkdtemp, realpath, rm, readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test, {type TestContext} from "node:test";
import ts from "typescript";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {createOrganizationId} from "../../../../contracts/organization";
import {readModelDownloadSource} from "../../../../contracts/model";
import {OwnedTaskReconcilerService} from "../../../../application/services/runtime/owned-task-reconciler.service";
import {createPythonRuntimeAdapterFoundation, resolveConfiguredModelCacheRoot} from "../../../../adapters/runtime/python";
import {composeDesktopRuntimeTaskFeature} from "../../../desktop/composition/composeDesktopRuntimeTaskFeature";
import {composeDesktopModelFeature} from "../../../desktop/composition/composeDesktopModelFeature";

const workspaceId = createWorkspaceId("workspace.source-host"), revision = "a".repeat(40), modelId = "fixture/model";
function request() {
  const source = readModelDownloadSource({provider: "huggingface", modelId, revision, format: "transformers-safetensors", license: {kind: "unknown"},
    files: ["config.json", "model.safetensors", "tokenizer.json"].map(name => ({path: name, sizeBytes: 2,
      integrity: name.endsWith("safetensors") ? {algorithm: "sha256", digest: "b".repeat(64)} : {algorithm: "git-blob-sha1", digest: "c".repeat(40)}})),
    totalBytes: 6, excludedFileCount: 0, sourceVerification: "provider-metadata", bytesVerification: "not-checked", runtimeReadiness: "not-checked"},
    {provider: "huggingface", modelId, revision});
  return {requestId: "11111111-1111-4111-8111-111111111111", workspaceId,
    sourceManifest: {source, manifestDigest: "sha256:" + createHash("sha256").update(JSON.stringify(source)).digest("hex")},
    maximumDurationSeconds: 10, allowedOrigins: ["https://huggingface.co"]};
}
async function temporary(t: TestContext) {
  const boundary = await realpath(tmpdir()), base = await mkdtemp(path.join(boundary, "model-source-host-"));
  const before = await lstat(base, {bigint: true});
  t.after(async () => {
    const after = await lstat(base, {bigint: true}); assert.equal(path.dirname(base), boundary); assert.equal(await realpath(base), base);
    assert.ok(after.isDirectory() && !after.isSymbolicLink()); assert.equal(after.dev, before.dev); assert.equal(after.ino, before.ino);
    await rm(base, {recursive: true});
  });
  return base;
}

test("source storage configuration captures the original runtime cache without filesystem, worker or installer effects", async t => {
  const base = await temporary(t), cacheRoot = path.join(base, "captured-cache"), environment = {HF_HUB_CACHE: cacheRoot};
  let spawns = 0, factories = 0, observed = "";
  const foundation = createPythonRuntimeAdapterFoundation({client: {baseUrl: "http://127.0.0.1:43111"},
    supervisor: {command: "synthetic-python", env: environment, spawnImplementation: (() => {spawns++; assert.fail("No source configuration spawn.");}) as never}});
  environment.HF_HUB_CACHE = path.join(base, "changed-cache");
  const config = foundation.createModelSourceDownloadConfiguration(root => {factories++; observed = root;
    return {async storeGeneratedModel() {assert.fail("No source configuration store.");}};});
  assert.equal(observed, cacheRoot); assert.equal(config.cacheRoot, cacheRoot); assert.equal(factories, 1); assert.equal(spawns, 0);
  assert.ok(Object.isFrozen(config)); assert.doesNotMatch(JSON.stringify(foundation), /captured-cache/);
  await assert.rejects(config.captureSession()); assert.equal(spawns, 0); await assert.rejects(lstat(cacheRoot), {code: "ENOENT"});
});

test("runtime cache aliases use the worker/storage precedence and deny relative configured roots", async t => {
  const base = await temporary(t), first = path.join(base, "first"), alias = path.join(base, "alias"), legacy = path.join(base, "legacy");
  assert.equal(resolveConfiguredModelCacheRoot({HF_HUB_CACHE: first, HUGGINGFACE_HUB_CACHE: alias, TRANSFORMERS_CACHE: legacy}), first);
  assert.equal(resolveConfiguredModelCacheRoot({HUGGINGFACE_HUB_CACHE: alias, TRANSFORMERS_CACHE: legacy}), alias);
  assert.equal(resolveConfiguredModelCacheRoot({TRANSFORMERS_CACHE: legacy}), legacy);
  assert.throws(() => resolveConfiguredModelCacheRoot({HUGGINGFACE_HUB_CACHE: "relative-cache"}), /absolute/);
});

test("Desktop source port uses captured storage and only installed readiness; missing support does not fall back", async t => {
  for (const configured of [false, true]) {
    const base = await temporary(t), cacheRoot = path.join(base, "cache"); await mkdir(cacheRoot);
    const reconciler = new OwnedTaskReconcilerService(); t.after(() => reconciler.stopObservation());
    let installed = 0, ordinary = 0, captured = 0, composed = 0;
    const foundation = {runtimePort: {}, bindHostAdmission() {}, supervisor: {async start() {ordinary++;}, async startWithoutInstalling() {installed++;}},
      ...(configured ? {createModelSourceDownloadConfiguration(factory: (root: string) => unknown) {
        composed++; return {cacheRoot, storage: factory(cacheRoot), async captureSession() {captured++; throw new Error("Synthetic unavailable original worker.");}};
      }} : {})};
    const feature = await composeDesktopRuntimeTaskFeature({pythonRuntimeFoundation: foundation, taskReconciler: reconciler,
      imageRuntimeTaskRegistry: {}, runtimeReadiness: {}});
    assert.equal((await feature.modelSourceDownloadPort.startApprovedModelSource(request(), {isCurrent: () => true, stillAllowed: async () => true})).kind, "unavailable");
    assert.equal(ordinary, 0); assert.equal(installed, configured ? 1 : 0); assert.equal(captured, configured ? 1 : 0); assert.equal(composed, configured ? 1 : 0);
    await assert.rejects(lstat(path.join(cacheRoot, ".aisb-model-source-transfers")), {code: "ENOENT"});
  }
});

test("Desktop Model application lazily forwards only the internal source port after its ACK", async t => {
  const base = await temporary(t), reconciler = new OwnedTaskReconcilerService(); t.after(() => reconciler.stopObservation());
  const events: string[] = [];
  const source = request();
  const feature = composeDesktopModelFeature({storageRootDirectory: base, now: () => "2026-11-19T00:00:00Z", taskReconciler: reconciler,
    tokenProvider: () => {assert.fail("No source-admission credential discovery.");},
    getArtifacts: async () => {assert.fail("No source-admission artifact initialization.");},
    getPythonRuntimeFoundation: async () => {assert.fail("No ordinary runtime fallback.");},
    getRuntimeTaskFeatures: async () => {events.push("runtime-features"); return {modelSourceDownloadPort: {
      async startApprovedModelSource(actual: unknown, control: {isCurrent: () => boolean}) {events.push("source-port");
        assert.deepEqual(actual, source); assert.equal(control.isCurrent(), true); return {kind: "unavailable"};},
    }};}});
  assert.equal(events.length, 0);
  assert.equal((await feature.modelDownloadTasksUseCase.startApprovedSource({workspaceId, provider: "huggingface", modelId, revision},
    {source, control: {isCurrent: () => true, stillAllowed: async () => true}, acknowledgeIssued: async () => {events.push("ack"); return true;}},
    {organizationId: createOrganizationId("org.source-host"), principalId: "principal.source-host", modelWriteAuthorized: true})).kind, "unavailable");
  assert.deepEqual(events, ["ack", "runtime-features", "source-port"]); assert.equal(reconciler.status.pending, 0);
});

test("both production host sources bind the captured cache into existing storage and the Model application port", async () => {
  for (const relative of ["modules/hosts/desktop/composition/composeDesktopRuntimeTaskFeature.ts", "modules/hosts/server/composition/composeServerHost.ts"]) {
    const text = await readFile(relative, "utf8"), source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true);
    const calls: ts.CallExpression[] = [];
    const visit = (node: ts.Node) => {if (ts.isCallExpression(node) && node.expression.getText(source).endsWith(".createModelSourceDownloadConfiguration")) calls.push(node);
      ts.forEachChild(node, visit);}; visit(source);
    assert.equal(calls.length, 1);
    const argument = calls[0]!.arguments[0]; assert.ok(argument && ts.isArrowFunction(argument));
    const body = argument.body; assert.ok(ts.isCallExpression(body));
    assert.equal(body.expression.getText(source), "createLocalGeneratedModelStorageAdapter");
    const config = body.arguments[0]; assert.ok(config && ts.isObjectLiteralExpression(config));
    const env = config.properties.find(value => ts.isPropertyAssignment(value) && value.name.getText(source) === "env");
    assert.ok(env && ts.isPropertyAssignment(env) && ts.isObjectLiteralExpression(env.initializer));
    const root = env.initializer.properties.find(value => ts.isPropertyAssignment(value) && value.name.getText(source) === "HF_HUB_CACHE");
    assert.ok(root && ts.isPropertyAssignment(root)); assert.equal(root.initializer.getText(source), argument.parameters[0]!.name.getText(source));
    assert.ok(text.includes("modelSourceDownloadPort: pythonRuntimeTaskRegistry") || text.includes("approvedModelSourceDownload: pythonRuntimeTaskRegistry"));
  }
});

for (const host of ["Desktop", "Managed"] as const)
test(`${host} Root task reads retain original Model ownership without effect ports`, async () => {
  const relative = host === "Desktop" ? "modules/hosts/desktop/composition/composeDesktopHost.ts"
    : "modules/hosts/server/composition/composeServerHost.ts";
  const text = await readFile(relative, "utf8"), source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true);
  const calls: ts.CallExpression[] = [], assignments: ts.BinaryExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) calls.push(node);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        node.left.getText(source) === "modelDownloadTaskOwner") assignments.push(node);
    ts.forEachChild(node, visit);
  }; visit(source);
  const named = (name: string) => calls.filter(call => call.expression.getText(source) === name);
  const properties = (call: ts.CallExpression) => {
    const value = call.arguments[0]; assert.ok(value && ts.isObjectLiteralExpression(value));
    return new Map(value.properties.filter(ts.isPropertyAssignment).map(field => [field.name.getText(source), field.initializer]));
  };
  const factory = named("composeHeadlessModelTaskReaders"); assert.equal(factory.length, 1);
  const config = properties(factory[0]!);
  assert.equal(config.get("documents")?.getText(source), host === "Desktop" ? "platformDocuments" : "managedDocuments");
  assert.equal(config.get("rootDirectory")?.getText(source), "registerOptions.storageRootDirectory");
  const configArgument = factory[0]!.arguments[0]; assert.ok(ts.isObjectLiteralExpression(configArgument));
  assert.ok(configArgument.properties.some(field => ts.isShorthandPropertyAssignment(field) && field.name.text === "hostIncarnationId"));
  const peek = config.get("peekOwner"); assert.ok(peek && ts.isArrowFunction(peek));
  assert.equal(peek.parameters.length, 0);
  assert.equal(peek.body.getText(source), host === "Desktop" ? "modelDownloadTaskOwner" : "modelDownloadTasksUseCase",
    "Read composition must peek the exact retained owner, not call a feature getter.");
  const current = config.get("isHostCurrent"); assert.ok(current && ts.isArrowFunction(current));
  assert.equal(current.modifiers?.some(value => value.kind === ts.SyntaxKind.AsyncKeyword) ?? false, false);
  if (host === "Desktop") {
    assert.equal(current.body.getText(source), "!headlessReadAdmissionClosed");
    assert.equal(config.get("placement")?.getText(source), 'createTenantPlacementConfig({mode: "dedicated", organizationId: identity.organizationId})');
    assert.equal(assignments.length, 1); assert.equal(assignments[0]!.right.getText(source), "feature.modelDownloadTasksUseCase");
  } else {
    assert.match(current.body.getText(source), /taskReconciler\.assertAccepting\(\); return true;/);
    assert.match(current.body.getText(source), /catch\s*\{return false;\}/);
    assert.equal(config.get("placement")?.getText(source), "options.managedHeadlessAgent.placement");
  }
  const handlers = named(host === "Desktop" ? "composeDesktopHeadlessReads" : "composeManagedAgentReads");
  assert.equal(handlers.length, 1);
  const reads = properties(handlers[0]!);
  for (const name of ["readModelTask", "readModelCompletion"])
    assert.equal(reads.get(name)?.getText(source), `modelTaskReaders?.${name}`);
  // Approved plan execution is now a separate, explicitly connected Root path.
  // Passive read composition must still never receive an execution or Save port.
  for (const name of ["getModelDownloadStart", "peekModelDownloadTasks", "peekModelReferenceSave"])
    assert.equal(reads.has(name), false, "Passive read wiring cannot accept a Model effect port.");
});
