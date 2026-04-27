import {
  createRuntimeTarget,
  type RuntimeExecutionOptions,
  type RuntimeTarget,
} from "../runtime";

export interface RuntimeConfig {
  defaultTarget: RuntimeTarget;
  defaultExecutionOptions?: RuntimeExecutionOptions;
}

export function createRuntimeConfig(options?: {
  defaultTarget?: RuntimeTarget;
  runtimeKind?: string;
  defaultExecutionOptions?: RuntimeExecutionOptions;
}): RuntimeConfig {
  return {
    defaultTarget:
      options?.defaultTarget ?? createRuntimeTarget(options?.runtimeKind),
    defaultExecutionOptions: options?.defaultExecutionOptions,
  };
}
