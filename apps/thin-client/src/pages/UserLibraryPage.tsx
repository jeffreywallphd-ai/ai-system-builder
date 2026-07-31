import { UserLibraryFeature } from '../features/user-library/components/UserLibraryFeature';
export function UserLibraryPage({ workspaceId }: { workspaceId: string; workspaceName: string }) { return <UserLibraryFeature workspaceId={workspaceId} />; }
