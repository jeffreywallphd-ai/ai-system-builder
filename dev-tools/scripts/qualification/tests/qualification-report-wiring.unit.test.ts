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
function inspectFinalization(name: string, text: string, argumentCount = 4) {
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const all = calls(source), finalizers = all.filter(call => call.expression.getText(source) === "finalizeQualificationEvidence");
  assert.equal(finalizers.length, 1);
  const finalizer = finalizers[0]!; assert.equal(finalizer.arguments.length, argumentCount);
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

const lateWriters = [
  ["ingestion-source-journey.ts", "real-ingestion-source-host-journey", 8192],
  ["ocr-dataset-journey.ts", "real-ocr-dataset-host-journey", 8192],
  ["provided-dataset-version-journey.ts", "provided-version-host-journey", 8192],
  ["saved-row-review-host-journey.ts", "saved-row-review-host-journey", 8192],
  ["source-context-host-journey.ts", "source-context-host-journey", 8192],
  ["manual-context-host-journey.ts", "manual-context-host-journey", 8192],
  ["low-memory-dataset-journey.ts", "low-memory-dataset-host-journey", 4096],
] as const;
function inspectLateWriter(name: string, attachmentName: string, maximum: number, text: string) {
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true), all = calls(source);
  const finalizers = all.filter(call => call.expression.getText(source) === "finalizeQualificationEvidence");
  assert.equal(finalizers.length, 1); const finalizer = finalizers[0]!;
  assert.equal(finalizer.arguments.length, 4); assert.equal(finalizer.arguments[0]!.getText(source), "report");
  const primary = finalizer.arguments[1]!; assert(ts.isArrayLiteralExpression(primary)); assert.equal(primary.elements.length, 0);
  const save = finalizer.arguments[2]!, attach = finalizer.arguments[3]!;
  assert(ts.isArrowFunction(save)); assert(ts.isArrowFunction(attach));
  assert(save.getText(source).includes("const body = serialize()"));
  const writes = all.filter(call => call.expression.getText(source) === "writeFile"); assert.equal(writes.length, 1);
  assert(writes[0]!.pos >= save.pos && writes[0]!.end <= save.end);
  const options = writes[0]!.arguments[2]!; assert(ts.isObjectLiteralExpression(options)); assert.equal(options.properties.length, 1);
  const flag = options.properties[0]!; assert(ts.isPropertyAssignment(flag)); assert.equal(flag.name.getText(source), "flag");
  assert(ts.isStringLiteral(flag.initializer)); assert.equal(flag.initializer.text, "wx");
  const attachments = all.filter(call => call.expression.getText(source) === "info.attach" && ts.isStringLiteral(call.arguments[0]!) && call.arguments[0].text === attachmentName);
  assert.equal(attachments.length, 1); assert(attachments[0]!.pos >= attach.pos && attachments[0]!.end <= attach.end);
  assert(attach.getText(source).includes("body: serialize()"));
  let serializer: ts.ArrowFunction | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "serialize" && node.initializer && ts.isArrowFunction(node.initializer)) serializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source); assert(serializer);
  const fresh = all.filter(call => call.expression.getText(source) === "JSON.stringify" && call.arguments[0]?.getText(source) === "report");
  assert.equal(fresh.length, 1); assert(fresh[0]!.pos >= serializer.pos && fresh[0]!.end <= serializer.end);
  assert(serializer.getText(source).includes(`Buffer.byteLength(body)`)); assert(serializer.getText(source).includes(String(maximum)));
  assert.equal(finalizer.parent.getText(source).startsWith("await finalizeQualificationEvidence"), true);
}
for (const [name, attachment, maximum] of lateWriters) test(`${name} publishes fresh status and preserves exclusive creation and its byte limit`, () => {
  inspectLateWriter(name, attachment, maximum, readFileSync(path.join(folder, name), "utf8"));
});
for (const [label, change] of [
  ["missing finalizer", (text: string) => text.replace("finalizeQualificationEvidence(report", "unrelatedPublisher(report")],
  ["cached attachment", (text: string) => text.replace("body: serialize()", "body")],
  ["unknown file overwrite", (text: string) => text.replace('flag: "wx"', 'flag: "w"')],
] as const) test(`late writer refuses ${label}`, () => {
  const [name, attachment, maximum] = lateWriters[0];
  assert.throws(() => inspectLateWriter(name, attachment, maximum, change(readFileSync(path.join(folder, name), "utf8"))));
});

test("owned tasks use one captured profile and explicit diagnostic finalization",()=>{
  const text=readFileSync(path.join(folder,"owned-task-journey.ts"),"utf8");
  const {source,finalizer}=inspectFinalization("owned-task-journey.ts",text,5);
  assert.equal(finalizer.arguments[4]!.getText(source),"profile.successfulStatus");
  const declaration=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="qualifyOwnedTaskJourney");
  assert(declaration&&ts.isFunctionDeclaration(declaration)&&declaration.body);
  const body=declaration.body.getText(source);
  assert(body.indexOf("readOwnedTaskQualificationProfile(options)")<body.indexOf('page.getByLabel("Select current workspace")'));
  assert(!body.includes("options.samples"));assert(!body.includes("options.transport"));
  assert(body.includes("samples:profile.samples"));assert(body.includes("qualificationComplete:profile.qualificationComplete"));
  assert(body.includes("i<profile.samples"));assert.equal(body.match(/toBeLessThanOrEqual\(2000\)/g)?.length,2);
});
test("both native cleanup seams catch observer disposal and use fixed failure labels",()=>{
  for(const name of ["desktop-task-cleanup.ts","desktop-main-cleanup.ts"]){
    const text=readFileSync(path.join(folder,name),"utf8"),source=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true),all=calls(source);
    const finalizers=all.filter(call=>call.expression.getText(source)==="finalizeQualificationEvidence");assert.equal(finalizers.length,1);
    assert.equal(finalizers[0]!.arguments[0]!.getText(source),"report");assert.equal(finalizers[0]!.arguments[1]!.getText(source),"errors");
    assert(text.includes('recordFailure("observer-close",error)'));assert(text.includes("errors.map(safeQualificationFailureType)"));assert(!text.includes("error.name"));
    assert(text.includes('flag: "wx"')||text.includes('flag:"wx"'));
    assert(text.includes("8192"));assert(text.includes("willQuitAcknowledged"));assert(text.includes("mainExitCode"));
  }
});
test("the import cleanup adapter delegates once to the guarded core without independent cleanup or publication",()=>{
  const text=readFileSync(path.join(folder,"desktop-import-cleanup.ts"),"utf8"),source=ts.createSourceFile("adapter.ts",text,ts.ScriptTarget.Latest,true);
  assert(text.includes('from "./desktop-main-cleanup"'));
  const fn=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="closeImportedFileDesktop");
  assert(fn&&ts.isFunctionDeclaration(fn)&&fn.body);assert.equal(fn.body.statements.length,1);
  assert.equal(fn.body.statements[0]!.getText(source).replace(/\s/g,""),'returncloseImportedMainDesktop(app,dataRoot,info,journeyStage,mode);');
  assert.equal(calls(source).filter(call=>call.expression.getText(source)==="closeImportedMainDesktop").length,1);
  assert(!text.includes("app.close")&&!text.includes("observeOwnedNativeProcessExit")&&!text.includes("finalizeQualificationEvidence"));
});

test("the file-import wrapper retains two cases and delegates the exact owned cleanup",()=>{
  const text=readFileSync(path.join(folder,"packaged-desktop-ingestion.e2e.spec.ts"),"utf8"),source=ts.createSourceFile("import.ts",text,ts.ScriptTarget.Latest,true),all=calls(source);
  assert(text.includes('from "./desktop-import-cleanup"'));assert(!text.includes("async function closeImportedFileDesktop"));
  const phases=all.filter(call=>call.expression.getText(source)==="runOwnedRestartPhase");assert.equal(phases.length,1);
  assert.equal(phases[0]!.arguments[1]!.getText(source).replace(/\s/g,""),"()=>closeImportedFileDesktop(app,isolated.dataRoot,test.info(),stage,mode)");
  assert.equal(all.filter(call=>call.expression.getText(source)==="test").length,2);
  assert.equal(all.filter(call=>call.expression.getText(source)==="test.setTimeout"&&call.arguments[0]?.getText(source)==="180_000").length,2);
  assert(text.includes('"ingestion-native400" : "ingestion"'));
});
test("meaningful construction protects setup, removes owned observers and preserves purpose/replay assertions",()=>{
  const text=readFileSync(path.join(folder,"meaningful-system-journeys.ts"),"utf8"),source=ts.createSourceFile("meaningful.ts",text,ts.ScriptTarget.Latest,true);
  const declaration=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="buildMeaningfulSystem");
  assert(declaration&&ts.isFunctionDeclaration(declaration)&&declaration.body);const body=declaration.body.getText(source);
  const sequence=['try {','page.on("pageerror", pageError)','started = performance.now()','await startLongTasks(page)','measurements =','await record(measurements)','page.getByLabel("New system name")'];
  let previous=-1;for(const step of sequence){const index=body.indexOf(step);assert(index>previous,step);previous=index;}
  assert(body.includes('page.off("pageerror", pageError)'));assert(body.includes("__canvasLongTasks?.observer?.disconnect()"));
  assert(body.includes("finalizeQualificationEvidence(report, failures"));assert.equal(body.match(/exercisePurpose\(preview, scenario\)/g)?.length,2);
  assert(body.includes("assertMeaningfulSystemPreserved"));assert(body.includes('runtimeQualification: "unavailable-custom-authoring-not-qualified"'));
});
test("managed task setup creates and binds a distinct workspace without resetting reference data",()=>{
  const text=readFileSync(path.join(folder,"managed-reference-tasks.e2e.spec.ts"),"utf8");
  const steps=['new URL("/",','name:"Create new workspace"','name:"Create workspace"','toHaveCount(0)','not.toHaveValue(previousWorkspaceId)','const createdWorkspaceId','new URL("/systems",','toHaveValue(createdWorkspaceId)','qualifyOwnedTaskJourney(page'];
  let previous=-1;for(const step of steps){const index=text.indexOf(step);assert(index>previous,step);previous=index;}
  assert(text.includes("test.setTimeout(300000)"));assert(text.includes('QUALIFICATION_TASK_DIAGNOSTIC==="1"?1:30'));
  assert(!/request\.(?:delete|post)|unlink|remove|resetDatabase/.test(text));
});
