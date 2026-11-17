export interface ModelLocalFilesDeletePort {
  deleteLocalModelFiles(input: { workspaceId: string; modelRecordId: string }): Promise<{ deleted: boolean }>;
}

export class ModelLocalFileEffectsUnavailableError extends Error {
  public readonly code = "unavailable";
  public constructor() {
    super("Model file actions are unavailable pending host qualification. Remove the record only, or manage its files using your file manager.");
    this.name = "ModelLocalFileEffectsUnavailableError";
  }
}
