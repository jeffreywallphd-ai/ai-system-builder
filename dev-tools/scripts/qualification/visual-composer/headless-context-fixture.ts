import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";

// Already authorized, installed input. This helper never fetches model files.
export const CONTEXT_FIXTURE_MODEL = "sentence-transformers/all-MiniLM-L6-v2";
export const CONTEXT_FIXTURE_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41";
export const CONTEXT_FIXTURE_MODEL_RECORD = "model_qualification_minilm";
export const CONTEXT_FIXTURE_FILES = Object.freeze({
  "config.json": "953f9c0d463486b10a6871cc2fd59f223b2c70184f49815e7efbcab5d8908b41",
  "tokenizer.json": "be50c3628f2bf5bb5e3a7f17b1f74611b2561a3a27eeab05e5aa30f411572037",
  "tokenizer_config.json": "acb92769e8195aabd29b7b2137a9e6d6e25c476a4f15aa4355c233426c61576b",
  "special_tokens_map.json": "303df45a03609e4ead04bc3dc1536d0ab19b5358db685b6f3da123d05ec200e3",
  "vocab.txt": "07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3",
  "model.safetensors": "53aa51172d142c89d9012cce15ae4d6cc0ca6895895114379cacb4fab128d9db",
});
const fail = () => new Error("The fixed installed Context model fixture is unavailable.");

export function contextFixtureRuntimeEndpoint(environment: Readonly<Record<string, string | undefined>>) {
  if (environment.PYTHON_RUNTIME_HOST !== "127.0.0.1" || environment.PYTHON_RUNTIME_PORT !== "43172" ||
      environment.PYTHON_RUNTIME_BASE_URL !== "http://127.0.0.1:43172")
    throw new Error("The fixed Context qualification runtime endpoint is unavailable.");
  return {PYTHON_RUNTIME_HOST: "127.0.0.1", PYTHON_RUNTIME_PORT: "43172", PYTHON_RUNTIME_BASE_URL: "http://127.0.0.1:43172"};
}

export function contextAcquisitionRelative(value: unknown): string {
  if (typeof value !== "string" || !/^\.local-codex\/model-qualification\/minilm-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/acquisition\.json$/.test(value)) throw fail();
  return value;
}

export function contextAcquisitionManifest(value: unknown) {
  const row = value as {schema_version?: unknown; model?: unknown; revision?: unknown; status?: unknown;
    files?: {name?: unknown; bytes?: unknown; sha256?: unknown}[]};
  if (!row || row.schema_version !== "qualified-model-acquisition-v1" || row.model !== CONTEXT_FIXTURE_MODEL ||
      row.revision !== CONTEXT_FIXTURE_REVISION || row.status !== "verified" || !Array.isArray(row.files) || row.files.length !== 6) throw fail();
  const seen = new Set<string>();
  for (const file of row.files) {
    if (!file || typeof file.name !== "string" || !Object.hasOwn(CONTEXT_FIXTURE_FILES, file.name) || seen.has(file.name) ||
        file.sha256 !== CONTEXT_FIXTURE_FILES[file.name as keyof typeof CONTEXT_FIXTURE_FILES] ||
        !Number.isSafeInteger(file.bytes) || (file.bytes as number) <= 0 || (file.bytes as number) > 100 * 1024 ** 2) throw fail();
    seen.add(file.name);
  }
  return row.files as {name: keyof typeof CONTEXT_FIXTURE_FILES; bytes: number; sha256: string}[];
}

/** Test-fixture checks, not a production native filesystem fence. */
export async function requireContextFixtureDirectory(root: string, directory: string) {
  const relative = path.relative(root, directory);
  if (!path.isAbsolute(root) || path.resolve(root) !== root || relative.startsWith("..") || path.isAbsolute(relative)) throw fail();
  let current = root;
  for (const part of ["", ...relative.split(path.sep).filter(Boolean)]) {
    if (part) current = path.join(current, part);
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(current) !== current) throw fail();
  }
}

async function digestRegular(file: string, bytes: number, expected: string) {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size !== bytes || await realpath(file) !== file) throw fail();
  const hash = createHash("sha256"); let read = 0;
  for await (const block of createReadStream(file, {highWaterMark: 1024 ** 2})) {
    read += block.length; if (read > bytes) throw fail(); hash.update(block);
  }
  const after = await lstat(file);
  if (read !== bytes || hash.digest("hex") !== expected || before.dev !== after.dev || before.ino !== after.ino ||
      before.size !== after.size || before.mtimeMs !== after.mtimeMs || after.nlink !== 1 || await realpath(file) !== file) throw fail();
}

export async function readContextModelAcquisition(root: string, relative: unknown) {
  const manifest = path.resolve(root, contextAcquisitionRelative(relative));
  const directory = path.dirname(manifest);
  await requireContextFixtureDirectory(root, directory);
  const file = await open(manifest, "r"); let parsed: unknown;
  try {
    const info = await file.stat(), named = await lstat(manifest);
    if (!info.isFile() || named.isSymbolicLink() || info.nlink !== 1 || info.dev !== named.dev || info.ino !== named.ino || info.size > 8192 || info.size < 1) throw fail();
    // Bound before allocation, then verify the descriptor and named file again.
    const buffer = Buffer.alloc(8193); const {bytesRead} = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== info.size || bytesRead > 8192) throw fail();
    parsed = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
    const after = await file.stat(), afterName = await lstat(manifest);
    if (info.dev !== after.dev || info.ino !== after.ino || info.size !== after.size || info.mtimeMs !== after.mtimeMs ||
        afterName.dev !== after.dev || afterName.ino !== after.ino || afterName.isSymbolicLink()) throw fail();
  } finally { await file.close(); }
  const files = contextAcquisitionManifest(parsed);
  assert.deepEqual((await readdir(directory)).sort(), ["acquisition.json", ...Object.keys(CONTEXT_FIXTURE_FILES)].sort(), fail().message);
  for (const item of files) await digestRegular(path.join(directory, item.name), item.bytes, item.sha256);
  return {directory, files, bytes: files.reduce((sum, item) => sum + item.bytes, 0)};
}

export function contextFixtureModelDestination(root: string, profile: string) {
  const base = path.resolve(root, "artifacts/qualification/visual-composer/d");
  if (!/^[a-f0-9]{16}[\\/]desktop[\\/]headless-plan-review$/.test(path.relative(base, profile))) throw fail();
  return path.join(profile, "unused-model-cache", "preinstalled-minilm");
}

export async function installContextFixtureModel(root: string, profile: string, acquisition: unknown) {
  const input = await readContextModelAcquisition(root, acquisition);
  const directory = contextFixtureModelDestination(root, profile), cache = path.dirname(directory);
  await requireContextFixtureDirectory(root, profile);
  await mkdir(cache); // Exclusive owned paths: refuse previous/unknown contents.
  await mkdir(directory);
  for (const item of input.files) {
    await copyFile(path.join(input.directory, item.name), path.join(directory, item.name), constants.COPYFILE_EXCL);
    await digestRegular(path.join(directory, item.name), item.bytes, item.sha256);
  }
  await readContextModelAcquisition(root, acquisition); // Preserve original input identity/content.
  await requireContextFixtureDirectory(root, directory);
  return {directory, cache, bytes: input.bytes};
}

export async function verifyContextFixtureModel(root: string, profile: string, supplied: string) {
  const expected = contextFixtureModelDestination(root, profile);
  return verifyFixedModelDirectory(root, expected, supplied);
}

export function managedContextFixtureModelDestination(root: string, runRoot: string) {
  const base = path.resolve(root, "artifacts/qualification/visual-composer/d");
  if (!/^managed-[a-f0-9]{32}$/.test(path.relative(base, runRoot))) throw fail();
  return path.join(runRoot, "runtime", "controlled-model-cache", "preinstalled-minilm");
}

export async function installManagedContextFixtureModel(root: string, runRoot: string, acquisition: unknown) {
  const input = await readContextModelAcquisition(root, acquisition);
  const directory = managedContextFixtureModelDestination(root, runRoot), cache = path.dirname(directory);
  await requireContextFixtureDirectory(root, cache);
  // The owned host just created this cache. Never add a model to an old cache.
  assert.deepEqual(await readdir(cache), [], fail().message);
  await mkdir(directory);
  for (const item of input.files) {
    await copyFile(path.join(input.directory, item.name), path.join(directory, item.name), constants.COPYFILE_EXCL);
    await digestRegular(path.join(directory, item.name), item.bytes, item.sha256);
  }
  await readContextModelAcquisition(root, acquisition);
  await verifyFixedModelDirectory(root, directory, directory);
  return {directory, cache, bytes: input.bytes};
}

export async function verifyManagedContextFixtureModel(root: string, runRoot: string, supplied: string) {
  return verifyFixedModelDirectory(root, managedContextFixtureModelDestination(root, runRoot), supplied);
}

async function verifyFixedModelDirectory(root: string, expected: string, supplied: string) {
  if (supplied !== expected) throw fail();
  await requireContextFixtureDirectory(root, expected);
  assert.deepEqual((await readdir(expected)).sort(), Object.keys(CONTEXT_FIXTURE_FILES).sort(), fail().message);
  let bytes = 0;
  for (const [name, digest] of Object.entries(CONTEXT_FIXTURE_FILES)) {
    const file = path.join(expected, name), info = await lstat(file);
    if (info.size < 1 || info.size > 100 * 1024 ** 2) throw fail();
    await digestRegular(file, info.size, digest); bytes += info.size;
  }
  return {bytes};
}

/** Read only finite facts from this exact owned Desktop fixture after shutdown. */
export async function readContextFixtureStartupFailures(root: string, profile: string) {
  const cache = path.dirname(contextFixtureModelDestination(root, profile));
  await requireContextFixtureDirectory(root, cache);
  const names = (await readdir(cache)).filter(name => /^q-start-failure-[0-9]+\.json$/.test(name));
  if (names.length > 4) throw fail();
  const values: {errorType: string; errno?: number; winerror?: number}[] = [];
  for (const name of names) {
    const file = path.join(cache, name), before = await lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size < 1 || before.size > 1024 || await realpath(file) !== file) throw fail();
    const descriptor = await open(file, "r");
    try {
      const info = await descriptor.stat();
      if (info.dev !== before.dev || info.ino !== before.ino || info.size !== before.size) throw fail();
      const bytes = Buffer.alloc(1025), {bytesRead} = await descriptor.read(bytes, 0, bytes.length, 0);
      if (bytesRead !== info.size) throw fail();
      const row = JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
      const keys = ["schemaVersion", "pid", "errorType", "errno", "winerror"];
      if (!row || Object.keys(row).some(key => !keys.includes(key)) || row.schemaVersion !== "headless-worker-startup-failure-v1" ||
          !Number.isInteger(row.pid) || row.pid <= 0 || name !== `q-start-failure-${row.pid}.json` ||
          !["ImportError", "ModuleNotFoundError", "MemoryError", "OSError", "RuntimeError", "ValueError", "TimeoutError", "OtherError"].includes(row.errorType) ||
          ["errno", "winerror"].some(key => row[key] !== undefined && (!Number.isInteger(row[key]) || row[key] < 0 || row[key] > 65535))) throw fail();
      const after = await lstat(file);
      if (after.dev !== info.dev || after.ino !== info.ino || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.nlink !== 1) throw fail();
      values.push({errorType: row.errorType, ...(row.errno === undefined ? {} : {errno: row.errno}), ...(row.winerror === undefined ? {} : {winerror: row.winerror})});
    } finally { await descriptor.close(); }
  }
  return values;
}
