export interface ResolveModelCheckpointRequest {
  selectedModel?: string;
  workspaceId?: string;
  taskTag?: string;
  runtimeDeviceMode?: string;
}

export interface ResolveModelCheckpointResult {
  checkpoint?: string;
}

export interface ModelCheckpointResolverPort {
  resolveCheckpoint(request: ResolveModelCheckpointRequest): Promise<ResolveModelCheckpointResult>;
}
