import assert from "node:assert/strict";
import test from "node:test";
import { readWebsiteHostFixture, websiteArtifactPair, websiteHostReport, WEBSITE_HOST_PHASES } from "../visual-composer/website-acquisition-oracles";
import { qualifyWebsiteAcquisitionJourney } from "../visual-composer/e2e/website-acquisition-journey";
import type { Page, TestInfo } from "@playwright/test";

const fixture = () => ({ schemaVersion: "authorized-website-host-fixture-v1", pageUrl: "https://qualification.example.org/synthetic.html", expectedText: "Synthetic website qualification marker.", authorizationRef: "approved-fixture-scope" });
const encode = (value: unknown) => JSON.stringify(value);
test("admits an explicit bounded public synthetic declaration without treating it as authorization", () => {
  assert.equal(readWebsiteHostFixture(undefined), undefined); assert.equal(readWebsiteHostFixture(""), undefined);
  const input = fixture(), actual = readWebsiteHostFixture(encode(input));
  assert.deepEqual(actual, input); assert(Object.isFrozen(actual)); input.expectedText = "Changed marker."; assert.notEqual(actual!.expectedText, input.expectedText);
});
test("refuses unsafe target forms and never includes the input in its error", () => {
  for (const pageUrl of ["http://example.org/test", "https://localhost/test", "https://127.0.0.1/test", "https://[::1]/test", "https://2130706433/test", "https://user:private@example.org/test", "https://example.org/test?token=private", "https://example.org/test#private", "https://example.org:8443/test", "https://example.local/test", "https://example.invalid/test", "https://example.org/%0a", "https://EXAMPLE.org/test", "not-a-url"]) {
    assert.throws(() => readWebsiteHostFixture(encode({ ...fixture(), pageUrl })), error => error instanceof Error && error.message === "The authorized public website test fixture is unavailable or invalid.");
  }
});
test("refuses malformed schema, excess fields, unsupported markers and oversized declarations before coercion", () => {
  const input = fixture();
  for (const value of [null, 0, false, [], {}, { ...input, extra: true }, { ...input, schemaVersion: "other" }, { ...input, authorizationRef: "private token" }, { ...input, expectedText: "<script>private</script>" }, { ...input, expectedText: "x".repeat(129) }, { ...input, pageUrl: "x".repeat(513) }]) assert.throws(() => readWebsiteHostFixture(encode(value)));
  for (const value of ["{", " ".repeat(2049), { toString() { throw new Error("private-coercion"); } }]) assert.throws(() => readWebsiteHostFixture(value), /fixture is unavailable or invalid/);
});
const workspace = "workspace.fixture-a", prefix = `workspaces/${workspace}/artifacts/files/website/`;
const pair = (source = "source.task.file", snapshot = "snapshot.task.file") => [`${prefix}${source}/${snapshot}.html`, `${prefix}${source}/${snapshot}.txt`];
test("binds raw and readable artifacts to one exact workspace/source/snapshot", () => {
  const keys = pair(); assert.deepEqual(websiteArtifactPair(workspace, keys), { rawKey: keys[0], textKey: keys[1] });
  assert.deepEqual(websiteArtifactPair(workspace, [...keys].reverse()), websiteArtifactPair(workspace, keys));
  assert(Object.isFrozen(websiteArtifactPair(workspace, keys)));
});
test("denies foreign, duplicate, traversal, partial and mismatched output identities", () => {
  const keys = pair();
  for (const value of [[], [keys[0]], [...keys, keys[0]], [keys[0], keys[0]], [keys[0], pair("source.other")[1]], [keys[0], pair("source.task.file", "snapshot.other")[1]], [keys[0], keys[1]!.replace(workspace, "workspace.foreign")], [keys[0], `${prefix}source.a/../snapshot.a.txt`], [keys[0], "private-path"], [keys[0], "x".repeat(641)], [undefined, keys[1]]]) assert.throws(() => websiteArtifactPair(workspace, value));
  assert.throws(() => websiteArtifactPair("workspace/foreign", keys));
  let reads = 0; const accessor = [...keys]; Object.defineProperty(accessor, "0", { get() { reads++; return keys[0]; } });
  assert.throws(() => websiteArtifactPair(workspace, accessor)); assert.equal(reads, 0);
});
test("partial and failed phases cannot pass or claim parent qualification", () => {
  for (let count = 0; count < WEBSITE_HOST_PHASES.length; count++) assert.equal(websiteHostReport(WEBSITE_HOST_PHASES.slice(0, count), false).status, "failed");
  const report = websiteHostReport(WEBSITE_HOST_PHASES, false); assert.equal(report.status, "passed"); assert.equal(report.parentQualificationGranted, false);
  assert.equal(websiteHostReport(WEBSITE_HOST_PHASES, true).status, "failed");
  assert.throws(() => websiteHostReport(["private error"], true)); assert.throws(() => websiteHostReport([...WEBSITE_HOST_PHASES, WEBSITE_HOST_PHASES[0]], false));
});

test("refuses an invalid declaration before reading the Page port", async () => {
  let reads = 0;
  const page = { getByLabel() { reads++; throw new Error("private-page"); } } as unknown as Page;
  const info = { project: { name: "thin-chrome" } } as TestInfo;
  for (const input of [undefined, "{", encode({ ...fixture(), pageUrl: "http://localhost/private" })]) await assert.rejects(qualifyWebsiteAcquisitionJourney(page, info, input), /prerequisites are invalid|fixture is unavailable or invalid/);
  assert.equal(reads, 0);
});
test("initial Page and attachment failures preserve a fixed phase without private diagnostic content", async () => {
  const page = { getByLabel() { throw new Error("private-page-token"); } } as unknown as Page;
  const reports: ReturnType<typeof websiteHostReport>[] = [];
  const info = { project: { name: "thin-chrome" }, attach: async (_: string, input: { body: string }) => { reports.push(JSON.parse(input.body)); } } as unknown as TestInfo;
  await assert.rejects(qualifyWebsiteAcquisitionJourney(page, info, encode(fixture())), /^Error: Website host phase did not complete: workspace-owned\.$/);
  assert.equal(reports.length, 1); assert.equal(reports[0]!.status, "failed"); assert.deepEqual(reports[0]!.phases, []);
  assert(!encode(reports).includes("private-page"));
  info.attach = async () => { throw new Error("private-attachment-token"); };
  await assert.rejects(qualifyWebsiteAcquisitionJourney(page, info, encode(fixture())), /^Error: Website host report unavailable; last phase: workspace-owned\.$/);
});

test("report and artifact admission refuse sparse, accessor, proxy and method-overridden arrays", () => {
  const sparse = new Array(WEBSITE_HOST_PHASES.length);
  const ownSome = [...WEBSITE_HOST_PHASES]; Object.defineProperty(ownSome, "some", { value: () => false });
  const ownIterator = [...WEBSITE_HOST_PHASES]; Object.defineProperty(ownIterator, Symbol.iterator, { value: function* () { yield "private-report-content"; } });
  const accessor = [...WEBSITE_HOST_PHASES]; let reads = 0; Object.defineProperty(accessor, "0", { get() { reads++; return WEBSITE_HOST_PHASES[0]; } });
  const proxy = new Proxy([...WEBSITE_HOST_PHASES], { get() { reads++; throw new Error("private-proxy"); } });
  for (const input of [sparse, ownSome, ownIterator, accessor, proxy]) assert.throws(() => websiteHostReport(input, false), /fixture is unavailable or invalid/);
  for (const input of [new Array(2), new Proxy(pair(), { getOwnPropertyDescriptor() { reads++; throw new Error("private-proxy"); } })]) assert.throws(() => websiteArtifactPair(workspace, input), /fixture is unavailable or invalid/);
  assert.equal(reads, 0);
});
