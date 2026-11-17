import path from "node:path";

export interface DesktopModelPathShell {
  showItemInFolder(localPath: string): void;
}

export function createRevealModelPath(
  desktopShell: DesktopModelPathShell,
): (localPath: string) => void {
  return (localPath) => {
    if (!path.isAbsolute(localPath) || /^[\\/]{2}/.test(localPath) || /[\u0000-\u001f]/.test(localPath) || (process.platform === "win32" && (!/^[A-Za-z]:[\\/]/.test(localPath) || localPath.slice(2).includes(":")))) {
      throw new Error("Model location must be an absolute host path.");
    }

    desktopShell.showItemInFolder(path.normalize(localPath));
  };
}
