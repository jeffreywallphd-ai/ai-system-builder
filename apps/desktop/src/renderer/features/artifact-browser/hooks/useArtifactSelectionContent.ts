import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  ARTIFACT_PREVIEW_MAX_BYTES,
  ARTIFACT_PDF_PREVIEW_MAX_BYTES,
  createIdleArtifactPreview,
  createCompressedImagePreviewObjectUrl,
  createLoadingArtifactPreview,
  createMediaArtifactPreview,
  createPdfFirstPagePreviewObjectUrl,
  createTextArtifactPreview,
  createUnavailableArtifactPreview,
  createUnsupportedArtifactPreview,
  describeArtifactPreview,
  isMediaArtifactPreviewKind,
  isTextArtifactPreviewKind,
  type ArtifactBrowserViewState,
  type ArtifactPreviewSource,
  type ArtifactPreviewView,
} from "../../../../../../../modules/ui/shared";
import type {
  DesktopArtifactContentDescriptor,
  DesktopArtifactDetail,
} from "../../../lib/desktopApi";
import type { DesktopArtifactBrowserClient } from "../api/desktopArtifactBrowserClient";
import { recordRendererMemorySnapshot } from "../../../diagnostics/rendererMemoryDiagnostics";

const ARTIFACT_MEDIA_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

export interface UseArtifactSelectionContentResult {
  selectedStorageKey?: string;
  detail?: DesktopArtifactDetail;
  content?: DesktopArtifactContentDescriptor;
  imageViewUrl?: string;
  htmlPreview?: string;
  artifactPreview: ArtifactPreviewView;
  selectArtifact: (storageKey: string) => Promise<void>;
  clearSelectedArtifact: () => void;
  captureSelectionClear: (storageKey: string) => () => void;
}

export function useArtifactSelectionContent(
  client: DesktopArtifactBrowserClient,
  setViewState: (value: ArtifactBrowserViewState) => void,
  workspaceId?: string,
): UseArtifactSelectionContentResult {
  const scope = useMemo(() => ({ lease: undefined as object | undefined, selection: 0, storageKey: undefined as string | undefined }), [client, workspaceId]);
  const [selectedStorageKey, setSelectedStorageKey] = useState<
    string | undefined
  >(undefined);
  const [detail, setDetail] = useState<DesktopArtifactDetail | undefined>(
    undefined,
  );
  const [content, setContent] = useState<
    DesktopArtifactContentDescriptor | undefined
  >(undefined);
  const [imageViewUrl, setImageViewUrl] = useState<string | undefined>(
    undefined,
  );
  const [htmlPreview, setHtmlPreview] = useState<string | undefined>(undefined);
  const [artifactPreview, setArtifactPreview] = useState<ArtifactPreviewView>(
    () => createIdleArtifactPreview(),
  );
  const activePreviewMediaUrl = useRef<string | undefined>(undefined);

  const revokeObjectUrl = useCallback((url: string) => {
    if (typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(url);
      recordRendererMemorySnapshot({
        milestone: "renderer.preview.object-url.revoked",
        component: "desktop-renderer-preview-cleanup",
        detail: {
          pageKey: "artifacts",
          sectionKey: "artifact-browser.preview",
          reason: "page-unmount",
        },
      });
    }
  }, []);

  const setManagedPreviewMediaUrl = useCallback(
    (nextUrl?: string) => {
      if (
        activePreviewMediaUrl.current &&
        activePreviewMediaUrl.current !== nextUrl
      ) {
        revokeObjectUrl(activePreviewMediaUrl.current);
      }
      activePreviewMediaUrl.current = nextUrl;
      setImageViewUrl(nextUrl);
    },
    [revokeObjectUrl],
  );

  const clearSelectedArtifact = useCallback(() => {
    scope.selection++;
    scope.storageKey = undefined;
    setSelectedStorageKey(undefined);
    setDetail(undefined);
    setContent(undefined);
    setManagedPreviewMediaUrl(undefined);
    setHtmlPreview(undefined);
    setArtifactPreview(createIdleArtifactPreview());
  }, [scope, setManagedPreviewMediaUrl]);

  const captureSelectionClear = useCallback((storageKey: string) => {
    const lease = scope.lease, selection = scope.selection;
    return () => {
      if (lease && scope.lease === lease && scope.selection === selection && scope.storageKey === storageKey) {
        clearSelectedArtifact();
      }
    };
  }, [clearSelectedArtifact, scope]);

  const createPreviewSource = useCallback(
    (
      artifactDetail: DesktopArtifactDetail,
      contentDescriptor?: DesktopArtifactContentDescriptor,
    ): ArtifactPreviewSource => ({
      storageKey: artifactDetail.locator.storageKey,
      originalName: artifactDetail.originalName,
      mediaType: contentDescriptor?.mediaType ?? artifactDetail.mediaType,
      artifactFamily: artifactDetail.artifactFamily,
    }),
    [],
  );

  const selectArtifact = useCallback(
    async (storageKey: string) => {
      const lease = scope.lease;
      if (!lease) return;
      const request = ++scope.selection;
      scope.storageKey = storageKey;
      const current = () => scope.lease === lease && scope.selection === request;
      setSelectedStorageKey(storageKey);
      setArtifactPreview(createLoadingArtifactPreview({ storageKey }));
      setViewState({ status: "loading", message: `Loading ${storageKey}...` });

      try {
        const locator = { storageKey };
        const artifactDetail = await client.readArtifactDetail(locator, {
          workspaceId,
        });
        if (!current()) return;

        setDetail(artifactDetail);

        try {
          const contentDescriptor = await client.readArtifactContent(locator, {
            workspaceId,
          });
          if (!current()) return;
          setContent(contentDescriptor);
          setHtmlPreview(undefined);
          const previewSource = createPreviewSource(
            artifactDetail,
            contentDescriptor,
          );
          const previewDescriptor = describeArtifactPreview(previewSource);

          if (contentDescriptor.availability !== "available") {
            setManagedPreviewMediaUrl(undefined);
            setArtifactPreview(createUnavailableArtifactPreview(previewSource));
          } else if (isMediaArtifactPreviewKind(previewDescriptor.kind)) {
            try {
              if (previewDescriptor.kind === "image") {
                try {
                  const media = await client.readArtifactMedia(locator, {
                    workspaceId,
                    maximumBytes: ARTIFACT_MEDIA_PREVIEW_MAX_BYTES,
                  });
                  if (!current()) return;
                  const nextPreviewMediaUrl =
                    await createCompressedImagePreviewObjectUrl(
                      media.bytes,
                      media.mediaType ?? previewSource.mediaType,
                    );
                  if (!current()) { revokeObjectUrl(nextPreviewMediaUrl); return; }
                  setManagedPreviewMediaUrl(nextPreviewMediaUrl);
                  setArtifactPreview(
                    createMediaArtifactPreview(
                      {
                        ...previewSource,
                        mediaType: media.mediaType ?? previewSource.mediaType,
                      },
                      nextPreviewMediaUrl,
                    ),
                  );
                } catch {
                  if (!current()) return;
                  const fallbackPreviewMediaUrl =
                    await client.createArtifactMediaViewUrl(locator, {
                      workspaceId,
                      maximumBytes: ARTIFACT_MEDIA_PREVIEW_MAX_BYTES,
                    });
                  if (!current()) { revokeObjectUrl(fallbackPreviewMediaUrl); return; }
                  setManagedPreviewMediaUrl(fallbackPreviewMediaUrl);
                  setArtifactPreview(
                    createMediaArtifactPreview(
                      previewSource,
                      fallbackPreviewMediaUrl,
                    ),
                  );
                }
              } else if (previewDescriptor.kind === "pdf") {
                const media = await client.readArtifactMedia(locator, {
                  workspaceId,
                  maximumBytes: ARTIFACT_PDF_PREVIEW_MAX_BYTES,
                });
                if (!current()) return;
                const nextPreviewMediaUrl =
                  await createPdfFirstPagePreviewObjectUrl(media.bytes);
                if (!current()) { revokeObjectUrl(nextPreviewMediaUrl); return; }
                setManagedPreviewMediaUrl(nextPreviewMediaUrl);
                setArtifactPreview(
                  createMediaArtifactPreview(
                    {
                      ...previewSource,
                      mediaType: "application/pdf",
                    },
                    nextPreviewMediaUrl,
                  ),
                );
              } else {
                const nextPreviewMediaUrl =
                  await client.createArtifactMediaViewUrl(locator, {
                    workspaceId,
                    maximumBytes: ARTIFACT_MEDIA_PREVIEW_MAX_BYTES,
                  });
                if (!current()) { revokeObjectUrl(nextPreviewMediaUrl); return; }
                setManagedPreviewMediaUrl(nextPreviewMediaUrl);
                setArtifactPreview(
                  createMediaArtifactPreview(
                    previewSource,
                    nextPreviewMediaUrl,
                  ),
                );
              }
            } catch {
              if (!current()) return;
              setManagedPreviewMediaUrl(undefined);
              setArtifactPreview(
                createUnavailableArtifactPreview(
                  previewSource,
                  "Preview could not be prepared for this artifact.",
                ),
              );
            }
          } else if (isTextArtifactPreviewKind(previewDescriptor.kind)) {
            setManagedPreviewMediaUrl(undefined);
            try {
              const media = await client.readArtifactMedia(locator, {
                workspaceId,
                maximumBytes: ARTIFACT_PREVIEW_MAX_BYTES,
              });
              if (!current()) return;
              const nextPreview = createTextArtifactPreview(
                {
                  ...previewSource,
                  mediaType: media.mediaType ?? previewSource.mediaType,
                },
                media.bytes,
              );
              setArtifactPreview(nextPreview);
              setHtmlPreview(nextPreview.text);
            } catch {
              if (!current()) return;
              setArtifactPreview(
                createUnavailableArtifactPreview(
                  previewSource,
                  "Preview text could not be prepared for this artifact.",
                ),
              );
            }
          } else {
            setManagedPreviewMediaUrl(undefined);
            setArtifactPreview(createUnsupportedArtifactPreview(previewSource));
          }
        } catch {
          if (!current()) return;
          setContent({
            locator,
            availability: "unavailable",
            retrieval: "deferred",
          });
          setManagedPreviewMediaUrl(undefined);
          setHtmlPreview(undefined);
          setArtifactPreview(createUnavailableArtifactPreview({ storageKey }));
        }

        if (current()) setViewState({ status: "success" });
      } catch (error) {
        if (!current()) return;
        clearSelectedArtifact();
        setViewState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Failed to load artifact detail.",
        });
      }
    },
    [
      clearSelectedArtifact,
      client,
      createPreviewSource,
      setManagedPreviewMediaUrl,
      setViewState,
      revokeObjectUrl,
      scope,
      workspaceId,
    ],
  );

  useLayoutEffect(() => {
    const lease = {}; scope.lease = lease;
    clearSelectedArtifact();
    return () => { if (scope.lease === lease) scope.lease = undefined; };
  }, [clearSelectedArtifact, scope]);

  useLayoutEffect(
    () => () => {
      if (activePreviewMediaUrl.current) {
        revokeObjectUrl(activePreviewMediaUrl.current);
        activePreviewMediaUrl.current = undefined;
      }
    },
    [revokeObjectUrl],
  );

  return {
    selectedStorageKey,
    detail,
    content,
    imageViewUrl,
    htmlPreview,
    artifactPreview,
    selectArtifact,
    clearSelectedArtifact,
    captureSelectionClear,
  };
}
