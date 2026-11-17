export interface ModelLocationRevealerPort {
  revealModelLocation(input: { workspaceId: string; modelRecordId: string }): Promise<void>;
}
