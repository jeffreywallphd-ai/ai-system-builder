import type { WorkspaceId } from "../../../contracts/workspace";

/** Resource authority at the application boundary, independently of transport admission. */
export interface WorkspaceAssetAccessPort {
  authorize(workspaceId: WorkspaceId, operation: string, scope: "asset:read" | "asset:write"): Promise<void>;
}
