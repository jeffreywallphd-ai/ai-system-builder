import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import {
  evaluateAuditReport,
  validatePythonDecoderDependencyInventory,
  validatePythonModelPlacementDependencyInventory,
  validatePythonParquetDependencyInventory,
  validatePythonTextTrainingDependencyInventory,
  validateRuntimeSbom,
} from "../check-dependency-security.mjs";

const report = (counts) => ({
  metadata: {
    vulnerabilities: {
      info: 0,
      low: 0,
      moderate: 0,
      high: 0,
      critical: 0,
      ...counts,
    },
  },
});

test("dependency security policy blocks every runtime advisory", () => {
  assert.equal(
    evaluateAuditReport(report({ moderate: 1 }), "runtime").blocking,
    true,
  );
  assert.equal(evaluateAuditReport(report({}), "runtime").blocking, false);
});

test("dependency security policy blocks every toolchain advisory", () => {
  assert.equal(
    evaluateAuditReport(report({ low: 1 }), "toolchain").blocking,
    true,
  );
  assert.equal(
    evaluateAuditReport(report({ high: 4 }), "toolchain").blocking,
    true,
  );
  assert.equal(
    evaluateAuditReport(report({ critical: 1 }), "toolchain").blocking,
    true,
  );
  assert.equal(evaluateAuditReport(report({}), "toolchain").blocking, false);
});

test("root manifest and lock retain the reviewed patched toolchain boundary", async () => {
  const [manifest, lockfile] = await Promise.all([
    readFile("package.json", "utf8").then(JSON.parse),
    readFile("package-lock.json", "utf8").then(JSON.parse),
  ]);

  assert.equal(manifest.engines.node, ">=24 <25");
  assert.equal(manifest.devDependencies.electron, "41.10.2");
  assert.equal(manifest.dependencies.selfsigned, "5.5.0");
  assert.deepEqual(manifest.overrides, {
    "brace-expansion": "$brace-expansion",
    "fast-uri": "3.1.4",
    tar: "7.5.22",
    tmp: "0.2.7",
    "webpack-dev-server": "5.2.6",
    sockjs: { uuid: "11.1.1" },
  });
  assert.equal(lockfile.packages["node_modules/electron"].version, "41.10.2");
  assert.equal(lockfile.packages["node_modules/selfsigned"].version, "5.5.0");

  const lockedPackages = Object.entries(lockfile.packages);
  const versionsFor = (packageName) =>
    lockedPackages
      .filter(([packagePath]) =>
        packagePath.endsWith(`node_modules/${packageName}`),
      )
      .map(([, entry]) => entry.version);
  assert.deepEqual(lockfile.packages["node_modules/brace-expansion"], {
    resolved: "dev-tools/vendor/brace-expansion-compat",
    link: true,
  });
  assert.equal(
    lockfile.packages["dev-tools/vendor/brace-expansion-compat"].version,
    "5.0.8",
  );
  assert.equal(
    lockfile.packages["node_modules/brace-expansion-upstream"].version,
    "5.0.8",
  );
  assert.deepEqual([...new Set(versionsFor("fast-uri"))], ["3.1.4"]);
  assert.deepEqual([...new Set(versionsFor("tar"))], ["7.5.22"]);
  assert.deepEqual([...new Set(versionsFor("tmp"))], ["0.2.7"]);
  assert.deepEqual([...new Set(versionsFor("uuid"))], ["11.1.1"]);
  assert.deepEqual([...new Set(versionsFor("webpack-dev-server"))], ["5.2.6"]);
});

test("reviewed overrides retain the APIs used by the Electron Forge toolchain", () => {
  const require = createRequire(import.meta.url);
  const braceExpansion = require("brace-expansion");
  const fastUri = require("fast-uri");
  const glob = require("glob");
  const tar = require("tar");
  const tmp = require("tmp");
  const uuid = require("uuid");
  const WebpackDevServer = require("webpack-dev-server");

  assert.equal(typeof braceExpansion, "function");
  assert.equal(braceExpansion.expand, braceExpansion);
  assert.deepEqual(braceExpansion("file-{a,b}.txt"), [
    "file-a.txt",
    "file-b.txt",
  ]);
  const bounded = braceExpansion("{a,b}".repeat(30), {
    max: 100,
    maxLength: 1_000,
  });
  assert.ok(bounded.reduce((total, item) => total + item.length, 0) <= 1_000);
  assert.deepEqual(
    glob.sync("package.json", { cwd: process.cwd(), nodir: true }),
    ["package.json"],
  );
  assert.equal(fastUri.parse("https://example.com/path").host, "example.com");
  assert.equal(typeof tar.extract, "function");
  assert.match(tmp.tmpNameSync({ postfix: ".txt" }), /\.txt$/);
  assert.match(
    uuid.v4(),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(typeof WebpackDevServer, "function");
  assert.equal(typeof WebpackDevServer.prototype.start, "function");
});

test("patched webpack dev server supports the Forge lifecycle and same-origin response policy", async (t) => {
  const require = createRequire(import.meta.url);
  const webpack = require("webpack");
  const WebpackDevServer = require("webpack-dev-server");
  const compiler = webpack({
    mode: "development",
    entry: {},
    output: {
      path: path.resolve(
        "artifacts",
        "test-runtime",
        "webpack-dev-server-compatibility",
      ),
    },
  });
  const server = new WebpackDevServer(
    {
      host: "127.0.0.1",
      port: 0,
      static: false,
      hot: false,
      client: false,
      setupExitSignals: false,
    },
    compiler,
  );
  t.after(async () => {
    await server.stop();
    await new Promise((resolve, reject) =>
      compiler.close((error) => (error ? reject(error) : resolve())),
    );
  });

  await server.start();
  const address = server.server?.address();
  assert.ok(address && typeof address === "object");
  const response = await new Promise((resolve, reject) => {
    const request = http.get(
      { host: "127.0.0.1", port: address.port, path: "/" },
      (result) => {
        result.resume();
        result.once("end", () => resolve(result));
      },
    );
    request.once("error", reject);
  });
  assert.equal(response.headers["cross-origin-resource-policy"], "same-origin");
});

test("runtime SBOM validation requires SPDX packages and relationships", () => {
  assert.deepEqual(
    validateRuntimeSbom({
      spdxVersion: "SPDX-2.3",
      packages: [{}],
      relationships: [{}],
    }),
    { packageCount: 1, relationshipCount: 1 },
  );
  assert.throws(
    () => validateRuntimeSbom({ spdxVersion: "SPDX-2.2" }),
    /SPDX 2.3/,
  );
});

test("conditional Python decoder dependencies retain exact reviewed inventory", async () => {
  const requirements = await readFile(
    "modules/adapters/runtime/python/worker/requirements.txt",
    "utf8",
  );
  const inventory = validatePythonDecoderDependencyInventory(requirements);
  assert.equal(inventory.supportedPython, ">=3.10 <3.14");
  assert.deepEqual(
    inventory.packages.map(({ name, version, license }) => ({
      name,
      version,
      license,
    })),
    [
      { name: "outlines", version: "1.3.2", license: "Apache-2.0" },
      {
        name: "outlines-core",
        version: "0.2.14",
        license: "Apache-2.0",
      },
      { name: "jsonschema", version: "4.26.0", license: "MIT" },
    ],
  );
  assert.throws(
    () =>
      validatePythonDecoderDependencyInventory(
        requirements.replace("outlines==1.3.2", "outlines==1.3.3"),
      ),
    /reviewed exact version/,
  );
  assert.throws(
    () =>
      validatePythonDecoderDependencyInventory(
        requirements.replace(
          'python_version < "3.14"',
          'python_version < "3.15"',
        ),
      ),
    /reviewed exact version|incomplete/,
  );
});

test("Python Parquet support retains the patched reviewed inventory", async () => {
  const requirements = await readFile(
    "modules/adapters/runtime/python/worker/requirements.txt",
    "utf8",
  );
  const inventory = validatePythonParquetDependencyInventory(requirements);
  assert.equal(inventory.supportedPython, ">=3.10 <3.15");
  assert.deepEqual(inventory.packages, [
    {
      name: "pyarrow",
      version: "25.0.0",
      license: "Apache-2.0",
      purl: "pkg:pypi/pyarrow@25.0.0",
    },
  ]);
  assert.throws(
    () =>
      validatePythonParquetDependencyInventory(
        requirements.replace("pyarrow==25.0.0", "pyarrow==21.0.0"),
      ),
    /reviewed exact version/,
  );
});

test("Python model loading retains the reviewed placement and LoRA inventory", async () => {
  const requirements = await readFile(
    "modules/adapters/runtime/python/worker/requirements.txt",
    "utf8",
  );
  const inventory =
    validatePythonModelPlacementDependencyInventory(requirements);
  assert.equal(inventory.supportedPython, ">=3.10 <3.15");
  assert.deepEqual(inventory.packages, [
    {
      name: "accelerate",
      version: "1.14.0",
      license: "Apache-2.0",
      purl: "pkg:pypi/accelerate@1.14.0",
    },
    {
      name: "peft",
      version: "0.15.2",
      license: "Apache-2.0",
      purl: "pkg:pypi/peft@0.15.2",
    },
  ]);
  assert.throws(
    () =>
      validatePythonModelPlacementDependencyInventory(
        requirements.replace("accelerate==1.14.0", "accelerate==1.13.0"),
      ),
    /reviewed exact version/,
  );
  assert.throws(
    () =>
      validatePythonModelPlacementDependencyInventory(
        requirements.replace("peft==0.15.2", "peft==0.15.1"),
      ),
    /reviewed exact version/,
  );
});

test("Python text training retains the reviewed exact direct inventory", async () => {
  const requirements = await readFile(
    "modules/adapters/runtime/python/worker/requirements-training-text.txt",
    "utf8",
  );
  const inventory = validatePythonTextTrainingDependencyInventory(requirements);
  assert.equal(inventory.supportedPython, ">=3.10 <3.15");
  assert.deepEqual(inventory.packages, [
    {
      name: "datasets",
      version: "5.0.1",
      license: "Apache-2.0",
      purl: "pkg:pypi/datasets@5.0.1",
    },
    {
      name: "peft",
      version: "0.15.2",
      license: "Apache-2.0",
      purl: "pkg:pypi/peft@0.15.2",
    },
  ]);
  assert.throws(
    () =>
      validatePythonTextTrainingDependencyInventory(
        requirements.replace("peft==0.15.2", "peft>=0.15.2"),
      ),
    /reviewed exact version/,
  );
  assert.throws(
    () =>
      validatePythonTextTrainingDependencyInventory(
        `${requirements}diffusers==0.39.0\n`,
      ),
    /unreviewed direct packages/,
  );
});

test("CI and image builds use the tracked lockfile and immutable action references", async () => {
  const [gitignore, workflow, dockerfile] = await Promise.all([
    readFile(".gitignore", "utf8"),
    readFile(".github/workflows/ci.yml", "utf8"),
    readFile("deployments/server/Dockerfile", "utf8"),
  ]);

  assert.doesNotMatch(gitignore, /^package-lock\.json$/m);
  assert.match(workflow, /npm ci --ignore-scripts --no-audit --no-fund/);
  assert.doesNotMatch(workflow, /uses:\s+[^\s]+@(?![0-9a-f]{40}(?:\s|$))/);
  assert.match(dockerfile, /COPY package\.json package-lock\.json/);
  assert.doesNotMatch(dockerfile, /npm install/);
});
