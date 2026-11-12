import { normalizeAssetImplementationReleaseId } from "../../../contracts/asset-implementation";
import type { AssetInstance } from "../../../contracts/asset";
import type { SystemBuildDigest, SystemBuildResolvedImplementation, SystemReleaseId } from "../../../contracts/system-build";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { SystemBuildArtifactPort, SystemBuildHasherPort, SystemBuildRepositoryPort } from "../../ports/system-build";
import type { SystemBuilderRepositoryPort } from "../../ports/system-builder";
import type { SystemDeploymentRevocationPort } from "../../ports/system-deployment";
import { canonicalizeSystemBuildValue } from "../system-build/canonical-system-build-json";
import { compileSystemFormAction, type CompiledSystemFormAction } from "./system-form-action.service";

export interface ResolveSystemFormReleaseDependencies {
  readonly builds: Pick<SystemBuildRepositoryPort, "readRelease">;
  readonly systems: Pick<SystemBuilderRepositoryPort, "readRecord" | "readRevision">;
  readonly hasher: SystemBuildHasherPort;
  readonly artifacts: Pick<SystemBuildArtifactPort, "readVerified">;
  readonly revocations: SystemDeploymentRevocationPort;
}

export interface SystemFormReleaseContext {
  readonly workspaceId: WorkspaceId;
  readonly releaseId: SystemReleaseId;
  readonly releaseDigest: SystemBuildDigest;
  readonly formId: string;
}

export class ResolveSystemFormReleaseService {
  public constructor(private readonly dependencies: ResolveSystemFormReleaseDependencies) {}

  public async resolve(request: SystemFormReleaseContext) {
    try {
      const { builds, systems, hasher, artifacts, revocations } = this.dependencies;
      const release = await builds.readRelease(request.workspaceId, request.releaseId);
      if (!release || !release.approvedAt || release.targetWorkspaceId !== request.workspaceId ||
          release.releaseId !== request.releaseId || release.releaseDigest !== request.releaseDigest ||
          release.releaseId !== `system-release:${release.releaseDigest.slice("sha256:".length)}` ||
          release.lock.systemId !== release.systemId || release.lock.systemRevisionId !== release.systemRevisionId ||
          hasher.digest(canonicalizeSystemBuildValue(release.lock)) !== release.lockDigest) return;
      const artifactDigests = release.artifacts.map(({ kind, digest }) => ({ kind, digest }))
        .sort((left, right) => `${left.kind}:${left.digest}`.localeCompare(`${right.kind}:${right.digest}`));
      if (hasher.digest(canonicalizeSystemBuildValue({ lockDigest: release.lockDigest, artifacts: artifactDigests })) !== release.releaseDigest) return;
      const record = await systems.readRecord(request.workspaceId, release.systemId);
      if (!record || record.targetWorkspaceId !== request.workspaceId || record.systemId !== release.systemId || record.status === "archived") return;
      const revision = await systems.readRevision(request.workspaceId, release.systemId, release.systemRevisionId);
      if (!revision || revision.targetWorkspaceId !== request.workspaceId || revision.systemId !== release.systemId ||
          revision.revisionId !== release.systemRevisionId ||
          hasher.digest(canonicalizeSystemBuildValue(revision)) !== release.lock.systemRevisionDigest) return;
      const action = compileSystemFormAction(revision, request.formId);
      if (!action) return;
      const stamp = release.lock.runtimeFormActions?.filter((entry) => entry.formId === action.form.id);
      if (stamp?.length !== 1 || stamp[0]!.operationId !== action.operationId || stamp[0]!.schemaVersion !== "system-builder-form-action.v1") return;
      const implementations = release.lock.resolvedImplementations;
      if (!hasTrustedFormImplementations(action, revision.instances, implementations)) return;
      const revoked = await revocations.listRevokedImplementationReleaseIds(request.workspaceId,
        [...new Set(implementations.map((implementation) => normalizeAssetImplementationReleaseId(implementation.releaseId)))]);
      if (revoked.length) return;
      const manifests = release.artifacts.filter((artifact) => artifact.kind === "manifest");
      if (manifests.length !== 1 || manifests[0]!.sizeBytes < 1 || manifests[0]!.sizeBytes > 8 * 1024 * 1024) return;
      await artifacts.readVerified(request.workspaceId, manifests[0]!);
      return action;
    } catch {
      return;
    }
  }
}

export function hasTrustedFormImplementations(
  action: CompiledSystemFormAction,
  instances: readonly AssetInstance[],
  implementations: readonly SystemBuildResolvedImplementation[],
): boolean {
  const ids = new Set([action.form.id, action.operationId, ...action.form.steps.flatMap((step) => [step.id, ...step.fields.map((field) => field.id)])]);
  for (const instance of instances) {
    if (!ids.has(String(instance.instanceId))) continue;
    const matches = implementations.filter((item) => item.instanceId === instance.instanceId);
    const selected = matches[0];
    if (matches.length !== 1 || !selected?.facets.length || selected.trustLevel !== "system-trusted" ||
        selected.definitionRef.kind !== "asset-definition-version" || selected.definitionRef.id !== instance.definitionRef.id ||
        selected.definitionRef.version !== instance.definitionRef.version) return false;
    ids.delete(String(instance.instanceId));
  }
  return ids.size === 0;
}
