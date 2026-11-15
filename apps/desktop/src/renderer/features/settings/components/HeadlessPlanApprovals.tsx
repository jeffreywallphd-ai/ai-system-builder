import type { WorkspaceId } from "../../../../../../../modules/contracts/workspace";
import { HeadlessPlanApprovalDialog, type HeadlessPlanApprovalClient } from "../../../../../../../modules/ui/shared/headless/HeadlessPlanApprovalDialog";
import { getDesktopApi } from "../../../lib/desktopApi";

const client: HeadlessPlanApprovalClient = {
  list: workspaceId => getDesktopApi().listHeadlessPlanApprovals?.(workspaceId),
  open: selection => getDesktopApi().openHeadlessPlanApproval?.(selection),
  decide: decision => getDesktopApi().decideHeadlessPlanApproval?.(decision),
  dismiss: viewId => getDesktopApi().dismissHeadlessPlanApproval?.(viewId),
};

export function HeadlessPlanApprovals({ workspaceId, workspaceName }: {
  readonly workspaceId: WorkspaceId;
  readonly workspaceName: string;
}) {
  return <HeadlessPlanApprovalDialog workspaceId={workspaceId} workspaceName={workspaceName} client={client} />;
}
