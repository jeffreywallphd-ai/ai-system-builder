import assert from "node:assert/strict";
import { createRequire, isBuiltin } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";

const requireFromRoot = createRequire(path.resolve("package.json"));
const forgeConfig = requireFromRoot("./apps/desktop/forge.config.js");

test("desktop packaging includes the complete managed Python worker resource", () => {
  const resources = forgeConfig.packagerConfig.extraResource;
  assert.equal(resources.length, 1);
  assert.equal(path.basename(resources[0]), "worker");
  for (const file of ["main.py", "requirements.txt", "requirements-context.txt", "tasks/constrained_json_decoder.py"]) {
    assert.ok(existsSync(path.join(resources[0], file)), file);
  }
});

test("desktop packaging admits only Vite output and excludes source, maps and runtime data", () => {
  const ignored = forgeConfig.packagerConfig.ignore;
  for (const file of ["/artifacts/runtime-data", "/dist/apps", "/out/package", "/.git/objects", "/apps/server/.local/server-runtime/model.bin", "/apps/desktop/src/main/index.ts", "/.webpack/main/index.cjs", "/.vite-other/main.cjs", "/.vite/build/main.cjs.map", "/.vite/renderer/main_window/assets/main.js.map"]) {
    assert.equal(ignored(file), true, file);
  }
  for (const file of ["", "/.vite", "/.vite/build/main.cjs", "/.vite/build/main_window_preload.cjs", "/.vite/build/system_runtime_preload.cjs", "/.vite/renderer/system_runtime/index.html"]) {
    assert.equal(ignored(file), false, file);
  }
  assert.equal(requireFromRoot("./package.json").main, ".vite/build/main.cjs");
});

async function generatedConfigs(production = true) {
  const { VitePlugin } = await import("@electron-forge/plugin-vite");
  const plugin = new VitePlugin(forgeConfig.plugins[0].config);
  plugin.setDirectories(process.cwd());
  plugin.isProd = production;
  return {
    builds: await plugin.configGenerator.getBuildConfigs(),
    renderers: await plugin.configGenerator.getRendererConfig(),
  };
}

test("Forge generates distinct CJS main/preloads and relative renderers without leaking Node into renderers", async () => {
  const { builds, renderers } = await generatedConfigs();
  assert.equal(builds.length, 3);
  const [main, ...preloads] = builds;
  assert.deepEqual(main.build?.lib && main.build.lib.formats, ["cjs"]);
  assert.deepEqual(main.build?.lib && Object.keys(main.build.lib.entry), ["main"]);
  assert.equal(main.build?.sourcemap, false);
  assert.equal(main.define?.MAIN_WINDOW_VITE_NAME, JSON.stringify("main_window"));
  assert.equal(main.define?.SYSTEM_RUNTIME_VITE_NAME, JSON.stringify("system_runtime"));
  assert.equal(main.define?.MAIN_WINDOW_VITE_DEV_SERVER_URL, undefined);
  assert.equal(main.define?.SYSTEM_RUNTIME_VITE_DEV_SERVER_URL, undefined);
  assert.deepEqual(preloads.map(config => Object.keys(config.build!.rollupOptions!.input!)).sort(), [["main_window_preload"], ["system_runtime_preload"]]);
  for (const config of preloads) {
    const output = config.build!.rollupOptions!.output as { format: string; inlineDynamicImports: boolean; entryFileNames: string };
    assert.equal(output.format, "cjs");
    assert.equal(output.inlineDynamicImports, true);
    assert.equal(output.entryFileNames, "[name].cjs");
    assert.equal(config.build?.sourcemap, false);
  }
  assert.equal(renderers.length, 2);
  assert.notEqual(renderers[0].root, renderers[1].root);
  assert.notEqual(renderers[0].build?.outDir, renderers[1].build?.outDir);
  for (const config of renderers) {
    assert.equal(config.base, "./");
    assert.equal(config.build?.sourcemap, false);
    const html = readFileSync(path.join(config.root!, "index.html"), "utf8");
    assert.match(html, /type="module" src="\.\/main\.tsx"/);
    assert.ok(!config.build?.rollupOptions?.external, "renderer must not externalize Node modules");
  }
});

test("development renderer listeners remain loopback only with distinct fixed ports", async () => {
  const { renderers } = await generatedConfigs(false);
  assert.deepEqual(renderers.map(config => config.server?.port), [3005, 3006]);
  for (const config of renderers) {
    assert.equal(config.server?.host, "127.0.0.1");
    assert.equal(config.server?.strictPort, true);
    assert.equal(config.server?.cors, false);
    assert.equal(config.server?.fs?.strict, true);
  }
});

test("development renderers keep independent dependency optimizer caches", async () => {
  const { resolveConfig } = await import("vite");
  const { renderers } = await generatedConfigs(false);
  const resolved = await Promise.all(renderers.map(config =>
    resolveConfig({ ...config, configFile: false }, "serve"),
  ));
  assert.notEqual(resolved[0].cacheDir, resolved[1].cacheDir,
    "concurrent renderer optimizers must not invalidate each other's React modules");
  for (const config of resolved) {
    const cache = path.resolve(config.cacheDir);
    assert.equal(path.dirname(cache), path.resolve("node_modules/.vite/desktop"));
    assert.ok(config.server.fs.allow.some(root => path.resolve(root) === path.resolve("node_modules")));
  }
});

test("starting the runtime renderer preserves the editor's already-issued optimized module URLs", { timeout: 30_000 }, async () => {
  const { createServer } = await import("vite");
  const { renderers } = await generatedConfigs(false);
  const parent = path.resolve("node_modules/.vite");
  await mkdir(parent, { recursive: true });
  const fixture = await mkdtemp(path.join(parent, "desktop-cache-regression-"));
  assert.equal(path.dirname(fixture), parent);
  const servers: Awaited<ReturnType<typeof createServer>>[] = [];
  try {
    const urls: string[] = [];
    for (const config of renderers) {
      const server = await createServer({
        ...config, configFile: false, logLevel: "silent",
        // Keep the real configured cache identities inside a disposable fixture.
        cacheDir: path.join(fixture, path.basename(config.cacheDir!)),
        server: { ...config.server, port: 0, strictPort: false, watch: null, hmr: false },
        optimizeDeps: { noDiscovery: true, include: ["react", "react-dom/client", "react/jsx-dev-runtime"] },
      });
      servers.push(server);
      await server.listen();
      const address = server.httpServer!.address();
      assert.ok(address && typeof address === "object");
      const origin = `http://127.0.0.1:${address.port}`;
      const entry = await fetch(`${origin}/main.tsx`, { signal: AbortSignal.timeout(10_000) });
      assert.equal(entry.status, 200);
      const source = await entry.text();
      await server.waitForRequestsIdle();
      const imports = [...source.matchAll(/from "([^"]*\/deps\/[^"?]+\.js\?v=[^"]+)"/g)];
      assert.ok(imports.length >= 2, "exercise actual optimized React imports");
      urls.push(...imports.map(match => new URL(match[1], origin).href));
      // Reuse the editor URLs after the differently configured runtime starts.
      for (const url of urls) {
        const dependency = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        assert.equal(dependency.status, 200, "an already-issued dependency URL must remain valid");
        assert.match(await dependency.text(), /react/i);
      }
    }
  } finally {
    await Promise.all(servers.map(server => server.close()));
    assert.equal(path.dirname(fixture), parent);
    await rm(fixture, { recursive: true, force: true });
  }
});

test("real Vite preload builds run within the sandbox require allowlist and expose only their own bridge", async () => {
  const { build } = await import("vite");
  const { builds } = await generatedConfigs();
  for (const [index, config] of builds.slice(1).entries()) {
    const result = await build({ ...config, configFile: false, logLevel: "silent", build: { ...config.build, write: false, minify: false } });
    assert.ok(!Array.isArray(result) && "output" in result);
    const chunks = result.output.filter(output => output.type === "chunk");
    assert.equal(chunks.length, 1, "sandbox preloads cannot require split chunks");
    const exposed: string[] = [];
    runInNewContext(chunks[0].code, {
      exports: {},
      process: { env: {}, platform: "win32", versions: {} },
      require(specifier: string) {
        assert.equal(specifier, "electron", "no arbitrary Node or sibling preload imports");
        return { contextBridge: { exposeInMainWorld(key: string) { exposed.push(key); } }, ipcRenderer: {} };
      },
    });
    assert.deepEqual(exposed, [index === 0 ? "desktopApi" : "systemRuntime"]);
  }
});

test("unminified development main starts without optional native peers or ambient repository modules", async () => {
  const { build } = await import("vite");
  const { builds } = await generatedConfigs(false);
  const config = builds[0];
  const result = await build({ ...config, configFile: false, logLevel: "silent", build: { ...config.build, watch: null, write: false, minify: false } });
  const results = Array.isArray(result) ? result : [result];
  assert.equal(results.length, 1);
  assert.ok("output" in results[0]);
  const chunks = results[0].output.filter(output => output.type === "chunk");
  assert.equal(chunks.length, 1);
  // Prevent the process bootstrap while evaluating its real dependency closure.
  // Unknown require/import paths are denied rather than resolved in node_modules.
  runInNewContext(chunks[0].code, {
    exports: {}, module: { exports: {} }, __dirname: path.resolve(".vite/build"),
    process: { ...process, env: {} }, Buffer, URL, URLSearchParams,
    TextEncoder, TextDecoder, AbortController, ReadableStream, Request, Response,
    Headers, Blob, FormData, fetch, setTimeout, clearTimeout, setImmediate, console,
    require(specifier: string) {
      if (specifier === "electron") return { app: { whenReady: () => new Promise(() => {}), on() {} } };
      assert.ok(isBuiltin(specifier), `packaged main must not depend on ambient ${specifier}`);
      return requireFromRoot(specifier);
    },
  }, {
    importModuleDynamically(specifier) {
      assert.ok(isBuiltin(specifier), `packaged dynamic imports must not depend on ambient ${specifier}`);
      return import(specifier);
    },
  });
});

test("bundled default provider loaders work offline with all external package imports denied", async () => {
  const { build } = await import("vite");
  const entry = path.resolve("apps/desktop/provider-probe.ts").replaceAll("\\", "/");
  const source = [
    'export { createHuggingFaceModelBrowseDetailsAdapter as models } from ',
    JSON.stringify(path.resolve("modules/adapters/model/huggingface/createHuggingFaceModelBrowseDetailsAdapter.ts").replaceAll("\\", "/")),
    '; export { createHuggingFaceArtifactRepoStorageAdapter as artifacts } from ',
    JSON.stringify(path.resolve("modules/adapters/storage/huggingface/createHuggingFaceArtifactRepoStorageAdapter.ts").replaceAll("\\", "/")),
    ";",
  ].join("");
  const result = await build({
    configFile: false, logLevel: "silent",
    plugins: [{ name: "desktop-provider-probe", enforce: "pre", resolveId: id => id.endsWith("provider-probe.ts") ? "\0desktop-provider-probe" : undefined, load: id => id === "\0desktop-provider-probe" ? source : undefined }],
    build: { write: false, target: "node24", minify: false, lib: { entry, formats: ["cjs"] }, rollupOptions: { external: id => isBuiltin(id), output: { inlineDynamicImports: true } } },
  });
  const outputs = Array.isArray(result) ? result : [result];
  assert.ok("output" in outputs[0]);
  const chunk = outputs[0].output.find(output => output.type === "chunk");
  assert.ok(chunk && chunk.type === "chunk");
  const exports: Record<string, (...args: any[]) => any> = {};
  let calls = 0;
  let status = 200;
  const fixtureFetch = async (_input: unknown, init?: RequestInit) => {
    calls += 1;
    return new Response(init?.method === "HEAD" ? null : "[]", { status, headers: { "content-type": "application/json" } });
  };
  runInNewContext(chunk.code, {
    exports, process: { ...process, env: {} }, Buffer, URL, URLSearchParams,
    Request, Response, Headers, Blob, FormData, ReadableStream, AbortController,
    TextEncoder, TextDecoder, fetch: fixtureFetch, setTimeout, clearTimeout,
    require(specifier: string) { assert.ok(isBuiltin(specifier), "deny ambient package resolution"); return requireFromRoot(specifier); },
  }, { importModuleDynamically() { throw new Error("External module import denied"); } });
  const models = exports.models();
  const browse = await models.browseModels({ provider: "huggingface", query: "fixture", limit: 2 });
  assert.ok(Array.isArray(browse.models), "default model client must be included in the bundle");
  const artifacts = exports.artifacts({ fetchImplementation: fixtureFetch });
  const request = { target: { provider: "huggingface", repository: "fixture/demo", path: "fixture.txt" } };
  const exists = await artifacts.hasArtifactInRepo(request);
  assert.equal(exists.ok, true, JSON.stringify(exists));
  assert.ok(calls >= 2, "both actual official clients must reach the offline fetch boundary");
  status = 403;
  const denied = await artifacts.hasArtifactInRepo(request);
  assert.equal(denied.ok, false, "bundling must preserve provider authorization denial");
});
