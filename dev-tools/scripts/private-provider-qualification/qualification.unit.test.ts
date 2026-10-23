import assert from "node:assert/strict";
import test from "node:test";
import { boundedHubFetch, main, publicationFixture, qualificationPlan, QualificationError, validateConfig, verifyExistingFixture } from "./qualification";

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
  assert.equal("maximum_requests" in plan, false); assert.equal("maximum_seconds" in plan, false);
  assert.equal(JSON.stringify(plan).includes("credential_file"), false);
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
