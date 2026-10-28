import { types } from "node:util";

export const OPERATIONAL_HOST_TIMEOUT_MS = 360_000;
export const OPERATIONAL_PHASE_TIMEOUT_MS = 30_000;
export type OperationalHost = "packaged-desktop" | "thin-chrome";
const COMMON_START = ["navigation-menu-opened", "navigation-menu-navigated", "navigation-menu-focus-returned", "sidebar-collapsed", "sidebar-restored", "settings-opened"] as const;
const COMMON_END = ["notifications-empty", "notifications-focus-returned", "models-discovery-opened", "models-inventory-opened"] as const;
const PHASES = Object.freeze({
  "packaged-desktop": Object.freeze([...COMMON_START, "runtime-deferred", "runtime-initially-stopped", "runtime-refresh-display-stopped", "runtime-start-ready", "runtime-view-reopened-ready", "runtime-restart-ready", "runtime-log-cleared", "runtime-stop-reported", ...COMMON_END, "model-training-opened", "image-configuration-opened", "home-returned"]),
  "thin-chrome": Object.freeze([...COMMON_START, "security-known", "security-fault-visible", "security-fault-safe", "security-retry-known", "security-controls-restricted", ...COMMON_END, "image-configuration-opened", "home-returned"]),
});
const INVALID = "Invalid operational UI observation.";
function hostValue(value: unknown): OperationalHost {
  if (value !== "packaged-desktop" && value !== "thin-chrome") throw new Error(INVALID);
  return value;
}
export function operationalPhases(host: OperationalHost): readonly string[] { return PHASES[hostValue(host)]; }
export function operationalStatusUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      || url.username || url.password || url.search || url.hash) throw new Error(INVALID);
    return new URL("/api/security/status", url.origin).href;
  } catch { throw new Error("Operational UI requires an authorized local test origin."); }
}
interface Input { schemaVersion: "operational-ui-observation-v1"; host: OperationalHost; runId: string; sourceRevision: string; phases: readonly string[]; }
export interface OperationalUiReport extends Input {
  readonly status: "passed" | "failed";
  readonly scope: "ui-integration-only";
  readonly nextPhase?: string;
}
function readInput(value: unknown): Input {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(INVALID);
    const keys = ["schemaVersion", "host", "runId", "sourceRevision", "phases"] as const;
    const fields = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(fields).length !== keys.length || keys.some(key => !fields[key] || !("value" in fields[key]!))) throw new Error(INVALID);
    const schema = fields.schemaVersion!.value, host = hostValue(fields.host!.value);
    const runId = fields.runId!.value, sourceRevision = fields.sourceRevision!.value, observed: unknown = fields.phases!.value;
    if (schema !== "operational-ui-observation-v1" || typeof runId !== "string" || !/^[a-z0-9-]{20,80}$/.test(runId)
      || typeof sourceRevision !== "string" || !/^source\.[a-f0-9]{64}$/.test(sourceRevision)
      || types.isProxy(observed) || !Array.isArray(observed) || Object.getPrototypeOf(observed) !== Array.prototype) throw new Error(INVALID);
    const length = Object.getOwnPropertyDescriptor(observed, "length")?.value;
    if (!Number.isInteger(length) || length < 0 || length > PHASES[host].length || length > 32) throw new Error(INVALID);
    const phases = Object.getOwnPropertyDescriptors(observed);
    if (Reflect.ownKeys(phases).length !== length + 1) throw new Error(INVALID);
    const snapshot: string[] = [];
    for (let index = 0; index < length; index++) {
      const phase = phases[String(index)];
      if (!phase || !("value" in phase) || phase.value !== PHASES[host][index]) throw new Error(INVALID);
      snapshot.push(phase.value);
    }
    return { schemaVersion: "operational-ui-observation-v1", host, runId, sourceRevision, phases: Object.freeze(snapshot) };
  } catch { throw new Error(INVALID); }
}
/** Structural evidence gate only; the driver and actual test receipt establish execution. */
export function qualifyOperationalObservation(value: unknown): OperationalUiReport {
  const input = readInput(value);
  if (input.phases.length !== PHASES[input.host].length) throw new Error(INVALID);
  return Object.freeze({ ...input, status: "passed", scope: "ui-integration-only" });
}
export function failedOperationalObservation(value: unknown): OperationalUiReport {
  const input = readInput(value);
  return Object.freeze({ ...input, status: "failed", scope: "ui-integration-only", nextPhase: PHASES[input.host][input.phases.length] ?? "reporting" });
}
