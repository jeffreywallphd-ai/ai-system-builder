/** Explicitly authorized, synthetic private-provider qualification; never a normal test side effect. */
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHuggingFaceArtifactRepoStorageAdapter } from "../../../modules/adapters/storage/huggingface/createHuggingFaceArtifactRepoStorageAdapter";
import { SecureEgressBroker } from "../../../modules/adapters/security/egress";
import { createSha256DatasetVersionHasher } from "../../../modules/adapters/storage/dataset-version";
import { createDatasetVersionDocumentationArtifacts } from "../../../modules/application/services/dataset-version/dataset-version-documentation.service";
import { PublishDatasetVersionUseCase } from "../../../modules/application/use-cases/dataset-version/publish-dataset-version.use-case";
import { createHuggingFaceTokenConfigStore } from "../../../modules/hosts/shared/huggingFaceTokenConfigStore";
import { createRetrieveArtifactSuccessResult } from "../../../modules/contracts/storage";
import { createWorkspaceId } from "../../../modules/contracts/workspace";
import { DurablePublicationError, openQualificationPersistence, type DurablePublicationState } from "./durable-publication";

const ORIGIN = "https://huggingface.co";
const MAX_BODY = 16 * 1024;
const MAX_RESPONSE = 64 * 1024;
const MAX_REQUESTS = 24;
const MAX_TIME = 180_000;
const FILES = ["README.md", "croissant.json", "data/dataset.jsonl"];
const hasher = createSha256DatasetVersionHasher();
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
export class QualificationError extends Error {
  constructor(readonly reason: string) { super("Private provider qualification did not complete."); }
}
function requireFact(value: unknown, reason: string): asserts value {
  if (!value) throw new QualificationError(reason);
}
export interface QualificationConfig {
  schema_version: "private-provider-qualification-v1";
  repository: string;
  credential_file: string;
  private: true;
  creation_approved: true;
}
export function validateConfig(input: unknown): QualificationConfig {
  requireFact(input && typeof input === "object" && !Array.isArray(input), "invalid-config");
  const c = input as QualificationConfig;
  requireFact(Object.keys(c).sort().join() === "creation_approved,credential_file,private,repository,schema_version", "invalid-config");
  requireFact(c.schema_version === "private-provider-qualification-v1" && c.private === true && c.creation_approved === true, "invalid-config");
  requireFact(typeof c.repository === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}\/[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(c.repository), "invalid-config");
  requireFact(typeof c.credential_file === "string" && /^\.local-codex\/(?:[A-Za-z0-9_-]+\/)+hugging-face-token\.json$/.test(c.credential_file), "invalid-config");
  return { ...c };
}
export function qualificationPlan(config: QualificationConfig) {
  validateConfig(config);
  return { schema_version: "private-provider-plan-v1", repository: config.repository, private: true,
    operations: ["inspect-private-destination", "create-if-missing", "publish-three-synthetic-files", "download-exact-commit", "check-denials-and-idempotent-retry", "close-synthetic-metadata-database", "verify-offline-retry-in-fresh-process"],
    maximum_hub_api_requests: MAX_REQUESTS, maximum_hub_upload_bytes_per_request: MAX_BODY,
    maximum_hub_response_bytes_per_request: MAX_RESPONSE,
    hub_call_admission_window_seconds: MAX_TIME / 1000, hub_request_timeout_seconds: 20,
    maximum_file_download_sessions: 6, file_download_session_timeout_seconds: 60,
    maximum_redirects_per_file_session: 2, maximum_file_bytes_per_session: MAX_BODY,
    hard_total_wall_clock_deadline: false,
    restart_child_timeout_seconds: 20, restart_input_bytes: 2048, restart_output_bytes_per_stream: 4096,
    metadata_file_limit_bytes: 1024 * 1024, synthetic_metadata_retained: true,
    credential_read: false, external_effects: false, deletion: false, model_execution: false,
    authority: "Configuration records a destination; separate human authorization is required before --execute." };
}
export interface TransportFacts { requests: number; commits: number; creates: number; }
export function boundedHubFetch(repository: string, facts: TransportFacts, transport: typeof fetch = fetch) {
  const started = performance.now();
  return async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    requireFact(typeof input === "string", "request-denied");
    const url = new URL(input);
    requireFact(url.origin === ORIGIN && !url.username && !url.password && !url.hash, "request-denied");
    const method = init.method ?? "GET";
    const prefix = `/api/datasets/${repository}`;
    requireFact(!url.search || method === "GET" && url.pathname === prefix && url.search === "?expand=private", "request-denied");
    const allowed = method === "GET" && url.pathname === prefix || method === "POST" && [prefix + "/preupload/main", prefix + "/commit/main", "/api/repos/create"].includes(url.pathname);
    requireFact(allowed && init.redirect !== "follow", "request-denied");
    requireFact(++facts.requests <= MAX_REQUESTS && performance.now() - started < MAX_TIME, "request-budget");
    requireFact(init.body === undefined || typeof init.body === "string" && Buffer.byteLength(init.body) <= MAX_BODY, "request-size");
    if (url.pathname === "/api/repos/create") {
      const expected = { name: repository.split("/")[1], organization: repository.split("/")[0], type: "dataset", private: true };
      let body; try { body = JSON.parse(String(init.body)); } catch { throw new QualificationError("request-denied"); }
      requireFact(Object.keys(body).sort().join() === Object.keys(expected).sort().join() && Object.entries(expected).every(([k, v]) => body[k] === v), "request-denied");
      requireFact(++facts.creates <= 1, "request-budget");
    }
    if (url.pathname.endsWith("/commit/main")) facts.commits++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      requireFact(!init.signal?.aborted, "request-cancelled");
      const signal = init.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal;
      const response = await transport(input, { ...init, redirect: "manual", signal });
      requireFact(response.status < 300 || response.status >= 400, "redirect-denied");
      const reader = response.body?.getReader(); const parts: Uint8Array[] = []; let size = 0;
      try {
        while (reader) {
          const { value, done } = await reader.read(); if (done) break;
          size += value.byteLength; requireFact(size <= MAX_RESPONSE, "response-size"); parts.push(value);
        }
      } catch (error) { await reader?.cancel().catch(() => {}); throw error; }
      return new Response(Buffer.concat(parts), { status: response.status, headers: response.headers });
    } finally { clearTimeout(timer); }
  };
}
export function publicationFixture() {
  const workspaceId = createWorkspaceId("private-provider-qualification");
  const data = new TextEncoder().encode('{"input":"Two plus two","output":"Four"}\n{"input":"Color of clear daytime sky","output":"Blue"}\n');
  const artifact = { role: "dataset" as const, artifactKey: "fixture-data", mediaType: "application/x-ndjson", digest: hasher.digest(data), sizeBytes: data.byteLength };
  const documentation = { name: "AI System Builder synthetic qualification", summary: "Synthetic software test data. No real user data.", intendedUses: ["Private software qualification only"], limitations: ["Two synthetic rows; not a model benchmark"], license: "mit" };
  const rendered = createDatasetVersionDocumentationArtifacts({ documentation, artifacts: [artifact], totalRows: 2 });
  const contents = new Map<string, Uint8Array>([[artifact.artifactKey, data], ["fixture-card", new TextEncoder().encode(rendered.card)], ["fixture-croissant", new TextEncoder().encode(rendered.croissant)]]);
  const artifacts = [artifact, ...([ ["dataset-card", "fixture-card", "text/markdown"], ["croissant", "fixture-croissant", "application/ld+json"] ] as const).map(([role, artifactKey, mediaType]) => ({ role, artifactKey, mediaType, digest: hasher.digest(contents.get(artifactKey)!), sizeBytes: contents.get(artifactKey)!.byteLength }))];
  const version = { schemaVersion: "1.0" as const, versionId: "dataset:private-qualification-v1" as never, datasetId: "private-qualification" as never, workspaceId,
    versionDigest: hasher.digest(artifacts.map(a => a.digest).join(":")), artifacts, documentation, totalRows: 2,
    lineage: { sources: [{ artifactKey: "synthetic-source", digest: hasher.digest("synthetic"), mediaType: "text/plain" }], recipe: { artifactKey: "synthetic-recipe", digest: hasher.digest("fixed-recipe"), implementationId: "qualification", implementationVersion: "1" }, quality: { policyId: "synthetic", policyVersion: "1", policyFingerprint: hasher.digest("policy"), reportFingerprint: hasher.digest("report") } },
    createdAt: "2026-10-23T00:00:00.000Z", createdBy: "qualification" };
  return { version, contents, files: FILES.map((file, i) => ({ path: file, content: contents.get(["fixture-card", "fixture-croissant", "fixture-data"][i])! })) };
}
export function verifyExistingFixture(metadata: any, actual: Map<string, Uint8Array>, expected = publicationFixture().files) {
  requireFact(metadata?.private === true, "destination-not-private");
  requireFact(Array.isArray(metadata.siblings) && metadata.siblings.length <= 100, "destination-inventory");
  for (const file of expected) {
    if (metadata.siblings.some((row: any) => row?.rfilename === file.path)) {
      const content = actual.get(file.path);
      requireFact(content && hash(content) === hash(file.content), "existing-file-differs");
    }
  }
}
async function readPrivateConfig(root: string, relative: string, maximum: number): Promise<string> {
  requireFact(relative.startsWith(".local-codex/") && !relative.split("/").some(s => !s || s === "." || s === "..") && !relative.includes("\\"), "local-config-denied");
  let current = root;
  for (const segment of relative.split("/")) { current = path.join(current, segment); requireFact(!lstatSync(current).isSymbolicLink(), "local-config-denied"); }
  requireFact(realpathSync(current).startsWith(realpathSync(root) + path.sep) && lstatSync(current).isFile() && lstatSync(current).size <= maximum, "local-config-denied");
  return current;
}
export async function executeQualification(config: QualificationConfig, token: string, persistence: DurablePublicationState, observe: (stage: string, details?: Record<string, unknown>) => void = () => {}) {
  try {
  validateConfig(config); requireFact(typeof token === "string" && token.trim().length > 0, "credential-unavailable");
  const facts: TransportFacts = { requests: 0, commits: 0, creates: 0 };
  const bounded = boundedHubFetch(config.repository, facts);
  const transport = async (input: string | URL | Request, init: RequestInit = {}) => {
    const response = await bounded(input, init);
    const pathname = new URL(String(input)).pathname;
    const operation = pathname === "/api/repos/create" ? "create" : pathname.endsWith("/preupload/main") ? "preupload" : pathname.endsWith("/commit/main") ? "commit" : "metadata";
    observe("provider-response", { operation, http_status: response.status, requests: facts.requests });
    return response;
  };
  const options = { accessToken: token, fetchImplementation: transport as never, maximumDownloadBytes: MAX_BODY, maximumDatasetPublicationBytes: MAX_BODY, maximumDatasetPublicationFiles: 3,
    authorizeRepositoryCreate: async (r: any) => r.repository === config.repository && r.visibility === "private",
    egressBroker: new SecureEgressBroker({ policy: { allowedProtocols: ["https:"], maximumResponseBytes: MAX_BODY, maximumTotalBytes: 6 * MAX_BODY, timeoutMs: 20_000, maximumRedirects: 2, maximumConcurrentRequests: 1 } }) };
  const adapter = createHuggingFaceArtifactRepoStorageAdapter(options);
  const fixture = publicationFixture();
  const metadataUrl = `${ORIGIN}/api/datasets/${config.repository}`;
  const headers = { authorization: `Bearer ${token}` };
  const preflight = await transport(metadataUrl, { headers });
  requireFact(preflight.status === 404 || preflight.ok, "destination-unavailable");
  if (preflight.ok) {
    const metadata = await preflight.json(); const actual = new Map<string, Uint8Array>();
    requireFact(metadata.private === true && /^[a-f0-9]{40}$/.test(metadata.sha), "destination-not-private");
    requireFact(Array.isArray(metadata.siblings) && metadata.siblings.length <= 100, "destination-inventory");
    for (const file of fixture.files) if (metadata.siblings?.some((s: any) => s.rfilename === file.path)) {
      const result = await adapter.retrieveArtifactFromRepo({ target: { provider: "huggingface", repository: config.repository, revision: metadata.sha, path: file.path } } as never);
      requireFact(result.ok, "existing-file-unavailable"); actual.set(file.path, result.value.content);
    }
    verifyExistingFixture(metadata, actual);
  }
  const repository = persistence.repository;
  await repository.createVersion(fixture.version);
  const artifacts = { retrieveArtifact: async (r: any, context: any) => {
    const content = fixture.contents.get(r.key); requireFact(content, "fixture-unavailable");
    return createRetrieveArtifactSuccessResult({ key: r.key, sizeBytes: content.byteLength }, content, context);
  } } as any;
  const useCase = new PublishDatasetVersionUseCase({ repository, artifacts, publisher: adapter, hasher });
  const context = { workspaceId: fixture.version.workspaceId, principalId: "qualification" };
  const command = { workspaceId: fixture.version.workspaceId, versionId: fixture.version.versionId, repositoryId: config.repository, createRepository: true, confirmation: { approved: true as const, visibility: "private" as const } };
  observe("publishing");
  const published = await useCase.execute(command, context);
  if (!published.ok) observe("publication-refused", { code: ["validation", "not-found", "unavailable", "internal", "unauthorized", "forbidden"].includes(published.error.code) ? published.error.code : "other" });
  requireFact(published.ok, "publication-failed");
  const revision = published.value.publication.revision;
  requireFact(/^[a-f0-9]{40}$/.test(revision), "immutable-revision-missing");
  const beforeRetry = facts.requests;
  const retry = await useCase.execute(command, context);
  requireFact(retry.ok && retry.value.publication.revision === revision && facts.requests === beforeRetry, "retry-not-idempotent");
  requireFact((await repository.listPublications(fixture.version.workspaceId)).length === 1, "publication-record-count");
  observe("publication-recorded", { revision });
  const downloaded = [];
  for (const file of fixture.files) {
    const result = await adapter.retrieveArtifactFromRepo({ target: { provider: "huggingface", repository: config.repository, revision, path: file.path } } as never, context);
    if (!result.ok) observe("download-refused", { code: ["validation", "not-found", "unavailable", "internal", "unauthorized", "forbidden"].includes(result.error.code) ? result.error.code : "other" });
    requireFact(result.ok && hash(result.value.content) === hash(file.content), "immutable-download-mismatch");
    downloaded.push({ sha256: hash(file.content), size_bytes: file.content.byteLength });
    observe("immutable-download-verified", { files_verified: downloaded.length });
  }
  const after = await transport(metadataUrl, { headers }); requireFact(after.ok && (await after.json()).private === true, "destination-not-private");
  const anonymous = await transport(metadataUrl);
  requireFact([401, 403, 404].includes(anonymous.status), "anonymous-access-not-denied");
  const denied = await transport(metadataUrl, { headers: { authorization: "Bearer hf_invalid_synthetic_qualification" } });
  requireFact([401, 403, 404].includes(denied.status), "invalid-credential-not-denied");
  const beforePublic = facts.requests;
  const publicAttempt = await useCase.execute({ ...command, visibility: "public", confirmation: { approved: true, visibility: "public" } }, context);
  requireFact(!publicAttempt.ok && facts.requests === beforePublic, "public-confirmation-not-enforced");
  observe("checking-saved-publication-restart");
  const restart = persistence.verifyRestart(config.repository, fixture.version.versionDigest, revision);
  observe("saved-publication-restart-verified", { publication_records: 1, added_provider_requests: 0 });
  return { schema_version: "private-provider-evidence-v1", status: "evidence-collected-review-required", repository_private: true, revision,
    files: downloaded, application_retry_added_requests: 0, publication_records: 1, anonymous_denied: true, invalid_credential_denied: true, unconfirmed_public_denied_before_network: true,
    transport: facts, restart, local_payload_files_written: 0, local_metadata_database_retained: true, remote_files_deleted: 0, remote_synthetic_files_retained: 3,
    scope: "Actual application and official Hub adapter with synthetic SQLite version metadata and in-memory artifact bytes. Fixed fresh-process offline retry is not a full app restart. Not mounted-host, large-file ingestion, provider UI rendering, model, native or parent qualification." };
  } finally { persistence.close(); }
}
export async function main(argv: string[]) {
  let stage = "arguments";
  let output: string | undefined;
  let persistence: DurablePublicationState | undefined;
  const events: Record<string, unknown>[] = [];
  const observe = (event: string, details: Record<string, unknown> = {}) => {
    requireFact(events.length < 64, "evidence-budget");
    events.push({ stage: event, ...details });
    if (output) writeFileSync(path.join(output, "progress.json"), JSON.stringify({ status: "in-progress-review-required", events }, null, 2) + "\n", { mode: 0o600 });
  };
  try {
    requireFact(argv.length === 3 && ["--plan", "--execute"].includes(argv[0]) && argv[1] === "--config", "invalid-arguments");
    const root = process.cwd(); stage = "configuration";
    const configPath = await readPrivateConfig(root, argv[2], 4096);
    const config = validateConfig(JSON.parse(readFileSync(configPath, "utf8")));
    if (argv[0] === "--plan") { console.log(JSON.stringify(qualificationPlan(config))); return 0; }
    const parent = ".local-codex/private-provider-qualification";
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    requireFact(!lstatSync(parent).isSymbolicLink() && realpathSync(parent).startsWith(realpathSync(root) + path.sep), "local-output-denied");
    output = parent + "/" + randomUUID(); mkdirSync(output, { mode: 0o700 });
    stage = "credential";
    const credentialPath = await readPrivateConfig(root, config.credential_file, 8192);
    const token = createHuggingFaceTokenConfigStore({ filePath: credentialPath }).getToken();
    requireFact(token, "credential-unavailable"); stage = "provider-qualification";
    observe("credential-configured");
    persistence = await openQualificationPersistence(output);
    const result = await executeQualification(config, token, persistence, observe);
    writeFileSync(path.join(output, "summary.json"), JSON.stringify({ ...result, events }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify({ status: result.status, evidence: output + "/summary.json" })); return 0;
  } catch (error) {
    const failure = { status: "qualification-failed", stage, reason: error instanceof QualificationError || error instanceof DurablePublicationError ? error.reason : "operation-unavailable", events };
    let saved = false;
    if (output) try { writeFileSync(path.join(output, "summary.json"), JSON.stringify(failure, null, 2) + "\n", { mode: 0o600, flag: "wx" }); saved = true; } catch { /* Report only fixed copy if the evidence sink is unavailable. */ }
    console.log(JSON.stringify({ status: failure.status, stage, reason: failure.reason, ...(saved ? { evidence: output + "/summary.json" } : {}) })); return 1;
  } finally { persistence?.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve("dev-tools/scripts/private-provider-qualification/qualification.ts")) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(() => {
    console.log(JSON.stringify({ status: "qualification-failed", reason: "operator-unavailable" })); process.exitCode = 1;
  });
}
