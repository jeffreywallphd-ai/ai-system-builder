import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { createPackageFixture } from "../../../../modules/testing/fixtures/asset-package-fixture";
import { readDesktopPublishedDefinition, readBrowserPublishedDefinition } from "../visual-composer/e2e/asset-authoring-journey";
import {
  AUTHORING_PHASE_BUDGET_MS, AUTHORING_STEP_BUDGET_MS, BASE_FIELD_LABELS,
  createAuthoringExpectations, assertPackageObservation, assertStudioObservation,
  validateBaseObservation, assertBaseUnchanged, assertPublishedHistory, assertPublishedDefinition, assertDocumentReplay,
  type BaseObservation,
} from "../visual-composer/asset-authoring-oracles";

const plan = createAuthoringExpectations("thin-chrome", "workspace.fixture"), copy = plan.copies[0]!;
function base(): BaseObservation {
  return {
    workspaceId: "workspace.fixture", id: "builtin.form.submit-action", version: "1.0.0", source: "system-owned-asset",
    baseLabel: "Base: Submit - builtin.form.submit-action - v1.0.0 - release.submit.v1",
    semantic: Object.fromEntries(BASE_FIELD_LABELS.map(label => [label, label === "Display name" ? "Submit" : ""])),
    resources: [
      {path: "frontend/Submit.tsx", mediaType: "text/typescript", content: "export const Submit = () => <button>Submit</button>;", editable: false},
      {path: "frontend/submit.css", mediaType: "text/css", content: "button { color: green; }", editable: true},
    ],
  };
}

test("declared journeys have three useful distinct assets, exact roles and finite phase budgets", () => {
  const desktop = createAuthoringExpectations("packaged-desktop", "workspace.desktop");
  assert.deepEqual(plan.copies.map(row => [row.baseId, row.baseVersion, row.source]), [
    ["builtin.form.submit-action", "1.0.0", "system-owned-asset"], ["imported.demo.ui-overrides.panel", "1.0.0", "workspace-imported-asset"],
  ]);
  assert.deepEqual(plan.studio.resources.map(row => [row.path, row.mediaType, row.section]), [
    ["frontend/AssetView.tsx", "text/typescript", "Frontend structure"], ["frontend/asset.css", "text/css", "Styling logic"], ["backend/handleAssetRequest.ts", "text/typescript", "Backend logic"],
  ]);
  assert.equal(plan.studio.type, "tool"); assert.equal(plan.studio.family, "behavioral");
  assert.equal(new Set([...plan.copies, plan.studio, ...desktop.copies, desktop.studio].map(row => row.id)).size, 6);
  assert.equal(plan.replayKind, "document-reload"); assert.equal(plan.replayCount, 4);
  assert.equal(AUTHORING_STEP_BUDGET_MS, 60_000); assert.equal(AUTHORING_PHASE_BUDGET_MS, 5 * AUTHORING_STEP_BUDGET_MS);
  assert.throws(() => createAuthoringExpectations("managed-thin-chrome" as never, "workspace.fixture"));
  assert.throws(() => createAuthoringExpectations("thin-chrome", ""));
});

test("package inspection must match the independently declared inert identity and counts", () => {
  const expected = {label: "Imported Demo UI Overrides v1.0.0", contents: "1 definitions · 1 implementations · 3 files"};
  assertPackageObservation(plan, expected);
  for (const observed of [{...expected, label: "Other package v1.0.0"}, {...expected, contents: "1 definitions · 1 implementations · 2 files"}, {...expected, extra: "undeclared"}, {label: expected.label}, null]) assert.throws(() => assertPackageObservation(plan, observed));
});

test("constructed inert package still supplies the exact declared import and customization inputs", async () => {
  const pack = await createPackageFixture(), manifest = pack.container.manifest;
  assert.equal(manifest.packageId, "imported.demo.ui-overrides"); assert.equal(manifest.version, "1.0.0");
  assert.equal(manifest.implementations.length, 1); assert.equal(manifest.semanticManifest.assets.length, 1);
  assert.equal(manifest.implementations[0]!.definitionRef.id, plan.copies[1]!.baseId);
  assert.equal(manifest.implementations[0]!.definitionRef.version, plan.copies[1]!.baseVersion);
  assert.deepEqual(manifest.requestedCapabilities, []); assert(pack.bytes.length < 64 * 1024);
  assertPackageObservation(plan, {label: `${manifest.displayName} v${manifest.version}`, contents: `${manifest.semanticManifest.assets.length} definitions · ${manifest.implementations.length} implementations · ${pack.container.entries.length} files`});
});

test("Saved exact observations preserve semantic fields, ordered resource bytes and all identities", () => {
  assertStudioObservation(plan.studio, structuredClone(plan.studio));
  for (const field of ["workspaceId", "id", "name", "version", "type", "family", "definition", "status"] as const) {
    const changed = structuredClone(plan.studio); changed[field] = `wrong-${field}`;
    assert.throws(() => assertStudioObservation(plan.studio, changed), field);
  }
  for (const key of ["purpose", "userFacingSummary", "developerFacingSummary", "capabilities", "limitations"]) {
    const changed = structuredClone(plan.studio); delete (changed.aiContext as Record<string, unknown>)[key];
    assert.throws(() => assertStudioObservation(plan.studio, changed), key);
  }
  assert.throws(() => assertStudioObservation(plan.studio, {...plan.studio, extra: "unrequested"}));
});
for (const field of ["path", "mediaType", "content", "section"] as const) test(`Saved rejects a substituted resource ${field}`, () => {
  for (let index = 0; index < 3; index++) {
    const changed = structuredClone(plan.studio); changed.resources[index]![field] = "different";
    assert.throws(() => assertStudioObservation(plan.studio, changed));
  }
});
test("Saved rejects missing, duplicated, reordered and incomplete resources", () => {
  for (const resources of [[], plan.studio.resources.slice(1), [...plan.studio.resources, plan.studio.resources[0]!], [...plan.studio.resources].reverse(), [{path: "frontend/AssetView.tsx"}]]) assert.throws(() => assertStudioObservation(plan.studio, {...plan.studio, resources}));
});

test("base comparison accepts complete readonly and editable source observations", () => {
  validateBaseObservation(plan, copy, base()); assertBaseUnchanged(plan, copy, base(), structuredClone(base()));
});
for (const field of ["workspaceId", "id", "version", "source", "baseLabel"] as const) test(`base selection refuses wrong ${field}`, () => {
  const changed = base(); changed[field] = "wrong";
  assert.throws(() => validateBaseObservation(plan, copy, changed));
});
test("two missing base contents cannot qualify as equal", () => {
  for (const content of [undefined, null, "", " ", "x".repeat(262_145)]) {
    const changed = base(); (changed.resources[0] as any).content = content;
    assert.throws(() => assertBaseUnchanged(plan, copy, changed, structuredClone(changed)));
  }
});
test("base observations reject missing or excess semantic fields and resources", () => {
  for (const mutate of [
    (row: BaseObservation) => {delete row.semantic["Ports"];},
    (row: BaseObservation) => {row.semantic.unexpected = "extra";},
    (row: BaseObservation) => {row.semantic["Ports"] = "x".repeat(32_769);},
    (row: BaseObservation) => {row.resources = [];},
    (row: BaseObservation) => {row.resources = Array(65).fill(row.resources[0]);},
    (row: BaseObservation) => {delete (row.resources[0] as any).editable;},
  ]) {const changed = base(); mutate(changed); assert.throws(() => validateBaseObservation(plan, copy, changed));}
});
test("base paths are relative, unique and bounded; UTF8 content has a total byte bound", () => {
  for (const candidate of ["../escape.css", "/root.css", "C:/root.css", "frontend\\root.css", "frontend//root.css", "./root.css", "x".repeat(241)]) {
    const changed = base(); changed.resources[0]!.path = candidate;
    assert.throws(() => validateBaseObservation(plan, copy, changed));
  }
  const duplicate = base(); duplicate.resources[1]!.path = "FRONTEND/SUBMIT.TSX";
  assert.throws(() => validateBaseObservation(plan, copy, duplicate));
  const excessive = base(); excessive.resources = Array.from({length: 3}, (_, i) => ({...excessive.resources[0]!, path: `frontend/part${i}.tsx`, content: "\u20ac".repeat(250_000)}));
  assert.throws(() => validateBaseObservation(plan, copy, excessive));
});
test("valid changed source, semantic, media and order are still detected as base mutation", () => {
  for (const mutate of [
    (row: BaseObservation) => {row.resources[0]!.content += " changed";},
    (row: BaseObservation) => {row.resources[0]!.mediaType = "text/plain";},
    (row: BaseObservation) => {row.resources[0]!.editable = true;},
    (row: BaseObservation) => {row.resources.reverse();},
    (row: BaseObservation) => {row.semantic["Description"] = "changed";},
  ]) {const changed = base(); mutate(changed); assert.throws(() => assertBaseUnchanged(plan, copy, base(), changed));}
});

test("published history requires one exact identity, version, name, status and revision", () => {
  const exact = `${copy.name} - published - revision 4 ${copy.id} v1.0.0`;
  assertPublishedHistory(copy, [exact.replace(" revision", "\n revision")]);
  for (const rows of [[], [exact, exact], [exact.replace("revision 4", "revision 3")], [exact.replace("published", "draft")], [exact.replace(copy.id, plan.copies[1]!.id)], [exact.replace("v1.0.0", "v2.0.0")], [exact.replace(copy.name, "Other name")], [exact + " Abandon"]]) assert.throws(() => assertPublishedHistory(copy, rows));
});
test("exact public definition reads reject same-name substitutions, changed semantics and failure envelopes", () => {
  for (const asset of [...plan.copies, plan.studio]) {
    const exact = {definitionId: asset.id, version: "1.0.0", displayName: asset.name, assetType: "tool", assetFamily: "behavioral", lifecycleStatus: "published", description: "Declared synthetic description", metadataSummary: "Declared summary"};
    const {metadataSummary, ...semantic} = exact, canonical = {...semantic, metadata: {summary: metadataSummary}};
    assertPublishedDefinition(exact, {ok: true, value: {definition: canonical}});
    for (const field of Object.keys(semantic)) assert.throws(() => assertPublishedDefinition(exact, {ok: true, value: {definition: {...canonical, [field]: "different"}}}), field);
    for (const definition of [{...semantic, summary: metadataSummary}, {...canonical, metadata: {summary: "different"}, summary: metadataSummary}, {...semantic}, {...canonical, metadata: {}}]) assert.throws(() => assertPublishedDefinition(exact, {ok: true, value: {definition}}));
    for (const invalid of [undefined, null, {ok: false, error: {message: "fixed synthetic refusal"}}, {ok: true}, {ok: true, value: canonical}, {ok: true, value: {definition: null}}, {ok: true, value: {definition: canonical, excess: "x".repeat(262_145)}}]) assert.throws(() => assertPublishedDefinition(exact, invalid));
    const studioExpected = {...semantic}; assertPublishedDefinition(studioExpected, {ok: true, value: {definition: semantic}});
    assert.throws(() => assertPublishedDefinition(studioExpected, {ok: true, value: {definition: canonical}}));
  }
});
test("replay checks refuse a process-restart claim, incomplete counts and workspace changes", () => {
  const exact = {kind: "document-reload", count: 4, workspaceIds: Array(4).fill("workspace.fixture")};
  assertDocumentReplay(plan, exact);
  for (const changed of [{...exact, kind: "process-restart"}, {...exact, count: 3}, {...exact, count: 5}, {...exact, workspaceIds: exact.workspaceIds.slice(1)}, {...exact, workspaceIds: ["workspace.other", ...exact.workspaceIds.slice(1)]}]) assert.throws(() => assertDocumentReplay(plan, changed));
});

test("both ordinary host specs await the same Assets core after their existing browse journey", () => {
  const folder = path.resolve("dev-tools/scripts/qualification/visual-composer/e2e");
  for (const [file, host, previousBudget] of [["packaged-desktop-browse.e2e.spec.ts", "packaged-desktop", 150_000], ["thin-client-browse.e2e.spec.ts", "thin-chrome", 120_000]] as const) {
    const source = ts.createSourceFile(file, readFileSync(path.join(folder, file), "utf8"), ts.ScriptTarget.Latest, true);
    const calls: ts.CallExpression[] = []; const visit = (node: ts.Node) => {if (ts.isCallExpression(node)) calls.push(node); ts.forEachChild(node, visit);}; visit(source);
    const named = (name: string) => calls.filter(call => call.expression.getText(source) === name);
    const browse = named("completeBrowseAuthoringJourney"), assets = named("completeAssetAuthoringJourney");
    assert.equal(browse.length, 1); assert.equal(assets.length, 1); assert(browse[0]!.pos < assets[0]!.pos);
    assert(ts.isAwaitExpression(assets[0]!.parent)); assert.equal((assets[0]!.arguments[1] as ts.StringLiteral).text, host);
    assert.equal(assets[0]!.arguments.length, 5);
    const reader = assets[0]!.arguments[3]!; assert(ts.isArrowFunction(reader));
    assert(reader.getText(source).includes(host === "thin-chrome" ? "page.evaluate(readBrowserPublishedDefinition, input)" : "page.evaluate(readDesktopPublishedDefinition, input)"));
    const replay = assets[0]!.arguments[2]!; assert(ts.isObjectLiteralExpression(replay));
    assert.equal(replay.properties.length, 2);
    const kind = replay.properties.find(prop => prop.name?.getText(source) === "kind")!;
    assert(ts.isPropertyAssignment(kind) && ts.isStringLiteral(kind.initializer)); assert.equal(kind.initializer.text, "document-reload");
    const reload = replay.properties.find(prop => prop.name?.getText(source) === "reload")!;
    assert(ts.isPropertyAssignment(reload) && ts.isArrowFunction(reload.initializer));
    const replayCalls = calls.filter(call => call.pos >= reload.pos && call.end <= reload.end);
    assert.equal(replayCalls.filter(call => call.expression.getText(source) === "page.reload").length, 1);
    assert.equal(replayCalls.filter(call => /launch|close|evaluate|route|request/.test(call.expression.getText(source))).length, 0);
    const budget = named("test.setTimeout"); assert.equal(budget.length, 1);
    assert.equal(budget[0]!.arguments[0]!.getText(source), `${previousBudget.toLocaleString("en-US").replaceAll(",", "_")} + AUTHORING_PHASE_BUDGET_MS`);
  }
});

const readQuery = {definitionId: "asset.synthetic-summary", version: "1.0.0", workspaceId: "workspace.fixture"};
const publicEnvelope = {ok: true, value: {definition: {definitionId: readQuery.definitionId, version: "1.0.0", displayName: "Synthetic summary"}}};
function clock() {
  const callbacks: (() => void)[] = [], cleared: number[] = [];
  return {callbacks, cleared, setTimeout(callback: () => void, ms: number) {assert.equal(ms, 10_000); callbacks.push(callback); return callbacks.length;}, clearTimeout(id: number) {cleared.push(id);}};
}
const safeReadError = (error: unknown) => error instanceof Error && error.message === "Public definition metadata is unavailable.";
test("desktop metadata probe forwards only the captured public query and clears its deadline", async () => {
  const time = clock(), calls: unknown[] = [];
  const value = await readDesktopPublishedDefinition(readQuery, {...time, desktopApi: {async readAssetDefinitionVersion(query) {calls.push(query); return publicEnvelope;}}});
  assert.deepEqual(value, publicEnvelope); assert.deepEqual(calls, [readQuery]); assert.deepEqual(time.cleared, [1]);
});
test("desktop metadata probe safely refuses missing, failed and oversized replies", async () => {
  for (const desktopApi of [undefined, {async readAssetDefinitionVersion() {throw new Error("synthetic private failure detail");}}, {async readAssetDefinitionVersion() {return {excess: "x".repeat(262_145)};}}]) {
    const time = clock(); await assert.rejects(readDesktopPublishedDefinition(readQuery, {...time, desktopApi} as any), safeReadError);
  }
});
test("desktop metadata probe has an executable bounded timeout", async () => {
  const time = clock(), pending = readDesktopPublishedDefinition(readQuery, {...time, desktopApi: {readAssetDefinitionVersion: () => new Promise(() => {})}});
  assert.equal(time.callbacks.length, 1); time.callbacks[0]!(); await assert.rejects(pending, safeReadError); assert.deepEqual(time.cleared, [1]);
});
function browserEnvironment(fetcher: typeof fetch, paired = true) {
  const time = clock(); return {...time, location: {origin: "http://127.0.0.1:19000"}, localStorage: {getItem(key: string) {assert.equal(key, "ai-system-builder.paired-device-token"); return paired ? "synthetic-fixture-value" : null;}}, fetch: fetcher};
}
test("browser metadata probe uses the paired same-origin exact GET and bounded chunk decoding", async () => {
  const calls: unknown[] = []; const raw = new TextEncoder().encode(JSON.stringify(publicEnvelope));
  const environment = browserEnvironment(async (url, options) => {calls.push({url: String(url), options}); return new Response(new ReadableStream({start(controller) {controller.enqueue(raw.slice(0, 7)); controller.enqueue(raw.slice(7)); controller.close();}}));});
  assert.deepEqual(await readBrowserPublishedDefinition(readQuery, environment), publicEnvelope);
  assert.equal(calls.length, 1); const call = calls[0] as {url: string; options: RequestInit};
  assert.equal(call.url, "http://127.0.0.1:19000/api/assets/definitions/asset.synthetic-summary/versions/1.0.0?workspaceId=workspace.fixture");
  assert.deepEqual(call.options.headers, {"x-client-source": "thin-client", Authorization: "Bearer synthetic-fixture-value"});
  assert.equal(call.options.method, "GET"); assert.equal(call.options.redirect, "error"); assert.equal(call.options.credentials, "omit");
  assert.equal(call.options.signal?.aborted, true); assert.deepEqual(environment.cleared, [1]);
});
test("browser metadata probe refuses missing pairing before any fetch", async () => {
  let calls = 0; const environment = browserEnvironment(async () => {calls++; return new Response("{}");}, false);
  await assert.rejects(readBrowserPublishedDefinition(readQuery, environment), safeReadError); assert.equal(calls, 0); assert.deepEqual(environment.cleared, [1]);
});
test("browser metadata probe bounds output and hides failed HTTP, malformed and interrupted replies", async () => {
  for (const fetcher of [
    async () => new Response("synthetic private failure", {status: 503}),
    async () => new Response("{synthetic malformed reply"),
    async () => new Response(new Uint8Array([0xc3, 0x28])),
    async () => new Response("x".repeat(262_145)),
    async () => new Response(null),
    async () => {throw new Error("synthetic private network detail");},
    async () => new Response(new ReadableStream({start(controller) {controller.error(new Error("synthetic stream detail"));}})),
  ]) {const environment = browserEnvironment(fetcher); await assert.rejects(readBrowserPublishedDefinition(readQuery, environment), safeReadError); assert.deepEqual(environment.cleared, [1]);}
});
test("browser metadata timeout aborts the owned read and clears the timer", async () => {
  let signal: AbortSignal | undefined;
  const environment = browserEnvironment(async (_url, options) => {signal = options!.signal!; return new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(new Error("synthetic abort detail")), {once: true}));});
  const pending = readBrowserPublishedDefinition(readQuery, environment); assert(signal && !signal.aborted);
  environment.callbacks[0]!(); await assert.rejects(pending, safeReadError); assert.equal(signal.aborted, true); assert.deepEqual(environment.cleared, [1]);
});
