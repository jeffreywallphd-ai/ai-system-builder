import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, readFile, readdir, rm, mkdir, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {test} from "node:test";
import {CONTEXT_GENERATION_LIMITS, CONTEXT_MARKDOWN_PACK_MEDIA_TYPE, CONTEXT_RAG_DATABASE_MEDIA_TYPE}
  from "../../../../../contracts/context-management";
import type {ContextArtifactMediaType} from "../../../../../contracts/context-management";
import {createOrganizationId} from "../../../../../contracts/organization";
import {createFilesystemContextResultByteStorageAdapter} from "../createFilesystemContextResultByteStorageAdapter";
import {verifiedPublicationStream} from "../verifiedPublicationStream";

const publicationId = "a".repeat(32);
const key = `workspaces/workspace-a/artifacts/context/${publicationId}`;
const context = {workspaceId: "workspace-a"};
const digest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const stream = async function* (bytes: Uint8Array) {yield bytes;};
const request = (bytes = new Uint8Array([1, 2, 3])) => ({publicationId, mediaType: CONTEXT_MARKDOWN_PACK_MEDIA_TYPE as ContextArtifactMediaType,
  expectedSizeBytes: bytes.length, expectedSha256: digest(bytes), content: stream(bytes)});
async function fixture(run: (root: string, storage: ReturnType<typeof createFilesystemContextResultByteStorageAdapter>) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "owned-context-result-bytes-"));
  try {await run(root, createFilesystemContextResultByteStorageAdapter({rootDirectory: root}));}
  finally {
    assert.ok(path.isAbsolute(root) && root.startsWith(path.join(tmpdir(), "owned-context-result-bytes-")));
    await rm(root, {recursive: true, force: true});
  }
}
async function noTarget(root: string, target = key) {
  await assert.rejects(readFile(path.join(root, target)), {code: "ENOENT"});
}
function noPrivateError(result: unknown) {
  assert.doesNotMatch(JSON.stringify(result), /owned-context-result-bytes|private-synthetic-detail|RangeError|byteLength/);
}

for (const mediaType of [CONTEXT_MARKDOWN_PACK_MEDIA_TYPE, CONTEXT_RAG_DATABASE_MEDIA_TYPE]) {
  test(`Context publication stores exact ${mediaType} bytes without registering metadata`, async () => fixture(async (root, storage) => {
    const input = {...request(), mediaType};
    const result = await storage.publishResult(input, context);
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.value, {key, mediaType, sizeBytes: 3,
      checksum: {algorithm: "sha256", value: input.expectedSha256.slice(7)}});
    assert.deepEqual(new Uint8Array(await readFile(path.join(root, key))), new Uint8Array([1, 2, 3]));
    // The only output tree is the workspace byte namespace. There is no catalog,
    // binding repository, runtime or metadata writer in this adapter's options.
    assert.deepEqual(await readdir(root), ["workspaces"]);
  }));
}

test("Context publication rejects malformed identities, scope, media and bounds before consuming bytes", async () => fixture(async (root, storage) => {
  const patches: unknown[] = [{publicationId: "../escape"}, {publicationId: "A".repeat(32)}, {publicationId: 123},
    {publicationId: `${publicationId}/child`}, {mediaType: "text/plain"}, {mediaType: `${CONTEXT_RAG_DATABASE_MEDIA_TYPE};private=true`},
    {expectedSizeBytes: 0}, {expectedSizeBytes: -1}, {expectedSizeBytes: 1.5}, {expectedSizeBytes: Number.NaN},
    {expectedSizeBytes: CONTEXT_GENERATION_LIMITS.maximumArtifactBytes + 1}, {expectedSha256: undefined},
    {expectedSha256: `sha256:${"B".repeat(64)}`}, {expectedSha256: "invalid"}];
  for (const patch of patches) {
    let reads = 0;
    const input = {...request(), ...(patch as object), content: (async function* () {reads++; yield new Uint8Array([1, 2, 3]);})()};
    const result = await storage.publishResult(input, context);
    assert.equal(result.ok, false);
    assert.equal(reads, 0);
    noPrivateError(result);
  }
  let reads = 0;
  const result = await storage.publishResult({...request(), content: (async function* () {reads++; yield new Uint8Array([1]);})()}, {});
  assert.equal(result.ok, false);
  assert.equal(reads, 0);
  await noTarget(root);
}));

for (const failure of ["digest", "short", "long", "late-extra", "producer-error", "non-bytes"] as const) {
  test(`Context publication rejects ${failure} before final publication and hides producer errors`, async () => fixture(async (root, storage) => {
    const input = request();
    if (failure === "digest") input.expectedSha256 = `sha256:${"b".repeat(64)}`;
    if (failure === "short") input.content = stream(new Uint8Array([1, 2]));
    if (failure === "long") input.content = stream(new Uint8Array([1, 2, 3, 4]));
    if (failure === "late-extra") input.content = (async function* () {yield new Uint8Array([1, 2, 3]); yield new Uint8Array([4]);})();
    if (failure === "producer-error") input.content = (async function* () {yield new Uint8Array([1, 2, 3]); throw new Error("private-synthetic-detail");})();
    if (failure === "non-bytes") input.content = (async function* () {yield "private-synthetic-detail" as unknown as Uint8Array;})();
    const result = await storage.publishResult(input, context);
    assert.equal(result.ok, false);
    noPrivateError(result);
    await noTarget(root);
  }));
}

test("Context publication preserves a conflicting target and admits only one concurrent writer", async () => fixture(async (root, storage) => {
  await mkdir(path.dirname(path.join(root, key)), {recursive: true});
  await writeFile(path.join(root, key), "foreign-sentinel");
  assert.equal((await storage.publishResult(request(), context)).ok, false);
  assert.equal(await readFile(path.join(root, key), "utf8"), "foreign-sentinel");
  const otherId = "c".repeat(32), otherKey = key.replace(publicationId, otherId);
  const bytes = [new Uint8Array([4, 5]), new Uint8Array([6, 7])];
  const results = await Promise.all(bytes.map(value => storage.publishResult({...request(value), publicationId: otherId}, context)));
  assert.equal(results.filter(value => value.ok).length, 1);
  assert.deepEqual(new Uint8Array(await readFile(path.join(root, otherKey))), bytes[results.findIndex(value => value.ok)]);
}));

test("Context publication copies bytes before producer mutation and ignores instance size accessors", async () => fixture(async (root, storage) => {
  const bytes = new Uint8Array([7, 8, 9]);
  const input = request(bytes);
  let sizeReads = 0;
  Object.defineProperty(bytes, "byteLength", {get() {sizeReads++; return 0;}});
  input.content = (async function* () {yield bytes; bytes.fill(0);})();
  assert.equal((await storage.publishResult(input, context)).ok, true);
  assert.equal(sizeReads, 0);
  assert.deepEqual(new Uint8Array(await readFile(path.join(root, key))), new Uint8Array([7, 8, 9]));
}));

test("Context oversized chunks deny without evaluating a false instance size", async () => fixture(async (root, storage) => {
  const bytes = new Uint8Array([7, 8, 9]);
  let sizeReads = 0;
  Object.defineProperty(bytes, "byteLength", {get() {sizeReads++; return 0;}});
  assert.equal((await storage.publishResult({...request(bytes), expectedSizeBytes: 1}, context)).ok, false);
  assert.equal(sizeReads, 0);
  await noTarget(root);
}));

test("Context server publication captures organization, request and caller facts before awaits", async () => fixture(async (root) => {
  const organizationId = createOrganizationId("organization-a");
  const record = {organizationId, principalId: "principal-a"};
  const storage = createFilesystemContextResultByteStorageAdapter({rootDirectory: root,
    organizationContextProvider: {getCurrentOrganizationContext: () => record}});
  const supplied = {...context, organizationId};
  const input = request();
  input.content = (async function* () {
    supplied.workspaceId = "workspace-b";
    supplied.organizationId = createOrganizationId("organization-b");
    record.organizationId = createOrganizationId("organization-c");
    input.publicationId = "d".repeat(32);
    input.expectedSizeBytes = 100;
    yield new Uint8Array([1, 2, 3]);
  })();
  const result = await storage.publishResult(input, supplied);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.key, key);
  assert.deepEqual(new Uint8Array(await readFile(path.join(root, "organizations", organizationId, key))), new Uint8Array([1, 2, 3]));
  await noTarget(root);
  await noTarget(root, `organizations/organization-b/${key}`);
  await noTarget(root, `organizations/organization-c/${key}`);
}));

test("Context server publication rejects missing or foreign organization before reading content", async () => fixture(async (root) => {
  const organizationId = createOrganizationId("organization-a");
  const storage = createFilesystemContextResultByteStorageAdapter({rootDirectory: root,
    organizationContextProvider: {getCurrentOrganizationContext: () => ({organizationId, principalId: "principal-a"})}});
  for (const supplied of [context, {...context, organizationId: createOrganizationId("organization-b")}]) {
    let reads = 0;
    const result = await storage.publishResult({...request(), content: (async function* () {reads++; yield new Uint8Array([1, 2, 3]);})()}, supplied);
    assert.equal(result.ok, false);
    assert.equal(reads, 0);
  }
  assert.deepEqual(await readdir(root), []);
}));

test("private stream verification cannot report success after a rejected EOF", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const verified = verifiedPublicationStream({content: stream(bytes), maximumBytes: 3, expectedSizeBytes: 3,
    expectedSha256: `sha256:${"b".repeat(64)}`}, 3);
  assert.throws(() => verified.result(), /Incomplete content/);
  await assert.rejects(async () => {for await (const _chunk of verified.content) {/* inspection */}}, /verification failed/);
  assert.throws(() => verified.result(), /Incomplete content/);
});
