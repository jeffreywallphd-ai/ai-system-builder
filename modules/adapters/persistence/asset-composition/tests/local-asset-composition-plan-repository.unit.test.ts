import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { normalizeAssetId, type AssetReference } from "../../../../contracts/asset";
import {
  normalizeAssetCompositionNodeId,
  normalizeAssetCompositionPlanId,
  normalizeAssetCompositionRelationshipId,
  type AssetCompositionPlan,
} from "../../../../contracts/asset-composition";
import { normalizeEffectiveAssetProjectionId } from "../../../../contracts/effective-asset-projections";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createLocalAssetCompositionPlanRepositoryAdapter, LocalAssetCompositionPlanRecordStoreError } from "..";

const wsA = createWorkspaceId("workspace.a");
const wsB = createWorkspaceId("workspace.b");
const timestamp = "2026-05-20T00:00:00.000Z";

function effectiveAssetReference(id: string): AssetReference {
  return {
    kind: "asset-definition-version",
    id: normalizeAssetId(`asset.${id}`),
    version: "1.0.0",
  };
}

function makePlan(
  targetWorkspaceId: string,
  id: string,
  status: AssetCompositionPlan["status"] = "draft",
): AssetCompositionPlan {
  const projectionId = normalizeEffectiveAssetProjectionId("projection.a");
  const effectiveRef = effectiveAssetReference(id);
  const nodeId = normalizeAssetCompositionNodeId(`node.${id}`);
  return {
    planId: normalizeAssetCompositionPlanId(id),
    targetWorkspaceId,
    name: `Plan ${id}`,
    status,
    selectedProjections: [{
      targetWorkspaceId,
      projectionId,
      effectiveAssetReference: effectiveRef,
      displayLabel: "Selected",
      selectedAt: timestamp,
    }],
    nodes: [{
      nodeId,
      targetWorkspaceId,
      selectedProjection: { targetWorkspaceId, projectionId, effectiveAssetReference: effectiveRef },
      effectiveAssetReference: effectiveRef,
      role: "processor",
      status: "planned",
      requiredCapabilities: [],
      providedCapabilities: [],
      diagnostics: [],
      blockers: [],
      label: "Node",
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    relationships: [{
      relationshipId: normalizeAssetCompositionRelationshipId(`rel.${id}`),
      targetWorkspaceId,
      sourceNodeId: nodeId,
      targetNodeId: nodeId,
      kind: "depends-on",
      compatibilityStatus: "compatible",
      diagnostics: [],
      blockers: [],
      label: "Link",
      summary: "summary",
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    compatibilityDiagnostics: [],
    blockers: [],
    planningSummary: {
      totalNodes: 1,
      compatibleNodeCount: 1,
      blockedNodeCount: 0,
      conflictedNodeCount: 0,
      missingDependencyCount: 0,
      staleProjectionCount: 0,
      unsupportedCount: 0,
      totalRelationships: 1,
      compatibleRelationshipCount: 1,
      blockedRelationshipCount: 0,
      planningReadiness: "ready",
      safeMetadata: { stage: "planning" },
    },
    provenance: [{
      kind: "plan-created",
      targetWorkspaceId,
      operationAt: timestamp,
      planId: normalizeAssetCompositionPlanId(id),
    }],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe("local asset composition plan persistence", () => {
  it("saves reads and isolates by workspace", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "acp-"));
    const repo = createLocalAssetCompositionPlanRepositoryAdapter({ rootDir });

    await repo.saveAssetCompositionPlanRecord(makePlan(wsA, "plan.1"));
    await repo.saveAssetCompositionPlanRecord(makePlan(wsB, "plan.1", "blocked"));

    assert.equal((await repo.readAssetCompositionPlanRecord(wsA, normalizeAssetCompositionPlanId("plan.1")))?.targetWorkspaceId, wsA);
    assert.equal((await repo.readAssetCompositionPlanRecord(wsB, normalizeAssetCompositionPlanId("plan.1")))?.targetWorkspaceId, wsB);
  });

  it("same plan id in two workspaces does not overwrite", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "acp-"));
    const repo = createLocalAssetCompositionPlanRepositoryAdapter({ rootDir });

    await repo.saveAssetCompositionPlanRecord(makePlan(wsA, "plan.same"));
    await repo.saveAssetCompositionPlanRecord(makePlan(wsB, "plan.same", "valid"));

    assert.equal((await repo.listAssetCompositionPlanRecords({ targetWorkspaceId: wsA })).records.length, 1);
    assert.equal((await repo.listAssetCompositionPlanRecords({ targetWorkspaceId: wsB, status: "valid" })).records.length, 1);
  });

  it("supports valid status and projection/effective/node/relationship/compatibility filters", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "acp-"));
    const repo = createLocalAssetCompositionPlanRepositoryAdapter({ rootDir });
    const plan = makePlan(wsA, "plan.f", "conflicted");

    await repo.saveAssetCompositionPlanRecord(plan);

    assert.equal((await repo.listAssetCompositionPlanRecords({ targetWorkspaceId: wsA, selectedProjectionId: normalizeEffectiveAssetProjectionId("projection.a") })).records.length, 1);
    assert.equal((await repo.listAssetCompositionPlanRecords({ targetWorkspaceId: wsA, effectiveAssetReference: effectiveAssetReference("plan.f") })).records.length, 1);
    assert.equal((await repo.listAssetCompositionPlanRecords({ targetWorkspaceId: wsA, nodeRole: "processor" })).records.length, 1);
    assert.equal((await repo.listAssetCompositionPlanRecords({ targetWorkspaceId: wsA, relationshipKind: "depends-on", compatibilityStatus: "compatible" })).records.length, 1);
    assert.equal((await repo.listValidDraftBlockedConflictedStaleOrArchivedAssetCompositionPlanRecords(wsA)).length, 1);
  });

  it("rejects unsafe injected fields", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "acp-"));
    const repo = createLocalAssetCompositionPlanRepositoryAdapter({ rootDir });
    const bad = { ...makePlan(wsA, "plan.bad"), name: "prompt secret" };

    await assert.rejects(() => repo.saveAssetCompositionPlanRecord(bad));
  });

  it("fails safely on manifest schema mismatch", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "acp-"));
    const repo = createLocalAssetCompositionPlanRepositoryAdapter({ rootDir });
    const storeDir = join(rootDir, "asset-composition");

    await mkdir(storeDir, { recursive: true });
    await writeFile(join(storeDir, "asset-composition-manifest.json"), JSON.stringify({ schemaVersion: 99, storeKind: "asset-composition-local-store" }));

    await assert.rejects(
      () => repo.listAssetCompositionPlanRecords({ targetWorkspaceId: wsA }),
      LocalAssetCompositionPlanRecordStoreError,
    );
  });
});
