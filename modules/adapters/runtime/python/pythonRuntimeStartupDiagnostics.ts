import { normalizePythonRuntimeStartupDiagnostics, readPythonStartupVersion,
  type PythonRuntimeStartupDiagnostics, type PythonStartupPhase } from "../../../contracts/runtime";
import { readPythonRuntimePreparationDiagnostic } from "./pythonRuntimePreparationDiagnostics";

export interface PythonStartupEnvironmentFacts {
  readonly pythonVersion?: string;
  readonly huggingfaceHubVersion?: string | null;
  readonly transformersVersion?: string | null;
}
export interface PythonStartupEvent {
  readonly token: object;
  readonly type: "begin" | "launch" | "health" | "ready" | "failed" | "retired" | "unavailable";
}
export function createPythonRuntimeStartupDiagnostics() {
  let owner: object | undefined;
  let report: PythonRuntimeStartupDiagnostics = { schemaVersion: "1", attempt: 0, outcome: "not-observed", phase: "none", reason: "none", dependencies: [], stages: [] };
  let entries = new Set<string>();
  const active = (token: object) => owner === token && report.outcome === "starting";
  const update = (patch: Partial<PythonRuntimeStartupDiagnostics>) => { report = normalizePythonRuntimeStartupDiagnostics({ ...report, ...patch }) ?? report; };
  return {
    read: () => normalizePythonRuntimeStartupDiagnostics(report)!,
    compositionFailed() { if (!owner && report.attempt === 0) update({ outcome: "failed", phase: "composition", reason: "composition-failed" }); },
    event(event: PythonStartupEvent) {
      if (event.type === "begin") { owner = event.token; entries = new Set(); report = { schemaVersion: "1", attempt: report.attempt + 1, outcome: "starting", phase: "none", reason: "none", dependencies: [], stages: [] }; return; }
      if (owner !== event.token) return;
      if (event.type === "retired") { if (report.outcome !== "failed") update({ outcome: "retired", reason: "attempt-retired" }); owner = undefined; return; }
      if (event.type === "unavailable") { update({ outcome: "failed", phase: "health", reason: "health-failed" }); return; }
      if (!active(event.token)) return;
      if (event.type === "failed") update({ outcome: "failed", reason: report.phase === "launch" ? "launch-failed" : report.phase === "health" ? "health-failed" : "startup-failed" });
      else if (event.type === "ready") update({ outcome: "ready", reason: "none" });
      else update({ phase: event.type });
    },
    stage(token: object, value: unknown) {
      if (!active(token)) return;
      const row = readPythonRuntimePreparationDiagnostic(value);
      if (!row || row.operation === "model-training") return;
      const key = `${row.operation}:${row.data.sequence}`;
      if (row.data.phase === "entered") { if (entries.has(key)) return; entries.add(key); }
      else { if (!entries.delete(key)) return; }
      const rows = [...report.stages, { operation: row.operation, stage: row.stage, sequence: row.data.sequence, phase: row.data.phase }];
      update({ phase: row.operation as PythonStartupPhase, stages: rows.slice(-64) as any,
        ...(report.stagesTruncated || rows.length > 64 ? { stagesTruncated: true } : {}) });
    },
    environment(token: object, facts: PythonStartupEnvironmentFacts) {
      if (!active(token)) return;
      const dependencies: PythonRuntimeStartupDiagnostics["dependencies"][number][] = [];
      for (const [field, name] of [["huggingfaceHubVersion", "huggingface_hub"], ["transformersVersion", "transformers"]] as const) {
        const value = Object.getOwnPropertyDescriptor(facts, field)?.value;
        if (value === null || readPythonStartupVersion(value)) dependencies.push({ name, version: value });
      }
      const version = readPythonStartupVersion(Object.getOwnPropertyDescriptor(facts, "pythonVersion")?.value);
      update({ ...(version ? { pythonVersion: version } : {}), dependencies });
    },
    preparationFailed(token: object, phase: "context" | "worker", reason: string) {
      if (!active(token)) return;
      const known = ["unsupported-platform", "unsupported-python", "probe-failed", "install-failed", "install-timeout", "verification-failed"].includes(reason) ? reason : "preparation-failed";
      update({ outcome: "failed", phase, reason: known as any });
    },
  };
}
