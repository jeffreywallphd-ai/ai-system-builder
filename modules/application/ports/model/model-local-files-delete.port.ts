export interface ModelLocalFilesDeletePort {
  deleteLocalModelFiles(input: {
    localPath: string;
    relativeFilePath?: string;
  }): Promise<{ deleted: boolean }>;
}
