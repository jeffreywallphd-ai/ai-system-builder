import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {lstat, mkdtemp, realpath, rm} from "node:fs/promises";
import {request} from "node:https";
import {tmpdir} from "node:os";
import path from "node:path";
import type {TestContext} from "node:test";
import {openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy} from "../../../../adapters/persistence/sqlite";
import {createStructuredOrganizationRepositories} from "../../../../adapters/persistence/organization";
import {initializeLocalIdentityProfile} from "../../../../adapters/security/local-identity";
import {createLocalWorkspaceRepository} from "../../../../adapters/persistence/workspace";
import {createDesktopPinnedLoopbackAgent} from "../../../../adapters/transport/headless-loopback";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {parseHeadlessBuildPlanProposal, type HeadlessHostIncarnationId} from "../../../../contracts/headless";

export const revision = "a".repeat(40), modelId = "fixture/model", timestamp = "2026-11-28T00:00:00.000Z";
export const workspaceId = createWorkspaceId("workspace.public-model-download");

export async function fixture(t: TestContext, options: {
  contents?: Readonly<Record<string, Uint8Array>>;
  runtimeOrigin?: string;
  canCleanup?: () => boolean;
} = {}) {
  const parent = await realpath(tmpdir()), folder = await realpath(await mkdtemp(path.join(parent, options.contents ? "source-recipient-worker-" : "model-public-root-")));
  const original = await lstat(folder, {bigint: true});
  const database = await openLocalSqliteDatabase({policy: resolveLocalSqliteDatabasePolicy({dataRootDirectory: folder})});
  const documents = database.documents;
  let metadataReads = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (options.runtimeOrigin && url.origin === options.runtimeOrigin) return previousFetch(input, init);
    assert.equal(url.origin, "https://huggingface.co"); metadataReads++;
    const segments = url.pathname.split("/");
    const selectedRevision = segments[segments.length - 1];
    assert.equal(selectedRevision, revision);
    if (url.pathname === `/api/models/${modelId}/revision/${selectedRevision}`)
      return Response.json({id: modelId, sha: selectedRevision, cardData: {license: "apache-2.0"}});
    assert.equal(url.pathname, `/api/models/${modelId}/tree/${selectedRevision}`);
    const files = ["config.json", "tokenizer.json", "model.safetensors"].map(name => {
      const bytes = options.contents?.[name];
      const size = bytes?.byteLength ?? 10;
      const oid = bytes ? createHash("sha1").update(`blob ${size}\0`).update(bytes).digest("hex") : "b".repeat(40);
      return {type: "file", path: name, size, oid, ...(name.endsWith("safetensors") ? {lfs: {
        oid: bytes ? createHash("sha256").update(bytes).digest("hex") : "c".repeat(64), size, pointerSize: 120}} : {})};
    });
    return Response.json(options.contents ? [...files, {type: "file", path: "README.md", size: 12, oid: "d".repeat(40)}] : files);
  };
  t.after(async () => {
    globalThis.fetch = previousFetch;
    assert.ok(!options.canCleanup || options.canCleanup(), "Original host shutdown must be confirmed before fixture cleanup.");
    await database.close();
    const current = await lstat(folder, {bigint: true});
    assert.equal(await realpath(folder), folder); assert.equal(path.dirname(folder), parent);
    assert.ok(current.isDirectory() && !current.isSymbolicLink()); assert.equal(current.dev, original.dev); assert.equal(current.ino, original.ino);
    await rm(folder, {recursive: true});
  });
  const identity = await initializeLocalIdentityProfile({documents, organizationDisplayName: "Synthetic", principalDisplayName: "Synthetic",
    now: () => timestamp, createId: () => randomUUID()});
  const organizationDocuments = documents.forOrganization(identity.organizationId);
  const workspaces = createLocalWorkspaceRepository({documents: organizationDocuments, rootDirectory: folder});
  await workspaces.saveWorkspace({workspaceId, organizationId: identity.organizationId, displayName: "Synthetic", status: "active",
    createdAt: timestamp, updatedAt: timestamp});
  const repositories = createStructuredOrganizationRepositories(documents);
  const membership = await repositories.memberships.readMembership(identity); assert.ok(membership);
  return {folder, documents, organizationDocuments, identity, repositories, membership, reads: () => metadataReads,
    rootIdentity: Object.freeze({device: original.dev.toString(), inode: original.ino.toString()})};
}

export function proposal(hostIncarnationId: HeadlessHostIncarnationId, source: unknown) {
  const sourceManifest = {source, manifestDigest: "sha256:" + createHash("sha256").update(JSON.stringify(source)).digest("hex")};
  const input = {hostIncarnationId, workspaceId, steps: [{operation: "models.download", idempotencyKey: randomUUID(),
    name: "Synthetic Model", sourceManifest, allowedOrigins: ["https://huggingface.co"], maximumDurationSeconds: 30, inferenceMode: "causal"}]};
  const parsed = parseHeadlessBuildPlanProposal(input, hostIncarnationId, {allowLocalFileSave: false, allowModelDownload: true});
  assert.ok(parsed.ok);
  return {...input, fingerprint: createHash("sha256").update(JSON.stringify(parsed.preview)).digest("hex")};
}

export async function post(connector: {endpoint: string; fingerprint: string}, route: string, value: unknown, credential?: string, timeoutMs = 8000) {
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 20_000);
  const agent = createDesktopPinnedLoopbackAgent(connector.endpoint, connector.fingerprint), body = JSON.stringify(value);
  try {
    return await new Promise<any>((resolve, reject) => {
      const call = request(new URL(route, connector.endpoint), {method: "POST", agent,
        headers: {"Content-Type": "application/json", "Content-Length": Buffer.byteLength(body),
          ...(credential ? {Authorization: "Bearer " + credential} : {})}}, response => {
        let text = ""; response.setEncoding("utf8");
        response.on("data", chunk => {text += chunk; if (text.length > 128 * 1024) call.destroy(new Error("Oversized synthetic response."));});
        response.on("error", reject); response.on("end", () => {try {resolve(JSON.parse(text));} catch (error) {reject(error);}});
      });
      call.setTimeout(timeoutMs, () => call.destroy(new Error("Synthetic request timed out.")));
      call.on("error", reject); call.end(body);
    });
  } finally {agent.destroy();}
}

/** Every captured original owner is attempted, including after a falsy throw. */
export async function closeFixtureOwners(closeApi?: () => Promise<void>, closeHost?: () => Promise<void>): Promise<void> {
  const failures: unknown[] = [];
  for (const close of [closeApi, closeHost]) {
    if (!close) continue;
    try {await close();} catch (error) {failures.push(error);}
  }
  if (failures.length) throw new AggregateError(failures, "Original fixture shutdown is unconfirmed.");
}

