import type { ApplicationRequestContext } from "../../ports";
import { normalizeDatasetVersionRecord } from "../../../contracts/dataset";
import { HEADLESS_DATASET_VERSION_READ_LIMIT, projectHeadlessDatasetVersion,
  readHeadlessDatasetVersionBatch, readHeadlessDatasetComparison, type HeadlessDatasetMetadataRequest } from "../../../contracts/headless";
import type { ReadDatasetVersionUseCase, CompareDatasetVersionsUseCase } from "./dataset-version-read.use-cases";

const denied = {ok: false, code: "headless.forbidden"} as const;
const unavailable = {ok: false, code: "headless.unavailable"} as const;
const tooLarge = {ok: false, code: "headless.result-too-large"} as const;

/** Minimized metadata queries over the existing authorized dataset read owners. */
export class ReadHeadlessDatasetMetadataUseCase {
  constructor(private readonly dependencies: {
    readonly versions: Pick<ReadDatasetVersionUseCase, "execute">;
    readonly comparisons: Pick<CompareDatasetVersionsUseCase, "execute">;
  }) {}

  async execute(request: HeadlessDatasetMetadataRequest, authority: {
    readonly context: ApplicationRequestContext;
    readonly stillAllowed: () => Promise<boolean>;
  }) {
    const {input, operation} = request, {context, stillAllowed} = authority;
    if (context.workspaceId !== input.workspaceId || !context.organizationId || !context.principalId) return denied;
    try {
      if (!await stillAllowed()) return denied;
      if (operation === "data.compare-dataset-versions") {
        const result = await this.dependencies.comparisons.execute(input, context);
        if (!await stillAllowed()) return denied;
        if (!result) return {ok: false, code: "headless.not-found"} as const;
        const value = readHeadlessDatasetComparison(result, input);
        return value ? {ok: true, operation, value} as const : unavailable;
      }
      if (!Array.isArray(input.versionIds) || input.versionIds.length < 1 || input.versionIds.length > HEADLESS_DATASET_VERSION_READ_LIMIT ||
          new Set(input.versionIds).size !== input.versionIds.length) return tooLarge;
      const selected = [];
      for (const versionId of input.versionIds) {
        if (!await stillAllowed()) return denied;
        const record = await this.dependencies.versions.execute({workspaceId: input.workspaceId, versionId}, context);
        if (!await stillAllowed()) return denied;
        if (!record) return {ok: false, code: "headless.not-found"} as const;
        const version = normalizeDatasetVersionRecord(record);
        if (version.organizationId !== context.organizationId || version.workspaceId !== input.workspaceId || version.datasetId !== input.datasetId || version.versionId !== versionId) return denied;
        selected.push(projectHeadlessDatasetVersion(version));
      }
      const value = readHeadlessDatasetVersionBatch({workspaceId: input.workspaceId, datasetId: input.datasetId, versions: selected}, input);
      if (!await stillAllowed()) return denied;
      return value ? {ok: true, operation, value} as const : unavailable;
    } catch {
      try { return await stillAllowed() ? unavailable : denied; } catch { return denied; }
    }
  }
}
