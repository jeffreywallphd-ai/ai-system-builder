import type {
  ModelCheckpointResolverPort,
  ResolveModelCheckpointRequest,
  ResolveModelCheckpointResult,
} from "../../application/ports/model";

export interface RuntimePreparationPort {
  start(): Promise<void>;
  startWithRuntimeDeviceMode?(request: { runtimeDeviceMode?: string }): Promise<void>;
}

export function createRuntimePreparedModelCheckpointResolver(input: {
  runtime: RuntimePreparationPort;
  modelCheckpointResolver: ModelCheckpointResolverPort;
}): ModelCheckpointResolverPort {
  return {
    async resolveCheckpoint(request: ResolveModelCheckpointRequest): Promise<ResolveModelCheckpointResult> {
      if (input.runtime.startWithRuntimeDeviceMode) {
        await input.runtime.startWithRuntimeDeviceMode({ runtimeDeviceMode: request.runtimeDeviceMode });
      } else {
        await input.runtime.start();
      }
      return input.modelCheckpointResolver.resolveCheckpoint(request);
    },
  };
}
