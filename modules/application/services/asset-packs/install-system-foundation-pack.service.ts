import type { AssetPackId, AssetPackVersion } from "../../../contracts/asset";
import {
  readSystemFoundationManifest,
  SYSTEM_FOUNDATION_PACK_ID,
  SYSTEM_FOUNDATION_PACK_VERSION,
  SYSTEM_FOUNDATION_PACK_VERSIONS,
} from "./system-packs";
import {
  InstallSystemAssetPackService,
  type InstallSystemAssetPackInput,
  type InstallSystemAssetPackResult,
  type InstallSystemAssetPackServiceDependencies,
} from "./install-system-asset-pack.service";

export type InstallSystemFoundationPackInput = Omit<
  InstallSystemAssetPackInput,
  "manifest" | "expectedPackId"
> & {
  readonly version?: AssetPackVersion;
};

/** Safe internal attribution; never attach repository errors, records or paths. */
export function createSystemFoundationInitializationError(results: readonly InstallSystemAssetPackResult[]): Error {
  const allowedCodes = new Set(["definition-read-failed", "definition-save-failed", "definition-save-rejected", "definition-conflict-not-overwritten"]);
  return Object.assign(new Error("System foundation assets are unavailable."), {
    name: "SystemFoundationInitializationError",
    stage: "foundation-installation",
    failures: results.filter(r => r.status === "failed").slice(0, 3).map(r => ({
      version: SYSTEM_FOUNDATION_PACK_VERSIONS.includes(r.packVersion) ? r.packVersion : "unknown",
      failedEntries: Number.isInteger(r.failedEntryCount) ? Math.max(0, Math.min(1000, r.failedEntryCount)) : 0,
      codes: [...new Set(r.diagnostics.slice(0, 1000).filter(d => d.severity === "error").map(d => allowedCodes.has(d.code) ? d.code : "validation-or-unknown"))].slice(0, 5),
    })),
  });
}

export class InstallSystemFoundationPackService {
  private readonly installer: InstallSystemAssetPackService;

  public constructor(dependencies: InstallSystemAssetPackServiceDependencies) {
    this.installer = new InstallSystemAssetPackService(dependencies);
  }

  public install(
    input: InstallSystemFoundationPackInput = {},
  ): Promise<InstallSystemAssetPackResult> {
    const { version = SYSTEM_FOUNDATION_PACK_VERSION, ...installInput } = input;
    const manifest = readSystemFoundationManifest(version);
    if (!manifest) {
      throw new Error(
        "The requested System Foundation release is unavailable.",
      );
    }
    return this.installer.install({
      ...installInput,
      manifest,
      expectedPackId: SYSTEM_FOUNDATION_PACK_ID as AssetPackId,
    });
  }

  public async installAll(
    input: Omit<InstallSystemFoundationPackInput, "version"> = {},
  ): Promise<readonly InstallSystemAssetPackResult[]> {
    const results: InstallSystemAssetPackResult[] = [];
    for (const version of SYSTEM_FOUNDATION_PACK_VERSIONS) {
      results.push(await this.install({ ...input, version }));
    }
    return results;
  }
}

export function installSystemFoundationPack(
  dependencies: InstallSystemAssetPackServiceDependencies,
  input: InstallSystemFoundationPackInput = {},
): Promise<InstallSystemAssetPackResult> {
  return new InstallSystemFoundationPackService(dependencies).install(input);
}
