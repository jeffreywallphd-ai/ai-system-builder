import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { createLocalAssetCompositionPlanRepositoryAdapter } from "../../../../modules/adapters/persistence/asset-composition";
import { createLocalConversationRepositoryAdapters } from "../../../../modules/adapters/persistence/conversations";
import { createLocalExecutionPlanRepositoryAdapter } from "../../../../modules/adapters/persistence/execution-plans";
import { createLocalExecutionRunRepositoryAdapters } from "../../../../modules/adapters/persistence/execution-runs";
import { createLocalRuntimeReadinessBindingRepositoryAdapter } from "../../../../modules/adapters/persistence/runtime-readiness";
import { openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy } from "../../../../modules/adapters/persistence/sqlite";
import { createLocalWorkspaceRepository } from "../../../../modules/adapters/persistence/workspace";
import { readLocalIdentityProfile } from "../../../../modules/adapters/security/local-identity";
import { normalizeAssetCompositionNodeId, normalizeAssetCompositionPlanId } from "../../../../modules/contracts/asset-composition";
import { normalizeConversationSessionId } from "../../../../modules/contracts/conversations";
import { normalizeEffectiveAssetProjectionId } from "../../../../modules/contracts/effective-asset-projections";
import { normalizeExecutionAdapterReferenceId, normalizeExecutionPlanId } from "../../../../modules/contracts/execution-plans";
import { normalizeExecutionApprovalId, normalizeExecutionRuntimeReferenceId } from "../../../../modules/contracts/execution-runs";
import { normalizeRuntimeReadinessBindingId } from "../../../../modules/contracts/runtime-readiness";
import { createWorkspaceId } from "../../../../modules/contracts/workspace";

async function seed() {
  const supplied = process.env.VISUAL_COMPOSER_DESKTOP_DATA_ROOT;
  const rawWorkspace = process.env.AISB_QUALIFICATION_WORKSPACE;
  const model = process.env.AISB_QUALIFICATION_MODEL;
  if (!supplied || !rawWorkspace || !model || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(model)) throw new Error("Invalid qualification input.");
  const root = path.resolve(supplied);
  const allowed = path.resolve("artifacts", "qualification", "visual-composer", "d");
  if (!/^[a-f0-9]{16}[\\/]desktop[\\/]headless-conversation$/.test(path.relative(allowed, root)) ||
      await realpath(root) !== root || (await lstat(root)).isSymbolicLink()) throw new Error("Invalid qualification root.");
  const workspaceId = createWorkspaceId(rawWorkspace);
  const db = await openLocalSqliteDatabase({ policy: resolveLocalSqliteDatabasePolicy({ dataRootDirectory: root }) });
  try {
    const identity = await readLocalIdentityProfile(db.documents);
    if (!identity) throw new Error("Missing fixture identity.");
    const documents = db.documents.forOrganization(identity.organizationId);
    const options = { rootDir: root, documents };
    const workspace = await createLocalWorkspaceRepository({ rootDirectory: root, documents }).readWorkspace(workspaceId);
    if (workspace?.organizationId !== identity.organizationId || workspace.status !== "active") throw new Error("Missing fixture workspace.");
    const at = "2026-11-13T10:00:00.000Z";
    const stamps = { createdAt: at, updatedAt: at };
    const lifecycle = { ...stamps, blockers: [], diagnostics: [], provenance: [] };
    const compositionPlanId = normalizeAssetCompositionPlanId("headless-fixture-composition");
    const readinessBindingId = normalizeRuntimeReadinessBindingId("headless-fixture-readiness");
    const planId = normalizeExecutionPlanId("headless-fixture-plan");
    const adapterId = normalizeExecutionAdapterReferenceId("headless-fixture-adapter");
    const sessionId = normalizeConversationSessionId("headless-fixture-session");
    const approvalId = normalizeExecutionApprovalId("headless-fixture-approval");
    const runtimeId = normalizeExecutionRuntimeReferenceId("headless-fixture-runtime");
    const selection = { targetWorkspaceId: workspaceId, projectionId: normalizeEffectiveAssetProjectionId("headless-fixture-projection") };
    const sessions = createLocalConversationRepositoryAdapters(options).conversationSessionRepository;
    if (await sessions.getConversationSessionById(workspaceId, sessionId)) throw new Error("The fixture may be seeded only once.");
    await createLocalAssetCompositionPlanRepositoryAdapter(options).saveAssetCompositionPlanRecord({
      ...stamps, planId: compositionPlanId, targetWorkspaceId: workspaceId, name: "Fixture conversation", status: "draft",
      selectedProjections: [selection], nodes: [{ ...stamps, nodeId: normalizeAssetCompositionNodeId("headless-fixture-node"),
        targetWorkspaceId: workspaceId, selectedProjection: selection, role: "ui-surface", status: "planned",
        requiredCapabilities: [], providedCapabilities: [{ kind: "text-output", key: "fixture-output" }], diagnostics: [], blockers: [] }],
      relationships: [], compatibilityDiagnostics: [], blockers: [], provenance: [],
      planningSummary: { totalNodes: 1, compatibleNodeCount: 1, blockedNodeCount: 0, conflictedNodeCount: 0,
        missingDependencyCount: 0, staleProjectionCount: 0, unsupportedCount: 0, totalRelationships: 0,
        compatibleRelationshipCount: 0, blockedRelationshipCount: 0, planningReadiness: "ready" },
    });
    await createLocalRuntimeReadinessBindingRepositoryAdapter(options).saveRuntimeReadinessBindingRecord({
      ...lifecycle, readinessBindingId, targetWorkspaceId: workspaceId, compositionPlanId, status: "ready-for-setup",
      requirements: [], providerCandidates: [], bindingCandidates: [], bindings: [],
    });
    await createLocalExecutionPlanRepositoryAdapter(options).saveExecutionPlan({
      ...lifecycle, id: planId, workspaceId, sourceCompositionPlanId: compositionPlanId,
      sourceRuntimeReadinessBindingId: readinessBindingId, sourceReadinessStatus: "ready-for-setup", status: "ready-for-review",
      steps: [], dependencies: [], inputs: [], outputs: [], safetyGates: [], resourceEstimates: [],
      adapterReferences: [{ id: adapterId, kind: "provider-capability", status: "available-by-readiness", capabilityKind: "text-generation",
        sourceRuntimeReadinessBindingId: readinessBindingId, label: "Fixture text generation", blockers: [], diagnostics: [] }],
    });
    const execution = createLocalExecutionRunRepositoryAdapters(options);
    await execution.executionRuntimeReferenceRepository.saveExecutionRuntimeReference({
      id: runtimeId, workspaceId, sourceExecutionPlanAdapterReferenceId: adapterId, sourceRuntimeReadinessBindingId: readinessBindingId,
      runtimeKind: "python-sidecar", capabilityKind: "text-generation", selectedModelRecordId: model,
      label: "Fixture runtime", status: "supported", blockers: [], diagnostics: [],
    });
    await execution.executionApprovalRepository.saveExecutionApproval({
      ...lifecycle, id: approvalId, workspaceId, sourceExecutionPlanId: planId, conversationSessionId: sessionId,
      approvalKind: "conversation-session-execution", approvalStatus: "granted", label: "Fixture approval", runtimeReferenceId: runtimeId,
      sourcePlanRevision: at, sourceReadinessRevision: at, grantedAt: at,
    });
    await sessions.saveConversationSession({
      ...lifecycle, id: sessionId, workspaceId, sourceExecutionPlanId: planId, sourceCompositionPlanId: compositionPlanId,
      sourceRuntimeReadinessBindingId: readinessBindingId, status: "approved", systemLabel: "Fixture conversation",
      executionApprovalId: approvalId, executionApprovalStatus: "granted", runtimeReferenceId: runtimeId, turnIds: [],
    });
  } finally { await db.close(); }
}
void seed().catch(() => { process.stderr.write("The isolated approved-conversation fixture could not be initialized.\n"); process.exitCode = 1; });
