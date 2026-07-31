import {
  normalizeAssetRevisionId,
  normalizeAuthoredAssetRevisionRecord,
  type AssetAuthoringResult,
  type AuthoredAssetDraftRecord,
  type AuthoredAssetId,
  type AuthoredAssetRevisionRecord,
  type AssetRevisionId,
} from "../../../contracts/asset-authoring";
import { fail } from "./asset-authoring-use-case-results";
import { createRevisedAuthoredAssetProvenance } from "./asset-authoring-provenance.service";

export const normalizeGeneratedRevisionId = (generateAssetRevisionId: () => string): AssetAuthoringResult<AssetRevisionId> => {
  try {
    return { kind: "success", value: normalizeAssetRevisionId(generateAssetRevisionId()) };
  } catch {
    return fail("internal", "Generated revision identifier is invalid.");
  }
};

export const createPublishedRevisionFromDraft = (args: {
  draft: AuthoredAssetDraftRecord;
  revisionId: AssetRevisionId;
  authoredAssetId: AuthoredAssetId;
  now: string;
  revisionLabel: string;
}): AssetAuthoringResult<AuthoredAssetRevisionRecord> => {
  try {
    return {
      kind: "success",
      value: normalizeAuthoredAssetRevisionRecord({
        revisionId: args.revisionId,
        workspaceId: args.draft.targetWorkspaceId,
        authoredAssetId: args.authoredAssetId,
        revision: args.revisionLabel,
        status: "published",
        editableValues: args.draft.draftEditableValues,
        provenance: createRevisedAuthoredAssetProvenance(args.draft.targetWorkspaceId, args.now),
        createdAt: args.now,
        updatedAt: args.now,
        publishedAt: args.now,
      }),
    };
  } catch {
    return fail("internal", "Generated revision label is invalid.");
  }
};
