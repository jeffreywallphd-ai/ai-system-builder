import {readFileSync} from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import ts from "typescript";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
const ports = vi.hoisted(() => ({exists: false, stats: [] as string[], seeds: [] as string[]}));
vi.mock("node:fs", async original => {
  const actual = await original<typeof import("node:fs")>();
  const lstatSync = (name: string, options: {throwIfNoEntry: boolean}) => {
    if (options.throwIfNoEntry !== false) throw new Error("Unexpected fixture stat.");
    ports.stats.push(name); return ports.exists ? {} : undefined;
  };
  return {...actual, lstatSync, default: {...actual, lstatSync}};
});
vi.mock("node:child_process", async original => {
  const actual = await original<typeof import("node:child_process")>();
  const spawnSync = (_binary: string, argv: string[], options: {timeout: number; windowsHide: boolean; env: Record<string, string>}) => {
    expect(options.timeout).toBe(30000); expect(options.windowsHide).toBe(true);
    expect(argv.slice(0, -1)).toEqual(["--preserve-symlinks", "--preserve-symlinks-main", "--import", "tsx"]);
    expect(options.env.ELECTRON_RUN_AS_NODE).toBe("1"); expect(options.env.VISUAL_COMPOSER_LARGE_FIXTURE).toBe("0");
    ports.seeds.push(options.env.VISUAL_COMPOSER_DESKTOP_DATA_ROOT!); return {status: 0};
  };
  return {...actual, spawnSync, default: {...actual, spawnSync}};
});
import {assetQualificationIdentity, requireAssetQualificationIdentity, assetObservation, createAssetEvidenceReport,
  assetEvidenceBody, finalizeAssetEvidence, assetAdmissionFailure, assetViewportPng, assetCaptureBudget,
  assetApplicationLifetime, runAssetQualificationCase, ASSET_PNG_MAX_BYTES} from "../visual-composer/asset-experience-oracles";
import {prepareIsolatedDesktopCase} from "../visual-composer/e2e/isolated-desktop-case";

const source = "source." + "1".repeat(64), run = "asset-fixture-0123456789012345";
const cases = [
  {host: "packaged-desktop", native: false, title: "packaged desktop Assets meaningful authoring and persistence"},
  {host: "packaged-desktop", native: true, title: "packaged desktop Assets native 400 percent zoom"},
  {host: "managed-thin-chrome", native: false, title: "managed thin client builds, customizes, reviews, publishes and reopens real assets"},
  {host: "managed-thin-chrome", native: true, title: "managed thin client Assets reflows at actual native 400 percent browser zoom"},
];
const identity = (index = 0) => {const row = cases[index]!; return assetQualificationIdentity(source, run, row.host, row.native, row.title);};
const png = (width = 1440, height = 1000) => {
  const bytes = Buffer.alloc(33); Buffer.from("89504e470d0a1a0a", "hex").copy(bytes);
  bytes.writeUInt32BE(13, 8); bytes.write("IHDR", 12, "ascii"); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
};
beforeEach(() => {
  ports.exists = false; ports.stats.length = ports.seeds.length = 0;
  vi.stubEnv("VISUAL_COMPOSER_DESKTOP_DATA_ROOT", path.resolve("artifacts/qualification/visual-composer/d/asset-fixture"));
  vi.stubEnv("VISUAL_COMPOSER_ELECTRON_NODE_EXECUTABLE", "synthetic-owned-electron");
});
afterEach(() => {vi.unstubAllEnvs(); vi.restoreAllMocks();});

describe("closed Assets qualification identity", () => {
  it.each(cases)("captures $host native=$native with distinct fixed names", row => {
    const value = assetQualificationIdentity(source, run, row.host, row.native, row.title);
    expect(Object.isFrozen(value)).toBe(true); expect(requireAssetQualificationIdentity(value)).toBe(value);
    expect(value.nativeZoom).toBe(row.native); expect(value.host).toBe(row.host);
    expect(value.suffix).toBe(row.host === "managed-thin-chrome" ? row.native ? "-managed-native400" : "-managed-standard" : "");
  });
  it.each([undefined, null, 0, 1, "false", {}, new Boolean(false)])("refuses nonboolean modes without coercion %#", value => {
    expect(() => assetQualificationIdentity(source, run, cases[0]!.host, value, cases[0]!.title)).toThrow("Invalid Assets");
    expect(ports.stats).toEqual([]); expect(ports.seeds).toEqual([]);
  });
  it("refuses wrong source/run/host/title and forged or proxied identities without executing methods", () => {
    const trap = vi.fn(() => {throw new Error("Synthetic private input");});
    const poison = new Proxy({}, {get: trap, getPrototypeOf: trap, ownKeys: trap});
    for (const [s, r, h, mode, title] of [[poison, run, cases[0]!.host, false, cases[0]!.title],
      [source, "../outside", cases[0]!.host, false, cases[0]!.title], [source, run, "thin-chrome", false, cases[0]!.title],
      [source, run, cases[0]!.host, true, cases[0]!.title], [source, run, cases[0]!.host, false, poison]]) {
      expect(() => assetQualificationIdentity(s, r, h, mode, title)).toThrow();
    }
    for (const value of [undefined, poison, {...identity()}, JSON.parse(JSON.stringify(identity()))]) {
      expect(() => requireAssetQualificationIdentity(value)).toThrow();
      expect(() => createAssetEvidenceReport(value as never)).toThrow();
    }
    expect(trap).not.toHaveBeenCalled(); expect(ports.stats).toEqual([]); expect(ports.seeds).toEqual([]);
  });
});

describe("fresh Assets desktop slots", () => {
  it.each(["assets", "assets-zoom"] as const)("admits only a new fenced %s slot with unchanged seed bounds", slot => {
    const value = prepareIsolatedDesktopCase(slot);
    expect(value.dataRoot).toBe(path.resolve("artifacts/qualification/visual-composer/d/asset-fixture", slot));
    expect(value.env.HF_HUB_CACHE).toBe(path.join(value.dataRoot, "controlled-model-cache"));
    expect(ports.stats).toEqual([value.dataRoot]); expect(ports.seeds).toEqual([value.dataRoot]);
  });
  it.each(["assets", "assets-zoom"] as const)("refuses retained %s and never seeds it", slot => {
    ports.exists = true; expect(() => prepareIsolatedDesktopCase(slot)).toThrow(); expect(ports.seeds).toEqual([]);
  });
  it("denies unsafe roots, nested/unlisted slots and a sample index before filesystem or seed effects", () => {
    for (const slot of ["assets", "assets-zoom"] as const) {
      expect(() => prepareIsolatedDesktopCase(slot, 0)).toThrow();
      for (const root of ["", "relative/artifacts/qualification/visual-composer/d/fixture", path.resolve(".local-codex/outside"),
        path.resolve("..", "lookalike", "artifacts/qualification/visual-composer/d/fixture")]) {
        vi.stubEnv("VISUAL_COMPOSER_DESKTOP_DATA_ROOT", root); expect(() => prepareIsolatedDesktopCase(slot)).toThrow();
      }
    }
    for (const slot of ["assets/child", "assets-zoom/../escape", "assets\\child", "unlisted"]) expect(() => prepareIsolatedDesktopCase(slot as never)).toThrow();
    expect(ports.stats).toEqual([]); expect(ports.seeds).toEqual([]);
  });
});

describe("complete browser observation projection", () => {
  it("retains full focus and numbered-state numeric facts without CSS or private strings", () => {
    const focus = {kind: "rendered-focus-contrast", width: 1440,
      outline: {visible: true, outline: 2, shadow: true, x: 10, right: 90, y: 20, bottom: 40, width: 1440, height: 1000},
      contrast: {samples: 24, ratios: Array(24).fill(4.5), minimum: 4.5, imageWidth: 2880, imageHeight: 2000, cssToDeviceScale: 2}};
    const number = {kind: "numbered-step-background", width: 1440, state: "active", facts: {
      stateBackground: [24, 24, 24, 255], stepZ: "auto", numberBackground: [0, 0, 0, 0], numberImage: "none",
      foreground: [250, 250, 250, 255], x: 30, y: 80, width: 24, height: 24, font: 16, opacity: "1",
      viewportWidth: 1440, viewportHeight: 1000, dpr: 2}, samples: 18, maximumBackdropDeviation: 2,
      textContrast: 14, imageWidth: 2880, imageHeight: 2000};
    const value = identity(), report = createAssetEvidenceReport(value);
    report.observations.push(assetObservation(focus), assetObservation(number)); report.status = "passed";
    expect(JSON.parse(assetEvidenceBody(value, report)).observations).toEqual([focus, number]);
    for (const facts of [{...number.facts, foreground: "rgb(250, 250, 250)"}, {...number.facts, stateBackground: "private-value"}]) {
      expect(() => assetObservation({...number, facts})).toThrow();
    }
    expect(() => assetObservation({...focus, outline: {...focus.outline, shadow: "0 0 private"}})).toThrow();
  });
  it("rejects oversized arrays before enumerating their descriptors", () => {
    const huge = new Array(1000000), report = createAssetEvidenceReport(identity());
    const original = Object.getOwnPropertyDescriptors;
    const inspect = vi.spyOn(Object, "getOwnPropertyDescriptors").mockImplementation(value => {
      if (value === huge) throw new Error("Oversized array was enumerated.");
      return original(value);
    });
    expect(() => assetObservation({samples: huge})).toThrow("Invalid Assets");
    report.failureTypes = huge;
    expect(() => assetEvidenceBody(identity(), report)).toThrow("Invalid Assets");
    expect(inspect.mock.calls.some(([value]) => value === huge)).toBe(false);
  });
});

describe("private-free bounded Asset evidence", () => {
  it("copies finite numeric/rule/image facts without aliases or arbitrary UI strings", () => {
    const observation = {surface: "Saved", width: 320, contrast: {samples: 24, ratios: [3, 4.5], minimum: 3},
      violations: [], incomplete: [], contrastPassedNodes: 2, retries: {attempted: 1, passed: 1}, status: "passed"};
    const copy = assetObservation(observation); observation.contrast.ratios[0] = 0;
    expect((copy.contrast as {ratios: number[]}).ratios).toEqual([3, 4.5]);
    const value = identity(), report = createAssetEvidenceReport(value); report.observations.push(copy); report.status = "passed";
    const parsed = JSON.parse(assetEvidenceBody(value, report));
    expect(parsed.schemaVersion).toBe("asset-accessibility-v2"); expect(parsed.source).toBe(source); expect(parsed.nativeZoom).toBe(false);
    expect(parsed.observations).toEqual([copy]); expect(parsed.status).toBe("passed");
  });
  it("refuses private fields, arbitrary strings, nonfinite/deep/large arrays, sparse/accessor/symbol/proxy input without getter calls", () => {
    const getter = vi.fn((): never => {throw new Error("synthetic-private-token");});
    const accessor = Object.defineProperty({}, "kind", {enumerable: true, get: getter});
    const sparse = new Array(1), withGetter = Object.defineProperty([], "0", {enumerable: true, get: getter});
    const extra = [1]; Object.defineProperty(extra, Symbol.iterator, {get: getter});
    const proxy = new Proxy({}, {get: getter, getPrototypeOf: getter, ownKeys: getter});
    let deep: unknown = {samples: 1}; for (let i = 0; i < 11; i++) deep = {facts: deep};
    for (const value of [{message: "synthetic-private-token"}, {selectors: ["private"]}, {kind: "synthetic-private-token"},
      {samples: NaN}, {samples: Infinity}, {samples: 1e10}, {ratios: sparse}, {ratios: withGetter}, {ratios: extra},
      {ratios: Array(513).fill(1)}, {toJSON: getter}, accessor, proxy, deep, [], "none"]) expect(() => assetObservation(value)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  it("bounds report count/bytes and refuses extra fields or unsafe stages without serializing them", () => {
    const value = identity(), report = createAssetEvidenceReport(value);
    report.observations = Array.from({length: 257}, () => ({kind: "keyboard-focus"}));
    expect(() => assetEvidenceBody(value, report)).toThrow();
    report.observations = Array.from({length: 16}, () => ({failures: Array(500).fill("native-technical-accessibility-audit-v1")}));
    expect(() => assetEvidenceBody(value, report)).toThrow("fixed bound");
    report.observations = []; report.failureStage = "synthetic-private-token"; expect(() => assetEvidenceBody(value, report)).toThrow();
    report.failureStage = "audit"; Object.assign(report, {message: "synthetic-private-token"}); expect(() => assetEvidenceBody(value, report)).toThrow();
  });
  it.each([undefined, null, false, 0, ""])("preserves primary/falsy reason and restore/attach/write/recovery failures %#", async reason => {
    const value = identity(), report = createAssetEvidenceReport(value), failures: unknown[] = [reason], steps: string[] = [];
    const restore = new Error("synthetic-private-restore"), attach = new Error("synthetic-private-attach"), write = new Error("synthetic-private-write");
    let caught: unknown;
    try {await finalizeAssetEvidence(report, failures, async () => {steps.push("restore"); throw restore;},
      async () => {steps.push("save"); expect(assetEvidenceBody(value, report)).not.toContain("synthetic-private"); throw write;},
      async () => {steps.push("attach"); expect(report.status).toBe("failed"); throw attach;});} catch (error) {caught = error;}
    expect(caught).toBeInstanceOf(AggregateError); expect((caught as AggregateError).errors).toEqual([reason, restore, attach, write, write]);
    expect(steps).toEqual(["restore", "attach", "save", "save"]); expect(report.failureStage).toBe("restore");
    expect(report.finalizationStage).toBe("evidence-save"); expect(report.failureTypes).toEqual(["Unknown", "Error"]);
  });
  it("keeps existing primary stage, succeeds only after restore and attaches current status before final save", async () => {
    const value = identity(), report = createAssetEvidenceReport(value); report.status = "passed"; const steps: string[] = [];
    await finalizeAssetEvidence(report, [], async () => {steps.push("restore");}, async () => {steps.push("save"); expect(JSON.parse(assetEvidenceBody(value, report)).status).toBe("passed");}, async () => {steps.push("attach");});
    expect(steps).toEqual(["restore", "attach", "save"]);
    report.status = "failed"; report.failureStage = "audit";
    await expect(finalizeAssetEvidence(report, [0], async () => {throw null;}, async () => undefined, async () => undefined)).rejects.toBeInstanceOf(AggregateError);
    expect(report.failureStage).toBe("audit");
  });
  it("admission failures disclose only fixed type/stage facts and preserve failed exclusive saves", async () => {
    const getter = vi.fn(() => "synthetic-private-token"), error = new Error("synthetic-private-token");
    Object.defineProperty(error, "name", {get: getter}); const bodies: string[] = [];
    await expect(assetAdmissionFailure(identity(), error, async body => {bodies.push(body); throw null;}, async body => {bodies.push(body); throw false;})).rejects.toBeInstanceOf(AggregateError);
    expect(bodies).toHaveLength(3); expect(bodies.every(b => !b.includes("synthetic-private-token"))).toBe(true);
    expect(JSON.parse(bodies[bodies.length - 1]!).status).toBe("failed"); expect(getter).not.toHaveBeenCalled();
  });
});

describe("deliberate bounded composited PNG evidence", () => {
  it("preserves original bytes/hash and separate standard/native names without supplied Buffer methods", () => {
    const bytes = png(), value = assetViewportPng(bytes.toString("base64"));
    expect(value).toEqual(bytes); const method = vi.fn(() => "synthetic-private-token"); value.toString = method as never;
    const capture = assetCaptureBudget(identity());
    const facts = capture("keyboard-focus-1440.png", value);
    expect(facts.screenshotSha256).toBe(createHash("sha256").update(bytes).digest("hex")); expect(method).not.toHaveBeenCalled();
    expect(() => capture("keyboard-focus-1440.png", bytes)).toThrow();
    expect(() => capture("keyboard-focus-native.png", bytes)).toThrow();
    expect(assetCaptureBudget(identity(1))("keyboard-focus-native.png", bytes).screenshot).toBe("keyboard-focus-native.png");
  });
  it("denies malformed encoded/header/dimension/oversize PNG and unsafe names before capture", () => {
    const poison = {toString: vi.fn(() => "private")};
    for (const value of [poison, "", "bad!", "====", png(6001).toString("base64"), png(1, 4201).toString("base64"),
      png(6000, 4200).toString("base64"), Buffer.alloc(33).toString("base64"), "A".repeat(Math.ceil(ASSET_PNG_MAX_BYTES / 3) * 4 + 4)]) expect(() => assetViewportPng(value)).toThrow();
    expect(poison.toString).not.toHaveBeenCalled();
    const capture = assetCaptureBudget(identity());
    for (const name of ["../outside.png", "keyboard-focus-321.png", "workflow-number-1440-private.png", "keyboard-focus-native.png"]) expect(() => capture(name, png())).toThrow();
    expect(() => capture("keyboard-focus-1440.png", poison as never)).toThrow(); expect(poison.toString).not.toHaveBeenCalled();
  });
});

describe("once-only owned Asset app lifecycle and public failure boundary", () => {
  it("serializes four restarts, confirms each close/exit, and refuses a sixth launch", async () => {
    const lifetime = assetApplicationLifetime(), events: string[] = [];
    for (let n = 0; n < 5; n++) {
      const process = {exitCode: null as number | null};
      await lifetime.launch(async () => {events.push("launch"); return {process: () => process, close: async () => {events.push("close"); process.exitCode = 0;}};});
      const first = lifetime.retire(), second = lifetime.retire(); expect(second).toBe(first); await first;
    }
    const extra = vi.fn(); await expect(lifetime.launch(extra)).rejects.toThrow(); expect(extra).not.toHaveBeenCalled();
    expect(events).toEqual(Array.from({length: 5}, () => ["launch", "close"]).flat());
  });
  it("refuses overlapping startup and retains a returned app even when process capture fails", async () => {
    const lifetime = assetApplicationLifetime(); let release!: (value: {process(): {exitCode: number | null}; close(): Promise<void>}) => void;
    const process = {exitCode: null as number | null}, close = vi.fn(async () => {process.exitCode = 0;});
    const first = lifetime.launch(() => new Promise(resolve => {release = resolve;})); const overlap = vi.fn();
    await expect(lifetime.launch(overlap)).rejects.toThrow(); expect(overlap).not.toHaveBeenCalled();
    release({process: () => process, close}); await first; await lifetime.retire(); expect(close).toHaveBeenCalledTimes(1);
    const broken = assetApplicationLifetime(), retire = vi.fn(async () => undefined);
    await expect(broken.launch(async () => ({process: () => {throw 0;}, close: retire}))).rejects.toBe(0);
    await expect(broken.retire()).rejects.toBeInstanceOf(AggregateError); expect(retire).toHaveBeenCalledTimes(1);
  });
  it("does not relaunch after close or exit refusal and redacts ordinary reporter errors", async () => {
    const lifetime = assetApplicationLifetime(), close = vi.fn(async () => {throw new Error("synthetic-private-token");});
    await lifetime.launch(async () => ({process: () => ({exitCode: null}), close}));
    await expect(lifetime.retire()).rejects.toBeInstanceOf(AggregateError);
    const launch = vi.fn(); await expect(lifetime.launch(launch)).rejects.toThrow(); expect(launch).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1);
    const cleanup = vi.fn(async () => {throw false;});
    let caught: unknown; try {await runAssetQualificationCase(async () => {throw new Error("synthetic-private-token");}, cleanup);} catch (error) {caught = error;}
    expect(cleanup).toHaveBeenCalledTimes(1); expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("Assets qualification failed. Check the bounded stage evidence."); expect(Object.getOwnPropertyDescriptor(caught, "cause")).toBeUndefined();
  });
});

describe("Asset definition wiring and meaningful preserved source oracles", () => {
  const read = (name: string) => readFileSync(path.resolve("dev-tools/scripts/qualification/visual-composer", name), "utf8");
  it("uses captured identities, strict snapshots/count collectors and failed safe finalization", () => {
    const text = read("e2e/asset-experience-journey.ts"), tree = ts.createSourceFile("journey.ts", text, ts.ScriptTarget.Latest, true);
    const functions = tree.statements.filter(ts.isFunctionDeclaration);
    for (const name of ["completeAssetExperienceJourney", "qualifyAssetSurfaces"]) {
      const fn = functions.find(f => f.name?.text === name)!; expect(fn.body!.statements[0]!.getText(tree)).toBe("requireAssetQualificationIdentity(identity);");
    }
    let pushes = 0; const calls: string[] = [];
    const walk = (node: ts.Node) => {if (ts.isCallExpression(node)) {
      calls.push(node.expression.getText(tree));
      if (node.expression.getText(tree) === "report.observations.push") {pushes++; expect(ts.isCallExpression(node.arguments[0]!)).toBe(true); expect((node.arguments[0] as ts.CallExpression).expression.getText(tree)).toBe("assetObservation");}
    } ts.forEachChild(node, walk);}; walk(tree);
    expect(pushes).toBe(7); for (const name of ["assetAdmissionFailure", "assetEvidenceBody", "finalizeAssetEvidence", "collectDocumentAccessibilityAudit", "collectNativeDocumentAccessibilityAudit", "assetViewportPng", "runOwnedRestartPhase"]) expect(calls).toContain(name);
    expect(text).toContain('flag: created ? "w" : "wx"'); expect(text).not.toContain("node.target"); expect(text).not.toContain("messages, issues");
    for (const assertion of ['expect(contrast.samples).toBe(24)', 'expect(contrast.minimum).toBeGreaterThanOrEqual(3)',
      'expect(observation.samples).toBe(18)', 'expect(observation.maximumBackdropDeviation).toBeLessThanOrEqual(3)',
      'expect(observation.textContrast).toBeGreaterThanOrEqual(4.5)', '"Page.captureScreenshot"', 'captureBeyondViewport: false',
      'SYSTEM_FOUNDATION_PACK_MANIFEST', 'createPackageFixture', 'originalBases', 'captureCustomizationBase',
      '"studio-three-resources"', '"saved-exact-reopen"', '"review-publish"', '"reload-rediscovery"',
      'capabilities: [{summary: "status-summary"}]', 'getImageData(0, 0, canvas.width, canvas.height)']) expect(text).toContain(assertion);
  });
  it("keeps all four existing cases/deadlines, explicit fresh managed workspaces, exact restart IDs and owned zoom", () => {
    const managed = read("e2e/managed-reference-asset-experience.e2e.spec.ts"), desktop = read("e2e/packaged-desktop-asset-experience.e2e.spec.ts");
    for (const text of [managed, desktop]) {
      expect(text).toContain('test.setTimeout(480000)'); expect(text).toContain('test.use({trace: "off", screenshot: "off", video: "off"})');
      expect(text).toContain('toHaveValue(workspaceId'); expect(text).toContain('runAssetQualificationCase'); expect(text).not.toContain('BrowserWindow.getAllWindows');
      expect(text).toContain('info, identity');
    }
    for (const row of cases.slice(2)) expect(managed).toContain(row.title);
    expect(desktop).toContain('for (const zoom of [false, true])'); expect(desktop).toContain('await applyOwnedDesktopNativeZoom(app, page)');
    expect(desktop).toContain('await lifetime.retire(); app = await lifetime.launch(launch)'); expect(desktop).toContain('page === retiredPage');
    expect(managed.indexOf('name: "Create new workspace"')).toBeLessThan(managed.indexOf('return workspaceId'));
    expect(managed).not.toContain('field.isVisible()'); expect(managed).toContain('new URL("/",'); expect(managed).toContain('not.toHaveValue(previous)');
    const heading = managed.indexOf('page.getByRole("heading", {name: workspaceName, exact: true})');
    expect(heading).toBeGreaterThan(managed.indexOf('const workspaceId = await selected.inputValue()'));
    expect(heading).toBeLessThan(managed.indexOf('new URL("/assets",'));
    expect(managed).toContain('.fill(workspaceName)');
  });
});
