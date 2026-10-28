import { describe, expect, it } from "vitest";
import { failedOperationalObservation, operationalPhases, operationalStatusUrl, OPERATIONAL_HOST_TIMEOUT_MS, OPERATIONAL_PHASE_TIMEOUT_MS, qualifyOperationalObservation, type OperationalHost } from "../visual-composer/operational-ui-oracles";
const input = (host: OperationalHost = "thin-chrome") => ({ schemaVersion: "operational-ui-observation-v1", host, runId: "operational-fixture-1234567890", sourceRevision: `source.${"a".repeat(64)}`, phases: [...operationalPhases(host)] });
describe("operational UI observation boundaries", () => {
  it.each(["thin-chrome", "packaged-desktop"] as const)("requires the supported Models and Image forms for %s without inventing thin training", host => {
    const tail = ["notifications-empty", "notifications-focus-returned", "models-discovery-opened", "models-inventory-opened",
      ...(host === "packaged-desktop" ? ["model-training-opened"] : []), "image-configuration-opened", "home-returned"];
    expect(operationalPhases(host).slice(-tail.length)).toEqual(tail);
    expect(operationalPhases(host).includes("model-training-opened")).toBe(host === "packaged-desktop");
    for (const missing of ["models-discovery-opened", "models-inventory-opened", "image-configuration-opened"]) {
      const value = { ...input(host), phases: operationalPhases(host).filter(phase => phase !== missing) };
      expect(() => qualifyOperationalObservation(value)).toThrow("Invalid operational UI observation.");
      expect(() => failedOperationalObservation(value)).toThrow("Invalid operational UI observation.");
    }
  });
  it.each(["thin-chrome", "packaged-desktop"] as const)("requires every exact ordered %s phase and returns an immutable copy", host => {
    const value = input(host), report = qualifyOperationalObservation(value);
    value.phases.splice(0); expect(report.phases).toEqual(operationalPhases(host));
    expect(report.status).toBe("passed"); expect(report.scope).toBe("ui-integration-only");
    expect(Object.isFrozen(report.phases)).toBe(true); expect(Object.isFrozen(report)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThan(8192);
  });
  it.each(["thin-chrome", "packaged-desktop"] as const)("never qualifies a missing %s phase or a partial failure", host => {
    const value = input(host);
    for (let count = 0; count < value.phases.length; count++) {
      const partial = { ...value, phases: value.phases.slice(0, count) };
      expect(() => qualifyOperationalObservation(partial)).toThrow("Invalid operational UI observation.");
      const report = failedOperationalObservation(partial);
      expect(report.status).toBe("failed"); expect(report.nextPhase).toBe(value.phases[count]);
    }
  });
  it.each([
    { host: "unknown" }, { sourceRevision: "worktree" }, { runId: "short" },
    { phases: ["private-synthetic-payload"] }, { phases: ["sidebar-restored", "sidebar-collapsed"] },
    { phases: ["sidebar-collapsed", "sidebar-collapsed"] }, { phases: new Array(33).fill("sidebar-collapsed") },
    { token: "synthetic-private-token" }, { screenshot: "private-synthetic-path" }, { nativeQualified: true },
  ])("refuses malformed, extra or private observation fields %#", change => {
    try { qualifyOperationalObservation({ ...input(), ...change }); throw new Error("Expected refusal"); }
    catch (error) { expect((error as Error).message).toBe("Invalid operational UI observation."); }
  });
  it("keeps a reporting failure failed after all UI steps and invents no native qualification", () => {
    const failed = failedOperationalObservation(input());
    expect(failed.status).toBe("failed"); expect(failed.nextPhase).toBe("reporting");
    expect(Object.keys(failed).sort()).toEqual(["host", "nextPhase", "phases", "runId", "schemaVersion", "scope", "sourceRevision", "status"]);
    expect(OPERATIONAL_PHASE_TIMEOUT_MS).toBe(30_000); expect(OPERATIONAL_HOST_TIMEOUT_MS).toBe(360_000);
  });
  it.each(["thin-chrome", "packaged-desktop"] as const)("refuses sparse %s phase arrays rather than inventing observations", host => {
    const value = { ...input(host), phases: new Array(operationalPhases(host).length) };
    expect(() => qualifyOperationalObservation(value)).toThrow("Invalid operational UI observation.");
    expect(() => failedOperationalObservation(value)).toThrow("Invalid operational UI observation.");
  });
  it.each(["every", "iterator", "element-accessor", "field-accessor", "symbol", "extra-array-field"] as const)("does not execute or retain caller-defined %s data", variant => {
    const value = input(); let calls = 0;
    if (variant === "every") Object.defineProperty(value.phases, "every", { value: () => { calls++; return true; } });
    if (variant === "iterator") Object.defineProperty(value.phases, Symbol.iterator, { value: function* () { calls++; yield* new Array(value.phases.length).fill("synthetic-private-payload"); } });
    if (variant === "element-accessor") Object.defineProperty(value.phases, "0", { get: () => { calls++; return "sidebar-collapsed"; } });
    if (variant === "field-accessor") Object.defineProperty(value, "host", { get: () => { calls++; return "thin-chrome"; } });
    if (variant === "symbol") Object.defineProperty(value, Symbol("synthetic-private-payload"), { value: "synthetic-private-payload" });
    if (variant === "extra-array-field") Object.defineProperty(value.phases, "private", { value: "synthetic-private-payload" });
    expect(() => qualifyOperationalObservation(value)).toThrow("Invalid operational UI observation.");
    expect(() => failedOperationalObservation(value)).toThrow("Invalid operational UI observation.");
    expect(calls).toBe(0);
  });
  it("normalizes descriptor inspection failure without reporting caller detail", () => {
    const value = new Proxy(input(), { ownKeys: () => { throw new Error("synthetic-private-payload"); } });
    for (const read of [qualifyOperationalObservation, failedOperationalObservation]) {
      try { read(value); throw new Error("Expected refusal"); }
      catch (error) { expect((error as Error).message).toBe("Invalid operational UI observation."); }
    }
  });
  it.each(["record-prototype", "record-keys", "record-descriptor", "array-prototype", "array-keys", "revoked-record", "revoked-array"] as const)("refuses %s proxies without executing their traps", variant => {
    let calls = 0;
    const traps = {
      getPrototypeOf(target: object) { calls++; return Reflect.getPrototypeOf(target); },
      ownKeys(target: object) { calls++; return Reflect.ownKeys(target); },
      getOwnPropertyDescriptor(target: object, key: string | symbol) { calls++; return Reflect.getOwnPropertyDescriptor(target, key); },
    };
    const base = input(); let value: unknown;
    if (variant === "record-prototype") value = new Proxy(base, { getPrototypeOf: traps.getPrototypeOf });
    if (variant === "record-keys") value = new Proxy(base, { ownKeys: traps.ownKeys });
    if (variant === "record-descriptor") value = new Proxy(base, { getOwnPropertyDescriptor: traps.getOwnPropertyDescriptor });
    if (variant === "array-prototype") value = { ...base, phases: new Proxy(base.phases, { getPrototypeOf: traps.getPrototypeOf }) };
    if (variant === "array-keys") value = { ...base, phases: new Proxy(base.phases, { ownKeys: traps.ownKeys }) };
    if (variant === "revoked-record") { const proxy = Proxy.revocable(base, traps); proxy.revoke(); value = proxy.proxy; }
    if (variant === "revoked-array") { const proxy = Proxy.revocable(base.phases, traps); proxy.revoke(); value = { ...base, phases: proxy.proxy }; }
    expect(() => qualifyOperationalObservation(value)).toThrow("Invalid operational UI observation.");
    expect(() => failedOperationalObservation(value)).toThrow("Invalid operational UI observation.");
    expect(calls).toBe(0);
  });
  it.each(["http://127.0.0.1:3000/systems", "https://localhost:8443/security", "http://[::1]:3000/"])("keeps its fixed read-only status route on local origin %s", value => {
    const result = new URL(operationalStatusUrl(value)); expect(result.pathname).toBe("/api/security/status"); expect(result.origin).toBe(new URL(value).origin);
  });
  it.each(["https://example.com/", "file:///private", "http://user:secret@localhost:3000/", "http://localhost:3000/?token=synthetic", "http://localhost:3000/#private", "not a URL"])("refuses an unknown or credential-bearing origin %#", value => {
    expect(() => operationalStatusUrl(value)).toThrow("Operational UI requires an authorized local test origin.");
  });
});
