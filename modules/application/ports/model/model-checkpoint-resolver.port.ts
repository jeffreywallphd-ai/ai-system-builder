export interface ResolveModelCheckpointRequest {
  selectedModel?: string;
  taskTag?: string;
}

export interface ResolveModelCheckpointResult {
  checkpoint?: string;
}

export interface ModelCheckpointResolverPort {
  resolveCheckpoint(request: ResolveModelCheckpointRequest): Promise<ResolveModelCheckpointResult>;
}
