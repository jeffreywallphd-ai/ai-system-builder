import type { SystemRunWorkflowHandlerPort } from "../../../application/ports/system-run-workflow";
import { createSystemRunWorkflowUseCases } from "../../../application/use-cases/system-run-workflow";

export interface ComposeSystemRunWorkflowOptions {
  readonly handlers: readonly SystemRunWorkflowHandlerPort[];
}

export function composeSystemRunWorkflow(
  options: ComposeSystemRunWorkflowOptions,
) {
  return {
    handlers: options.handlers,
    useCases: createSystemRunWorkflowUseCases({
      handlers: options.handlers,
    }),
  };
}

export type SystemRunWorkflowCompositionRoot = ReturnType<
  typeof composeSystemRunWorkflow
>;
