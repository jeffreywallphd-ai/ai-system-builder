export interface StoreGeneratedModelRequest {
  sourceDirectory: string;
  outputModelName: string;
  runId: string;
  repository?: string;
}

export interface StoreGeneratedModelResult {
  localPath: string;
  modelId?: string;
}

export interface GeneratedModelStoragePort {
  storeGeneratedModel(request: StoreGeneratedModelRequest): Promise<StoreGeneratedModelResult>;
}
