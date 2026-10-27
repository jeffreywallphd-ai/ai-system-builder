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
    const entry = config.root!.endsWith("system-runtime") ? "main" : "startup";
    assert.ok(html.includes(`type="module" src="./${entry}.tsx"`) || html.includes(`type="module" src="./${entry}.ts"`));
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

// Execute the actual createMainWindow function against finite native-event ports.
// This verifies ordering/denials without composing storage, models or a real host.
import { EventEmitter } from "node:events";

async function mainWindowFixture(options: { synchronousPaint?: boolean; synchronousThrow?: boolean; cueRejects?: boolean } = {}) {
  const { transform } = await import("esbuild");
  const source = readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8").replaceAll("\r\n", "\n");
  const start = source.indexOf("async function createMainWindow(): Promise<void> {");
  const end = source.indexOf('\nrecordDesktopMemorySnapshot({\n  milestone: "desktop.app.whenReady.enter"', start);
  assert.ok(start >= 0 && end > start, "exercise the actual main-window source function");
  const compiled = await transform(source.slice(start, end) + "\nglobalThis.fixtureBoot = createMainWindow;", { loader: "ts", format: "cjs", target: "node24" });
  let resolveLoad!: () => void;
  let rejectLoad!: (error: unknown) => void;
  const load = new Promise<void>((resolve, reject) => { resolveLoad = resolve; rejectLoad = reject; });
  let constructed!: MockWindow;
  const calls: string[] = [];
  const scripts: string[] = [];
  let rejectCue = options.cueRejects ?? false;
  const errors: string[][] = [];
  const deadlines = new Map<number, () => void>();
  class MockWindow extends EventEmitter {
    destroyed = false;
    contentsDestroyed = false;
    visible = false;
    loading = false;
    url = "";
    webContents = Object.assign(new EventEmitter(), {
      isDestroyed: () => this.contentsDestroyed,
      isLoadingMainFrame: () => this.loading,
      executeJavaScript: (script: string) => {
        scripts.push(script);
        return rejectCue ? Promise.reject(new Error("SYNTHETIC_PRIVATE_CUE_DETAIL")) : Promise.resolve();
      },
    });
    constructor(readonly options: Record<string, any>) { super(); constructed = this; calls.push("construct"); }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    loadURL(url: string) {
      calls.push("load"); this.url = url;
      if (options.synchronousThrow) throw new Error("SYNTHETIC_PRIVATE_NATIVE_DETAIL");
      if (options.synchronousPaint) this.emit("ready-to-show");
      return load;
    }
    maximize() { calls.push("maximize"); this.visible = true; this.emit("show"); }
    show() { calls.push("show"); this.visible = true; }
    destroy() { this.destroyed = true; this.contentsDestroyed = true; calls.push("destroy"); this.emit("closed"); }
  }
  const context: Record<string, any> = {
    BrowserWindow: MockWindow, openWindows: new Set(), recordDesktopMemorySnapshot() {},
    path, pathToFileURL: (await import("node:url")).pathToFileURL,
    __dirname: path.resolve(".vite/build"), MAIN_WINDOW_VITE_DEV_SERVER_URL: "http://127.0.0.1:3005", MAIN_WINDOW_VITE_NAME: "main_window",
    dialog: { showErrorBox: (...values: string[]) => { calls.push("error"); errors.push(values); } },
    setTimeout: (callback: () => void, ms: number) => { assert.equal(ms, 60_000); deadlines.set(1, callback); return 1; },
    clearTimeout: (id: number) => deadlines.delete(id),
  };
  runInNewContext(compiled.code, context);
  const running: Promise<void> = context.fixtureBoot();
  await Promise.resolve();
  return { window: constructed, running, calls, scripts, errors, deadlines, resolveLoad, rejectLoad,
    cueSucceeds() { rejectCue = false; },
    async flush() { await Promise.resolve(); await Promise.resolve(); },
    timeout() { const callback = deadlines.get(1); assert.ok(callback); callback(); },
  };
}

for (const order of ["paint-first", "load-first", "synchronous-paint"] as const) {
  test(`main window stays hidden until both load and first paint: ${order}`, async () => {
    const f = await mainWindowFixture({ synchronousPaint: order === "synchronous-paint" });
    assert.deepEqual(f.calls, ["construct", "load"]);
    assert.equal(f.window.options.show, false);
    assert.equal(f.window.options.backgroundColor, "#06101e");
    assert.equal(f.window.options.webPreferences.contextIsolation, true);
    assert.equal(f.window.options.webPreferences.nodeIntegration, false);
    assert.notEqual(f.window.options.webPreferences.sandbox, false);
    assert.notEqual(f.window.options.webPreferences.paintWhenInitiallyHidden, false);
    if (order === "load-first") { f.resolveLoad(); await f.flush(); }
    else if (order === "paint-first") f.window.emit("ready-to-show");
    assert.equal(f.calls.includes("maximize"), false, "maximize implicitly reveals and must wait");
    if (order === "load-first") f.window.emit("ready-to-show"); else f.resolveLoad();
    await f.running;
    assert.deepEqual(f.calls, ["construct", "load", "maximize", "show"]);
    assert.equal(f.deadlines.size, 0);
    assert.equal(f.window.listenerCount("ready-to-show"), 0);
    assert.equal(f.window.webContents.listenerCount("preload-error"), 0);
    assert.equal(f.window.webContents.listenerCount("render-process-gone"), 0);
    assert.equal(f.errors.length, 0);
    f.window.emit("ready-to-show"); assert.equal(f.calls.filter(c => c === "show").length, 1);
  });
}

for (const failure of ["reject", "throw", "preload-error", "render-process-gone", "deadline"] as const) {
  test(`main window fails safely without revealing an empty document: ${failure}`, async () => {
    const f = await mainWindowFixture({ synchronousThrow: failure === "throw" });
    if (failure === "reject") f.rejectLoad(new Error("SYNTHETIC_PRIVATE_NATIVE_DETAIL"));
    else if (failure === "deadline") f.timeout();
    else if (failure !== "throw") f.window.webContents.emit(failure, {}, new Error("SYNTHETIC_PRIVATE_NATIVE_DETAIL"));
    await f.running;
    assert.equal(f.calls.includes("maximize") || f.calls.includes("show"), false);
    assert.equal(f.window.destroyed, true);
    assert.equal(f.errors.length, 1);
    assert.deepEqual(f.calls.slice(-2), ["error", "destroy"], "show the safe dialog before last-window shutdown");
    assert.equal(JSON.stringify(f.errors).includes("SYNTHETIC_PRIVATE_NATIVE_DETAIL"), false);
    assert.equal(f.deadlines.size, 0);
    assert.equal(f.window.listenerCount("ready-to-show"), 0);
    f.resolveLoad(); f.window.emit("ready-to-show"); await f.flush();
    assert.equal(f.calls.includes("show"), false, "late callbacks cannot resurrect a retired window");
  });
}

test("closing a still-hidden window retires startup without a failure dialog", async () => {
  const f = await mainWindowFixture(); f.window.destroy(); await f.running;
  assert.equal(f.errors.length, 0); assert.equal(f.deadlines.size, 0);
  f.resolveLoad(); f.window.emit("ready-to-show"); await f.flush();
  assert.equal(f.calls.includes("maximize") || f.calls.includes("show"), false);
});

test("visible documents receive only the fixed presentation cue, including a minimized menu reload", async () => {
  const f = await mainWindowFixture(); f.window.webContents.emit("did-finish-load");
  assert.equal(f.scripts.length, 0, "do not announce native visibility before show");
  f.window.emit("ready-to-show"); f.resolveLoad(); await f.running;
  const expected = 'document.documentElement.dataset.desktopWindowShown = "true"; document.dispatchEvent(new Event("desktop-window-shown"));';
  assert.deepEqual(f.scripts, [expected]);
  f.window.visible = false; f.window.webContents.emit("did-finish-load");
  await f.flush();
  assert.deepEqual(f.scripts, [expected, expected], "reload replays show history; renderer still counts only visible time");
  f.window.destroy(); f.window.webContents.emit("did-finish-load");
  await f.flush();
  assert.equal(f.scripts.length, 2);
});

test("a live document's failed presentation cue shows fixed recovery and retires its unusable window", async () => {
  const f = await mainWindowFixture({ cueRejects: true });
  f.window.emit("ready-to-show"); f.resolveLoad(); await f.running; await f.flush();
  assert.equal(f.errors.length, 1); assert.equal(f.window.destroyed, true);
  assert.equal(JSON.stringify(f.errors).includes("SYNTHETIC_PRIVATE_CUE_DETAIL"), false);
  assert.deepEqual(f.calls.slice(-2), ["error", "destroy"]);
});

test("a superseded loading document can reject its cue and replay it after the new load", async () => {
  const f = await mainWindowFixture({ cueRejects: true });
  f.window.loading = true; f.window.emit("ready-to-show"); f.resolveLoad();
  await f.running; await f.flush();
  assert.equal(f.errors.length, 0); assert.equal(f.window.destroyed, false);
  f.window.loading = false; f.cueSucceeds(); f.window.webContents.emit("did-finish-load");
  await f.flush();
  assert.equal(f.scripts.length, 2); assert.equal(f.errors.length, 0);
});

test("production Vite rewrites the real startup document, styles and controller to local packaged assets", async () => {
  const { build } = await import("vite");
  const { renderers } = await generatedConfigs();
  const config = renderers.find(row => path.resolve(row.root!) === path.resolve("apps/desktop/src/renderer"));
  assert.ok(config);
  const appEntry = path.resolve("apps/desktop/src/renderer/main.tsx").replaceAll("\\", "/");
  const result = await build({
    ...config, configFile: false, logLevel: "silent",
    // Keep real HTML/CSS/controller processing; replace only the heavy App graph.
    // This is asset/bootstrap qualification, not a build or run of the full host.
    plugins: [...(config.plugins ?? []), {
      name: "bounded-startup-app-fixture", enforce: "pre",
      load(id) {
        if (id.replaceAll("\\", "/") === appEntry) return 'import { markDesktopRendererLoaded, markDesktopRendererReady } from "./startup/desktopStartup"; markDesktopRendererLoaded(); markDesktopRendererReady();';
      },
    }],
    build: { ...config.build, write: false, minify: false },
  });
  assert.ok(!Array.isArray(result) && "output" in result);
  const document = result.output.find(row => row.type === "asset" && row.fileName === "index.html");
  assert.ok(document && document.type === "asset");
  const html = String(document.source);
  assert.match(html, /id="desktop-startup"/);
  assert.match(html, /<link[^>]+href="\.\/assets\/[^\"]+\.css"/);
  assert.match(html, /<script[^>]+src="\.\/assets\/[^\"]+\.js"/);
  assert.equal(html.includes('src="./startup.ts"'), false);
  const styles = result.output.filter(row => row.type === "asset" && row.fileName.endsWith(".css"));
  assert.ok(styles.some(row => row.type === "asset" && String(row.source).includes("desktop-startup-orbit")));
  assert.ok(styles.some(row => row.type === "asset" && /#06101e/i.test(String(row.source))));
  const scripts = result.output.filter(row => row.type === "chunk");
  assert.ok(scripts.some(row => row.type === "chunk" && row.code.includes("desktop-window-shown")));
  assert.ok(scripts.every(row => row.type === "chunk" && !row.code.includes("require(\"electron\")")));
});
