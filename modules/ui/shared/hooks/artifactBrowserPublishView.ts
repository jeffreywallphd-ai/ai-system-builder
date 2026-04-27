import type {
  ArtifactDetailWithPublishedBacking,
  PublishedBackingView,
} from "./useArtifactBrowserPublishLogic";

export type PublishedBackingVerificationState =
  | "never-verified"
  | "verified-exists"
  | "verified-missing";

export interface PublishedBackingVerificationPresentation {
  state: PublishedBackingVerificationState;
  statusLabel: string;
  lastCheckedLabel: string;
}

export interface PublishedBackingDisplayRow {
  label: string;
  value: string;
}

export function derivePublishedBackingFromDetail(
  detail: ArtifactDetailWithPublishedBacking | undefined,
): PublishedBackingView | undefined {
  return detail?.metadata?.publishedBacking;
}

export function derivePublishedBackingVerificationPresentation(
  backing: PublishedBackingView | undefined,
): PublishedBackingVerificationPresentation {
  if (!backing || !backing.verification.verifiedAt) {
    return {
      state: "never-verified",
      statusLabel: "Not yet verified",
      lastCheckedLabel: "Last checked: never",
    };
  }

  if (backing.verification.exists) {
    return {
      state: "verified-exists",
      statusLabel: "Remote backing verified",
      lastCheckedLabel: `Last checked: ${backing.verification.verifiedAt}`,
    };
  }

  return {
    state: "verified-missing",
    statusLabel: "Remote backing missing",
    lastCheckedLabel: `Last checked: ${backing.verification.verifiedAt}`,
  };
}

export function derivePublishedBackingDisplayRows(
  backing: PublishedBackingView,
): PublishedBackingDisplayRow[] {
  return [
    { label: "Provider", value: backing.target.provider },
    { label: "Repo", value: backing.target.repository },
    { label: "Path", value: backing.target.path },
    { label: "Revision", value: backing.target.revision ?? "main" },
  ];
}
