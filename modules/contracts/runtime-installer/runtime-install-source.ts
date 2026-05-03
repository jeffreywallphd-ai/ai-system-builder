export interface RuntimeInstallGitSource {
  type: "git";
  repositoryUrl: string;
  ref?: string;
}

export type RuntimeInstallSource = RuntimeInstallGitSource;
