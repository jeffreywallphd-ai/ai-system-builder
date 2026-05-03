export type ModelId = string;

export function normalizeModelId(value: string): ModelId {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error("Model id must be a non-empty trimmed string.");
  }

  return normalized;
}

export interface ModelIdentity {
  provider?: string;
  modelId: ModelId;
}

export function normalizeModelIdentity(identity: ModelIdentity): ModelIdentity {
  return {
    provider: typeof identity.provider === "string" ? identity.provider.trim().toLowerCase() : undefined,
    modelId: normalizeModelId(identity.modelId),
  };
}
