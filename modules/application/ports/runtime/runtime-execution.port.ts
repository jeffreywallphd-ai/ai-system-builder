import type {
  RuntimeExecutionEvent,
  RuntimeExecutionRequest,
  RuntimeExecutionResult,
} from "../../../contracts/runtime";

export interface RuntimeExecutionHandlers<TChunk = unknown> {
  onEvent?: (event: RuntimeExecutionEvent<TChunk>) => void;
}

export interface RuntimeExecutionPort {
  execute<TInput = unknown, TOutput = unknown, TChunk = unknown>(
    request: RuntimeExecutionRequest<TInput>,
    handlers?: RuntimeExecutionHandlers<TChunk>,
  ): Promise<RuntimeExecutionResult<TOutput>>;
}
