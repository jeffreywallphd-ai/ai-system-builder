import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createOrganizationId } from "../../../../../contracts/organization";
import { createFilesystemIngestionFileByteStorageAdapter } from "../createFilesystemIngestionFileByteStorageAdapter";

const key = `workspaces/workspace-a/artifacts/files/ingestion/${"a".repeat(32)}`;
const context = { workspaceId: "workspace-a" };
const digest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
const content = async function* (bytes: Uint8Array) { yield bytes; };
const request = (bytes = new Uint8Array([1, 2, 3])) => ({ descriptor: { key, mediaType: "application/octet-stream" },
  content: content(bytes), maximumBytes: bytes.length, expectedSizeBytes: bytes.length, expectedSha256: digest(bytes), overwrite: false });
async function fixture(run: (root: string, storage: ReturnType<typeof createFilesystemIngestionFileByteStorageAdapter>) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "owned-ingestion-bytes-"));
  try { await run(root, createFilesystemIngestionFileByteStorageAdapter({ rootDirectory: root })); }
  finally { assert.ok(path.isAbsolute(root) && root.startsWith(path.join(tmpdir(), "owned-ingestion-bytes-"))); await rm(root, { recursive: true, force: true }); }
}

test("checkpoint inspection validates the full stream without creating a target", async () => fixture(async (root, storage) => {
  const bytes = new Uint8Array([1, 2, 3]);
  const result = await storage.verifyContent(request(bytes), context);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { sizeBytes: 3, digest: digest(bytes) });
  assert.deepEqual(await readdir(root), []);
}));

test("checkpoint inspection rejects invalid scope and bounds before reading producer bytes", async () => fixture(async (root, storage) => {
  const invalidInputs = [
    { maximumBytes: -1 },
    { maximumBytes: Number.NaN },
    { maximumBytes: Number.MAX_SAFE_INTEGER },
    { expectedSizeBytes: -1 },
    { expectedSizeBytes: 1.5 },
    { expectedSizeBytes: 4 },
    { expectedSha256: "invalid" as ReturnType<typeof digest> },
  ];
  for (const patch of invalidInputs) {
    let reads = 0;
    const input = { ...request(), ...patch, content: (async function* () { reads++; yield new Uint8Array([1, 2, 3]); })() };
    assert.equal((await storage.verifyContent(input, context)).ok, false);
    assert.equal(reads, 0);
  }
  let reads = 0;
  assert.equal((await storage.verifyContent({ ...request(), content: (async function* () { reads++; yield new Uint8Array([1, 2, 3]); })() }, {})).ok, false);
  assert.equal(reads, 0);
  assert.deepEqual(await readdir(root), []);
}));

test("exclusive publication returns exact digest and preserves desktop's canonical byte location", async () => fixture(async (root, storage) => {
  const bytes = new Uint8Array([1, 2, 3]);
  const result = await storage.storeArtifactStream(request(bytes), { ...context, organizationId: createOrganizationId("organization-a") });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { key, mediaType: "application/octet-stream", sizeBytes: 3, checksum: { algorithm: "sha256", value: digest(bytes).slice(7) } });
  assert.deepEqual(new Uint8Array(await readFile(path.join(root, key))), bytes);
  await assert.rejects(readFile(path.join(root, "organizations/organization-a", key)), { code: "ENOENT" });
}));

for (const mode of ["digest", "size", "oversize", "stream-failure"] as const) {
  test(`rejects ${mode} before linking the final target`, async () => fixture(async (root, storage) => {
    const input = request();
    if (mode === "digest") input.expectedSha256 = `sha256:${"b".repeat(64)}`;
    if (mode === "size") input.expectedSizeBytes = 2;
    if (mode === "oversize") input.maximumBytes = 2;
    if (mode === "stream-failure") input.content = (async function* () { yield new Uint8Array([1]); throw new Error("synthetic-private-detail"); })();
    const result = await storage.storeArtifactStream(input, context);
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-private-detail|owned-ingestion-bytes/);
    await assert.rejects(readFile(path.join(root, key)), { code: "ENOENT" });
  }));
}

test("a conflicting target survives and concurrent writers cannot overwrite the winner", async () => fixture(async (root, storage) => {
  await mkdir(path.dirname(path.join(root, key)), { recursive: true });
  await writeFile(path.join(root, key), "foreign-sentinel");
  assert.equal((await storage.storeArtifactStream(request(), context)).ok, false);
  assert.equal(await readFile(path.join(root, key), "utf8"), "foreign-sentinel");
  const otherKey = key.replace(/a{32}$/, "c".repeat(32));
  const inputs = [new Uint8Array([4, 5]), new Uint8Array([6, 7])].map(bytes => ({ ...request(bytes), descriptor: { key: otherKey, mediaType: "application/octet-stream" } }));
  const results = await Promise.all(inputs.map(input => storage.storeArtifactStream(input, context)));
  assert.equal(results.filter(r => r.ok).length, 1);
  const winner = results.findIndex(r => r.ok);
  assert.deepEqual(new Uint8Array(await readFile(path.join(root, otherKey))), winner === 0 ? new Uint8Array([4, 5]) : new Uint8Array([6, 7]));
}));

test("unsafe publication inputs deny before consuming the stream", async () => fixture(async (_root, storage) => {
  for (const patch of [{ overwrite: true }, { expectedSha256: undefined }, { maximumBytes: -1 },
    { descriptor: { key: key.replace("workspace-a", "workspace-b"), mediaType: "application/octet-stream" } },
    { descriptor: { key: "../escape", mediaType: "application/octet-stream" } },
    { descriptor: { key, mediaType: "text/plain;private=detail" } }]) {
    let reads = 0;
    const input = { ...request(), ...patch, content: (async function* () { reads++; yield new Uint8Array([1, 2, 3]); })() };
    assert.equal((await storage.storeArtifactStream(input, context)).ok, false);
    assert.equal(reads, 0);
  }
}));

test("server publication captures exact organization mapping and rejects conflicting context", async () => fixture(async (root) => {
  const organizationId = createOrganizationId("organization-a");
  const storage = createFilesystemIngestionFileByteStorageAdapter({ rootDirectory: root,
    organizationContextProvider: { getCurrentOrganizationContext: () => ({ organizationId, principalId: "principal-a" }) } });
  let reads = 0;
  assert.equal((await storage.storeArtifactStream({ ...request(), content: (async function* () { reads++; yield new Uint8Array([1, 2, 3]); })() }, context)).ok, false);
  assert.equal(reads, 0);
  assert.equal((await storage.storeArtifactStream(request(), { ...context, organizationId })).ok, true);
  assert.deepEqual(new Uint8Array(await readFile(path.join(root, "organizations", organizationId, key))), new Uint8Array([1, 2, 3]));
  await assert.rejects(readFile(path.join(root, key)), { code: "ENOENT" });
}));

test("empty files retain exact size and digest semantics", async () => fixture(async (root, storage) => {
  assert.equal((await storage.verifyContent(request(new Uint8Array()), context)).ok, true);
  assert.equal((await storage.storeArtifactStream(request(new Uint8Array()), context)).ok, true);
  assert.equal((await readFile(path.join(root, key))).length, 0);
}));
