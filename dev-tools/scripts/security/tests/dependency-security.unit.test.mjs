import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import http from "node:http";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  evaluateAuditReport,
  validatePythonContextDependencyInventory,
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
  assert.equal(manifest.devDependencies.electron, "42.11.18");
  assert.equal(manifest.dependencies.selfsigned, "5.5.0");
  assert.deepEqual(manifest.overrides, {
    "body-parser": "2.4.0",
    "brace-expansion": "$brace-expansion",
    tar: "7.5.22",
    tmp: "0.2.7",
    "@electron/get": { undici: "7.30.1" },
  });
  assert.equal(lockfile.packages["node_modules/electron"].version, "42.11.18");
  assert.equal(
    lockfile.packages["node_modules/electron"].resolved,
    "https://registry.npmjs.org/electron/-/electron-42.11.18.tgz",
  );
  assert.equal(
    lockfile.packages["node_modules/electron"].integrity,
    "sha512-hbzodG06x/l7uq+oeyob5ugv6qZBmJRWC7Uto5QEE99xSHUARz6d+++Rz+79T/ssTYTQkONW4ciTTcJuAbXKIQ==",
  );
  assert.equal(lockfile.packages["node_modules/selfsigned"].version, "5.5.0");
  assert.equal(lockfile.packages["node_modules/body-parser"].version, "2.4.0");

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
    "5.0.12",
  );
  // npm may place the exact upstream alias beneath its local file consumer.
  // Check all locked instances instead of assuming a hoisted physical layout.
  assert.deepEqual([...new Set(versionsFor("brace-expansion-upstream"))], ["5.0.12"]);
  assert.deepEqual(versionsFor("fast-uri"), []);
  assert.deepEqual([...new Set(versionsFor("tar"))], ["7.5.22"]);
  // The supported Forge migration removes the old tmp consumer entirely.
  assert.deepEqual(versionsFor("tmp"), []);
  for (const obsolete of ["@electron-forge/plugin-webpack", "webpack", "webpack-dev-server", "braces", "micromatch", "http-proxy-middleware"]) {
    assert.deepEqual(versionsFor(obsolete), [], `${obsolete} must not remain in the resolved toolchain`);
  }
  assert.equal(manifest.devDependencies["@electron-forge/plugin-vite"], "8.0.1");
  assert.equal(manifest.devDependencies.vite, "7.3.7");
  assert.deepEqual([...new Set(versionsFor("undici").filter(version => version.startsWith("7.")))], ["7.30.1"]);
});

test("reviewed overrides retain the APIs used by the Electron Forge toolchain", () => {
  const require = createRequire(import.meta.url);
  const braceExpansion = require("brace-expansion");
  const glob = require("glob");
  const tar = require("tar");

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
  assert.equal(typeof tar.extract, "function");

});

test("brace expansion compatibility supports both ESM named and CommonJS callable consumers", async () => {
  const namespace = await import("brace-expansion");
  assert.equal(typeof namespace.expand, "function");
  assert.equal(namespace.expand, namespace.default);
  assert.deepEqual(namespace.expand("file-{a,b}.txt"), ["file-a.txt", "file-b.txt"]);
});

test("patched proxy subnet matching denies unrelated IPv4 identities", () => {
  // GHSA-jqcg-44mw-7w3h; synthetic addresses, no external requests.
  const require = createRequire(import.meta.url);
  const proxyaddr = require("proxy-addr");
  for (const subnet of ["::ffff:10.0.0.0/8", "::/1"]) {
    const trust = proxyaddr.compile([subnet]);
    assert.equal(trust("203.0.113.20", 0), false);
    assert.equal(proxyaddr({ socket: { remoteAddress: "203.0.113.20" },
      headers: { "x-forwarded-for": "10.1.2.3" } }, trust), "203.0.113.20");
  }
  for (const subnet of ["10.0.0.0/8", "::ffff:10.0.0.0/104"]) {
    const trust = proxyaddr.compile([subnet]);
    assert.equal(trust("10.1.2.3", 0), true);
    assert.equal(trust("203.0.113.20", 0), false);
  }
});

test("Vite development serves source but denies private evidence and foreign origins", { timeout: 15_000 }, async (t) => {
  const { createServer } = await import("vite");
  // The aggregate runner stages executable files, not renderer HTML. Exercise
  // the real repository server config and filesystem boundary in either mode.
  const { createDesktopRendererConfig } = await import(pathToFileURL(
    path.resolve("apps/desktop/vite.renderer.shared.mjs"),
  ).href);
  const config = createDesktopRendererConfig("main_window", "renderer", 0);
  assert.equal(config.root, path.resolve("apps/desktop/src/renderer"));
  const privateRoot = path.resolve(".local-codex/t");
  await mkdir(privateRoot, { recursive: true });
  const fixtureRoot = await mkdtemp(path.join(privateRoot, "vite-denial-"));
  const privateFile = path.join(fixtureRoot, "synthetic-private-diagnostic.json");
  await writeFile(privateFile, '{"fixture":"private evidence must not be served"}');
  const artifactRoot = path.resolve("artifacts/test-runtime");
  await mkdir(artifactRoot, { recursive: true });
  const artifactFixtureRoot = await mkdtemp(path.join(artifactRoot, "vite-denial-"));
  const artifact = path.join(artifactFixtureRoot, "synthetic-private-diagnostic.json").replaceAll("\\", "/");
  await writeFile(artifact, '{"fixture":"private artifact must not be served"}');
  // This test owns HTTP exposure, not React transformation. Avoid dependency
  // optimization/watch work shared with concurrent bundle tests; real dev and
  // packaged UI journeys qualify the unchanged React pipeline separately.
  const server = await createServer({ ...config, configFile: false, logLevel: "silent", plugins: [], server: { ...config.server, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
  t.after(async () => { server.httpServer?.closeAllConnections(); await server.close(); await rm(fixtureRoot, { recursive: true, force: true }); await rm(artifactFixtureRoot, { recursive: true, force: true }); });
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address === "object");
  const request = (requestPath, headers = {}) => new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port: address.port, path: requestPath, headers }, response => {
      response.resume(); response.once("end", () => resolve(response));
    }).once("error", reject);
  });
  assert.equal((await request("/")).statusCode, 200);
  const denied = await request(`/@fs/${privateFile.replaceAll("\\", "/")}`);
  assert.equal(denied.statusCode, 403);
  assert.equal((await request(`/@fs/${artifact}`)).statusCode, 403);
  const crossOrigin = await request("/", { Origin: "https://untrusted.example" });
  assert.equal(crossOrigin.headers["access-control-allow-origin"], undefined);
  assert.equal((await request("/", { Host: "untrusted.example" })).statusCode, 403);
});

test("Electron downloader retains compatible patched proxy dispatcher APIs", async (t) => {
  const require = createRequire(import.meta.url);
  const downloaderRequire = createRequire(require.resolve("@electron/get"));
  const { EnvHttpProxyAgent, fetch } = downloaderRequire("undici");
  assert.equal(downloaderRequire("undici/package.json").version, "7.30.1");
  const agent = new EnvHttpProxyAgent({ noProxy: "*" });
  const server = http.createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/ok" });
      response.end();
    } else response.end("offline downloader fixture");
  });
  t.after(async () => { await agent.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/`, { dispatcher: agent });
  assert.equal(await response.text(), "offline downloader fixture");
  const redirected = await fetch(`http://127.0.0.1:${address.port}/redirect`, { dispatcher: agent });
  assert.equal(await redirected.text(), "offline downloader fixture");
  await assert.rejects(fetch(`http://127.0.0.1:${address.port}/redirect`, { dispatcher: agent, redirect: "error" }));
});

test("patched request parser preserves normal bodies, bounded refusals and continued service", { timeout: 15_000 }, async (t) => {
  const { default: express } = await import("express");
  const app = express();
  app.use(express.json({ limit: "1kb" }));
  app.use(express.urlencoded({ extended: true, limit: "1kb" }));
  app.post("/parse", (request, response) => response.json(request.body));
  app.use((error, _request, response, _next) => response.status(error.status ?? 400).json({ refused: true }));
  const server = http.createServer(app);
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const post = (body, type = "application/json", encoding) => new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port: address.port, path: "/parse", method: "POST",
      headers: { "content-type": type, "content-length": body.length, ...(encoding ? { "content-encoding": encoding } : {}) } }, response => {
      const chunks = []; let count = 0;
      response.on("data", chunk => {
        count += chunk.length;
        if (count > 4096) response.destroy(new Error("Bounded fixture response exceeded."));
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    request.setTimeout(3000, () => request.destroy(new Error("Bounded fixture request timeout.")));
    request.on("error", reject); request.end(body);
  });
  const body = Buffer.from(JSON.stringify({ fixture: "local request", items: [1, 2] }));
  const expected = { status: 200, body: { fixture: "local request", items: [1, 2] } };
  assert.deepEqual(await post(body), expected);
  assert.deepEqual(await post(gzipSync(body), "application/json", "gzip"), expected);
  assert.deepEqual(await post(Buffer.from("label=fixture&nested%5Bvalue%5D=two"), "application/x-www-form-urlencoded"),
    { status: 200, body: { label: "fixture", nested: { value: "two" } } });
  assert.equal((await post(Buffer.from("not gzip"), "application/json", "gzip")).status, 400);
  const oversized = gzipSync(Buffer.from(JSON.stringify({ fixture: "x".repeat(2048) })));
  assert.equal((await post(oversized, "application/json", "gzip")).status, 413);
  // A single tiny owned fixture exercises late decoder cleanup. The supplier
  // can reject early or finish the valid frame; the next request must work.
  const trailing = await post(Buffer.concat([gzipSync(body), Buffer.from("x")]), "application/json", "gzip");
  assert.ok([200, 400].includes(trailing.status));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal((await post(body)).status, 200);
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

test("Python Context retains the reviewed exact LanceDB inventory", async () => {
  const requirements = await readFile(
    "modules/adapters/runtime/python/worker/requirements-context.txt",
    "utf8",
  );
  const inventory = validatePythonContextDependencyInventory(requirements);
  assert.equal(inventory.supportedPython, ">=3.10 <3.15");
  assert.deepEqual(inventory.packages, [
    {
      name: "lancedb",
      version: "0.34.0",
      license: "Apache-2.0",
      purl: "pkg:pypi/lancedb@0.34.0",
    },
    {
      name: "pyarrow",
      version: "25.0.0",
      license: "Apache-2.0",
      purl: "pkg:pypi/pyarrow@25.0.0",
    },
  ]);
  assert.throws(
    () =>
      validatePythonContextDependencyInventory(
        requirements.replace("lancedb==0.34.0", "lancedb>=0.34.0"),
      ),
    /reviewed exact version/,
  );
  assert.throws(
    () =>
      validatePythonContextDependencyInventory(
        `${requirements}requests==2.32.5\n`,
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
