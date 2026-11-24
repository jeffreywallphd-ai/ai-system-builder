import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {lstat, mkdir, mkdtemp, open, opendir, readFile, realpath, rename, rm, writeFile, link} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import test, {type TestContext} from "node:test";
import type {ApprovedLocalTrainingDefinition, ApprovedLocalTrainingModelSelection} from "../../../../application/ports/model";
import type {WorkspaceId} from "../../../../contracts/workspace";
import {createOriginalTrainingPort, type OriginalTrainingCapture, type OriginalTrainingOwnedChannel} from "../client/approvedTrainingTaskSession";
import {createOriginalTrainingModelSourceFactory, assertOriginalTrainingModelObservation,
  bindOriginalTrainingSourceLaunch, captureOriginalTrainingSourceLaunch, type OriginalTrainingSourceReservation,
  type OriginalTrainingModelObservation, type ObservedOriginalTrainingModelSource,
  type OriginalTrainingModelObservationPolicy} from "../client/originalTrainingModelSource";

type IO = NonNullable<Parameters<typeof createOriginalTrainingModelSourceFactory>[1]>;
const realIO: IO = {lstat, open, opendir, realpath};
const digest = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const at = "2026-11-23T00:00:00.000Z", hash = "sha256:" + "a".repeat(64);
async function fixture(t: TestContext, options: {reader?: false; io?: (base: IO) => IO;
  policy?: Partial<OriginalTrainingModelObservationPolicy>; onObserved?: () => Promise<void>} = {}) {
  const boundary = await realpath(tmpdir()), root = await realpath(await mkdtemp(path.join(boundary, "model-observation-")));
  const identity = await lstat(root, {bigint: true}), model = path.join(root, "model"); await mkdir(model);
  const contents = {"config.json": '{"synthetic":true}', "tokenizer.json": '{"synthetic":"tokenizer"}', "model.safetensors": "synthetic bytes, never loaded"};
  for (const [name, content] of Object.entries(contents)) await writeFile(path.join(model, name), content);
  const gates: (() => void)[] = [];
  t.after(async () => {
    for (const release of gates) release();
    // Fixture IO wrappers own their exceptional raw handles explicitly. Tests
    // settle/close those before this exclusively created directory is removed.
    await new Promise(resolve => setImmediate(resolve));
    const current = await lstat(root, {bigint: true});
    assert.ok(current.isDirectory() && !current.isSymbolicLink()); assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino);
    assert.equal(await realpath(root), root); assert.equal(path.dirname(root), boundary); await rm(root, {recursive: true});
  });
  const policy: OriginalTrainingModelObservationPolicy = {allowedRootDirectories: [root], maximumTotalBytes: 1024,
    maximumDurationMs: 5_000, bufferBytes: 7, ...options.policy};
  const factory = createOriginalTrainingModelSourceFactory(policy, options.io?.(realIO) ?? realIO);
  const id = randomUUID(), workspaceId = randomUUID() as WorkspaceId;
  const definition: ApprovedLocalTrainingDefinition = {requestId: id, workspaceId,
    owner: {organizationId: "synthetic-org", principalId: "synthetic-actor", clientId: randomUUID(), hostIncarnationId: randomUUID()},
    request: {workspaceId, trainingTask: "llm-instruction", baseModel: {modelRecordId: "model.synthetic", localPath: model},
      datasets: [{artifactId: "input-0", splitRole: "train"}], method: "lora", commonParameters: {}, output: {outputModelName: "synthetic", destination: {local: {enabled: false}}}},
    modelUpdatedAt: at, dataset: {datasetId: "dataset", versionId: "v1", versionDigest: hash, recipeDigest: hash},
    proposalDigest: hash, inputs: [{artifactId: "input-0", role: "train", mediaType: "application/jsonl", digest: hash, sizeBytes: 2}], recipeSizeBytes: 2};
  const state = {current: true, allowed: true, modelRead: true, reads: 0, reservations: 0, releases: 0, dispatches: 0,
    onRead: undefined as (() => Promise<void> | void) | undefined,
    onPermission: undefined as (() => Promise<void> | void) | undefined,
    selection: {modelRecordId: "model.synthetic", modelUpdatedAt: at, localModelReference: model} as ApprovedLocalTrainingModelSelection};
  const reader = {async read() {assert.equal(this, reader); state.reads++; await state.onRead?.(); return state.modelRead ? {...state.selection} : undefined;}};
  let original: OriginalTrainingCapture | undefined, owner: OriginalTrainingModelObservation | undefined, observed: ObservedOriginalTrainingModelSource | undefined;
  const identityData = {runtimeId: "synthetic-runtime", workerStartedAt: at, profileId: "synthetic", profileFingerprint: hash};
  const binding = {...identityData, requestId: id, workspaceId, sessionId: "b".repeat(64)};
  const channel: OriginalTrainingOwnedChannel = {identity: identityData, assertCurrent() {}, async retireOriginalWorker() {return true;}, releaseUnusedWorker() {},
    async send(endpoint) {state.dispatches++; assert.equal(endpoint, "/training/original/prepare"); return {binding, phase: "ready"};}};
  const port = createOriginalTrainingPort({reserve(capture) {
    original = capture; owner = factory.bind(capture); if (!owner) return undefined;
    state.reservations++; return () => {assert.ok(owner!.isSettled()); state.releases++;};
  }, async captureChannel(capture) {assert.equal(capture, original); observed = await owner!.observe(); await options.onObserved?.(); return channel;}});
  const session = port.createSession(definition, {isCurrent: () => state.current, stillAllowed: async () => {await state.onPermission?.(); return state.allowed;}},
    options.reader === false ? undefined : reader);
  return {root, model, contents, policy, definition, state, factory, reader, session, gates,
    get original() {return original;}, get owner() {return owner;}, get observed() {return observed;}};
}

test("original reserved training source observes complete actual SHA256 bytes without starting a model", async t => {
  const f = await fixture(t); assert.equal(f.state.reads, 0); assert.equal(f.state.dispatches, 0);
  assert.equal(await f.session!.prepare(), "ready"); assert.equal(f.state.reads, 3); assert.equal(f.state.dispatches, 1);
  assert.deepEqual(f.observed!.files, Object.entries(f.contents).sort(([a], [b]) => a.localeCompare(b)).map(([name, content]) => ({name,
    sizeBytes: Buffer.byteLength(content), sha256: digest(content)})));
  assert.ok(Object.isFrozen(f.observed)); assert.ok(Object.isFrozen(f.observed!.files)); assert.ok(f.observed!.files.every(Object.isFrozen));
  assert.equal(f.owner!.isSettled(), true); assertOriginalTrainingModelObservation(f.original!, f.observed!);
  assert.throws(() => assertOriginalTrainingModelObservation(f.original!, JSON.parse(JSON.stringify(f.observed))));
  assert.equal("nativeCustody" in f.observed!, false); assert.equal("ready" in f.observed!, false);
  assert.equal(await readFile(path.join(f.model, "model.safetensors"), "utf8"), f.contents["model.safetensors"]);
});

async function launchFixture(t: TestContext, loseCharge = false) {
  let signal!: () => void, finish!: () => void;
  const observed = new Promise<void>(resolve => {signal = resolve;}), held = new Promise<void>(resolve => {finish = resolve;});
  let preparing: Promise<unknown> | undefined;
  t.after(async () => {finish(); await preparing;});
  const f = await fixture(t, {onObserved: async () => {signal(); await held;}});
  preparing = f.session!.prepare();
  await Promise.race([observed, preparing.then(() => {throw Error("Original preparation ended before source binding");})]);
  const calls: string[] = []; let live = true;
  const hooks: {charge?: () => Promise<void>} = {};
  const reservation: OriginalTrainingSourceReservation = {configuration: {freshParent: f.root, freshName: "source-copy",
    maximumCopyBytes: 65_536, bufferBytes: 4096, preparationMs: 5000},
    assertCurrent() {assert.equal(this, reservation); assert.ok(live);},
    async chargeSourceCopy(bytes) {assert.equal(this, reservation); assert.equal(bytes, 65_536); calls.push("charge");
      await hooks.charge?.();
      if (loseCharge) throw Error("unknown original charge");},
    async retainSourceCopy(bytes) {assert.equal(this, reservation); assert.equal(bytes, 65_536); calls.push("retain");}};
  const token = bindOriginalTrainingSourceLaunch(f.original!, f.observed!, reservation);
  return {...f, calls, hooks, reservation, token, loseReservation() {live = false;}};
}

test("source launch redeems original observation once, captures reservation receivers, and retains after caller withdrawal", async t => {
  const f = await launchFixture(t), launch = captureOriginalTrainingSourceLaunch(f.token);
  assert.throws(() => captureOriginalTrainingSourceLaunch(f.token));
  assert.throws(() => captureOriginalTrainingSourceLaunch({} as never));
  assert.throws(() => bindOriginalTrainingSourceLaunch(f.original!, f.observed!, f.reservation));
  assert.throws(() => bindOriginalTrainingSourceLaunch({...f.original!}, f.observed!, f.reservation));
  assert.throws(() => bindOriginalTrainingSourceLaunch(f.original!, JSON.parse(JSON.stringify(f.observed)), f.reservation));
  f.reservation.chargeSourceCopy = async () => {throw Error("replaced charge");};
  f.reservation.retainSourceCopy = async () => {throw Error("replaced retain");};
  assert.equal(launch.descriptor.logicalPath, f.model); assert.equal(launch.descriptor.sourcePath, f.model);
  assert.equal(launch.descriptor.definitionDigest, "sha256:" + digest(JSON.stringify(f.original!.definition)));
  await launch.acknowledge("charge", 65_536);
  await launch.acknowledge("allocate", 65_536);
  for (const _ of f.observed!.files) await launch.acknowledge("copy", 65_536);
  await launch.acknowledge("seal", 65_536); await launch.acknowledge("create", 65_536); await launch.acknowledge("dispatch", 65_536);
  const modelReads = f.state.reads; f.state.current = false; f.state.allowed = false; f.state.modelRead = false;
  await launch.acknowledge("retain", 65_536); assert.deepEqual(f.calls, ["charge", "retain"]);
  assert.equal(f.state.reads, modelReads);
  await assert.rejects(() => launch.acknowledge("retain", 65_536)); assert.deepEqual(f.calls, ["charge", "retain"]);
});

for (const failure of ["order", "amount", "permission", "reservation", "lost-charge", "parallel"] as const)
  test(`source launch refuses ${failure} without repeated reservation effects`, async t => {
    const f = await launchFixture(t, failure === "lost-charge");
    const launch = captureOriginalTrainingSourceLaunch(f.token);
    if (failure === "permission") f.state.allowed = false;
    if (failure === "reservation") f.loseReservation();
    if (failure === "parallel") {
      const pending = launch.acknowledge("charge", 65_536);
      await assert.rejects(() => launch.acknowledge("charge", 65_536)); await pending;
      assert.deepEqual(f.calls, ["charge"]); return;
    }
    await assert.rejects(() => launch.acknowledge(failure === "order" ? "copy" : "charge", failure === "amount" ? 1 : 65_536));
    await assert.rejects(() => launch.acknowledge("charge", 65_536));
    assert.equal(f.calls.length, failure === "lost-charge" ? 1 : 0);
  });

for (const change of ["revision-before-charge", "revision-before-dispatch", "path-before-dispatch", "during-charge", "during-permission"] as const)
  test(`source launch rejects stale saved Model ${change}`, async t => {
    const f = await launchFixture(t), launch = captureOriginalTrainingSourceLaunch(f.token);
    const changeModel = () => {f.state.selection = {...f.state.selection,
      ...(change === "path-before-dispatch" ? {localModelReference: path.join(f.root, "other")} : {modelUpdatedAt: "2030-01-01T00:00:00.000Z"})};};
    if (change === "revision-before-charge") changeModel();
    if (change === "during-permission") f.state.onPermission = changeModel;
    if (change === "during-charge") {
      f.hooks.charge = async () => {await new Promise(resolve => setImmediate(resolve)); changeModel();};
    }
    if (change.endsWith("before-dispatch")) {
      for (const phase of ["charge", "allocate", "copy", "copy", "copy", "seal", "create"] as const)
        await launch.acknowledge(phase, 65_536);
      changeModel(); await assert.rejects(() => launch.acknowledge("dispatch", 65_536));
      assert.deepEqual(f.calls, ["charge"]);
    } else {
      await assert.rejects(() => launch.acknowledge("charge", 65_536));
      assert.equal(f.calls.length, change === "during-charge" ? 1 : 0);
    }
    await assert.rejects(() => launch.acknowledge("dispatch", 65_536));
  });

test("configured missing Model reader refuses before a reservation, filesystem IO or worker dispatch", async t => {
  let io = 0;
  const f = await fixture(t, {reader: false, io: base => ({...base, lstat: (async () => {io++; throw Error("no IO permitted");}) as typeof lstat})});
  assert.equal(f.session, undefined); assert.equal(f.state.reservations, 0); assert.equal(io, 0); assert.equal(f.state.dispatches, 0);
});

test("reconstructed and foreign captures cannot supply an observed source association", async t => {
  const first = await fixture(t), second = await fixture(t);
  assert.throws(() => first.factory.bind({...first.original!}));
  assert.equal(await first.session!.prepare(), "ready");
  assert.throws(() => assertOriginalTrainingModelObservation(second.original!, first.observed!));
  assert.equal(second.state.reads, 0); assert.equal(second.state.dispatches, 0);
});

for (const kind of ["ModelRead denied", "revision", "path"] as const) test(`original source denies ${kind} before filesystem reads`, async t => {
  let io = 0;
  const f = await fixture(t, {io: base => ({...base, lstat: (async () => {io++; throw Error("must deny before IO");}) as typeof lstat})});
  if (kind === "ModelRead denied") f.state.modelRead = false;
  else f.state.selection = {...f.state.selection, ...(kind === "revision" ? {modelUpdatedAt: "2030-01-01T00:00:00.000Z"} : {localModelReference: path.join(f.root, "other")})};
  assert.equal(await f.session!.prepare(), "unconfirmed"); assert.equal(io, 0); assert.equal(f.state.dispatches, 0); assert.equal(f.state.releases, 0);
});

for (const name of ["unexpected.txt", "adapter_config.json", "model.safetensors.index.json", "chat_template.jinja"])
  test(`entire original inventory refuses unapproved entry ${name}`, async t => {
    const f = await fixture(t); await writeFile(path.join(f.model, name), "synthetic");
    assert.equal(await f.session!.prepare(), "unconfirmed"); assert.equal(f.state.dispatches, 0); assert.equal(f.owner!.isSettled(), true);
  });

test("empty directories and real hardlinks cannot become safe source files", async t => {
  const directory = await fixture(t); await mkdir(path.join(directory.model, "generation_config.json"));
  assert.equal(await directory.session!.prepare(), "unconfirmed"); assert.equal(directory.state.dispatches, 0);
  const hardlink = await fixture(t); await link(path.join(hardlink.model, "config.json"), path.join(hardlink.root, "owned-hardlink"));
  assert.equal(await hardlink.session!.prepare(), "unconfirmed"); assert.equal(hardlink.state.dispatches, 0);
});

test("case-fold aliases and symlink facts deny before source file open", async t => {
  for (const mode of ["case", "symlink"] as const) {
    let opens = 0;
    const f = await fixture(t, {io: base => ({...base,
      async opendir(filename: any) {
        if (mode !== "case") return base.opendir(filename);
        const names = ["config.json", "CONFIG.JSON"]; let at = 0;
        return {async read() {return at < names.length ? {name: names[at++]} : null;}, async close() {}} as any;
      },
      lstat: (async (filename: any, options: any) => {
        const result: any = await base.lstat(filename, options);
        if (mode === "symlink" && path.basename(String(filename)) === "config.json") return {...result, mode: 0o120777n};
        return result;
      }) as typeof lstat,
      open: (async (...args: any[]) => {opens++; return (base.open as any)(...args);}) as typeof open,
    })});
    assert.equal(await f.session!.prepare(), "unconfirmed"); assert.equal(opens, 0); assert.equal(f.state.dispatches, 0);
  }
});

test("configured byte budgets deny without buffering the selected weight file", async t => {
  let reads = 0;
  const f = await fixture(t, {policy: {maximumTotalBytes: 1}, io: base => ({...base,
    open: (async (...args: any[]) => {reads++; return (base.open as any)(...args);}) as typeof open})});
  assert.equal(await f.session!.prepare(), "unconfirmed"); assert.equal(reads, 0); assert.equal(f.state.dispatches, 0);
});

test("same-size source replacement during opened-handle handoff cannot publish a manifest", async t => {
  let changed = false;
  const f = await fixture(t, {io: base => ({...base, open: (async (filename: any, flags: any) => {
    const file = await base.open(filename, flags);
    if (!changed) {changed = true; const old = String(filename) + ".owned-old"; await rename(filename, old);
      await writeFile(filename, await readFile(old));}
    return file;
  }) as typeof open})});
  assert.equal(await f.session!.prepare(), "unconfirmed"); assert.equal(f.state.dispatches, 0); assert.equal(f.observed, undefined);
});

test("late inventory entries and changed saved Model revision are rechecked", async t => {
  const entry = await fixture(t);
  entry.state.onRead = async () => {if (entry.state.reads === 2) await writeFile(path.join(entry.model, "late-unknown.txt"), "synthetic");};
  assert.equal(await entry.session!.prepare(), "unconfirmed"); assert.equal(entry.state.dispatches, 0);
  const revision = await fixture(t);
  revision.state.onRead = () => {if (revision.state.reads === 2) revision.state.selection = {...revision.state.selection, modelUpdatedAt: "2030-01-01T00:00:00.000Z"};};
  assert.equal(await revision.session!.prepare(), "unconfirmed"); assert.equal(revision.state.dispatches, 0);
});

test("captured reader and filesystem methods keep original receivers across waits", async t => {
  let replacements = 0, f!: Awaited<ReturnType<typeof fixture>>;
  const io = {...realIO, async open(filename: any, flags: any) {
    assert.equal(this, io); const file = await realIO.open(filename, flags);
    f.reader.read = async () => {replacements++; throw Error("replacement reader");};
    io.open = (async () => {replacements++; throw Error("replacement open");}) as typeof open;
    return file;
  }} as IO;
  f = await fixture(t, {io: () => io});
  assert.equal(await f.session!.prepare(), "ready"); assert.equal(replacements, 0); assert.equal(f.state.reads, 3);
});

for (const stage of ["second hash", "file close"] as const)
  for (const loss of ["revision", "path", "ModelRead"] as const)
    test(`final saved Model reread denies ${loss} drift during ${stage}`, async t => {
      let f!: Awaited<ReturnType<typeof fixture>>, passes = 0, changed = false;
      const change = () => {
        changed = true;
        if (loss === "ModelRead") f.state.modelRead = false;
        else f.state.selection = {...f.state.selection, ...(loss === "revision"
          ? {modelUpdatedAt: "2030-01-01T00:00:00.000Z"} : {localModelReference: path.join(f.root, "changed")})};
      };
      f = await fixture(t, {io: base => ({...base, open: (async (filename: any, flags: any) => {
        const file = await base.open(filename, flags), selected = path.basename(String(filename)) === "config.json";
        return {stat: file.stat.bind(file), async close() {
          await file.close();
          // Change after the real close has returned, before its awaited reply.
          if (selected && stage === "file close") change();
        }, async read(buffer: Buffer, offset: number, length: number, position: number) {
          if (selected && position === 0 && ++passes === 2 && stage === "second hash") change();
          return file.read(buffer, offset, length, position);
        }};
      }) as unknown as typeof open})});
      assert.equal(await f.session!.prepare(), "unconfirmed"); assert.equal(changed, true);
      assert.equal(f.state.reads, 3); assert.equal(f.state.dispatches, 0); assert.equal(f.state.releases, 0);
      assert.equal(f.observed, undefined); assert.equal(f.owner!.isSettled(), true);
      await assert.rejects(f.owner!.observe());
    });

test("final saved Model reread follows every closed original file and permits no later source IO", async t => {
  let f!: Awaited<ReturnType<typeof fixture>>, files = 0, closed = 0, checks = 0;
  const beforeIO = () => {assert.ok(f.state.reads < 3, "No source IO may follow the final Model reread"); checks++;};
  f = await fixture(t, {io: base => ({
    lstat: (async (...args: any[]) => {beforeIO(); return (base.lstat as any)(...args);}) as typeof lstat,
    realpath: (async (...args: any[]) => {beforeIO(); return (base.realpath as any)(...args);}) as typeof realpath,
    opendir: (async (...args: any[]) => {
      beforeIO(); const dir = await (base.opendir as any)(...args);
      return {async read() {beforeIO(); return dir.read();}, async close() {beforeIO(); await dir.close();}};
    }) as unknown as typeof opendir,
    open: (async (...args: any[]) => {
      beforeIO(); const file = await (base.open as any)(...args); files++;
      return {async stat(...values: any[]) {beforeIO(); return file.stat(...values);},
        async read(...values: any[]) {beforeIO(); return file.read(...values);},
        async close() {beforeIO(); await file.close(); closed++;}};
    }) as unknown as typeof open,
  })});
  f.state.onRead = () => {if (f.state.reads === 3) {assert.equal(files, 3); assert.equal(closed, files);}};
  assert.equal(await f.session!.prepare(), "ready"); assert.equal(f.state.reads, 3); assert.equal(f.state.dispatches, 1);
  assert.equal(closed, files); assert.ok(checks > 0); assert.equal(f.owner!.isSettled(), true);
});

test("reentrant observation from its own awaited callback is denied; concurrent readers share one original flight", async t => {
  const f = await fixture(t); let checked = false;
  f.state.onRead = async () => {
    if (!checked) {checked = true; await assert.rejects(f.owner!.observe()); await Promise.resolve(); await assert.rejects(f.owner!.observe());}
  };
  assert.equal(await f.session!.prepare(), "ready"); assert.equal(checked, true); assert.equal(f.state.reads, 3);
  const one = f.owner!.observe(), two = f.owner!.observe(); assert.equal(one, two); assert.equal(await one, f.observed);
});

test("unknown close retains the original owner without another close or startup", async t => {
  let closes = 0;
  const f = await fixture(t, {io: base => ({...base, open: (async (...args: any[]) => {
    const file = await (base.open as any)(...args);
    return {stat: file.stat.bind(file), read: file.read.bind(file), async close() {
      closes++; await file.close(); throw Error("synthetic lost close acknowledgement");
    }};
  }) as unknown as typeof open})});
  assert.equal(await f.session!.prepare(), "unconfirmed"); const attempts = closes;
  assert.equal(f.owner!.isSettled(), false); assert.equal(await f.owner!.retire(), false); assert.equal(await f.owner!.retire(), false);
  assert.equal(closes, attempts); assert.equal(f.state.dispatches, 0); assert.equal(f.state.releases, 0);
});

for (const loss of ["permission", "currentness"] as const) test(`source ${loss} lost during open stays lost and closes only original IO`, async t => {
  let f!: Awaited<ReturnType<typeof fixture>>;
  f = await fixture(t, {io: base => ({...base, open: (async (...args: any[]) => {
    const file = await (base.open as any)(...args);
    if (loss === "permission") f.state.allowed = false; else f.state.current = false;
    return file;
  }) as typeof open})});
  assert.equal(await f.session!.prepare(), "unconfirmed"); assert.equal(f.state.dispatches, 0); assert.equal(f.owner!.isSettled(), true);
  f.state.allowed = f.state.current = true; await assert.rejects(f.owner!.observe());
  assert.equal(f.state.dispatches, 0); assert.equal(f.state.releases, 0);
});

for (const mode of ["short", "extended", "changed"] as const) test(`source ${mode} read cannot publish observed bytes`, async t => {
  let changed = false;
  const f = await fixture(t, {io: base => ({...base, open: (async (filename: any, flags: any) => {
    const file = await base.open(filename, flags);
    return {stat: file.stat.bind(file), close: file.close.bind(file), async read(buffer: Buffer, offset: number, length: number, position: number) {
      if (mode === "short") return {buffer, bytesRead: 0};
      if (mode === "extended") return {buffer, bytesRead: length + 1};
      const reply = await file.read(buffer, offset, length, position);
      if (!changed) {changed = true; const count = (await file.stat()).size; await writeFile(filename, Buffer.alloc(count, 88));}
      return reply;
    }} as any;
  }) as typeof open})});
  assert.equal(await f.session!.prepare(), "unconfirmed"); assert.equal(f.state.dispatches, 0); assert.equal(f.observed, undefined);
});

test("root identity drift and final ModelRead withdrawal deny source publication", async t => {
  let opened = false;
  const drift = await fixture(t, {io: base => ({...base,
    open: (async (...args: any[]) => {const file = await (base.open as any)(...args); opened = true; return file;}) as typeof open,
    lstat: (async (filename: any, options: any) => {
      const value: any = await base.lstat(filename, options);
      return opened && path.basename(String(filename)) === "model" ? {...value, ino: value.ino + 1n} : value;
    }) as typeof lstat,
  })});
  assert.equal(await drift.session!.prepare(), "unconfirmed"); assert.equal(drift.state.dispatches, 0);
  const policy = await fixture(t); policy.state.onRead = () => {if (policy.state.reads === 2) policy.state.modelRead = false;};
  assert.equal(await policy.session!.prepare(), "unconfirmed"); assert.equal(policy.state.dispatches, 0);
});

test("observation policy and original selection are captured before caller changes", async t => {
  const f = await fixture(t);
  (f.policy.allowedRootDirectories as string[])[0] = path.join(f.root, "unapproved");
  (f.definition.request.baseModel as any).localPath = path.join(f.root, "other");
  assert.equal(await f.session!.prepare(), "ready"); assert.equal(f.observed!.logicalPath, f.model);
  for (const mutation of [{bufferBytes: 65_537}, {maximumTotalBytes: Number.NaN}, {maximumDurationMs: 0},
    {allowedRootDirectories: []}, {allowedRootDirectories: ["relative"]}, {ready: true}])
    assert.throws(() => createOriginalTrainingModelSourceFactory({...f.policy, allowedRootDirectories: [f.root], ...mutation} as never));
});

test("active reader, filesystem and read-reply getters are refused without execution", async t => {
  const f = await fixture(t); let getters = 0, reservations = 0;
  const port = createOriginalTrainingPort({reserve() {reservations++; return () => {};}, captureChannel: async () => {throw Error("unreachable");}});
  assert.throws(() => port.createSession(f.definition, {isCurrent: () => true, stillAllowed: async () => true},
    {get read() {getters++; return async () => f.state.selection;}}));
  assert.equal(reservations, 0); assert.equal(getters, 0);
  assert.throws(() => createOriginalTrainingModelSourceFactory(f.policy, {...realIO, get open() {getters++; return realIO.open;}}));
  assert.equal(getters, 0);
  const reply = await fixture(t, {io: base => ({...base, open: (async (...args: any[]) => {
    const file = await (base.open as any)(...args);
    return {stat: file.stat.bind(file), close: file.close.bind(file), async read(buffer: Buffer) {
      return {buffer, get bytesRead() {getters++; return 1;}};
    }};
  }) as unknown as typeof open})});
  assert.equal(await reply.session!.prepare(), "unconfirmed"); assert.equal(getters, 0); assert.equal(reply.state.dispatches, 0);
});

test("deadline returns failure while late original open stays owned until its real close", async t => {
  t.mock.timers.enable({apis: ["setTimeout", "Date"], now: Date.now()});
  let release!: () => void, closed!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;}), closeProof = new Promise<void>(resolve => {closed = resolve;});
  const opened = new Promise<void>(resolve => {entered = resolve;});
  const f = await fixture(t, {policy: {maximumDurationMs: 100}, io: base => ({...base, open: (async (...args: any[]) => {
    const file = await (base.open as any)(...args); entered(); await gate;
    return {stat: file.stat.bind(file), read: file.read.bind(file), async close() {await file.close(); closed();}};
  }) as typeof open})});
  try {
    f.gates.push(release); const preparing = f.session!.prepare();
    await Promise.race([opened, preparing.then(() => {throw Error("Observation ended before the held open.");})]);
    t.mock.timers.tick(100);
    assert.equal(await preparing, "unconfirmed"); assert.equal(f.owner!.isSettled(), false); assert.equal(await f.owner!.retire(), false);
    release(); await closeProof; await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.owner!.isSettled(), true); assert.equal(await f.owner!.retire(), true);
    assert.equal(f.observed, undefined); assert.equal(f.state.dispatches, 0); assert.equal(f.state.releases, 0);
    assert.equal(await f.session!.settle(), false); // IO retirement is not global custody release.
  } finally {release(); t.mock.timers.reset();}
});
