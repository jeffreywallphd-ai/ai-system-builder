import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import path from "node:path";
import ts from "typescript";

const folder = path.resolve("dev-tools/scripts/qualification/visual-composer/e2e");
const consumers = ["reference-browse-performance.ts", "packaged-desktop-cold-canvas.e2e.spec.ts", "structured-output-controls-journey.ts"];
function calls(source: ts.SourceFile) {
  const found: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => { if (ts.isCallExpression(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(source); return found;
}
function inspectFinalization(name: string, text: string) {
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const all = calls(source), finalizers = all.filter(call => call.expression.getText(source) === "finalizeQualificationEvidence");
  assert.equal(finalizers.length, 1);
  const finalizer = finalizers[0]!; assert.equal(finalizer.arguments.length, 4);
  assert.equal(finalizer.arguments[0]!.getText(source), "report");
  assert.equal(finalizer.arguments[1]!.getText(source), "failures");
  let owner: ts.TryStatement | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isTryStatement(node) && node.finallyBlock && finalizer.pos >= node.finallyBlock.pos && finalizer.end <= node.finallyBlock.end) owner = node;
    ts.forEachChild(node, visit);
  };
  visit(source); assert(owner?.catchClause);
  const caught = owner.catchClause.variableDeclaration?.name.getText(source); assert.equal(caught, "error");
  const statements = owner.catchClause.block.statements; assert.equal(statements.length, 1);
  assert.equal(statements[0]!.getText(source).replace(/\s/g, ""), "failures.push(error);");
  const attachment = finalizer.arguments[3]!; assert(ts.isArrowFunction(attachment));
  const attached = all.filter(call => call.expression.getText(source).endsWith(".attach")); assert.equal(attached.length, 1);
  assert(attached[0]!.pos >= attachment.pos && attached[0]!.end <= attachment.end);
  return {source, all, finalizer};
}
for (const name of consumers) {
  test(`${name} retains primary failure and awaits its one shared finalizer`, () => {
    const text = readFileSync(path.join(folder, name), "utf8");
    const {source, finalizer} = inspectFinalization(name, text);
    assert.equal(finalizer.parent.getText(source).startsWith("await finalizeQualificationEvidence"), true);
  });
}
test("the old passed-before-attachment finally pattern cannot satisfy wiring", () => {
  assert.throws(() => inspectFinalization("legacy.ts", 'try {report.status="passed";await info.attach("result",report);} finally {if(report.status==="running") report.status="failed";await save();}'));
});
test("a detached finalizer without the primary catch cannot satisfy wiring", () => {
  assert.throws(() => inspectFinalization("detached.ts", 'try {report.status="passed";} finally {await finalizeQualificationEvidence(report,failures,save,()=>info.attach("result",report));}'));
});
test("cold attempts always await owned shutdown through the failure-preserving phase", () => {
  const text = readFileSync(path.join(folder, consumers[1]!), "utf8"), source = ts.createSourceFile("cold.ts", text, ts.ScriptTarget.Latest, true);
  const phases = calls(source).filter(call => call.expression.getText(source) === "runOwnedRestartPhase");
  assert.equal(phases.length, 1); assert.equal(phases[0]!.arguments.length, 2);
  assert(ts.isArrowFunction(phases[0]!.arguments[0]!));
  assert.equal(phases[0]!.arguments[1]!.getText(source).replace(/\s/g, ""), "()=>app.close()");
  for (const invariant of ["i<35", "if(i>=5)", "toHaveLength(35)", "toHaveLength(30)", "toBeLessThanOrEqual(report.budgetMilliseconds)", "firstWindowMilliseconds", "interactiveShellMilliseconds"]) assert(text.includes(invariant), invariant);
  assert(!text.includes("finally{await app.close();}"));
});
test("structured output serializes current status, preserves exclusive creation and removes a stale passed stage", () => {
  const text = readFileSync(path.join(folder, consumers[2]!), "utf8");
  const {source, finalizer} = inspectFinalization(consumers[2]!, text);
  const save = finalizer.arguments[2]!; assert(ts.isArrowFunction(save));
  const attach = finalizer.arguments[3]!; assert(ts.isArrowFunction(attach));
  assert(save.getText(source).includes("const body = serialize()"));
  assert(save.getText(source).includes('flag: "wx"'));
  assert(attach.getText(source).includes("body: serialize()"));
  assert(text.includes('report.status === "failed" && report.stage === "passed" ? "evidence-finalization" : report.stage'));
  assert(text.includes("toBeLessThanOrEqual(4096)"));
  assert(text.includes('mode === "native400" ? "-native400" : ""'));
});
function inspectWorkspace(text: string) {
  const source = ts.createSourceFile("browse.ts", text, ts.ScriptTarget.Latest, true);
  const entry = calls(source).find(call => call.expression.getText(source) === "test" && ts.isStringLiteral(call.arguments[0]!) && call.arguments[0].text === "thin client preserves the complete browse authoring journey");
  assert(entry); const callback = entry.arguments[1]!; assert(ts.isArrowFunction(callback));
  const body = callback.body.getText(source);
  const required = [
    'await page.goto(new URL("/", origin).href)',
    'const previousWorkspaceId = await selectedWorkspace.inputValue()',
    'name: "Create new workspace", exact: true',
    '.fill("Browse journey fixture")',
    'name: "Create workspace", exact: true',
    'await expect(page.locator(".workspace-create-form")).toHaveCount(0)',
    'await expect(selectedWorkspace).not.toHaveValue(previousWorkspaceId)',
    'const createdWorkspaceId = await selectedWorkspace.inputValue()',
    'await page.goto(new URL("/systems", origin).href)',
    'await expect(selectedWorkspace).toHaveValue(createdWorkspaceId)',
    'await completeBrowseAuthoringJourney',
    'await completeAssetAuthoringJourney',
  ];
  let previous = -1;
  for (const step of required) { const index = body.indexOf(step); assert(index > previous, step); previous = index; }
}
test("standard browse explicitly creates and binds a fresh workspace before either authoring journey", () => {
  inspectWorkspace(readFileSync(path.join(folder, "thin-client-browse.e2e.spec.ts"), "utf8"));
});
for (const step of ['name: "Create new workspace", exact: true', 'await expect(selectedWorkspace).toHaveValue(createdWorkspaceId)']) test(`missing workspace ownership step is rejected: ${step}`, () => {
  const text = readFileSync(path.join(folder, "thin-client-browse.e2e.spec.ts"), "utf8");
  assert.throws(() => inspectWorkspace(text.replace(step, "/* synthetic missing ownership step */")));
});
