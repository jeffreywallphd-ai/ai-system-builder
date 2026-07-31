import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "../../../../testing/node-test";
import { normalizeExecutionPlanId, normalizeExecutionPlanRecord, type ExecutionPlanRecord } from "../../../../contracts/execution-plans";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createLocalExecutionPlanRepositoryAdapter, LocalExecutionPlanRecordStore, LocalExecutionPlanRecordStoreError } from "..";

const now = () => "2026-05-21T00:00:00.000Z";
const root = async () => mkdtemp(join(tmpdir(), "execution-plan-store-"));
const wsA = createWorkspaceId("ws-a");
const wsB = createWorkspaceId("ws-b");
const p1 = normalizeExecutionPlanId("p-1");
const p2 = normalizeExecutionPlanId("p-2");

const plan = (workspaceId: string, id: string, overrides: Partial<ExecutionPlanRecord> = {}): ExecutionPlanRecord => normalizeExecutionPlanRecord({
  id,
  workspaceId,
  sourceCompositionPlanId: "comp-1",
  sourceRuntimeReadinessBindingId: "rr-1",
  sourceReadinessStatus: "ready",
  status: "draft",
  steps: [{ id: "step-1", sourceCompositionPlanId: "comp-1", kind: "prepare-input", status: "planned", label: "Prepare", requiredAdapterReferenceIds: ["adapter-1"], inputIds: ["input-1"], outputIds: ["output-1"], dependencyIds: [], safetyGateIds: ["gate-1"], blockers: [], diagnostics: [] }],
  dependencies: [], inputs: [{ id: "input-1", stepId: "step-1", kind: "asset-reference", label: "Input", status: "planned", sourceReferenceKind: "asset", required: true, blockers: [], diagnostics: [] }], outputs: [{ id: "output-1", stepId: "step-1", kind: "artifact", label: "Output", status: "planned", destinationReferenceKind: "artifact", required: true, blockers: [], diagnostics: [] }], adapterReferences: [{ id: "adapter-1", kind: "provider-adapter", status: "planned", sourceRuntimeReadinessBindingId: "rr-1", label: "Provider", blockers: [], diagnostics: [] }], safetyGates: [{ id: "gate-1", kind: "required-input-available", status: "planned", label: "Gate", blockers: [], diagnostics: [] }], blockers: [], diagnostics: [], resourceEstimates: [], provenance: [{ kind: "execution-plan-created", at: now(), workspaceId }],
  createdAt: now(), updatedAt: now(),
  ...overrides,
} as unknown as ExecutionPlanRecord);

describe("local execution plan repository adapter", () => {
  it("saves, reads, lists, filters, archives, and isolates by workspace", async () => {
    const repository = createLocalExecutionPlanRepositoryAdapter({ rootDir: await root(), now });
    await repository.saveExecutionPlan(plan(wsA, p1, { status: "blocked" }));
    await repository.saveExecutionPlan(plan(wsA, p2, { sourceRuntimeReadinessBindingId: "rr-2", sourceCompositionPlanId: "comp-2", status: "stale", updatedAt: "2026-05-21T00:01:00.000Z" }));
    await repository.saveExecutionPlan(plan(wsB, p1, { status: "draft" }));

    expect((await repository.getExecutionPlanById(wsA, p1))?.workspaceId).toBe(wsA);
    expect(await repository.getExecutionPlanById(wsB, p2)).toBeUndefined();
    expect((await repository.listExecutionPlans({ workspaceId: wsA })).plans.map((p) => p.id)).toEqual(["p-2", "p-1"]);
    expect((await repository.listExecutionPlans({ workspaceId: wsA, status: "blocked" })).plans.map((p) => p.id)).toEqual(["p-1"]);
    expect((await repository.listExecutionPlans({ workspaceId: wsA, sourceRuntimeReadinessBindingId: "rr-2" })).plans.map((p) => p.id).length).toBe(1);
    expect((await repository.listExecutionPlans({ workspaceId: wsA, sourceCompositionPlanId: "comp-2" })).plans.map((p) => p.id).length).toBe(1);

    await repository.archiveExecutionPlan(wsA, p1, "2026-05-21T00:02:00.000Z");
    expect((await repository.getExecutionPlanById(wsA, p1))?.status).toBe("archived");
  });

  it("rejects missing workspace and unsafe metadata", async () => {
    const repository = createLocalExecutionPlanRepositoryAdapter({ rootDir: await root(), now });
    await assert.rejects(() => repository.listExecutionPlans({ workspaceId: "" as never }));
    await assert.rejects(() =>
      repository.saveExecutionPlan({
        ...plan(wsA, "p-unsafe"),
        diagnostics: [{ code: "unsafe.metadata", severity: "error", message: "contains token" }],
      }),
    );
  });

  it("fails safely for manifest mismatch", async () => {
    const rootDir = await root();
    const store = new LocalExecutionPlanRecordStore({ rootDir, now });
    await store.readPlans();
    await writeFile(join(rootDir, "execution-plans", "manifest.json"), JSON.stringify({ schemaVersion: 999, storeKind: "wrong", updatedAt: now() }));
    await assert.rejects(() => store.readManifest());
    await assert.rejects(() => store.readManifest(), LocalExecutionPlanRecordStoreError);
    const source = await readFile(join(rootDir, "execution-plans", "manifest.json"), "utf8");
    expect(source.includes("wrong")).toBe(true);
  });

  it("type-checks the local record store under strict compiler settings", () => {
    const storeFile = resolve(
      process.cwd(),
      "modules/adapters/persistence/execution-plans/local-execution-plan-record-store.ts",
    );
    const program = ts.createProgram([storeFile], {
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      noEmit: true,
      noEmitOnError: true,
      types: ["node"],
    });

    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.deepEqual(
      diagnostics.map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      ),
      [],
    );
  });
});
