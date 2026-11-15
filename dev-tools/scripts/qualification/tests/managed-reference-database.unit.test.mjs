import assert from "node:assert/strict";
import {mkdtempSync, readFileSync, rmSync, symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {test} from "node:test";
import {acquireDatabase, assertRestrictedDatabase, IMAGE, stopDatabase} from "../visual-composer/managed-reference-database.mjs";

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "aisb-pg-"));
  const calls = []; let container, running = false;
  const execute = args => {
    calls.push(args);
    if (args[0] === "image") return JSON.stringify([{RepoDigests: [IMAGE]}]);
    if (args[0] === "create") {
      const name = args[args.indexOf("--name") + 1];
      container = {Id: "c".repeat(64), Name: `/${name}`, Config: {Image: IMAGE, User: "999:999",
        Labels: {"ai-system-builder.qualification": "true", "ai-system-builder.run": name.slice("aisb-qualification-".length)}},
        State: {Running: false}, HostConfig: {Privileged: false, ReadonlyRootfs: true, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges"],
          Memory: 768 * 1024**2, NanoCpus: 2e9, PidsLimit: 128, NetworkMode: "bridge", RestartPolicy: {Name: "no"},
          Tmpfs: Object.fromEntries(["/tmp", "/var/lib/postgresql", "/var/run/postgresql"].map(destination => [destination,
            `rw,noexec,nosuid,size=${destination === "/var/lib/postgresql" ? "512m" : "16m"},uid=999,gid=999,mode=0700`]))},
        NetworkSettings: {Ports: {"5432/tcp": [{HostIp: "127.0.0.1", HostPort: "54321"}]}}, Mounts: []};
      return container.Id;
    }
    if (args[0] === "inspect") {container.State.Running = running; return JSON.stringify([container]);}
    if (args[0] === "start") {running = true; return "";}
    if (args[0] === "stop") {running = false; return "";}
    if (args[0] === "exec") return args.includes("psql") ? "1" : "ready";
    throw new Error("Unexpected command.");
  };
  return {root, calls, execute, get container() {return container;}, close: () => rmSync(root, {recursive: true, force: true})};
}
test("acquisition uses a cached exact image, isolated bounded argv and a private credential file; stop checks exact owner", async t => {
  const f = fixture(); t.after(f.close);
  const result = await acquireDatabase(f.root, {execute: f.execute});
  assert.equal(result.status, "ready");
  const create = f.calls.find(args => args[0] === "create");
  for (const option of ["--pull=never", "127.0.0.1::5432", "--network=bridge", "--user=999:999", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--memory=768m", "--cpus=2", "--pids-limit=128"]) assert.ok(create.includes(option));
  assert.equal(create.at(-1), IMAGE);
  const envFile = create[create.indexOf("--env-file") + 1];
  const env = readFileSync(envFile, "utf8");
  const secret = /^POSTGRES_PASSWORD=([a-f0-9]{64})$/m.exec(env)[1];
  assert.ok(!JSON.stringify(f.calls).includes(secret));
  const record = JSON.parse(readFileSync(path.join(f.root, result.database_reference), "utf8"));
  assert.ok(!JSON.stringify(record).includes(secret));
  assert.equal(record.port, 54321);
  assert.equal(record.readiness, "tcp-authenticated-select-1");
  assert.equal(stopDatabase(f.root, result.database_reference, {execute: f.execute}).status, "stopped");
  assert.equal(f.calls.filter(args => args[0] === "stop").length, 1);
  stopDatabase(f.root, result.database_reference, {execute: f.execute});
  assert.equal(f.calls.filter(args => args[0] === "stop").length, 1);
});
test("socket-only init readiness cannot publish ready; final TCP and authenticated query are both required", async t => {
  const f = fixture(); t.after(f.close); let probes = 0, waits = 0;
  const result = await acquireDatabase(f.root, {execute: args => {
    if (args.includes("pg_isready")) {
      assert.equal(args[args.indexOf("--host") + 1], "127.0.0.1");
      assert.equal(args[args.indexOf("--port") + 1], "5432");
      if (++probes === 1) throw new Error("Only temporary Unix socket is ready.");
    }
    if (args.includes("psql")) assert.deepEqual(args.slice(-2), ["--command", "SELECT 1"]);
    return f.execute(args);
  }, pause: async () => {waits++;}});
  assert.equal(result.status, "ready"); assert.equal(probes, 2); assert.equal(waits, 1);
});
test("redirected acquisition roots are refused before container creation", async t => {
  const f = fixture(); t.after(f.close);
  const outside = fixture(); t.after(outside.close);
  symlinkSync(outside.root, path.join(f.root, ".local-codex"), "junction");
  await assert.rejects(acquireDatabase(f.root, {execute: f.execute}));
  assert.equal(f.calls.filter(args => args[0] === "create").length, 0);
});
test("unavailable cached image prevents credential creation and container effects", async t => {
  const f = fixture(); t.after(f.close);
  await assert.rejects(acquireDatabase(f.root, {execute: args => {assert.equal(args[0], "image"); throw new Error("not cached");}}));
  assert.equal(f.calls.length, 0);
});
test("every relaxed authority, resource or mount variant is denied", async t => {
  const f = fixture(); t.after(f.close);
  const result = await acquireDatabase(f.root, {execute: f.execute});
  const record = JSON.parse(readFileSync(path.join(f.root, result.database_reference), "utf8"));
  for (const mutate of [x => x.Config.Labels["ai-system-builder.run"] = "foreign",
    x => x.Config.User = "root", x => x.HostConfig.Privileged = true, x => delete x.HostConfig.Privileged,
    x => x.HostConfig.ReadonlyRootfs = false,
    x => x.HostConfig.CapDrop = [], x => x.HostConfig.SecurityOpt = [], x => x.HostConfig.Memory = 0,
    x => x.HostConfig.NanoCpus = 0, x => x.HostConfig.PidsLimit = -1, x => x.HostConfig.NetworkMode = "host",
    x => x.NetworkSettings.Ports["5432/tcp"][0].HostIp = "0.0.0.0",
    x => x.Mounts.push({Type: "bind", Destination: "/host"}), x => delete x.HostConfig.Tmpfs["/tmp"],
    x => x.HostConfig.Tmpfs["/tmp"] = "rw,size=16m"]) {
    const altered = structuredClone(f.container); mutate(altered);
    assert.throws(() => assertRestrictedDatabase(altered, record));
  }
  f.container.Config.Labels["ai-system-builder.run"] = "foreign";
  assert.throws(() => stopDatabase(f.root, result.database_reference, {execute: f.execute}));
  assert.equal(f.calls.filter(args => args[0] === "stop").length, 0);
  for (const reference of ["../private-state.json", path.join(f.root, result.database_reference), result.database_reference.replace("private-state", "postgres")]) {
    assert.throws(() => stopDatabase(f.root, reference, {execute: f.execute}));
  }
});
test("readiness failure stops only the owned child and preserves failed history without raw errors", async t => {
  const f = fixture(); t.after(f.close);
  const privateMessage = "SECRET private /host/path";
  await assert.rejects(acquireDatabase(f.root, {execute: args => {
    if (args[0] === "exec") throw new Error(privateMessage);
    return f.execute(args);
  }, pause: async () => {throw new Error(privateMessage);}}), error => !error.message.includes(privateMessage));
  const create = f.calls.find(args => args[0] === "create");
  const envFile = create[create.indexOf("--env-file") + 1];
  const record = JSON.parse(readFileSync(path.join(path.dirname(envFile), "private-state.json"), "utf8"));
  assert.equal(record.phase, "failed"); assert.equal(record.cleanup, "stopped");
  assert.ok(!JSON.stringify(record).includes(privateMessage));
  assert.equal(f.calls.filter(args => args[0] === "stop").length, 1);
});
