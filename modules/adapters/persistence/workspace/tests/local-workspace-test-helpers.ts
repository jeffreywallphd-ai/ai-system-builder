import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { normalizeAssetPackId, type AssetPackVersion } from "../../../../contracts/asset";
import {
  createWorkspaceId,
  type WorkspaceId,
  type WorkspaceRecord,
  type WorkspaceSystemPackActivation,
} from "../../../../contracts/workspace";

export async function makeTempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ai-system-builder-workspace-persistence-"));
}

export function makeWorkspaceRecord(overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    workspaceId: createWorkspaceId("workspace.alpha"),
    displayName: "Workspace Alpha",
    status: "active",
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:00.000Z",
    ...overrides,
  };
}

export function makeSystemFoundationActivation(
  workspaceId: WorkspaceId = createWorkspaceId("workspace.alpha"),
  overrides: Partial<WorkspaceSystemPackActivation> = {},
): WorkspaceSystemPackActivation {
  return {
    activationId: "activation.system-foundation.1",
    workspaceId,
    packId: normalizeAssetPackId("system.foundation"),
    packVersion: "1.0.0" as AssetPackVersion,
    sourceKind: "system",
    sourceLayer: "system-default",
    trustStatus: "system-trusted",
    status: "active",
    activatedAt: "2026-05-14T00:00:00.000Z",
    ...overrides,
  };
}

export function errorText(error: unknown): string {
  const candidate = error as { message?: string; stack?: string; code?: string };
  return `${candidate.code ?? ""} ${candidate.message ?? ""} ${candidate.stack ?? ""}`;
}

export function assertSanitizedErrorText(text: string, rootDirectory: string): void {
  if (text.includes(rootDirectory)) {
    throw new Error("Error text leaked the temporary root directory.");
  }
  for (const forbidden of ["{\"", "at ", "node:internal", "SECRET_TOKEN", "curl ", "../../"]) {
    if (text.includes(forbidden)) {
      throw new Error(`Error text leaked forbidden diagnostic content: ${forbidden}`);
    }
  }
}
