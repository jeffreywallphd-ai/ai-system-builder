/** Trusted prelaunch inputs only. Never seed a task, result or generated model. */
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { ensurePythonRuntimeWorkerDependencies, ensurePythonRuntimeModelTrainingDependencies } from "../../../../modules/adapters/runtime/python/ensurePythonRuntimeWorkerDependencies";
import { ensurePythonRuntimeContextDependencies } from "../../../../modules/adapters/runtime/python/ensurePythonRuntimeContextDependencies";
import { openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy } from "../../../../modules/adapters/persistence/sqlite";
import { readLocalIdentityProfile } from "../../../../modules/adapters/security/local-identity";
import { composeInternalAssetRegistry } from "../../../../modules/hosts/shared/composition/composeInternalAssetRegistry";
import { createLocalModelRegistryAdapter } from "../../../../modules/adapters/persistence/model/createLocalModelRegistryAdapter";
import { createLocalArtifactCatalogPersistenceAdapter, createLocalArtifactStorageBindingAdapter, createFilesystemArtifactObjectStorageAdapter } from "../../../../modules/adapters/storage/filesystem";
import { createStoreArtifactRequest } from "../../../../modules/contracts/storage";
import { createWorkspaceId } from "../../../../modules/contracts/workspace";
import { captureTrainingHostFixture, trainingDatasetIds, trainingWorkspaceId, TRAINING_WORKSPACE_NAME, TRAINING_OUTPUT_NAME, TRAINING_DISPLAY_NAME } from "./model-training-oracles";
import { createTrainingCaseEnvironment, TRAINING_PYTHON_RELATIVE, trainingAcquisition } from "./training-host-launch-plan.mjs";

const fail = () => { throw new Error("Training qualification prerequisites are unavailable."); };
const repoRoot = path.resolve(__dirname, "../../../..");
function literalProbe(source: string, name: string): string {
  const marker = `const ${name} = `;
  const offset = source.indexOf(marker);
  if (offset < 0 || source.indexOf(marker, offset + 1) >= 0) return fail();
  const value = source.slice(offset + marker.length).match(/^`([\s\S]*?)`\.trim\(\);/);
  if (!value) return fail();
  return value[1]!.trim();
}
export function trainingReadOnlyArguments(args: readonly string[], probes: ReadonlySet<string>): boolean {
  return (args.length === 3 && args[0] === "-m" && args[1] === "pip" && args[2] === "--version") ||
    (args.length === 2 && args[0] === "-c" && probes.has(args[1]!));
}
/** Use the real preparation functions, but deny installation before spawning. */
export async function inspectTrainingDependencies(environment: NodeJS.ProcessEnv): Promise<void> {
  const workerSource = readFileSync(path.join(repoRoot, "modules/adapters/runtime/python/ensurePythonRuntimeWorkerDependencies.ts"), "utf8");
  const contextSource = readFileSync(path.join(repoRoot, "modules/adapters/runtime/python/ensurePythonRuntimeContextDependencies.ts"), "utf8");
  const probes = new Set(["ENV_INSPECTION_SCRIPT", "WORKER_DEPENDENCY_PROBE_SCRIPT", "MODEL_TRAINING_DEPENDENCY_PROBE_SCRIPT", "TORCH_INSTALL_PROBE_SCRIPT"].map(name => literalProbe(workerSource, name)));
  probes.add(literalProbe(contextSource, "CONTEXT_DEPENDENCY_PROBE_SCRIPT"));
  for (const backend of ["cpu", "cuda", "rocm"]) probes.add(literalProbe(workerSource, "verificationScript").replace('${JSON.stringify(backend)}', JSON.stringify(backend)));
  const python = path.join(repoRoot, TRAINING_PYTHON_RELATIVE);
  const readonlySpawn: typeof spawnSync = ((command: string, args: readonly string[]) => {
    // Preserve the production preparer's real backend discovery. Do not invent
    // CPU readiness while later activation would select another install target.
    if ((command === "nvidia-smi" && JSON.stringify(args) === '["--query-gpu=name","--format=csv,noheader"]') ||
        (command === "rocminfo" && args.length === 0)) {
      return spawnSync(command, args, { cwd: repoRoot, env: environment, windowsHide: true, encoding: "utf8", timeout: 15_000, maxBuffer: 8192 });
    }
    if (command !== python || !trainingReadOnlyArguments(args, probes)) return fail();
    return spawnSync(python, ["-I", "-B", ...args], { cwd: repoRoot, env: environment, windowsHide: true, encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 });
  }) as typeof spawnSync;
  const options = { command: python, env: environment, platform: "win32" as const, retryCount: 0, installTimeoutMs: 60_000, spawnSyncImplementation: readonlySpawn };
  ensurePythonRuntimeWorkerDependencies(options);
  ensurePythonRuntimeModelTrainingDependencies(options);
  await ensurePythonRuntimeContextDependencies({ command: python, env: environment, platform: "win32", execFileImplementation: (command, args, _options, callback) => {
    if (command !== python || !trainingReadOnlyArguments(args, probes)) return fail();
    return execFile(python, ["-I", "-B", ...args], { cwd: repoRoot, env: environment, windowsHide: true, encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 }, callback);
  } });
}
export function inspectTrainingInputs(environment: NodeJS.ProcessEnv): { modelRelativeDirectory: string; modelId: string } {
  const acquisition = trainingAcquisition(environment.VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION);
  const result = spawnSync(path.join(repoRoot, TRAINING_PYTHON_RELATIVE), ["-I", "-B", path.join(__dirname, "training-host-prerequisites.py"), "--inspect"], {
    cwd: repoRoot, env: { ...environment, VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION: acquisition }, windowsHide: true, encoding: "utf8", timeout: 120_000, maxBuffer: 8192,
  });
  if (result.status !== 0 || result.error || Buffer.byteLength(result.stdout ?? "") > 4096) return fail();
  const input = JSON.parse(result.stdout);
  if (input.schemaVersion !== "training-local-inputs-v1" || input.status !== "verified-inputs-only" || input.accuracyExecuted !== false || input.launchAuthorized !== false ||
      input.pythonRelative !== TRAINING_PYTHON_RELATIVE || input.modelId !== "Qwen/Qwen2.5-0.5B-Instruct" || input.modelRelativeDirectory !== acquisition.slice(0, -"/acquisition.json".length) || input.modelFiles !== 8) return fail();
  return { modelRelativeDirectory: input.modelRelativeDirectory, modelId: input.modelId };
}
function requireOwnedCase(environment: NodeJS.ProcessEnv): string {
  const root = environment.VISUAL_COMPOSER_DESKTOP_DATA_ROOT ?? "";
  createTrainingCaseEnvironment(environment, repoRoot, root, environment.VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION);
  const fence = path.join(repoRoot, "artifacts/qualification/visual-composer/d");
  const parts = path.relative(repoRoot, root).split(path.sep);
  for (let i = 1; i <= parts.length; i++) {
    const current = path.join(repoRoot, ...parts.slice(0, i));
    const info = lstatSync(current);
    if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(current) !== current) return fail();
  }
  if (!root.startsWith(`${fence}${path.sep}`)) return fail();
  return root;
}
export async function seedTrainingInputs(environment: NodeJS.ProcessEnv): Promise<string> {
  const dataRoot = requireOwnedCase(environment);
  const run = environment.VISUAL_COMPOSER_QUALIFICATION_RUN_ID;
  const source = environment.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION;
  const workspaceId = createWorkspaceId(trainingWorkspaceId(run));
  const inputs = inspectTrainingInputs(environment);
  // No copy of the gigabyte of immutable weights; registration points at the
  // exact verified original local input. Only fresh tiny input records are made.
  for (const leaf of ["training-temp", "controlled-model-cache"]) mkdirSync(path.join(dataRoot, leaf));
  const database = await openLocalSqliteDatabase({ policy: resolveLocalSqliteDatabasePolicy({ dataRootDirectory: dataRoot }) });
  try {
    const identity = await readLocalIdentityProfile(database.documents);
    if (!identity) return fail();
    const documents = database.documents.forOrganization(identity.organizationId);
    const composition = composeInternalAssetRegistry({ rootDirectory: dataRoot, documents });
    const created = await composition.workspaceUseCases.createWorkspace.execute({ command: { displayName: TRAINING_WORKSPACE_NAME }, organizationId: identity.organizationId, generateWorkspaceId: () => workspaceId, selectAfterCreate: true });
    if (created.status !== "created" || created.workspace?.workspaceId !== workspaceId) return fail();
    const registry = createLocalModelRegistryAdapter({ filePath: path.join(dataRoot, "model-registry/models.json"), rootDirectory: dataRoot, documents, discovery: { enabled: false } });
    const base = await registry.registerDownloadedModel({ workspaceId, displayName: "Qualified Qwen 0.5B input", source: "local", provider: "huggingface", modelId: inputs.modelId, localPath: path.join(repoRoot, inputs.modelRelativeDirectory), artifactForm: "full-model", inferenceMode: "causal", serializationFormat: "safetensors" });
    const catalog = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory: dataRoot, documents });
    const bindings = createLocalArtifactStorageBindingAdapter({ rootDirectory: dataRoot, documents });
    const storage = createFilesystemArtifactObjectStorageAdapter({ rootDirectory: dataRoot, host: "desktop", artifactCatalogAppend: catalog, artifactBindingWrite: bindings });
    const context = { workspaceId, organizationId: identity.organizationId, principalId: identity.principalId };
    const datasets = trainingDatasetIds(run);
    for (const key of datasets) {
      const bound = await bindings.createArtifactStorageBindingIfAbsent({ binding: { workspaceId, artifactId: key, role: "primary", backing: { kind: "artifact-object", provider: "local-filesystem", locator: key } } }, context);
      if (!bound.ok || bound.value.binding.artifactId !== key) return fail();
      const content = new TextEncoder().encode('{"instruction":"What does the help panel show?","output":"The help panel shows guidance for the current feature."}\n{"instruction":"Where are task updates?","output":"Task updates are in the notification center."}\n');
      const stored = await storage.storeArtifact(createStoreArtifactRequest(content, { descriptor: { key, mediaType: "application/jsonl", metadata: { originalFileName: path.basename(key) } } }), context);
      if (!stored.ok || stored.value.key !== key) return fail();
    }
    const fixture = JSON.stringify({ schemaVersion: "training-host-fixture-v1", runId: run, sourceRevision: source, workspaceId, baseModelRecordId: base.model.modelRecordId, datasetArtifactIds: datasets, outputName: TRAINING_OUTPUT_NAME, displayName: TRAINING_DISPLAY_NAME });
    if (!captureTrainingHostFixture(fixture, run, source)) return fail();
    return fixture;
  } finally { database.close(); }
}
async function main() {
  if (process.platform !== "win32" || process.argv.length !== 3) return fail();
  const role = process.argv[2];
  if (role === "--inspect-prerequisites") {
    inspectTrainingInputs(process.env);
    await inspectTrainingDependencies(process.env);
    process.stdout.write(JSON.stringify({ schemaVersion: "training-host-readiness-v1", status: "inputs-and-dependencies-verified", accuracyExecuted: false }) + "\n");
  } else if (role === "--seed-inputs") process.stdout.write(await seedTrainingInputs(process.env) + "\n");
  else return fail();
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.join(__dirname, "training-host-fixture.ts")) void main().catch(() => {
  process.stderr.write('{"schemaVersion":"training-host-readiness-v1","status":"unavailable","reason":"fixed-training-prerequisites"}\n');
  process.exitCode = 1;
});
