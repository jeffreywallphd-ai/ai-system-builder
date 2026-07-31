import { randomUUID } from "node:crypto";
import { ExecutionPlanReadModelService } from "../../../application/services/execution-plans";
import {
  CreateExecutionPlanUseCase,
  ValidateExecutionPlanUseCase,
  ExecutionPlanStepPlanningService,
  ExecutionPlanStatusService,
  ExecutionPlanProviderPlanningService,
  ExecutionPlanInputOutputPlanningService,
  ExecutionPlanDependencyPlanningService,
  ExecutionPlanSafetyGatePlanningService,
  ExecutionPlanResourceEstimateService,
  ExecutionPlanPreflightValidationService,
  ExecutionPlanSafetyGateValidationService,
} from "../../../application/use-cases/execution-plans";
import type { AssetCompositionPlanRepositoryPort } from "../../../application/ports/asset-composition";
import type { RuntimeReadinessBindingRepositoryPort } from "../../../application/ports/runtime-readiness";
import type { ExecutionPlanRepositoryPort } from "../../../application/ports/execution-plans";

export interface ComposeExecutionPlanServicesDependencies {
  executionPlanRepository: ExecutionPlanRepositoryPort;
  runtimeReadinessBindingRepository: RuntimeReadinessBindingRepositoryPort;
  compositionPlanRepository: AssetCompositionPlanRepositoryPort;
  now?: () => string;
}

export function composeExecutionPlanServices(dependencies: ComposeExecutionPlanServicesDependencies) {
  const statusService = new ExecutionPlanStatusService();
  const providerPlanningService = new ExecutionPlanProviderPlanningService();
  const inputOutputPlanningService = new ExecutionPlanInputOutputPlanningService();
  const dependencyPlanningService = new ExecutionPlanDependencyPlanningService();
  const safetyGatePlanningService = new ExecutionPlanSafetyGatePlanningService();
  const resourceEstimateService = new ExecutionPlanResourceEstimateService();

  return {
    createPlan: new CreateExecutionPlanUseCase({
      executionPlanRepository: dependencies.executionPlanRepository,
      runtimeReadinessBindingRepository: dependencies.runtimeReadinessBindingRepository,
      compositionPlanRepository: dependencies.compositionPlanRepository,
      stepPlanningService: new ExecutionPlanStepPlanningService(),
      statusService,
      providerPlanningService,
      inputOutputPlanningService,
      dependencyPlanningService,
      safetyGatePlanningService,
      resourceEstimateService,
      nextExecutionPlanId: () => `ep.${randomUUID()}`,
      nextExecutionStepId: () => `eps.${randomUUID()}`,
      nextExecutionInputId: () => `epi.${randomUUID()}`,
      nextExecutionOutputId: () => `epo.${randomUUID()}`,
      nextExecutionDependencyId: () => `epd.${randomUUID()}`,
      nextExecutionAdapterReferenceId: () => `epar.${randomUUID()}`,
      nextExecutionSafetyGateId: () => `epsg.${randomUUID()}`,
      now: dependencies.now,
    }),
    validatePlan: new ValidateExecutionPlanUseCase({
      executionPlanRepository: dependencies.executionPlanRepository,
      runtimeReadinessBindingRepository: dependencies.runtimeReadinessBindingRepository,
      compositionPlanRepository: dependencies.compositionPlanRepository,
      preflightValidationService: new ExecutionPlanPreflightValidationService(),
      safetyGateValidationService: new ExecutionPlanSafetyGateValidationService(),
      resourceEstimateService,
      statusService,
      now: dependencies.now,
    }),
    readModel: new ExecutionPlanReadModelService(dependencies.executionPlanRepository),
  };
}
