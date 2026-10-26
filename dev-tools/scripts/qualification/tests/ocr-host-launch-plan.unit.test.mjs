import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createOcrHostLaunchPlan } from "../visual-composer/ocr-host-launch-plan.mjs";
import { createVisualComposerHostLaunchPlan } from "../visual-composer/visual-composer-host-lifecycle.mjs";
import * as qualificationSetup from "../visual-composer/visual-composer-global-setup.mjs";
import { createHash } from "node:crypto";
const { startVisualComposerQualification } = qualificationSetup;

const root = path.resolve("synthetic repository with spaces");
const python = path.resolve("synthetic installed runtime", process.platform === "win32" ? "python.exe" : "python");

test("OCR launch uses only deployed Python and the fixed relative fixture, retaining host identity and scope", () => {
  const plan = createOcrHostLaunchPlan({ pythonExecutable: python, repoRoot: root, runId: "synthetic-ocr-run" });
  for (const env of [plan.server.env, plan.desktop.env, plan.desktop.seed.env]) {
    assert.equal(env.PYTHON_RUNTIME_COMMAND, python);
    assert.equal(env.PYTHON_RUNTIME_ARGS, "-I -B ../../../../dev-tools/scripts/qualification/visual-composer/ocr-qualification-worker.py");
    assert.equal(env.PYTHON_RUNTIME_WORKER_DIR, path.join(root, "out/ai-system-builder-win32-x64/resources/worker"));
    assert.equal(env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO, "ocr-documents");
    for (const key of ["HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "PIP_NO_INDEX"]) assert.equal(env[key], "1");
    assert.equal(env.PYTHON_RUNTIME_HOST, "127.0.0.1");
    assert.ok(env.HF_HUB_CACHE.startsWith(plan.paths.desktopDataRoot) || env.HF_HUB_CACHE.startsWith(plan.paths.thinRuntimeRoot));
  }
  assert.equal(plan.server.command, process.execPath);
  assert.equal(plan.thinClient.command, process.execPath);
  assert.equal(plan.server.env.AI_SYSTEM_BUILDER_DEDICATED_ORGANIZATION_ID, "qualification.local");
  assert.notEqual(plan.server.env.PYTHON_RUNTIME_PORT, plan.desktop.env.PYTHON_RUNTIME_PORT);
  assert.equal(typeof startVisualComposerQualification, "function");
});

test("normal qualification keeps the established controlled Node worker", () => {
  const plan = createVisualComposerHostLaunchPlan({ repoRoot: root, runId: "ordinary-synthetic-run" });
  for (const env of [plan.server.env, plan.desktop.env]) {
    assert.equal(env.PYTHON_RUNTIME_COMMAND, process.execPath);
    assert.equal(env.PYTHON_RUNTIME_ARGS, "dev-tools/scripts/qualification/visual-composer/controlled-conversation-runtime-worker.mjs");
    assert.equal(env.PYTHON_RUNTIME_WORKER_DIR, root);
  }
});

test("OCR composition refuses relative paths, shells and malformed executables", () => {
  for (const value of [undefined, "python", path.resolve("python.cmd"), `${python}\n`, `${python}\0`]) {
    assert.throws(() => createOcrHostLaunchPlan({ pythonExecutable: value, repoRoot: root }));
  }
});


const packageParent = "resources/worker/ocr/native/build/NVIDIA Corporation";
const packageLeaf = `${packageParent}/umdlogs`;
const packageCaps = { files: 4096, directories: 1024, totalBytes: 2 * 1024 ** 3,
  fileBytes: 512 * 1024 ** 2, depth: 24, pathBytes: 768 };
function framedPackage({ directories = [], files } = {}) {
  const value = {
    schema_version: "fixed-packaged-desktop-tree-v1",
    root: path.join(root, "out", "ai-system-builder-win32-x64"), caps: { ...packageCaps },
    files: files ?? [
      { path: "app.exe", bytes: 3, sha256: "a".repeat(64) },
      { path: "resources/worker/ocr/native/build/WindowsOcrHelper.exe", bytes: 4, sha256: "b".repeat(64) },
    ],
    directories: [".", "resources", "resources/worker", "resources/worker/ocr", "resources/worker/ocr/native", "resources/worker/ocr/native/build", ...directories].sort(),
  };
  value.files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  value.total_bytes = value.files.reduce((sum, file) => sum + file.bytes, 0);
  return reframePackage(value);
}
function reframePackage(value) {
  const { framed_sha256: ignored, ...tree } = value;
  return { ...tree, framed_sha256: createHash("sha256").update(JSON.stringify(tree)).digest("hex") };
}
function comparePackage(before, after) {
  return qualificationSetup.compareFixedOcrPackageInventories(before, after);
}
function refusesPackage(before, after) {
  assert.throws(() => comparePackage(before, after), (error) =>
    error instanceof Error && error.message === "Fixed OCR package inventory comparison failed." && error.cause === undefined);
}

for (const additions of [[], [packageParent], [packageParent, packageLeaf]]) {
  test(`OCR package inventory accepts exactly ${additions.length} fixed empty directory additions with separate full hashes`, () => {
    const before = framedPackage(), after = framedPackage({ directories: additions });
    const result = comparePackage(before, after);
    assert.equal(result.schema_version, "fixed-ocr-package-inventory-comparison-v1");
    assert.equal(result.before_framed_sha256, before.framed_sha256);
    assert.equal(result.after_framed_sha256, after.framed_sha256);
    assert.equal(result.before_framed_sha256 === result.after_framed_sha256, additions.length === 0);
    assert.equal(JSON.stringify(result.added_empty_directories), JSON.stringify(additions));
    assert.equal(result.all_files_unchanged, true);
    assert.equal(result.all_original_directories_preserved, true);
    assert.equal(JSON.stringify(comparePackage(before, after)), JSON.stringify(result));
  });
}
test("OCR package inventory preserves an existing allowed parent and admits only its empty leaf", () => {
  const before = framedPackage({ directories: [packageParent] });
  const result = comparePackage(before, framedPackage({ directories: [packageParent, packageLeaf] }));
  assert.equal(JSON.stringify(result.added_empty_directories), JSON.stringify([packageLeaf]));
});
test("OCR package inventory refuses added, removed, changed and zero-byte files", () => {
  const before = framedPackage();
  for (const mutate of [
    (tree) => tree.files.push({ path: "new.bin", bytes: 1, sha256: "c".repeat(64) }),
    (tree) => tree.files.push({ path: "empty.bin", bytes: 0, sha256: "c".repeat(64) }),
    (tree) => tree.files.pop(),
    (tree) => { tree.files[0].bytes += 1; },
    (tree) => { tree.files[0].sha256 = "c".repeat(64); },
    (tree) => { tree.files[0].path = "renamed.exe"; },
  ]) {
    const after = structuredClone(before); mutate(after);
    after.files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    after.total_bytes = after.files.reduce((sum, file) => sum + file.bytes, 0);
    refusesPackage(before, reframePackage(after));
  }
});
test("OCR package inventory refuses every file in the allowed subtree, including an existing zero-byte file", () => {
  for (const filePath of [`${packageParent}/empty.bin`, `${packageLeaf}/empty.bin`]) {
    const tree = framedPackage({ directories: [packageParent, packageLeaf], files: [
      { path: "app.exe", bytes: 3, sha256: "a".repeat(64) },
      { path: filePath, bytes: 0, sha256: "c".repeat(64) },
    ] });
    refusesPackage(framedPackage(), tree); refusesPackage(tree, tree);
  }
});
test("OCR package inventory refuses removed original directories, other directories and unlisted children", () => {
  const before = framedPackage();
  const removed = structuredClone(before); removed.directories.splice(1, 1);
  refusesPackage(before, reframePackage(removed));
  refusesPackage(framedPackage({ directories: ["original-empty"] }), framedPackage());
  for (const directories of [["unlisted"], [packageLeaf], [packageParent, `${packageParent}/other`], [packageParent, packageLeaf, `${packageLeaf}/child`]]) {
    refusesPackage(before, framedPackage({ directories }));
  }
});
test("OCR package inventory refuses aliases, duplicates, malformed and nonregular-shaped entries", () => {
  const before = framedPackage();
  for (const alias of [`${packageParent}/../umdlogs`, `${packageParent}/.`, `${packageParent}/`, `${packageParent} `,
    packageParent.replace("NVIDIA", "nvidia"), packageParent.replaceAll("/", "\\"), "/absolute", "C:/absolute", "aux.txt", "file:stream", "bad\nname"]) {
    refusesPackage(before, framedPackage({ directories: [alias] }));
  }
  for (const mutate of [
    (tree) => tree.directories.push("resources"),
    (tree) => tree.directories.push("Resources"),
    (tree) => tree.files.push({ ...tree.files[0] }),
    (tree) => { tree.files[0].kind = "symlink"; },
    (tree) => { tree.files[0].bytes = -1; },
    (tree) => { tree.files[0].bytes = 0.5; },
    (tree) => { tree.files[0].sha256 = "G".repeat(64); },
    (tree) => { tree.files[0] = null; },
    (tree) => { tree.directories[0] = { path: ".", kind: "directory" }; },
    (tree) => { delete tree.files[0]; },
    (tree) => { tree.files.extra = true; },
    (tree) => { tree.total_bytes += 1; },
    (tree) => { tree.framed_sha256 = "0".repeat(64); },
    (tree) => { tree.root = path.join(root, "elsewhere"); },
    (tree) => { tree.schema_version = "other"; },
    (tree) => { tree.extra = true; },
  ]) {
    const after = structuredClone(before); mutate(after); refusesPackage(before, after);
  }
  refusesPackage(null, before); refusesPackage(before, []);
  const accessor = structuredClone(before);
  Object.defineProperty(accessor.files[0], "bytes", { get() { throw new Error("untrusted accessor"); }, enumerable: true });
  refusesPackage(before, accessor);
});
test("OCR package inventory refuses count, byte, depth and path-cap violations without changing caps", () => {
  const before = framedPackage();
  for (const mutate of [
    (tree) => { tree.caps.files += 1; },
    (tree) => { tree.files = Array.from({ length: packageCaps.files + 1 }, () => tree.files[0]); },
    (tree) => { tree.directories = Array.from({ length: packageCaps.directories + 1 }, () => "."); },
    (tree) => { tree.files[0].bytes = packageCaps.fileBytes + 1; },
    (tree) => { tree.total_bytes = packageCaps.totalBytes + 1; },
    (tree) => { tree.directories.push(Array.from({ length: packageCaps.depth + 1 }, () => "d").join("/")); },
    (tree) => { tree.files[0].path = "p".repeat(packageCaps.pathBytes + 1); },
  ]) {
    const after = structuredClone(before); mutate(after); refusesPackage(before, after);
  }
});
