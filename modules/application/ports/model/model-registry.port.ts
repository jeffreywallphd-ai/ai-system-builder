import type {
  DeleteModelRecordRequest,
  DeleteModelRecordResult,
  ListModelsRequest,
  ListModelsResult,
  ModelInventoryRecord,
  RegisterDownloadedModelRequest,
  RegisterDownloadedModelResult,
  RegisterGeneratedModelRequest,
  RegisterGeneratedModelResult,
  SaveModelReferenceRequest,
  SaveModelReferenceResult,
  UpdateModelRecordRequest,
  UpdateModelRecordResult,
} from "../../../contracts/model";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface ModelRegistryPort {
  listModels(request: ListModelsRequest): Promise<ListModelsResult>;
  getModelRecord(workspaceId: WorkspaceId, modelRecordId: string): Promise<ModelInventoryRecord | undefined>;
  saveModelReference(request: SaveModelReferenceRequest): Promise<SaveModelReferenceResult>;
  registerDownloadedModel(request: RegisterDownloadedModelRequest): Promise<RegisterDownloadedModelResult>;
  registerGeneratedModel(request: RegisterGeneratedModelRequest): Promise<RegisterGeneratedModelResult>;
  updateModelRecord(request: UpdateModelRecordRequest): Promise<UpdateModelRecordResult>;
  deleteModelRecord(request: DeleteModelRecordRequest): Promise<DeleteModelRecordResult>;
}
