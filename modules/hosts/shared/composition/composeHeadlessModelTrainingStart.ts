import {types} from "node:util";
import {readStrictPassiveRecord} from "../../../contracts/shared";
import {TrainModelUseCase} from "../../../application/use-cases/model/train-model.use-case";
import type {ApprovedLocalModelTrainingPort, GeneratedModelStoragePort} from "../../../application/ports/model";
import type {OriginalTrainingRunOptions} from "./headlessModelTrainingTasks";
import {captureHeadlessTrainingMethod} from "./headlessTrainingPlanInputs";

type Dependencies = Omit<ConstructorParameters<typeof TrainModelUseCase>[0], "approvedLocalTraining" | "generatedModelStorage">;
export interface HeadlessTrainingStartConfiguration {
  readonly approvedLocalTraining: ApprovedLocalModelTrainingPort;
  readonly generatedModelStorage?: GeneratedModelStoragePort;
}

/** Trusted in-process composition only. Configuration receives no task data.
 * Resolving this capability neither approves nor starts a task. One missing or
 * uncertain initialization stays unavailable; a caller cannot retry it into a
 * different runtime. The application and original session own actual effects. */
export function composeHeadlessModelTrainingStart(options: {
  readonly dependencies: Dependencies;
  getConfiguration(): Promise<HeadlessTrainingStartConfiguration | undefined>;
}): OriginalTrainingRunOptions["resolveStart"] {
  type Start = Awaited<ReturnType<OriginalTrainingRunOptions["resolveStart"]>>;
  let initialize: (() => Promise<Start>) | undefined;
  try {
    if (types.isProxy(options)) throw Error("Unavailable training composition.");
    const row = readStrictPassiveRecord(options, ["dependencies", "getConfiguration"]);
    const getConfiguration = captureHeadlessTrainingMethod<typeof options.getConfiguration>(options, "getConfiguration");
    if (!getConfiguration || !row.dependencies || types.isProxy(row.dependencies)) throw Error("Unavailable training composition.");
    const dependencies = Object.freeze({...readStrictPassiveRecord(row.dependencies, ["runtimeTaskRegistry", "taskReconciler", "modelRegistry",
      "storageBindings", "storage", "modelPublisher", "taskPowerLifecycle", "runtimeCapabilityGuard"])}) as Dependencies;
    if (!dependencies.taskReconciler || !dependencies.runtimeTaskRegistry || !dependencies.modelRegistry ||
        !dependencies.storageBindings || !dependencies.storage || !dependencies.taskPowerLifecycle) throw Error("Unavailable training composition.");
    initialize = async () => {
      const configuration = await getConfiguration();
      if (!configuration || types.isProxy(configuration)) return;
      const selected = readStrictPassiveRecord(configuration, ["approvedLocalTraining", "generatedModelStorage"]);
      const createSession = captureHeadlessTrainingMethod<ApprovedLocalModelTrainingPort["createSession"]>(selected.approvedLocalTraining, "createSession");
      if (!createSession) return;
      let generatedModelStorage: GeneratedModelStoragePort | undefined;
      if (selected.generatedModelStorage !== undefined) {
        const storeGeneratedModel = captureHeadlessTrainingMethod<GeneratedModelStoragePort["storeGeneratedModel"]>(selected.generatedModelStorage, "storeGeneratedModel");
        const storage = selected.generatedModelStorage;
        if (!storeGeneratedModel || !storage || typeof storage !== "object" || types.isProxy(storage)) return;
        // Optional absence is different from a supplied malformed capability.
        let at: object | null = storage, present = false;
        for (let depth = 0; at && at !== Object.prototype && depth < 8; depth++, at = Object.getPrototypeOf(at)) {
          if (types.isProxy(at)) return;
          const field = Object.getOwnPropertyDescriptor(at, "createReviewedSession");
          if (field) {present = !("value" in field) || field.value !== undefined; break;}
        }
        const createReviewedSession = captureHeadlessTrainingMethod<NonNullable<GeneratedModelStoragePort["createReviewedSession"]>>(storage, "createReviewedSession");
        if (present && !createReviewedSession) return;
        generatedModelStorage = Object.freeze({storeGeneratedModel, ...(createReviewedSession ? {createReviewedSession} : {})});
      }
      const owner = new TrainModelUseCase({...dependencies, approvedLocalTraining: Object.freeze({createSession}),
        ...(generatedModelStorage ? {generatedModelStorage} : {})});
      return captureHeadlessTrainingMethod<NonNullable<Start>>(owner, "startApprovedLocal");
    };
  } catch { /* Malformed trusted configuration grants no capability. */ }
  let pending: Promise<Start> | undefined;
  return () => pending ??= Promise.resolve().then(() => initialize?.()).catch(() => undefined);
}
