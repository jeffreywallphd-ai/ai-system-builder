export type AssetAuthoringConflictCode =
  | "expected-base-revision-mismatch"
  | "override-target-missing"
  | "override-target-identity-mismatch";

export interface AssetAuthoringConflict {
  readonly code: AssetAuthoringConflictCode;
  readonly message: string;
}

export const detectExpectedBaseRevisionConflict = (
  expectedBaseRevision: string | undefined,
  actualBaseRevision: string | undefined,
): AssetAuthoringConflict | undefined => {
  if (!expectedBaseRevision) return undefined;
  if (!actualBaseRevision || expectedBaseRevision !== actualBaseRevision) {
    return { code: "expected-base-revision-mismatch", message: "Expected base revision does not match current base revision." };
  }
  return undefined;
};
