import { describe, expectTypeOf, it } from "../../../../testing/node-test";

import type {
  DeleteModelRecordRequest,
  ListModelsRequest,
  RegisterDownloadedModelRequest,
  RegisterGeneratedModelRequest,
  SaveModelReferenceRequest,
  UpdateModelRecordRequest,
} from "../../../../contracts/model";
import type { ModelRegistryPort } from "..";

describe("model registry application port", () => {
  it("defines explicit model-asset registry operations", () => {
    expectTypeOf<keyof ModelRegistryPort>().toEqualTypeOf<
      | "listModels"
      | "getModelRecord"
      | "saveModelReference"
      | "registerDownloadedModel"
      | "registerGeneratedModel"
      | "updateModelRecord"
      | "deleteModelRecord"
    >();

    expectTypeOf<Parameters<ModelRegistryPort["listModels"]>[0]>().toExtend<ListModelsRequest>();
    expectTypeOf<Parameters<ModelRegistryPort["saveModelReference"]>[0]>().toExtend<SaveModelReferenceRequest>();
    expectTypeOf<Parameters<ModelRegistryPort["registerDownloadedModel"]>[0]>().toExtend<RegisterDownloadedModelRequest>();
    expectTypeOf<Parameters<ModelRegistryPort["registerGeneratedModel"]>[0]>().toExtend<RegisterGeneratedModelRequest>();
    expectTypeOf<Parameters<ModelRegistryPort["updateModelRecord"]>[0]>().toExtend<UpdateModelRecordRequest>();
    expectTypeOf<Parameters<ModelRegistryPort["deleteModelRecord"]>[0]>().toExtend<DeleteModelRecordRequest>();
  });
});
