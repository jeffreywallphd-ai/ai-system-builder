/** Fixed Windows-local disposable database operator. Never pulls or adopts. */
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {assertIsolatedPostgresInspection} from "./managed-reference-lifecycle.mjs";

export const IMAGE = "postgres@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15";
const ENDPOINT = "npipe:////./pipe/dockerDesktopLinuxEngine";
const BASE = ".local-codex/managed-reference";
const REFERENCE = /^\.local-codex\/managed-reference\/([a-f0-9]{16})\/private-state\.json$/;

function directory(target, create = false) {
  for (const current of ancestors(path.resolve(target))) {
    let facts;
    try {facts = lstatSync(current);} catch (error) {
      if (!create || error.code !== "ENOENT") throw error;
      mkdirSync(current, {mode: 0o700}); facts = lstatSync(current);
    }
    assert.ok(facts.isDirectory() && !facts.isSymbolicLink());
  }
}
function ancestors(target) {
  const parent = path.dirname(target);
  return parent === target ? [target] : [...ancestors(parent), target];
}
function regular(target) {
  directory(path.dirname(target));
  const facts = lstatSync(target);
  assert.ok(facts.isFile() && !facts.isSymbolicLink() && facts.size <= 4096);
}
function writeState(folder, value, first = false) {
  const target = path.join(folder, "private-state.json");
  if (!first) regular(target);
  const temporary = path.join(folder, `pending-${randomBytes(8).toString("hex")}.json`);
  writeFileSync(temporary, JSON.stringify(value) + "\n", {flag: "wx", mode: 0o600});
  if (first) {
    // Reserve the final name exclusively before replacement; never overwrite
    // another acquisition's record or follow a preexisting redirected file.
    writeFileSync(target, "{}\n", {flag: "wx", mode: 0o600});
  }
  renameSync(temporary, target);
}
export function docker(args) {
  const environment = {...process.env};
  for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) delete environment[key];
  return execFileSync("docker", ["--host", ENDPOINT, ...args], {env: environment,
    encoding: "utf8", windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"]}).trim();
}
function inspect(execute, fixture) {
  const values = JSON.parse(execute(["inspect", fixture.container]));
  assert.ok(Array.isArray(values) && values.length === 1);
  const value = values[0];
  assert.equal(value.Id, fixture.container);
  assert.equal(value.Name, `/${fixture.name}`);
  assert.equal(value.Config?.Image, IMAGE);
  assert.equal(value.Config?.Labels?.["ai-system-builder.qualification"], "true");
  assert.equal(value.Config?.Labels?.["ai-system-builder.run"], fixture.id);
  return value;
}
export function assertRestrictedDatabase(value, fixture) {
  assertIsolatedPostgresInspection(value, fixture, IMAGE);
  assert.equal(value.Config.User, "999:999");
  assert.equal(value.HostConfig.Privileged, false);
  assert.equal(value.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(value.HostConfig.CapDrop, ["ALL"]);
  assert.ok(value.HostConfig.SecurityOpt?.includes("no-new-privileges"));
  assert.equal(value.HostConfig.Memory, 768 * 1024**2);
  assert.equal(value.HostConfig.NanoCpus, 2_000_000_000);
  assert.equal(value.HostConfig.PidsLimit, 128);
  assert.equal(value.HostConfig.NetworkMode, "bridge");
  assert.equal(value.HostConfig.RestartPolicy?.Name, "no");
  const expected = ["/tmp", "/var/lib/postgresql", "/var/run/postgresql"];
  assert.deepEqual(Object.keys(value.HostConfig.Tmpfs ?? {}).sort(), expected);
  for (const destination of expected) {
    const options = new Set(value.HostConfig.Tmpfs[destination].split(","));
    for (const option of ["rw", "noexec", "nosuid", "uid=999", "gid=999", "mode=0700"]) assert.ok(options.has(option));
    assert.ok(options.has(destination === "/var/lib/postgresql" ? "size=512m" : "size=16m"));
  }
  // Docker may report --tmpfs in HostConfig.Tmpfs without Mounts entries.
  assert.ok(Array.isArray(value.Mounts) && value.Mounts.every(mount => mount.Type === "tmpfs" && expected.includes(mount.Destination)));
}
export async function acquireDatabase(root, {execute = docker, pause = () => new Promise(resolve => setTimeout(resolve, 1000))} = {}) {
  // Fixed digest must already exist. No pull, alternate image or remote engine.
  const image = JSON.parse(execute(["image", "inspect", IMAGE]));
  assert.ok(Array.isArray(image) && image.length === 1 && image[0].RepoDigests?.includes(IMAGE));
  const id = randomBytes(8).toString("hex");
  const base = path.resolve(root, BASE);
  directory(base, true);
  const folder = path.join(base, id);
  mkdirSync(folder, {mode: 0o700});
  const envFile = path.join(folder, "postgres.env");
  const password = randomBytes(32).toString("hex");
  writeFileSync(envFile, `POSTGRES_PASSWORD=${password}\nPGPASSWORD=${password}\nPOSTGRES_DB=qualification_admin\nPGDATA=/var/lib/postgresql/data\nPOSTGRES_INITDB_ARGS=--auth-host=scram-sha-256\n`, {flag: "wx", mode: 0o600});
  const fixture = {schema_version: "managed-reference-database-v1", id, name: `aisb-qualification-${id}`, image: IMAGE, container: null, port: null, phase: "acquiring"};
  writeState(folder, fixture, true);
  try {
    const container = execute(["create", "--pull=never", "--name", fixture.name,
      "--label", "ai-system-builder.qualification=true", "--label", `ai-system-builder.run=${id}`,
      "--network=bridge", "--publish", "127.0.0.1::5432", "--restart=no", "--read-only", "--user=999:999",
      "--cap-drop=ALL", "--security-opt=no-new-privileges", "--memory=768m", "--cpus=2", "--pids-limit=128",
      "--tmpfs", "/var/lib/postgresql:rw,noexec,nosuid,size=512m,uid=999,gid=999,mode=0700",
      "--tmpfs", "/var/run/postgresql:rw,noexec,nosuid,size=16m,uid=999,gid=999,mode=0700",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m,uid=999,gid=999,mode=0700", "--env-file", envFile, IMAGE]);
    assert.match(container, /^[a-f0-9]{64}$/);
    fixture.container = container; fixture.phase = "created"; writeState(folder, fixture);
    inspect(execute, fixture); // Identity proof before changing container state.
    execute(["start", container]);
    const deadline = performance.now() + 60_000;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (performance.now() >= deadline) throw new Error("Readiness deadline.");
      const value = inspect(execute, fixture);
      const bindings = value.NetworkSettings?.Ports?.["5432/tcp"];
      assert.ok(Array.isArray(bindings) && bindings.length === 1);
      fixture.port = Number(bindings[0].HostPort);
      assert.ok(Number.isInteger(fixture.port) && fixture.port >= 1024 && fixture.port <= 65535);
      assertRestrictedDatabase(value, fixture);
      assert.equal(value.State?.Running, true);
      try {
        execute(["exec", container, "pg_isready", "--host", "127.0.0.1", "--port", "5432", "--username", "postgres", "--dbname", "qualification_admin", "--timeout", "1"]);
        assert.equal(execute(["exec", container, "psql", "--no-psqlrc", "--host", "127.0.0.1", "--port", "5432", "--username", "postgres", "--dbname", "qualification_admin", "--no-password", "--tuples-only", "--no-align", "--command", "SELECT 1"]), "1");
        fixture.phase = "ready"; fixture.readiness = "tcp-authenticated-select-1"; writeState(folder, fixture);
        return {status: "ready", database_reference: `${BASE}/${id}/private-state.json`};
      } catch {
        if (attempt === 29) throw new Error("Readiness deadline.");
        await pause();
      }
    }
  } catch {
    fixture.phase = "failed";
    fixture.cleanup = "unconfirmed";
    if (fixture.container) {
      try {
        inspect(execute, fixture);
        execute(["stop", "--time", "5", fixture.container]);
        assert.equal(inspect(execute, fixture).State.Running, false);
        fixture.cleanup = "stopped";
      } catch { /* Preserve exact failed identity, never stop a foreign object. */ }
    }
    writeState(folder, fixture);
    throw new Error("Managed database acquisition failed; preserved private state requires inspection.");
  }
}
export function stopDatabase(root, reference, {execute = docker} = {}) {
  const match = REFERENCE.exec(reference); assert.ok(match);
  const target = path.resolve(root, reference); regular(target);
  const fixture = JSON.parse(readFileSync(target, "utf8"));
  assert.equal(fixture.schema_version, "managed-reference-database-v1");
  assert.equal(fixture.id, match[1]); assert.equal(fixture.name, `aisb-qualification-${fixture.id}`);
  assert.equal(fixture.image, IMAGE); assert.match(fixture.container, /^[a-f0-9]{64}$/);
  let value = inspect(execute, fixture);
  if (value.State?.Running) execute(["stop", "--time", "5", fixture.container]);
  value = inspect(execute, fixture); assert.equal(value.State?.Running, false);
  fixture.phase = "stopped"; fixture.cleanup = "stopped"; writeState(path.dirname(target), fixture);
  return {status: "stopped", database_reference: reference};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.platform, "win32");
    const args = process.argv.slice(2); const root = path.resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
    let result;
    if (args.length === 1 && args[0] === "--acquire") result = await acquireDatabase(root);
    else if (args.length === 2 && args[0] === "--stop") result = stopDatabase(root, args[1]);
    else throw new Error("Use --acquire or --stop with an exact owned reference.");
    console.log(JSON.stringify(result));
  } catch {
    console.error(JSON.stringify({status: "failed", code: "managed-database.unavailable"})); process.exitCode = 1;
  }
}
