import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import test from "node:test";
import ts from "typescript";
import {createInMemoryStructuredDocumentStore, type StructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {readHeadlessContextPackPlanRequest} from "../../../../contracts/headless";
import {CONTEXT_MARKDOWN_PACK_MEDIA_TYPE, type ContextSavedArtifactReference} from "../../../../contracts/context-management";
import type {PreparedContextResultReview} from "../../../../application/ports/context-management";
import {reserveStructuredContextPlanTask, issueStructuredContextPlanTask, acceptStructuredContextPlanTask,
  type ContextPlanTaskEffect} from "../../../../adapters/persistence/system-builder/createStructuredHeadlessContextPlanTaskStore";
import {reserveStructuredContextResultSave, issueStructuredContextResultSave, commitStructuredContextResultSave,
  type ContextResultSaveEffect} from "../../../../adapters/persistence/system-builder/createStructuredHeadlessContextResultStore";
import {composeHeadlessContextPresentation} from "../headlessContextPresentation";

test("both real host sources compose Context display with a cached owner and no feature initializer", () => {
  for (const [path, cachedName] of [
    ["modules/hosts/desktop/composition/composeDesktopHost.ts", "contextResultOwner"],
    ["modules/hosts/server/composition/composeServerHost.ts", "contextGenerationUseCase"],
  ]) {
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const calls: ts.CallExpression[] = [];
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "composeHeadlessContextPresentation") calls.push(node);
      ts.forEachChild(node, visit);
    }
    visit(source); assert.equal(calls.length, 1);
    const options = calls[0]!.arguments[0]; assert.ok(options && ts.isObjectLiteralExpression(options));
    const peek = options.properties.find(property => property.name?.getText(source) === "peekProcessor");
    assert.ok(peek && ts.isPropertyAssignment(peek) && ts.isArrowFunction(peek.initializer));
    assert.ok(ts.isIdentifier(peek.initializer.body)); assert.equal(peek.initializer.body.text, cachedName);
    const query = options.properties.find(property => property.name?.getText(source) === "peekQueryOwner");
    assert.ok(query && ts.isPropertyAssignment(query) && ts.isArrowFunction(query.initializer));
    assert.ok(ts.isIdentifier(query.initializer.body));
    assert.equal(query.initializer.body.text, path.includes("/desktop/") ? "contextQueryOwner" : "contextBrowserUseCases");
  }
});

async function fixture() {
  const documents = createInMemoryStructuredDocumentStore(), hostIncarnationId = randomUUID(), rootDirectory = process.cwd();
  const context = {organizationId: createOrganizationId("org.context-window"), workspaceId: createWorkspaceId("workspace.context-window"), principalId: "principal.synthetic"};
  const target = {hostIncarnationId: hostIncarnationId as never, fingerprint: "a".repeat(64), scope: {...context, registeredClientId: randomUUID()}};
  const parsed = readHeadlessContextPackPlanRequest({version: "aisb-headless-v1", operation: "context.generate-pack", input: {
    hostIncarnationId, workspaceId: context.workspaceId, idempotencyKey: randomUUID(), name: "Synthetic context",
    sources: [{kind: "ingestion-file", taskId: "source.task", fileId: "source.file", taskRevision: 3}],
    settings: {kind: "markdown-context-pack", cleaningPreset: "standard", chunkCharacters: 500, overlapCharacters: 50,
      maximumChunks: 100, textFields: ["text"]}}}, hostIncarnationId as never);
  assert.ok(parsed.ok);
  const effect: ContextPlanTaskEffect = {key: randomUUID(), target, approvalRevision: 1, step: 1, request: parsed.request};
  const tx = <T>(run: (owner: StructuredDocumentStore) => Promise<T>) => documents.runInOwnedTransaction!(
    owner => run(owner.forOrganization(context.organizationId)), () => {});
  const sourceDigest = "b".repeat(64), reserved = await tx(owner => reserveStructuredContextPlanTask(owner, effect, sourceDigest, 1));
  assert.equal(reserved.kind, "new"); assert.ok("taskId" in reserved);
  const taskId = reserved.taskId;
  const issue = () => tx(owner => issueStructuredContextPlanTask(owner, effect, taskId, sourceDigest, 2));
  const accept = () => tx(owner => acceptStructuredContextPlanTask(owner, effect, taskId, 3));
  async function save() {
    const commandDigest = "sha256:" + "c".repeat(64), outputDigest = "sha256:" + "d".repeat(64), sizeBytes = 3;
    const reportFingerprint = createHash("sha256").update(JSON.stringify({requestId: taskId, outputDigest, sizeBytes,
      commandDigest, sourceCount: 1, chunkCount: 1})).digest("hex");
    const prepared: PreparedContextResultReview = {review: {reportFingerprint, kind: "markdown-context-pack", sourceCount: 1,
      chunkCount: 1, sizeBytes, requiresExplicitSave: true}, name: "Synthetic context", commandDigest,
      output: {name: "synthetic.context.zip", outputHandle: "synthetic.context.zip", mediaType: CONTEXT_MARKDOWN_PACK_MEDIA_TYPE, sizeBytes, digest: outputDigest}};
    const saveEffect: ContextResultSaveEffect = {key: randomUUID(), target: {...target, fingerprint: "e".repeat(64)}, approvalRevision: 1,
      step: 1, taskId, reportFingerprint};
    const saved = await tx(owner => reserveStructuredContextResultSave(owner, saveEffect, prepared, sourceDigest, 4));
    assert.equal(saved.kind, "new"); assert.ok("saveId" in saved);
    assert.equal(await tx(owner => issueStructuredContextResultSave(owner, saveEffect, saved.saveId, sourceDigest, 5)), true);
    const storageKey = `workspaces/${context.workspaceId}/artifacts/context/${saved.saveId.replace(/-/g, "")}`;
    const artifact: ContextSavedArtifactReference = {artifactId: storageKey, storageKey, kind: "markdown-context-pack", name: prepared.name,
      mediaType: prepared.output.mediaType, sizeBytes, digest: outputDigest};
    assert.ok(await tx(owner => commitStructuredContextResultSave(owner, rootDirectory, saveEffect, saved.saveId, sourceDigest, artifact, 6)));
    return {workspaceId: context.workspaceId, contextId: saved.saveId, taskId, kind: "markdown-context-pack" as const, artifactDigest: outputDigest};
  }
  return {documents, hostIncarnationId, rootDirectory, context, taskId, tx, issue, accept, save};
}

test("Context task display proves exact accepted scope before observing an already-loaded owner", async () => {
  const f = await fixture(); let peeks = 0, reads = 0;
  const make = (hostIncarnationId = f.hostIncarnationId, hasOwner = true) => composeHeadlessContextPresentation({...f, hostIncarnationId,
    peekProcessor() {peeks++; return hasOwner ? {async readAdmittedContextTask(taskId, actor) {
      reads++; assert.equal(taskId, f.taskId); assert.deepEqual(actor, f.context);
      return {taskId, state: "running", review: null};
    }} : undefined;}})(f.context)!;
  const intent = {action: "show-context-task", taskId: f.taskId} as const, allowed = async () => true;
  assert.equal(await make().execute({...intent, taskId: randomUUID()}, f.context, allowed), undefined);
  assert.equal(await make().execute(intent, f.context, allowed), undefined);
  assert.equal(await f.issue(), true);
  assert.equal(await make().execute(intent, f.context, allowed), undefined);
  assert.equal(peeks, 0); assert.equal(reads, 0);
  assert.equal(await f.accept(), true);
  for (const context of [{...f.context, principalId: "another.principal"}, {...f.context, organizationId: createOrganizationId("another.org")},
    {...f.context, workspaceId: createWorkspaceId("another.workspace")}]) assert.equal(await make().execute(intent, context, allowed), undefined);
  assert.equal(await make(randomUUID()).execute(intent, f.context, allowed), undefined);
  assert.equal(peeks, 0);
  assert.equal(await make(f.hostIncarnationId, false).execute(intent, f.context, allowed), undefined);
  assert.equal(reads, 0);
  assert.deepEqual(await make().execute(intent, f.context, allowed), {title: "Context task", summary: "Task status: running."});
  assert.equal(reads, 1);
  assert.ok(await f.documents.forOrganization(f.context.organizationId).readDocument("headless/context/pack-plan-task-index", `${f.context.workspaceId}/${f.taskId}`));
});

test("saved Context display uses real committed catalog/binding lineage without a processor or artifact-byte reader", async () => {
  const f = await fixture(); assert.equal(await f.issue(), true); assert.equal(await f.accept(), true);
  const reference = await f.save(); let peeks = 0;
  const reader = composeHeadlessContextPresentation({...f, peekProcessor() {peeks++; return undefined;}})(f.context)!;
  const intent = {action: "show-context-artifact", reference} as const;
  assert.deepEqual(await reader.execute(intent, f.context, async () => true), {title: "Saved context pack",
    summary: "Sources: 1. Chunks: 1. Size: 3 bytes. File availability has not been checked."});
  for (const patch of [{taskId: randomUUID()}, {artifactDigest: "sha256:" + "e".repeat(64)}, {kind: "rag-database" as const},
    {contextId: randomUUID()}, {workspaceId: createWorkspaceId("another.workspace")}])
    assert.equal(await reader.execute({...intent, reference: {...reference, ...patch}}, f.context, async () => true), undefined);
  assert.equal(await reader.execute(intent, {...f.context, organizationId: createOrganizationId("another.org")}, async () => true), undefined);
  assert.equal(peeks, 0);
});

test("permission withdrawn at cached-owner observation prevents task reads and leaves accepted work intact", async () => {
  const f = await fixture(); assert.equal(await f.issue(), true); assert.equal(await f.accept(), true);
  let live = true, reads = 0;
  const reader = composeHeadlessContextPresentation({...f, peekProcessor() {live = false;
    return {async readAdmittedContextTask() {reads++; return {taskId: f.taskId, state: "running", review: null};}};
  }})(f.context)!;
  assert.equal(await reader.execute({action: "show-context-task", taskId: f.taskId}, f.context, async () => live), undefined);
  assert.equal(reads, 0);
  assert.ok(await f.documents.forOrganization(f.context.organizationId).readDocument("headless/context/pack-plan-task-index", `${f.context.workspaceId}/${f.taskId}`));
});


test("actual Desktop and Managed query selectors require artifact and model scopes; a removed model fence is detected", () => {
  function check(path: string, text: string) {
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), branches: ts.ArrayLiteralExpression[] = [];
    function visit(node: ts.Node) {
      if (ts.isConditionalExpression(node) && ts.isBinaryExpression(node.condition) &&
          node.condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
          node.condition.left.getText(source) === "intent.action" && ts.isStringLiteral(node.condition.right) &&
          node.condition.right.text === "show-context-query") {
        const yes = node.whenTrue;
        const array = ts.isAsExpression(yes) ? yes.expression : yes;
        assert.ok(ts.isArrayLiteralExpression(array)); branches.push(array);
      }
      ts.forEachChild(node, visit);
    }
    visit(source); assert.equal(branches.length, 1);
    const scopes = branches[0].elements.filter(ts.isStringLiteral).map(item => item.text);
    assert.ok(scopes.includes("artifact:read")); assert.ok(scopes.includes("model:read"));
  }
  for (const path of ["modules/hosts/desktop/composition/composeDesktopUiControl.ts", "modules/hosts/server/composition/composeServerHost.ts"]) {
    const source = readFileSync(path, "utf8"); check(path, source);
    const mutated = source.replace(/(intent\.action === "show-context-query" \? \[[^\]]*)"model:read"/, '$1"artifact:read"');
    assert.notEqual(mutated, source); assert.throws(() => check(path, mutated), "A ModelRead omission must fail this source-wiring guard.");
  }
});
