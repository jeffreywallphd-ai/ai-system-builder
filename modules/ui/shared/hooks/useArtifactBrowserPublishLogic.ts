import { useState } from "react";

import {
  derivePublishedBackingFromDetail,
} from "./artifactBrowserPublishView";

export interface ArtifactBrowserViewState {
  status: "idle" | "loading" | "success" | "error";
  message?: string;
}

export interface PublishedBackingVerificationView {
  exists: boolean;
  verifiedAt?: string;
}

export interface PublishedBackingTargetView {
  provider: string;
  repository: string;
  path: string;
  revision?: string;
  locator?: string;
}

export interface PublishedBackingView {
  target: PublishedBackingTargetView;
  verification: PublishedBackingVerificationView;
}

export interface ArtifactDetailWithPublishedBacking {
  locator: { storageKey: string };
  metadata?: {
    publishedBacking?: PublishedBackingView;
  };
}

interface PublishInput {
  repository: string;
  path: string;
  revision?: string;
  mediaType?: string;
}

export interface ArtifactBrowserPublishClient {
  publishArtifactToHuggingFace: (input: {
    artifactId: string;
    repository: string;
    path: string;
    revision?: string;
    mediaType?: string;
  }) => Promise<PublishedBackingView>;
  verifyPublishedArtifactBacking: (input: {
    artifactId: string;
  }) => Promise<PublishedBackingView>;
}

export interface UseArtifactBrowserPublishLogicDependencies<TDetail extends ArtifactDetailWithPublishedBacking> {
  selectedStorageKey?: string;
  readSelectedArtifactDetail: () => Promise<TDetail | undefined>;
  client: ArtifactBrowserPublishClient;
}

export interface UseArtifactBrowserPublishLogicResult<
  TDetail extends ArtifactDetailWithPublishedBacking = ArtifactDetailWithPublishedBacking,
> {
  publishState: ArtifactBrowserViewState;
  publishedBacking?: PublishedBackingView;
  publishForm: {
    repository: string;
    pathInRepo: string;
    revision: string;
    mediaType: string;
    showPublishForm: boolean;
  };
  setRepository: (value: string) => void;
  setPathInRepo: (value: string) => void;
  setRevision: (value: string) => void;
  setMediaType: (value: string) => void;
  togglePublishForm: () => void;
  publishArtifactToHuggingFace: (input?: PublishInput) => Promise<void>;
  recheckPublishedBacking: () => Promise<void>;
  setPublishedBackingFromDetail: (detail: TDetail | undefined) => void;
}

export function useArtifactBrowserPublishLogic<TDetail extends ArtifactDetailWithPublishedBacking>(
  dependencies: UseArtifactBrowserPublishLogicDependencies<TDetail>,
): UseArtifactBrowserPublishLogicResult<TDetail> {
  const withHuggingFaceAuthGuidance = (message: string): string => {
    const normalized = message.toLowerCase();
    const mentionsAuth = normalized.includes("hugging face")
      && (
        normalized.includes("token")
        || normalized.includes("auth")
        || normalized.includes("401")
        || normalized.includes("403")
        || normalized.includes("access denied")
        || normalized.includes("private")
        || normalized.includes("gated")
      );
    if (!mentionsAuth) {
      return message;
    }

    return `${message} This Hugging Face repository may require an access token. Configure a Hugging Face token in this page's token settings to access private or gated repos.`;
  };

  const [publishState, setPublishState] = useState<ArtifactBrowserViewState>({ status: "idle" });
  const [publishedBacking, setPublishedBacking] = useState<PublishedBackingView | undefined>();
  const [repository, setRepository] = useState("");
  const [pathInRepo, setPathInRepo] = useState("");
  const [revision, setRevision] = useState("main");
  const [mediaType, setMediaType] = useState("");
  const [showPublishForm, setShowPublishForm] = useState(false);

  async function publishArtifactToHuggingFace(input?: PublishInput): Promise<void> {
    if (!dependencies.selectedStorageKey) {
      setPublishState({ status: "error", message: "Select an artifact before publishing." });
      return;
    }

    const nextInput = input ?? {
      repository,
      path: pathInRepo,
      revision,
      mediaType,
    };

    setPublishState({ status: "loading", message: "Publishing to Hugging Face..." });
    try {
      const backing = await dependencies.client.publishArtifactToHuggingFace({
        artifactId: dependencies.selectedStorageKey,
        repository: nextInput.repository,
        path: nextInput.path,
        revision: nextInput.revision,
        mediaType: nextInput.mediaType,
      });
      setPublishedBacking(backing);
      setPublishState({
        status: "success",
        message: "Published artifact backing to Hugging Face.",
      });
      const refreshedDetail = await dependencies.readSelectedArtifactDetail();
      setPublishedBackingFromDetail(refreshedDetail);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to publish artifact.";
      setPublishState({
        status: "error",
        message: withHuggingFaceAuthGuidance(message),
      });
    }
  }

  async function recheckPublishedBacking(): Promise<void> {
    if (!dependencies.selectedStorageKey) {
      setPublishState({ status: "error", message: "Select an artifact before verification." });
      return;
    }

    setPublishState({ status: "loading", message: "Verifying published backing..." });
    try {
      const backing = await dependencies.client.verifyPublishedArtifactBacking({
        artifactId: dependencies.selectedStorageKey,
      });
      setPublishedBacking(backing);
      setPublishState({
        status: "success",
        message: backing.verification.exists
          ? "Published backing verified in remote repository."
          : "Published backing not found in remote repository.",
      });
      const refreshedDetail = await dependencies.readSelectedArtifactDetail();
      setPublishedBackingFromDetail(refreshedDetail);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to verify published backing.";
      setPublishState({
        status: "error",
        message: withHuggingFaceAuthGuidance(message),
      });
    }
  }

  function setPublishedBackingFromDetail(detail: TDetail | undefined): void {
    setPublishedBacking(derivePublishedBackingFromDetail(detail));
  }

  return {
    publishState,
    publishedBacking,
    publishForm: {
      repository,
      pathInRepo,
      revision,
      mediaType,
      showPublishForm,
    },
    setRepository,
    setPathInRepo,
    setRevision,
    setMediaType,
    togglePublishForm: () => setShowPublishForm((current) => !current),
    publishArtifactToHuggingFace,
    recheckPublishedBacking,
    setPublishedBackingFromDetail,
  };
}
