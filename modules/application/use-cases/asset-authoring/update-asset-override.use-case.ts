import { normalizeAssetOverrideRecord, normalizeUpdateAssetOverrideCommand, type AssetAuthoringFailure, type UpdateAssetOverrideCommand, type UpdateAssetOverrideResult } from "../../../contracts/asset-authoring";
import type { AssetOverrideRepositoryPort } from "../../ports/asset-authoring";
import { detectExpectedBaseRevisionConflict } from "./asset-authoring-conflict.service";

const nowIso = () => new Date().toISOString();
const fail = (code: AssetAuthoringFailure["code"], message: string): UpdateAssetOverrideResult => ({ kind: "failure", failure: { code, message } });

export interface UpdateAssetOverrideUseCaseDependencies { assetOverrideRepository: AssetOverrideRepositoryPort; now?: () => string; }
export class UpdateAssetOverrideUseCase {
  constructor(private readonly d: UpdateAssetOverrideUseCaseDependencies) {}
  async execute(command: UpdateAssetOverrideCommand): Promise<UpdateAssetOverrideResult> { try {
    const c = normalizeUpdateAssetOverrideCommand(command);
    const found = await this.d.assetOverrideRepository.readAssetOverrideRecord(c.targetWorkspaceId, c.overrideId);
    if (!found) return fail("not-found", "Asset override was not found.");
    if (found.targetWorkspaceId !== c.targetWorkspaceId) return fail("conflict", "Override workspace mismatch.");
    if (found.status !== "active") return fail("conflict", "Override status is not editable.");
    const conflict = detectExpectedBaseRevisionConflict(c.expectedBaseRevision, found.baseRevision);
    if (conflict) return fail("conflict", conflict.message);
    const updated = normalizeAssetOverrideRecord({ ...found, overrideValues: { ...found.overrideValues, ...c.overrideValues }, updatedAt: (this.d.now ?? nowIso)(), provenance: found.provenance, customizationTarget: found.customizationTarget, targetWorkspaceId: found.targetWorkspaceId, baseAssetReference: found.baseAssetReference, overrideScope: found.overrideScope });
    return { kind: "success", value: await this.d.assetOverrideRepository.updateAssetOverrideRecord(updated) };
  } catch { return fail("unavailable", "Unable to update asset override record."); }}
}
