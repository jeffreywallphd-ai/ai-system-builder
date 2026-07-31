export interface ModelLocationRevealerPort {
  revealPath(localPath: string): Promise<void>;
}
