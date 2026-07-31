import type { AssetAuthoringDiagnostic, AssetAuthoringFailure, AssetAuthoringResultFailure } from "../../../contracts/asset-authoring";

export const fail = <T>(
  code: AssetAuthoringFailure["code"],
  message: string,
  diagnostics?: readonly AssetAuthoringDiagnostic[],
): { kind: "failure"; failure: AssetAuthoringFailure } => ({
  kind: "failure",
  failure: { code, message, diagnostics },
});
