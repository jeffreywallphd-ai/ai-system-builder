import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "../../../modules/testing/node-test";

function readSourceFile(relativePath: string): string {
  return readFileSync(resolve(relativePath), "utf8");
}

describe("artifact browser TypeScript regression guards", () => {
  it("keeps useArtifactSelectionContent state hooks explicitly initialized for React 19 typings", () => {
    const source = readSourceFile(
      "apps/desktop/src/renderer/features/artifact-browser/hooks/useArtifactSelectionContent.ts",
    );

    expect(source).toContain("useState<string | undefined>(undefined)");
    expect(source).toContain("useState<DesktopArtifactDetail | undefined>(undefined)");
    expect(source).toContain("useState<DesktopArtifactContentDescriptor | undefined>(undefined)");
    expect(source).toContain("useRef<string | undefined>(undefined)");
  });

  it("keeps selectedStorageKey destructured in desktop ArtifactBrowserFeature", () => {
    const source = readSourceFile(
      "apps/desktop/src/renderer/features/artifact-browser/components/ArtifactBrowserFeature.tsx",
    );

    expect(source).toContain("selectedStorageKey");
    expect(source).toMatchObject(expect.stringMatching(/const\s*\{\s*[\s\S]*selectedStorageKey[\s\S]*\}\s*=\s*useArtifactBrowserFeature\(client\);/));
  });

  it("keeps publish logic result typed with TDetail for setPublishedBackingFromDetail", () => {
    const source = readSourceFile("modules/ui/shared/hooks/useArtifactBrowserPublishLogic.ts");

    expect(source).toContain("export interface UseArtifactBrowserPublishLogicResult<");
    expect(source).toContain("setPublishedBackingFromDetail: (detail: TDetail | undefined) => void;");
    expect(source).toContain("): UseArtifactBrowserPublishLogicResult<TDetail> {");
  });

  it("keeps artifact-browser filesystem metadata merge guarded with unknown-to-generic narrowing", () => {
    const source = readSourceFile(
      "modules/adapters/storage/filesystem/artifact-store/createFilesystemArtifactBrowserReadAdapter.ts",
    );

    expect(source).toContain("function withPublishedBackingMetadata<TMetadata extends StorageObjectMetadata>(");
    expect(source).toContain("} as unknown as TMetadata;");
    expect(source).toContain("detail.artifact.metadata = withPublishedBackingMetadata(");
  });

  it("keeps desktop artifact IPC failure mapping channel-specific per response contract", () => {
    const source = readSourceFile(
      "modules/adapters/transport/ipc-electron/artifact-browser/registerArtifactBrowserIpc.ts",
    );

    expect(source).toContain("function mapPublishFailure(");
    expect(source).toContain("function mapPublishVerifyFailure(");
    expect(source).toContain("DESKTOP_ARTIFACT_PUBLISH_RESPONSE_CHANNEL");
    expect(source).toContain("DESKTOP_ARTIFACT_PUBLISH_VERIFY_RESPONSE_CHANNEL");
  });

  it("keeps register-from-repo IPC mapper normalizing artifact family before use-case command mapping", () => {
    const source = readSourceFile(
      "modules/adapters/transport/ipc-electron/artifact-browser/registerArtifactBrowserIpc.ts",
    );

    expect(source).toContain("mapDesktopArtifactRegisterFromRepoRequestToCommand");
    expect(source).toContain("normalizeArtifactFamily(request.payload.artifactFamily)");
  });
});
