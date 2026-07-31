import type { ModelFileListItem } from "../../../contracts/model";

export interface ModelFileListerPort {
  listFiles(localPath: string): Promise<{
    files: ModelFileListItem[];
    truncated: boolean;
  }>;
}
