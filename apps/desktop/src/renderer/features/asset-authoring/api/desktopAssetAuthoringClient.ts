import type {
  AssetAuthoringEffectiveSourceSummary,
  AssetCustomizationSourceFileChange,
  AssetDerivedCustomizationDraftRecord,
  AssetDerivedCustomizationSemanticPatch,
  AssetDerivedCustomizationTargetDetail,
  AssetDerivedCustomizationTargetSummary,
  AssetOverrideRecord,
  AuthoredAssetDraftRecord,
  AuthoredAssetRecord,
} from "../../../../../../../modules/contracts/asset-authoring";
import type { AssetReference } from "../../../../../../../modules/contracts/asset";

type FailureCode =
  | "unavailable"
  | "conflict"
  | "not-found"
  | "validation"
  | "internal"
  | "unsupported"
  | "not-supported";
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: FailureCode; message: string } };

type EnvelopeSuccess<T> = { status: "success"; payload: T };
type EnvelopeFailure = {
  status: "error";
  error?: { code?: string; message?: string };
};
type Envelope<T> = EnvelopeSuccess<T> | EnvelopeFailure;

type Api = {
  listAuthoredAssets?: (i: {
    workspaceId: string;
    status?: string;
    limit?: number;
    cursor?: string;
  }) => Promise<unknown>;
  listAssetDrafts?: (i: { targetWorkspaceId: string }) => Promise<unknown>;
  createAssetDraft?: (i: {
    targetWorkspaceId: string;
    draftEditableValues: EditableValues & { "display-name": string };
  }) => Promise<unknown>;
  updateAssetDraft?: (i: {
    targetWorkspaceId: string;
    draftId: string;
    draftEditablePatch: EditableValues;
  }) => Promise<unknown>;
  publishAssetDraft?: (i: {
    targetWorkspaceId: string;
    draftId: string;
  }) => Promise<unknown>;
  listAssetOverrides?: (i: {
    targetWorkspaceId: string;
    status?: string;
    limit?: number;
    cursor?: string;
  }) => Promise<unknown>;
  disableAssetOverride?: (i: {
    targetWorkspaceId: string;
    overrideId: string;
  }) => Promise<unknown>;
  listAssetAuthoringEffectiveSummaries?: (i: {
    targetWorkspaceId: string;
  }) => Promise<unknown>;
  listAssetDerivedCustomizationTargets?: (i: {
    workspaceId: string;
    text?: string;
    sourceKind?: string;
    eligibility?: string;
  }) => Promise<unknown>;
  readAssetDerivedCustomizationTarget?: (i: {
    workspaceId: string;
    definitionRef: AssetReference;
    implementationReleaseId: string;
  }) => Promise<unknown>;
  createAssetDerivedCustomization?: (
    i: CreateDerivedCustomizationInput,
  ) => Promise<unknown>;
  updateAssetDerivedCustomization?: (
    i: UpdateDerivedCustomizationInput,
  ) => Promise<unknown>;
  reviewAssetDerivedCustomization?: (
    i: CustomizationRevisionInput,
  ) => Promise<unknown>;
  publishAssetDerivedCustomization?: (
    i: CustomizationRevisionInput,
  ) => Promise<unknown>;
  abandonAssetDerivedCustomization?: (
    i: CustomizationRevisionInput,
  ) => Promise<unknown>;
  listAssetDerivedCustomizations?: (i: {
    workspaceId: string;
    status?: string;
    text?: string;
    limit?: number;
    cursor?: string;
  }) => Promise<unknown>;
  readAssetDerivedCustomization?: (i: {
    workspaceId: string;
    customizationId: string;
  }) => Promise<unknown>;
};
type EditableValues = Partial<
  Record<
    "display-name" | "summary" | "description" | "classification" | "tags",
    string | readonly string[]
  >
>;
export type CreateDerivedCustomizationInput = {
  workspaceId: string;
  baseDefinitionRef: AssetReference;
  baseImplementationReleaseId: string;
  derivedDefinitionRef: AssetReference;
  semanticPatch: AssetDerivedCustomizationSemanticPatch;
  sourceChanges?: readonly AssetCustomizationSourceFileChange[];
};
export type UpdateDerivedCustomizationInput = {
  workspaceId: string;
  customizationId: string;
  expectedRevision: number;
  semanticPatch: AssetDerivedCustomizationSemanticPatch;
  sourceChanges?: readonly AssetCustomizationSourceFileChange[];
  clearSourceOverlay?: boolean;
};
export type CustomizationRevisionInput = {
  workspaceId: string;
  customizationId: string;
  expectedRevision: number;
};

const fail = (
  message: string,
  code: FailureCode = "internal",
): Result<never> => ({ ok: false, error: { code, message } });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isFailureCode = (value: unknown): value is FailureCode =>
  [
    "unavailable",
    "conflict",
    "not-found",
    "validation",
    "internal",
    "unsupported",
    "not-supported",
  ].includes(
    String(value),
  );

const parseEnvelope = <T>(response: unknown): Result<T> => {
  if (!isRecord(response)) {
    return fail("Unable to complete request.", "internal");
  }
  if (response.ok === true && "value" in response) {
    return { ok: true, value: response.value as T };
  }
  if (response.ok === false) {
    const error = isRecord(response.error) ? response.error : {};
    const code = isFailureCode(error.code) ? error.code : "internal";
    const message =
      typeof error.message === "string"
        ? error.message
        : "Unable to complete request.";
    return fail(message, code);
  }
  if (response.status !== "success" && response.status !== "error") {
    return fail("Unable to complete request.", "internal");
  }
  const envelope = response as Envelope<T>;
  if (envelope.status === "success")
    return { ok: true, value: envelope.payload };
  const code = isFailureCode(envelope.error?.code)
    ? envelope.error.code
    : "internal";
  const message =
    typeof envelope.error?.message === "string"
      ? envelope.error.message
      : "Unable to complete request.";
  return fail(message, code);
};

const getApi = (): Api =>
  (globalThis as { window?: { desktopApi?: Api } }).window?.desktopApi ?? {};

export function createDesktopAssetAuthoringClient() {
  const api = getApi();
  return {
    async listAuthoredAssets(
      workspaceId: string,
      options: {
        status?: string;
        limit?: number;
        cursor?: string;
      } = {},
    ): Promise<
      Result<{
        items: readonly AuthoredAssetRecord[];
        nextCursor?: string;
      }>
    > {
      if (typeof api.listAuthoredAssets !== "function")
        return fail("Custom assets are not available yet.", "unavailable");
      const r = parseEnvelope<{
        assets: readonly AuthoredAssetRecord[];
        nextCursor?: string;
      }>(
        await api.listAuthoredAssets({ workspaceId, ...options }),
      );
      if (r.ok === true)
        return {
          ok: true,
          value: {
            items: r.value.assets ?? [],
            nextCursor: r.value.nextCursor,
          },
        };
      return fail(r.error.message, r.error.code);
    },
    async listDrafts(
      workspaceId: string,
    ): Promise<Result<{ items: readonly AuthoredAssetDraftRecord[] }>> {
      if (typeof api.listAssetDrafts !== "function")
        return fail("Drafts are not available yet.", "unavailable");
      const r = parseEnvelope<{ drafts: readonly AuthoredAssetDraftRecord[] }>(
        await api.listAssetDrafts({ targetWorkspaceId: workspaceId }),
      );
      if (r.ok === true)
        return { ok: true, value: { items: r.value.drafts ?? [] } };
      return fail(r.error.message, r.error.code);
    },
    async createDraft(input: {
      workspaceId: string;
      displayName: string;
      summary?: string;
      description?: string;
      classification?: string;
      tags?: readonly string[];
    }): Promise<Result<unknown>> {
      if (typeof api.createAssetDraft !== "function")
        return fail("Create draft is not available yet.", "unavailable");
      return parseEnvelope(
        await api.createAssetDraft({
          targetWorkspaceId: input.workspaceId,
          draftEditableValues: {
            ...editableValues(input),
            "display-name": input.displayName,
          },
        }),
      );
    },
    async updateDraft(input: {
      workspaceId: string;
      draftId: string;
      displayName?: string;
      summary?: string;
      description?: string;
      classification?: string;
      tags?: readonly string[];
    }): Promise<Result<unknown>> {
      if (typeof api.updateAssetDraft !== "function")
        return fail("Update draft is not available yet.", "unavailable");
      return parseEnvelope(
        await api.updateAssetDraft({
          targetWorkspaceId: input.workspaceId,
          draftId: input.draftId,
          draftEditablePatch: editableValues(input),
        }),
      );
    },
    async publishDraft(
      workspaceId: string,
      draftId: string,
    ): Promise<Result<unknown>> {
      if (typeof api.publishAssetDraft !== "function")
        return fail("Publish draft is not available yet.", "unavailable");
      return parseEnvelope(
        await api.publishAssetDraft({
          targetWorkspaceId: workspaceId,
          draftId,
        }),
      );
    },
    async listOverrides(
      workspaceId: string,
      options: {
        status?: string;
        limit?: number;
        cursor?: string;
      } = {},
    ): Promise<
      Result<{
        items: readonly AssetOverrideRecord[];
        nextCursor?: string;
      }>
    > {
      if (typeof api.listAssetOverrides !== "function")
        return fail(
          "Workspace customizations are not available yet.",
          "unavailable",
        );
      const r = parseEnvelope<{
        overrides: readonly AssetOverrideRecord[];
        nextCursor?: string;
      }>(
        await api.listAssetOverrides({
          targetWorkspaceId: workspaceId,
          ...options,
        }),
      );
      if (r.ok === true)
        return {
          ok: true,
          value: {
            items: r.value.overrides ?? [],
            nextCursor: r.value.nextCursor,
          },
        };
      return fail(r.error.message, r.error.code);
    },
    async disableOverride(
      workspaceId: string,
      overrideId: string,
    ): Promise<Result<unknown>> {
      if (typeof api.disableAssetOverride !== "function")
        return fail(
          "Disable customization is not available yet.",
          "unavailable",
        );
      return parseEnvelope(
        await api.disableAssetOverride({
          targetWorkspaceId: workspaceId,
          overrideId,
        }),
      );
    },
    async listEffectiveSummaries(
      workspaceId: string,
    ): Promise<
      Result<{ items: readonly AssetAuthoringEffectiveSourceSummary[] }>
    > {
      if (typeof api.listAssetAuthoringEffectiveSummaries !== "function")
        return fail(
          "Workspace usage summaries are not available yet.",
          "unavailable",
        );
      const r = parseEnvelope<{
        items: readonly AssetAuthoringEffectiveSourceSummary[];
      }>(
        await api.listAssetAuthoringEffectiveSummaries({
          targetWorkspaceId: workspaceId,
        }),
      );
      if (r.ok === false) return fail(r.error.message, r.error.code);
      return { ok: true, value: { items: r.value.items ?? [] } };
    },
    async listCustomizationTargets(input: {
      workspaceId: string;
      text?: string;
      sourceKind?: string;
      eligibility?: string;
    }): Promise<
      Result<{
        items: readonly AssetDerivedCustomizationTargetSummary[];
        nextCursor?: string;
      }>
    > {
      if (typeof api.listAssetDerivedCustomizationTargets !== "function")
        return fail(
          "Asset customization targets are not available yet.",
          "unavailable",
        );
      const r = parseEnvelope<{
        targets: readonly AssetDerivedCustomizationTargetSummary[];
        nextCursor?: string;
      }>(await api.listAssetDerivedCustomizationTargets(input));
      return r.ok
        ? {
            ok: true,
            value: {
              items: r.value.targets ?? [],
              nextCursor: r.value.nextCursor,
            },
          }
        : r;
    },
    async readCustomizationTarget(input: {
      workspaceId: string;
      definitionRef: AssetReference;
      implementationReleaseId: string;
    }): Promise<Result<AssetDerivedCustomizationTargetDetail>> {
      if (typeof api.readAssetDerivedCustomizationTarget !== "function")
        return fail(
          "Asset customization details are not available yet.",
          "unavailable",
        );
      return parseEnvelope<AssetDerivedCustomizationTargetDetail>(
        await api.readAssetDerivedCustomizationTarget(input),
      );
    },
    async listDerivedCustomizations(input: {
      workspaceId: string;
      status?: string;
      text?: string;
      limit?: number;
      cursor?: string;
    }): Promise<
      Result<{
        items: readonly AssetDerivedCustomizationDraftRecord[];
        nextCursor?: string;
      }>
    > {
      if (typeof api.listAssetDerivedCustomizations !== "function")
        return fail(
          "Asset customizations are not available yet.",
          "unavailable",
        );
      const r = parseEnvelope<{
        customizations: readonly AssetDerivedCustomizationDraftRecord[];
        nextCursor?: string;
      }>(await api.listAssetDerivedCustomizations(input));
      return r.ok
        ? {
            ok: true,
            value: {
              items: r.value.customizations ?? [],
              nextCursor: r.value.nextCursor,
            },
          }
        : r;
    },
    async readDerivedCustomization(
      workspaceId: string,
      customizationId: string,
    ): Promise<Result<AssetDerivedCustomizationDraftRecord>> {
      if (typeof api.readAssetDerivedCustomization !== "function")
        return fail("Asset customization is not available yet.", "unavailable");
      return parseEnvelope<AssetDerivedCustomizationDraftRecord>(
        await api.readAssetDerivedCustomization({
          workspaceId,
          customizationId,
        }),
      );
    },
    async createDerivedCustomization(
      input: CreateDerivedCustomizationInput,
    ): Promise<Result<AssetDerivedCustomizationDraftRecord>> {
      if (typeof api.createAssetDerivedCustomization !== "function")
        return fail(
          "Create customization is not available yet.",
          "unavailable",
        );
      return parseEnvelope<AssetDerivedCustomizationDraftRecord>(
        await api.createAssetDerivedCustomization(input),
      );
    },
    async updateDerivedCustomization(
      input: UpdateDerivedCustomizationInput,
    ): Promise<Result<AssetDerivedCustomizationDraftRecord>> {
      if (typeof api.updateAssetDerivedCustomization !== "function")
        return fail(
          "Update customization is not available yet.",
          "unavailable",
        );
      return parseEnvelope<AssetDerivedCustomizationDraftRecord>(
        await api.updateAssetDerivedCustomization(input),
      );
    },
    async reviewDerivedCustomization(
      input: CustomizationRevisionInput,
    ): Promise<Result<AssetDerivedCustomizationDraftRecord>> {
      if (typeof api.reviewAssetDerivedCustomization !== "function")
        return fail(
          "Review customization is not available yet.",
          "unavailable",
        );
      return parseEnvelope<AssetDerivedCustomizationDraftRecord>(
        await api.reviewAssetDerivedCustomization(input),
      );
    },
    async publishDerivedCustomization(
      input: CustomizationRevisionInput,
    ): Promise<Result<AssetDerivedCustomizationDraftRecord>> {
      if (typeof api.publishAssetDerivedCustomization !== "function")
        return fail(
          "Publish customization is not available yet.",
          "unavailable",
        );
      return parseEnvelope<AssetDerivedCustomizationDraftRecord>(
        await api.publishAssetDerivedCustomization(input),
      );
    },
    async abandonDerivedCustomization(
      input: CustomizationRevisionInput,
    ): Promise<Result<AssetDerivedCustomizationDraftRecord>> {
      if (typeof api.abandonAssetDerivedCustomization !== "function")
        return fail(
          "Abandon customization is not available yet.",
          "unavailable",
        );
      return parseEnvelope<AssetDerivedCustomizationDraftRecord>(
        await api.abandonAssetDerivedCustomization(input),
      );
    },
  };
}

function editableValues(input: {
  displayName?: string;
  summary?: string;
  description?: string;
  classification?: string;
  tags?: readonly string[];
}): EditableValues {
  return {
    ...(input.displayName ? { "display-name": input.displayName } : {}),
    ...(input.summary ? { summary: input.summary } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.classification ? { classification: input.classification } : {}),
    ...(input.tags?.length ? { tags: input.tags } : {}),
  };
}
