import { useCallback, useEffect, useRef, useState } from "react";

import type { ArtifactBrowserViewState } from "../../../../../../../modules/ui/shared";
import type {
  DesktopArtifactContentDescriptor,
  DesktopArtifactDetail,
} from "../../../lib/desktopApi";
import type { DesktopArtifactBrowserClient } from "../api/desktopArtifactBrowserClient";
import { decodeHtmlArtifactPreview } from "../helpers/htmlArtifactPreview";

export interface UseArtifactSelectionContentResult {
  selectedStorageKey?: string;
  detail?: DesktopArtifactDetail;
  content?: DesktopArtifactContentDescriptor;
  imageViewUrl?: string;
  htmlPreview?: string;
  selectArtifact: (storageKey: string) => Promise<void>;
  clearSelectedArtifact: () => void;
}

export function useArtifactSelectionContent(
  client: DesktopArtifactBrowserClient,
  setViewState: (value: ArtifactBrowserViewState) => void
): UseArtifactSelectionContentResult {
  const [selectedStorageKey, setSelectedStorageKey] = useState<string | undefined>(undefined);
  const [detail, setDetail] = useState<DesktopArtifactDetail | undefined>(undefined);
  const [content, setContent] = useState<DesktopArtifactContentDescriptor | undefined>(undefined);
  const [imageViewUrl, setImageViewUrl] = useState<string | undefined>(undefined);
  const [htmlPreview, setHtmlPreview] = useState<string | undefined>(undefined);
  const activeImageViewUrl = useRef<string | undefined>(undefined);

  const revokeObjectUrl = useCallback((url: string) => {
    if (typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(url);
    }
  }, []);

  const setManagedImageViewUrl = useCallback((nextUrl?: string) => {
    if (activeImageViewUrl.current && activeImageViewUrl.current !== nextUrl) {
      revokeObjectUrl(activeImageViewUrl.current);
    }
    activeImageViewUrl.current = nextUrl;
    setImageViewUrl(nextUrl);
  }, [revokeObjectUrl]);

  const clearSelectedArtifact = useCallback(() => {
    setSelectedStorageKey(undefined);
    setDetail(undefined);
    setContent(undefined);
    setManagedImageViewUrl(undefined);
    setHtmlPreview(undefined);
  }, [setManagedImageViewUrl]);

  const selectArtifact = useCallback(async (storageKey: string) => {
    setSelectedStorageKey(storageKey);
    setViewState({ status: "loading", message: `Loading ${storageKey}...` });

    try {
      const locator = { storageKey };
      const artifactDetail = await client.readArtifactDetail(locator);

      setDetail(artifactDetail);

      try {
        const contentDescriptor = await client.readArtifactContent(locator);
        setContent(contentDescriptor);
        setHtmlPreview(undefined);

        if (contentDescriptor.mediaType?.startsWith("image/")) {
          try {
            const nextImageViewUrl = await client.createArtifactMediaViewUrl(locator);
            setManagedImageViewUrl(nextImageViewUrl);
          } catch {
            setManagedImageViewUrl(undefined);
          }
        } else {
          setManagedImageViewUrl(undefined);
          if (contentDescriptor.availability === "available" && contentDescriptor.mediaType === "text/html") {
            try {
              const media = await client.readArtifactMedia(locator);
              setHtmlPreview(decodeHtmlArtifactPreview(media.bytes));
            } catch {
              setHtmlPreview(undefined);
            }
          }
        }
      } catch {
        setContent({ locator, availability: "unavailable", retrieval: "deferred" });
        setManagedImageViewUrl(undefined);
        setHtmlPreview(undefined);
      }

      setViewState({ status: "success", message: `Loaded ${storageKey}.` });
    } catch (error) {
      clearSelectedArtifact();
      setViewState({
        status: "error",
        message: error instanceof Error ? error.message : "Failed to load artifact detail.",
      });
    }
  }, [clearSelectedArtifact, client, setManagedImageViewUrl, setViewState]);

  useEffect(() => () => {
    if (activeImageViewUrl.current) {
      revokeObjectUrl(activeImageViewUrl.current);
      activeImageViewUrl.current = undefined;
    }
  }, [revokeObjectUrl]);

  return {
    selectedStorageKey,
    detail,
    content,
    imageViewUrl,
    htmlPreview,
    selectArtifact,
    clearSelectedArtifact,
  };
}
