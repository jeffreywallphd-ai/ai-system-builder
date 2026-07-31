import path from "node:path";

export interface DesktopModelPathShell {
  showItemInFolder(localPath: string): void;
}

export function createRevealModelPath(
  desktopShell: DesktopModelPathShell,
): (localPath: string) => void {
  return (localPath) => {
    if (!path.isAbsolute(localPath)) {
      throw new Error("Model location must be an absolute host path.");
    }

    desktopShell.showItemInFolder(path.normalize(localPath));
  };
}
