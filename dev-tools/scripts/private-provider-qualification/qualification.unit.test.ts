import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { boundedHubFetch, main, publicationFixture, qualificationPlan, QualificationError, validateConfig, verifyExistingFixture } from "./qualification";
import { DurablePublicationError, openQualificationPersistence, replayEnvironment, validateReplayInput, type DurablePublicationState } from "./durable-publication";
import { PublishDatasetVersionUseCase } from "../../../modules/application/use-cases/dataset-version/publish-dataset-version.use-case";
import { createSha256DatasetVersionHasher } from "../../../modules/adapters/storage/dataset-version";
import { createStructuredDatasetVersionRepository } from "../../../modules/adapters/persistence/dataset-version";
import { openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy } from "../../../modules/adapters/persistence/sqlite";
import { createContractError, createFailureResult, createSuccessResult } from "../../../modules/contracts/shared";
import { createRetrieveArtifactSuccessResult } from "../../../modules/contracts/storage";

const valid = { schema_version: "private-provider-qualification-v1", repository: "synthetic/private-test", credential_file: ".local-codex/profile/artifacts/config/hugging-face-token.json", private: true, creation_approved: true };
const repo = "synthetic/private-test";
const base = `https://huggingface.co/api/datasets/${repo}`;
const facts = () => ({ requests: 0, commits: 0, creates: 0 });

test("config permits only the explicit private dataset profile and existing bounded credential reference", () => {
  assert.deepEqual(validateConfig(valid), valid);
  for (const changed of [ { private: false }, { creation_approved: false }, { schema_version: "other" }, { repository: "https://other/private" }, { repository: "synthetic/../private" }, { repository: "synthetic/repo?token=secret" }, { credential_file: "C:/private/token.json" }, { credential_file: ".local-codex/../hugging-face-token.json" }, { credential_file: ".local-codex/profile/other.json" }, { token: "never-copy-a-token" } ]) {
    assert.throws(() => validateConfig({ ...valid, ...changed }), QualificationError);
  }
  for (const value of [null, [], "config", true]) assert.throws(() => validateConfig(value), QualificationError);
});

test("plan contains no credential value and performs no token read, network or payload effect", () => {
  const plan = qualificationPlan(validateConfig(valid));
  assert.equal(plan.external_effects, false); assert.equal(plan.credential_read, false);
  assert.equal(plan.deletion, false); assert.equal(plan.model_execution, false);
  assert.equal(plan.maximum_hub_api_requests, 24); assert.equal(plan.maximum_hub_upload_bytes_per_request, 16 * 1024);
  assert.equal(plan.maximum_hub_response_bytes_per_request, 64 * 1024);
  assert.equal(plan.hub_call_admission_window_seconds, 180); assert.equal(plan.hub_request_timeout_seconds, 20);
  assert.equal(plan.maximum_file_download_sessions, 6); assert.equal(plan.file_download_session_timeout_seconds, 60);
  assert.equal(plan.maximum_redirects_per_file_session, 2); assert.equal(plan.maximum_file_bytes_per_session, 16 * 1024);
  assert.equal(plan.hard_total_wall_clock_deadline, false);
  assert.equal(plan.restart_child_timeout_seconds, 20); assert.equal(plan.restart_input_bytes, 2048); assert.equal(plan.restart_output_bytes_per_stream, 4096);
  assert.equal(plan.metadata_file_limit_bytes, 1024 * 1024); assert.equal(plan.synthetic_metadata_retained, true);
  assert.equal("maximum_requests" in plan, false); assert.equal("maximum_seconds" in plan, false);
  assert.equal(JSON.stringify(plan).includes("credential_file"), false);
});

const revision = "a".repeat(40);
function freshOutput() {
  const parent = ".local-codex/private-provider-qualification";
  mkdirSync(parent, { recursive: true });
  const output = `${parent}/${randomUUID()}`; mkdirSync(output); return output;
}
function fixtureUseCase(repository: DurablePublicationState["repository"], fail = false) {
  const fixture = publicationFixture(); let calls = 0;
  const retrieveArtifact = async (request: any, context: any) => {
    const content = fixture.contents.get(request.key)!;
    return createRetrieveArtifactSuccessResult({ key: request.key, sizeBytes: content.byteLength }, content, context);
  };
  const forbidden = async () => { throw new Error("Synthetic unexpected artifact operation"); };
  const useCase = new PublishDatasetVersionUseCase({ repository, hasher: createSha256DatasetVersionHasher(),
    artifacts: { retrieveArtifact: retrieveArtifact as never, storeArtifact: forbidden, hasArtifact: forbidden, deleteArtifact: forbidden },
    publisher: { publishDatasetVersion: async () => { calls++; return fail
      ? createFailureResult(createContractError("unavailable", "Synthetic provider unavailable."))
      : createSuccessResult({ provider: "hugging-face" as const, repositoryId: repo, revision }); } } });
  const context = { workspaceId: fixture.version.workspaceId, principalId: "qualification" };
  const command = { workspaceId: fixture.version.workspaceId, versionId: fixture.version.versionId, repositoryId: repo, createRepository: true, confirmation: { approved: true as const, visibility: "private" as const } };
  return { fixture, calls: () => calls, execute: () => useCase.execute(command, context) };
}
test("restart input accepts only exact bounded synthetic identities, digest and immutable revision", () => {
  const input = { run_id: randomUUID(), nonce: randomUUID(), repository: repo, version_digest: "sha256:" + "b".repeat(64), revision };
  assert.deepEqual(validateReplayInput(input), input);
  for (const change of [{ run_id: "../old" }, { nonce: "secret" }, { repository: "other/../private" }, { repository: "https://other/private" }, { revision: "main" }, { version_digest: "sha256:wrong" }, { token: "synthetic-never-transmit" }]) {
    assert.throws(() => validateReplayInput({ ...input, ...change }), DurablePublicationError);
  }
  for (const input of [null, [], true]) assert.throws(() => validateReplayInput(input), DurablePublicationError);
});
test("fresh child environment excludes credentials, provider settings, ambient PATH and Node options", () => {
  const names = ["HF_TOKEN", "HUGGING_FACE_HUB_TOKEN", "NODE_OPTIONS", "PYTHON_RUNTIME_AUTH_TOKEN"];
  const old = names.map(name => process.env[name]);
  try {
    for (const name of names) process.env[name] = "synthetic-must-not-be-inherited";
    const env = replayEnvironment("synthetic-owned-temporary-directory");
    assert.deepEqual(Object.keys(env).filter(name => !["TEMP", "TMP", "SystemRoot", "WINDIR", "PATH", "HOMEDRIVE", "HOMEPATH", "USERPROFILE", "USERNAME", "USERDOMAIN", "LOGONSERVER", "SYSTEMDRIVE"].includes(name)), []);
    assert.equal(env.PATH, ""); assert.equal(env.USERNAME, "qualification");
    assert.equal(env.TEMP, "synthetic-owned-temporary-directory");
    assert.doesNotMatch(JSON.stringify(env), /synthetic-must-not|NODE_OPTIONS|HF_TOKEN/);
  } finally { names.forEach((name, i) => { if (old[i] === undefined) delete process.env[name]; else process.env[name] = old[i]; }); }
});
test("fixed replay process rejects bad argv, oversized input and extra fields with safe bounded copy", () => {
  const output = freshOutput(); const env = replayEnvironment(path.resolve(output));
  const entry = path.resolve("dev-tools/scripts/private-provider-qualification/durable-publication.ts");
  const loader = pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href;
  for (const [args, input] of [[[], "{}"], [["--replay", "--other"], "{}"], [["--replay"], "x".repeat(2049)], [["--replay"], '{"token":"synthetic-never-log"}']] as const) {
    const child = spawnSync(process.execPath, ["--import", loader, entry, ...args], { cwd: process.cwd(), env, input, encoding: "utf8", timeout: 20_000, maxBuffer: 4096, windowsHide: true });
    assert.equal(child.error, undefined); assert.equal(child.status, 1);
    assert.equal(JSON.parse(child.stdout).status, "replay-failed");
    assert.doesNotMatch(child.stdout, /synthetic-never|token|Bearer|stack|C:/); assert.ok(child.stdout.length <= 256);
  }
});
test("production SQLite publication survives close and a fresh offline process without a second upload", async t => {
  const output = freshOutput(); const state = await openQualificationPersistence(output); t.after(() => state.close());
  const flow = fixtureUseCase(state.repository); await state.repository.createVersion(flow.fixture.version);
  const published = await flow.execute(); assert.equal(published.ok, true); assert.equal(flow.calls(), 1);
  const replay = state.verifyRestart(repo, flow.fixture.version.versionDigest, revision);
  assert.equal(replay.fresh_process_exit_code, 0); assert.equal(replay.database_closed, true);
  assert.equal(replay.publication_records, 1); assert.equal(replay.publisher_calls, 0); assert.equal(replay.artifact_calls, 0);
  assert.equal(replay.version_unchanged, true); assert.equal(replay.revision_unchanged, true); assert.equal(replay.ambient_settings_absent, true);
  await assert.rejects(() => state.repository.listVersions(flow.fixture.version.workspaceId));
});
test("a failed restart assertion cannot produce evidence or prevent a later exact replay", async t => {
  const output = freshOutput(); const state = await openQualificationPersistence(output); t.after(() => state.close());
  const flow = fixtureUseCase(state.repository); await state.repository.createVersion(flow.fixture.version); assert.equal((await flow.execute()).ok, true);
  assert.throws(() => state.verifyRestart(repo, flow.fixture.version.versionDigest, "b".repeat(40)), DurablePublicationError);
  assert.equal(state.verifyRestart(repo, flow.fixture.version.versionDigest, revision).fresh_process_exit_code, 0);
});
test("provider failure preserves local version across database restart and permits explicit successful retry", async t => {
  const output = freshOutput(); const state = await openQualificationPersistence(output); t.after(() => state.close());
  const failedFlow = fixtureUseCase(state.repository, true); await state.repository.createVersion(failedFlow.fixture.version);
  assert.equal((await failedFlow.execute()).ok, false); assert.equal(failedFlow.calls(), 1);
  assert.deepEqual(await state.repository.listPublications(failedFlow.fixture.version.workspaceId), []); state.close();
  const reopened = await openLocalSqliteDatabase({ policy: resolveLocalSqliteDatabasePolicy({ dataRootDirectory: path.resolve(output, "durable-state") }) });
  try {
    const repository = createStructuredDatasetVersionRepository(reopened.documents);
    assert.deepEqual(await repository.readVersion(failedFlow.fixture.version.workspaceId, failedFlow.fixture.version.versionId), failedFlow.fixture.version);
    assert.deepEqual(await repository.listPublications(failedFlow.fixture.version.workspaceId), []);
    const retry = fixtureUseCase(repository); assert.equal((await retry.execute()).ok, true); assert.equal(retry.calls(), 1);
  } finally { reopened.close(); }
  assert.equal(state.verifyRestart(repo, failedFlow.fixture.version.versionDigest, revision).publication_records, 1);
});
test("run admission refuses old ownership, arbitrary paths and changed database inventory", async t => {
  for (const output of [".local-codex/private-provider-qualification/../old", ".local-codex/other/" + randomUUID(), "C:/private/state", ".local-codex/private-provider-qualification/not-a-run"]) {
    await assert.rejects(() => openQualificationPersistence(output));
  }
  const output = freshOutput(); const state = await openQualificationPersistence(output); t.after(() => state.close());
  await assert.rejects(() => openQualificationPersistence(output));
  const flow = fixtureUseCase(state.repository); await state.repository.createVersion(flow.fixture.version); assert.equal((await flow.execute()).ok, true); state.close();
  writeFileSync(path.join(output, "durable-state", "persistence", "unowned.txt"), "synthetic retain");
  assert.throws(() => state.verifyRestart(repo, flow.fixture.version.versionDigest, revision), DurablePublicationError);
});

test("restart rejects substituted owner, oversized database and hard-linked database without changing bytes", async t => {
  for (const fault of ["owner", "oversize", "hardlink"] as const) {
    const output = freshOutput(); const state = await openQualificationPersistence(output); t.after(() => state.close());
    const flow = fixtureUseCase(state.repository); await state.repository.createVersion(flow.fixture.version); assert.equal((await flow.execute()).ok, true); state.close();
    const file = path.join(output, "durable-state", "persistence", "ai-system-builder.sqlite3");
    if (fault === "owner") writeFileSync(path.join(output, "durable-owner.json"), JSON.stringify({ run_id: path.basename(output), nonce: randomUUID() }));
    if (fault === "oversize") writeFileSync(file, Buffer.alloc(1024 * 1024 + 1));
    if (fault === "hardlink") linkSync(file, path.join(output, "retained-database-link"));
    const before = readFileSync(file);
    assert.throws(() => state.verifyRestart(repo, flow.fixture.version.versionDigest, revision), DurablePublicationError);
    assert.deepEqual(readFileSync(file), before);
  }
});
test("run admission refuses a directory link instead of adopting another fixture", async () => {
  const target = freshOutput(); const linked = `.local-codex/private-provider-qualification/${randomUUID()}`;
  symlinkSync(path.resolve(target), linked, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(() => openQualificationPersistence(linked), DurablePublicationError);
});
test("fixed synthetic files use real documentation generator and consistent data references", () => {
  const fixture = publicationFixture();
  assert.equal(fixture.version.totalRows, 2);
  assert.deepEqual(fixture.files.map(f => f.path), ["README.md", "croissant.json", "data/dataset.jsonl"]);
  assert.ok(fixture.files.reduce((n, f) => n + f.content.length, 0) < 4096);
  assert.match(new TextDecoder().decode(fixture.files[0].content), /Synthetic software test data/);
  const croissant = JSON.parse(new TextDecoder().decode(fixture.files[1].content));
  assert.equal(croissant.distribution[0].contentUrl, "data/dataset.jsonl");
  assert.equal(croissant.distribution[0].sha256, fixture.version.artifacts[0].digest.slice(7));
  assert.equal(new TextDecoder().decode(fixture.files[2].content).trim().split("\n").length, 2);
  assert.deepEqual(publicationFixture().files, fixture.files);
});

test("existing destination guards preserve unrelated files and refuse changed fixture bytes", () => {
  const fixture = publicationFixture(); const existing = new Map(fixture.files.map(f => [f.path, f.content]));
  const metadata = { private: true, siblings: [...fixture.files.map(f => ({ rfilename: f.path })), { rfilename: "unrelated.txt" }] };
  verifyExistingFixture(metadata, existing);
  verifyExistingFixture({ private: true, siblings: [] }, new Map());
  assert.throws(() => verifyExistingFixture({ ...metadata, private: false }, existing), /did not complete/);
  assert.throws(() => verifyExistingFixture({ private: true }, existing), QualificationError);
  assert.throws(() => verifyExistingFixture(metadata, new Map()), QualificationError);
  assert.throws(() => verifyExistingFixture(metadata, new Map([...existing, ["README.md", new Uint8Array([0])]])), QualificationError);
  assert.throws(() => verifyExistingFixture({ private: true, siblings: Array(101).fill({}) }, new Map()), QualificationError);
});

test("transport denies foreign origins, URLs, endpoints, writes and body sizes before network", async () => {
  let calls = 0;
  const fetcher = boundedHubFetch(repo, facts(), (async () => { calls++; return new Response("{}"); }) as typeof fetch);
  for (const url of ["http://huggingface.co/api/datasets/" + repo, "https://other.example/api/datasets/" + repo, base + "?token=private", base + "#fragment", "https://user:secret@huggingface.co/api/datasets/" + repo, base + "/settings", "https://huggingface.co/api/datasets/foreign/repo", base + "/commit/other"]) {
    await assert.rejects(() => fetcher(url), QualificationError);
  }
  await assert.rejects(() => fetcher(base, { method: "DELETE" }), QualificationError);
  await assert.rejects(() => fetcher(base, { redirect: "follow" }), QualificationError);
  await assert.rejects(() => fetcher(base + "/commit/main", { method: "POST", body: "x".repeat(16 * 1024 + 1) }), QualificationError);
  await assert.rejects(() => fetcher(new URL(base)), QualificationError);
  assert.equal(calls, 0);
});

test("only the exact private-field metadata query is added to the existing request scope", async () => {
  let calls = 0;
  const bounded = boundedHubFetch(repo, facts(), (async () => { calls++; return new Response('{"private":true}'); }) as typeof fetch);
  assert.equal((await bounded(base + "?expand=private")).status, 200);
  for (const suffix of ["?expand=private&expand=cardData", "?expand=private&token=synthetic", "?expand=private&expand=private", "?expand=cardData", "?expand=private#fragment"]) {
    await assert.rejects(() => bounded(base + suffix), QualificationError);
  }
  await assert.rejects(() => bounded(base + "?expand=private", { method: "POST" }), QualificationError);
  await assert.rejects(() => bounded(base + "/commit/main?expand=private", { method: "POST", body: "{}" }), QualificationError);
  assert.equal(calls, 1);
});

test("the bounded transport preserves the production metadata request's cancellation", async () => {
  const controller = new AbortController(); let aborted = false;
  const bounded = boundedHubFetch(repo, facts(), (async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("synthetic-abort")); }, { once: true });
  })) as typeof fetch);
  const pending = bounded(base + "?expand=private", { signal: controller.signal });
  controller.abort(); await assert.rejects(() => pending); assert.equal(aborted, true);
  await assert.rejects(() => bounded(base, { signal: controller.signal }), QualificationError);
});

test("create is exact private dataset only and cannot repeat", async () => {
  const f = facts(); let calls = 0;
  const fetcher = boundedHubFetch(repo, f, (async () => { calls++; return new Response("{}"); }) as typeof fetch);
  const body = { name: "private-test", organization: "synthetic", type: "dataset", private: true };
  for (const changed of [{ private: false }, { organization: "other" }, { type: "model" }, { extra: true }]) {
    await assert.rejects(() => fetcher("https://huggingface.co/api/repos/create", { method: "POST", body: JSON.stringify({ ...body, ...changed }) }), QualificationError);
  }
  assert.equal(calls, 0);
  await fetcher("https://huggingface.co/api/repos/create", { method: "POST", body: JSON.stringify(body) });
  await assert.rejects(() => fetcher("https://huggingface.co/api/repos/create", { method: "POST", body: JSON.stringify(body) }), QualificationError);
  assert.equal(calls, 1);
});

test("transport refuses authenticated redirects, oversized response and request exhaustion", async () => {
  const redirect = boundedHubFetch(repo, facts(), (async () => new Response(null, { status: 302, headers: { location: "https://other.example" } })) as typeof fetch);
  await assert.rejects(() => redirect(base, { headers: { authorization: "Bearer synthetic" } }), QualificationError);
  const huge = boundedHubFetch(repo, facts(), (async () => new Response("x".repeat(64 * 1024 + 1))) as typeof fetch);
  await assert.rejects(() => huge(base), QualificationError);
  let calls = 0; const bounded = boundedHubFetch(repo, facts(), (async () => { calls++; return new Response("{}"); }) as typeof fetch);
  for (let i = 0; i < 24; i++) await bounded(base);
  await assert.rejects(() => bounded(base), QualificationError); assert.equal(calls, 24);
});

test("transport preserves safe status/body for actual client mapping without exposing errors", async () => {
  const f = facts();
  const bounded = boundedHubFetch(repo, f, (async (_url, init) => {
    assert.equal(init?.redirect, "manual"); assert.ok(init?.signal);
    return new Response('{"error":"synthetic provider response"}', { status: 401 });
  }) as typeof fetch);
  const response = await bounded(base);
  assert.equal(response.status, 401); assert.equal((await response.json()).error, "synthetic provider response");
  assert.equal(f.requests, 1); assert.equal(f.commits, 0);
});

test("operator failures expose only fixed codes and no config path, credential or native exception", async () => {
  const original = console.log; const lines: string[] = [];
  console.log = (line: string) => { lines.push(line); };
  try {
    assert.equal(await main(["--invalid", "private-secret-payload"]), 1);
    assert.equal(await main(["--execute", "--config", ".local-codex/nonexistent-private-config-qualification.json"]), 1);
  } finally { console.log = original; }
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.equal(JSON.parse(line).status, "qualification-failed");
    assert.doesNotMatch(line, /private-secret|nonexistent-private|ENOENT|stack|token|Bearer|C:/);
  }
});
