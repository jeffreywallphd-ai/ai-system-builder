const SAFE_DEPLOYMENT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;

export type SystemDeploymentId = string & {
  readonly __systemDeploymentIdBrand: unique symbol;
};
export type SystemDeploymentRunId = string & {
  readonly __systemDeploymentRunIdBrand: unique symbol;
};
export type SystemDeploymentAuditId = string & {
  readonly __systemDeploymentAuditIdBrand: unique symbol;
};

function normalizeId<T extends string>(value: string, label: string): T {
  const normalized = value.trim();
  if (
    !SAFE_DEPLOYMENT_ID.test(normalized) ||
    normalized.includes("..") ||
    /[\\/]/.test(normalized)
  ) {
    const error = new Error(`${label} must be a safe non-path identifier.`);
    error.stack = undefined;
    throw error;
  }
  return normalized as T;
}

export const normalizeSystemDeploymentId = (value: string) =>
  normalizeId<SystemDeploymentId>(value, "System deployment id");
export const normalizeSystemDeploymentRunId = (value: string) =>
  normalizeId<SystemDeploymentRunId>(value, "System deployment run id");
export const normalizeSystemDeploymentAuditId = (value: string) =>
  normalizeId<SystemDeploymentAuditId>(value, "System deployment audit id");
