import { normalizeAssetOverrideRecord, normalizeDisableAssetOverrideCommand, type AssetAuthoringFailure, type DisableAssetOverrideCommand, type DisableAssetOverrideResult } from "../../../contracts/asset-authoring";
import type { AssetOverrideRepositoryPort } from "../../ports/asset-authoring";

const nowIso = () => new Date().toISOString();
const fail = (code: AssetAuthoringFailure["code"], message: string): DisableAssetOverrideResult => ({ kind: "failure", failure: { code, message } });

export interface DisableAssetOverrideUseCaseDependencies { assetOverrideRepository: AssetOverrideRepositoryPort; now?: () => string; }
export class DisableAssetOverrideUseCase {
  constructor(private readonly d: DisableAssetOverrideUseCaseDependencies) {}
  async execute(command: DisableAssetOverrideCommand): Promise<DisableAssetOverrideResult> { try {
    const c = normalizeDisableAssetOverrideCommand(command);
    const found = await this.d.assetOverrideRepository.readAssetOverrideRecord(c.targetWorkspaceId, c.overrideId);
    if (!found) return fail("not-found", "Asset override was not found.");
    if (found.targetWorkspaceId !== c.targetWorkspaceId) return fail("conflict", "Override workspace mismatch.");
    if (found.status === "disabled") return fail("conflict", "Asset override is already disabled.");
    const updated = normalizeAssetOverrideRecord({ ...found, status: "disabled", updatedAt: (this.d.now ?? nowIso)(), provenance: found.provenance });
    return { kind: "success", value: await this.d.assetOverrideRepository.updateAssetOverrideRecord(updated) };
  } catch { return fail("validation", "Disable asset override command is invalid."); }}
}
