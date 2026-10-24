/** Fixed, offline process-restart proof for the opt-in synthetic provider operator. */
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { DatasetVersionRepositoryPort } from "../../../modules/application/ports/dataset-version";
import { PublishDatasetVersionUseCase } from "../../../modules/application/use-cases/dataset-version/publish-dataset-version.use-case";
import { createStructuredDatasetVersionRepository } from "../../../modules/adapters/persistence/dataset-version";
import { openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy, type OpenedLocalSqliteDatabase } from "../../../modules/adapters/persistence/sqlite";
import { createSha256DatasetVersionHasher } from "../../../modules/adapters/storage/dataset-version";
import { createWorkspaceId } from "../../../modules/contracts/workspace";

const PARENT = ".local-codex/private-provider-qualification";
const ENTRY = "dev-tools/scripts/private-provider-qualification/durable-publication.ts";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_DATABASE_BYTES = 1024 * 1024;
const WORKSPACE = createWorkspaceId("private-provider-qualification");
const VERSION = "dataset:private-qualification-v1" as never;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export class DurablePublicationError extends Error {
  constructor(readonly reason: string) { super("Saved publication verification did not complete."); }
}
function requireFact(value: unknown, reason: string): asserts value {
  if (!value) throw new DurablePublicationError(reason);
}
function exactObject(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  requireFact(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join() === keys.sort().join(), "replay-input-denied");
}
function runDirectory(root: string, runId: string): string {
  requireFact(UUID.test(runId), "run-identity-denied");
  const canonicalRoot = realpathSync(root);
  let current = canonicalRoot;
  for (const segment of [".local-codex", "private-provider-qualification", runId]) {
    current = path.join(current, segment);
    const stat = lstatSync(current);
    requireFact(stat.isDirectory() && !stat.isSymbolicLink() && realpathSync(current) === current, "run-path-denied");
  }
  return current;
}
function markerAt(directory: string): { run_id: string; nonce: string } {
  const file = path.join(directory, "durable-owner.json"); const stat = lstatSync(file);
  requireFact(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 256, "run-owner-denied");
  const record: unknown = JSON.parse(readFileSync(file, "utf8")); exactObject(record, ["run_id", "nonce"]);
  requireFact(typeof record.run_id === "string" && UUID.test(record.run_id) && typeof record.nonce === "string" && UUID.test(record.nonce), "run-owner-denied");
  return record as { run_id: string; nonce: string };
}
function databaseRoot(directory: string, existing: boolean): string {
  const dataRoot = path.join(directory, "durable-state");
  for (const part of [dataRoot, path.join(dataRoot, "persistence")]) {
    const stat = lstatSync(part);
    requireFact(stat.isDirectory() && !stat.isSymbolicLink() && realpathSync(part) === part, "database-path-denied");
  }
  const persistence = path.join(dataRoot, "persistence");
  const names = readdirSync(persistence);
  requireFact(names.length <= 3 && (!existing || names.includes("ai-system-builder.sqlite3")), "database-inventory-denied");
  for (const name of names) {
    requireFact(["ai-system-builder.sqlite3", "ai-system-builder.sqlite3-wal", "ai-system-builder.sqlite3-shm"].includes(name), "database-inventory-denied");
    const stat = lstatSync(path.join(persistence, name));
    requireFact(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= MAX_DATABASE_BYTES, "database-file-denied");
  }
  return dataRoot;
}
export interface DurableReplayInput {
  run_id: string;
  nonce: string;
  repository: string;
  version_digest: string;
  revision: string;
}
export function validateReplayInput(value: unknown): DurableReplayInput {
  exactObject(value, ["run_id", "nonce", "repository", "version_digest", "revision"]);
  requireFact(typeof value.run_id === "string" && UUID.test(value.run_id) && typeof value.nonce === "string" && UUID.test(value.nonce), "replay-input-denied");
  requireFact(typeof value.repository === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}\/[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value.repository), "replay-input-denied");
  requireFact(typeof value.version_digest === "string" && /^sha256:[a-f0-9]{64}$/.test(value.version_digest) && typeof value.revision === "string" && /^[a-f0-9]{40}$/.test(value.revision), "replay-input-denied");
  return value as unknown as DurableReplayInput;
}
export function replayEnvironment(temporaryDirectory: string): NodeJS.ProcessEnv {
  // Node/Windows supplies these mandatory variables when omitted. Give them
  // explicit inert values instead of allowing ambient identity/PATH inheritance.
  const drive = path.parse(path.resolve(temporaryDirectory)).root.replace(/[\\/]$/, "");
  const env: NodeJS.ProcessEnv = { TEMP: temporaryDirectory, TMP: temporaryDirectory, PATH: "",
    HOMEDRIVE: drive, HOMEPATH: temporaryDirectory, USERPROFILE: temporaryDirectory,
    USERNAME: "qualification", USERDOMAIN: "qualification", LOGONSERVER: "qualification", SYSTEMDRIVE: drive };
  for (const name of ["SystemRoot", "WINDIR"]) if (process.env[name]) env[name] = process.env[name];
  return env;
}
export interface DurablePublicationState {
  repository: DatasetVersionRepositoryPort;
  close(): void;
  verifyRestart(repository: string, versionDigest: string, revision: string): Record<string, unknown>;
}
export async function openQualificationPersistence(output: string): Promise<DurablePublicationState> {
  requireFact(output.startsWith(PARENT + "/") && !output.includes("\\") && output.split("/").length === 3, "run-path-denied");
  const runId = output.slice(PARENT.length + 1); const directory = runDirectory(process.cwd(), runId); const nonce = randomUUID();
  writeFileSync(path.join(directory, "durable-owner.json"), JSON.stringify({ run_id: runId, nonce }) + "\n", { flag: "wx", mode: 0o600 });
  mkdirSync(path.join(directory, "durable-state"), { mode: 0o700 });
  mkdirSync(path.join(directory, "durable-state", "persistence"), { mode: 0o700 });
  const dataRoot = databaseRoot(directory, false);
  const opened = await openLocalSqliteDatabase({ policy: resolveLocalSqliteDatabasePolicy({ dataRootDirectory: dataRoot }) });
  let closed = false;
  const close = () => { if (!closed) { opened.close(); closed = true; } };
  try { requireFact(opened.checkHealth().healthy, "database-health-failed"); } catch (error) { close(); throw error; }
  return {
    repository: createStructuredDatasetVersionRepository(opened.documents), close,
    verifyRestart(repository, versionDigest, revision) {
      close();
      requireFact(runDirectory(process.cwd(), runId) === directory && markerAt(directory).nonce === nonce, "run-owner-denied");
      databaseRoot(directory, true);
      const input = validateReplayInput({ run_id: runId, nonce, repository, version_digest: versionDigest, revision });
      const wire = JSON.stringify(input); requireFact(Buffer.byteLength(wire) <= 2048, "replay-input-denied");
      const child = spawnSync(process.execPath, ["--import", pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href, path.resolve(ENTRY), "--replay"], {
        cwd: realpathSync(process.cwd()), env: replayEnvironment(directory), input: wire, encoding: "utf8", timeout: 20_000, maxBuffer: 4096, windowsHide: true,
      });
      requireFact(!child.error && child.status === 0 && child.signal === null && child.stdout.length <= 4096, "replay-process-failed");
      let result: unknown; try { result = JSON.parse(child.stdout); } catch { throw new DurablePublicationError("replay-result-denied"); }
      exactObject(result, ["schema_version", "version_unchanged", "revision_unchanged", "publication_records", "publisher_calls", "artifact_calls", "database_closed", "ambient_settings_absent"]);
      requireFact(result.schema_version === "private-publication-replay-v1" && result.version_unchanged === true && result.revision_unchanged === true && result.publication_records === 1 && result.publisher_calls === 0 && result.artifact_calls === 0 && result.database_closed === true && result.ambient_settings_absent === true, "replay-result-denied");
      return { ...result, fresh_process_exit_code: 0, stdout_sha256: digest(Buffer.from(child.stdout)), stderr_sha256: digest(Buffer.from(child.stderr)), scope: "Production SQLite metadata close/reopen and offline application retry in a fixed new process; not a full app restart or native filesystem qualification." };
    },
  };
}
async function replay(input: DurableReplayInput): Promise<Record<string, unknown>> {
  const allowedEnvironment = new Set(Object.keys(replayEnvironment("unused")));
  requireFact(Object.keys(process.env).every(name => allowedEnvironment.has(name)), "replay-environment-denied");
  const directory = runDirectory(process.cwd(), input.run_id); const marker = markerAt(directory);
  requireFact(marker.run_id === input.run_id && marker.nonce === input.nonce, "run-owner-denied");
  const dataRoot = databaseRoot(directory, true);
  let database: OpenedLocalSqliteDatabase | undefined; let publisherCalls = 0; let artifactCalls = 0;
  // No provider adapter or credential store is imported here. All possible publication I/O refuses.
  const denyArtifact = async () => { artifactCalls++; throw new DurablePublicationError("replay-artifact-read-denied"); };
  try {
    database = await openLocalSqliteDatabase({ policy: resolveLocalSqliteDatabasePolicy({ dataRootDirectory: dataRoot }) });
    requireFact(database.checkHealth().healthy, "database-health-failed");
    const repository = createStructuredDatasetVersionRepository(database.documents);
    const version = await repository.readVersion(WORKSPACE, VERSION);
    requireFact(version?.versionDigest === input.version_digest && (await repository.listVersions(WORKSPACE)).length === 1, "saved-version-mismatch");
    const useCase = new PublishDatasetVersionUseCase({ repository, hasher: createSha256DatasetVersionHasher(),
      publisher: { publishDatasetVersion: async () => { publisherCalls++; throw new DurablePublicationError("replay-publication-denied"); } },
      artifacts: { retrieveArtifact: denyArtifact, storeArtifact: denyArtifact, hasArtifact: denyArtifact, deleteArtifact: denyArtifact } });
    const result = await useCase.execute({ workspaceId: WORKSPACE, versionId: VERSION, repositoryId: input.repository, createRepository: true, confirmation: { approved: true, visibility: "private" } }, { workspaceId: WORKSPACE, principalId: "qualification" });
    requireFact(result.ok && result.value.publication.revision === input.revision && result.value.publication.versionId === VERSION && result.value.publication.visibility === "private" && publisherCalls === 0 && artifactCalls === 0, "saved-retry-mismatch");
    requireFact((await repository.listPublications(WORKSPACE)).length === 1, "saved-publication-count");
    database.close(); database = undefined;
    return { schema_version: "private-publication-replay-v1", version_unchanged: true, revision_unchanged: true, publication_records: 1, publisher_calls: publisherCalls, artifact_calls: artifactCalls, database_closed: true, ambient_settings_absent: true };
  } finally { database?.close(); }
}
export async function replayMain(argv: string[]): Promise<number> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    requireFact(argv.length === 1 && argv[0] === "--replay", "replay-arguments-denied");
    deadline = setTimeout(() => { process.exitCode = 1; process.stdin.destroy(); }, 15_000);
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of process.stdin) { size += chunk.length; requireFact(size <= 2048, "replay-input-denied"); chunks.push(Buffer.from(chunk)); }
    const input = validateReplayInput(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const result = await replay(input); console.log(JSON.stringify(result)); return 0;
  } catch (error) { console.log(JSON.stringify({ status: "replay-failed", reason: error instanceof DurablePublicationError ? error.reason : "saved-publication-unavailable" })); return 1; }
  finally { if (deadline) clearTimeout(deadline); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ENTRY)) {
  replayMain(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(() => { process.exitCode = 1; });
}
