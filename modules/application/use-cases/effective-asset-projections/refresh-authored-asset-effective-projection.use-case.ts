import {
  normalizeRefreshEffectiveAssetProjectionCommand,
  type EffectiveAssetProjectionPolicy,
  type EffectiveAssetProjectionStatus,
  type RefreshEffectiveAssetProjectionCommand,
  type RefreshEffectiveAssetProjectionResult,
} from "../../../contracts/effective-asset-projections";
import type { AuthoredAssetRepositoryPort, AssetRevisionRepositoryPort } from "../../ports/asset-authoring";
import type { EffectiveAssetProjectionRepositoryPort } from "../../ports/effective-asset-projections";
import { mapEditableToProjectedFields } from "./effective-asset-projection-field-mapper.service";
import { createProjectionProvenance } from "./effective-asset-projection-provenance.service";
import { projectionFailure } from "./effective-asset-projection-result-helpers";
import { defaultEffectiveAssetProjectionValidationService } from "./effective-asset-projection-validation.service";
import { defaultEffectiveAssetProjectionDiagnosticsService } from "./effective-asset-projection-diagnostics.service";
import { defaultEffectiveAssetProjectionConflictBlockingService } from "./effective-asset-projection-conflict-blocking.service";

export class RefreshAuthoredAssetEffectiveProjectionUseCase { constructor(private readonly d:{projectionRepository:EffectiveAssetProjectionRepositoryPort;authoredAssetRepository:AuthoredAssetRepositoryPort;assetRevisionRepository:AssetRevisionRepositoryPort;now?:()=>string;}){}
async execute(command:RefreshEffectiveAssetProjectionCommand):Promise<RefreshEffectiveAssetProjectionResult>{
let c;try{c=normalizeRefreshEffectiveAssetProjectionCommand(command);}catch{return projectionFailure("validation","effective-projection-workspace-required");}
const existing=await this.d.projectionRepository.readEffectiveAssetProjectionRecord(c.targetWorkspaceId,c.projectionId); if(!existing) return projectionFailure("not-found","effective-projection-source-missing");
if(!["workspace-authored","workspace-authored-revision"].includes(existing.sourceKind)) return projectionFailure("unsupported","effective-projection-source-unsupported");
const src=existing.sourceKind==="workspace-authored-revision"?await this.d.assetRevisionRepository.readAssetRevisionRecord(c.targetWorkspaceId,existing.source.authoredAssetId!,existing.source.revisionId!):await this.d.authoredAssetRepository.readAuthoredAssetRecordByWorkspace(c.targetWorkspaceId,existing.source.authoredAssetId!);
const now=(this.d.now??(()=>new Date().toISOString()))();
if(!src){const upd={...existing,status:"source-missing" as const,policy:"blocked" as const,updatedAt:now,materializedAt:now,diagnostics:[defaultEffectiveAssetProjectionDiagnosticsService.createDiagnostic("effective-projection-source-missing")],blockers:[defaultEffectiveAssetProjectionDiagnosticsService.createBlocker("effective-projection-source-missing")]}; await this.d.projectionRepository.updateEffectiveAssetProjectionRecord(upd); return {status:"success",value:upd};}
const mapped=mapEditableToProjectedFields((src as any).editableValues);
const sourceStatus = (src as { status?: string }).status;
const status: EffectiveAssetProjectionStatus =
  sourceStatus === "published"
    ? (mapped.blocked ? "blocked" : "ready")
    : sourceStatus === "draft"
      ? "draft-only"
      : sourceStatus === "conflicted"
        ? "conflicted"
        : sourceStatus === "disabled" || sourceStatus === "archived"
          ? "disabled"
          : "unsupported";
const policy: EffectiveAssetProjectionPolicy = status==="ready"?"safe-fields-only":"blocked";
const upd={...existing,status,policy,projectedFields:mapped.projectedFields,diagnostics:mapped.diagnostics,blockers:mapped.blockers,provenance:createProjectionProvenance(c.targetWorkspaceId,existing.source,now),updatedAt:now,materializedAt:now};
try{return {status:"success",value:await this.d.projectionRepository.updateEffectiveAssetProjectionRecord(upd)};}catch{return projectionFailure("unavailable","effective-projection-materialization-unavailable");}
}}
