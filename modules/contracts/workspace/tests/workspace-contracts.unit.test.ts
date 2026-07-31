import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { AssetPackId, AssetPackVersion } from "../../asset";
import { normalizeAssetPackId } from "../../asset";
import {
  ActiveWorkspaceSelection,
  CreateWorkspaceCommand,
  WORKSPACE_ACTOR_KINDS,
  WORKSPACE_MEMBER_STATUSES,
  WORKSPACE_ROLES,
  WORKSPACE_STATUSES,
  WORKSPACE_STORAGE_ROOT_KINDS,
  WORKSPACE_SYSTEM_PACK_ACTIVATION_DIAGNOSTIC_SEVERITIES,
  WORKSPACE_SYSTEM_PACK_ACTIVATION_STATUSES,
  WorkspaceActorReference,
  WorkspaceMemberReference,
  WorkspaceRecord,
  WorkspaceRequestContext,
  WorkspaceStorageRootDescriptor,
  WorkspaceSystemPackActivation,
  createWorkspaceId,
  isWorkspaceId,
  isWorkspaceRole,
  isWorkspaceStatus,
} from "..";
import * as workspaceContracts from "..";

const workspaceId = createWorkspaceId("workspace.alpha-01");
const timestamp = "2026-05-14T00:00:00.000Z";
const SYSTEM_FOUNDATION_PACK_ID = normalizeAssetPackId("system.foundation");
const SYSTEM_FOUNDATION_PACK_VERSION: AssetPackVersion = "1.0.0";

const actor: WorkspaceActorReference = {
  actorKind: "local-user",
  actorId: "local-user-1",
  displayName: "Local User",
};

const systemFoundationActivation: WorkspaceSystemPackActivation = {
  activationId: "activation.system-foundation.1",
  workspaceId,
  packId: SYSTEM_FOUNDATION_PACK_ID,
  packVersion: SYSTEM_FOUNDATION_PACK_VERSION,
  sourceKind: "system",
  sourceLayer: "system-default",
  trustStatus: "system-trusted",
  status: "active",
  activatedAt: timestamp,
  activatedByActorRef: { actorKind: "system", actorId: "system" },
  diagnostics: [
    {
      code: "system-foundation-referenced",
      severity: "info",
      message: "System foundation pack is referenced by id and version.",
    },
  ],
  metadata: {
    referenceOnly: true,
    copiesDefinitions: false,
  },
};

const workspaceRecord: WorkspaceRecord = {
  workspaceId,
  displayName: "Workspace Alpha",
  description: "Contract-only workspace fixture.",
  status: "active",
  createdAt: timestamp,
  updatedAt: timestamp,
  storageRoot: {
    kind: "host-managed",
    storageId: "workspace-alpha-storage",
    label: "Host managed workspace storage",
  },
  ownerActorRef: actor,
  createdByActorRef: actor,
  members: [
    {
      actor,
      role: "owner",
      status: "active",
      addedAt: timestamp,
    },
  ],
  settings: {
    defaultIncludeSystemFoundationAssets: true,
  },
  systemPackActivations: [systemFoundationActivation],
  metadata: {
    contractOnly: true,
  },
};

function assertJsonSerializable(value: unknown): void {
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
}

function serialized(value: unknown): string {
  return JSON.stringify(value).toLowerCase();
}

function assertDoesNotIncludeAny(value: unknown, forbidden: readonly string[]): void {
  const output = serialized(value);

  for (const token of forbidden) {
    assert.equal(output.includes(token.toLowerCase()), false, token);
  }
}

function assertNoForbiddenKeys(
  value: Record<string, unknown>,
  forbiddenKeys: readonly string[],
): void {
  for (const key of forbiddenKeys) {
    assert.equal(key in value, false, key);
  }
}

describe("workspace contracts", () => {
  it("accepts safe workspace ids and normalizes surrounding whitespace", () => {
    for (const valid of [
      "workspace.alpha",
      "workspace-alpha_01",
      "WorkspaceAlpha01",
      "ws.2026-05-14",
    ]) {
      assert.equal(isWorkspaceId(valid), true, valid);
      assert.equal(createWorkspaceId(` ${valid} `), valid);
    }
  });

  it("rejects empty and whitespace-only workspace ids", () => {
    for (const invalid of ["", " ", "\t\n"]) {
      assert.equal(isWorkspaceId(invalid), false, invalid);
      assert.throws(() => createWorkspaceId(invalid));
    }
  });

  it("rejects path-like, URL-like, traversal, drive-letter, control-character, and shell-heavy ids", () => {
    for (const invalid of [
      "/tmp/workspace",
      "./workspace",
      "../workspace",
      "workspace/alpha",
      "workspace\\alpha",
      "C:\\workspace",
      "D:workspace",
      "https://example.test/workspace",
      "file://workspace",
      "workspace..alpha",
      "workspace\u0000alpha",
      "workspace;rm-rf",
      "workspace|alpha",
      "workspace$alpha",
      "workspace[alpha]",
    ]) {
      assert.equal(isWorkspaceId(invalid), false, invalid);
      assert.throws(() => createWorkspaceId(invalid));
    }
  });


  it("throws safe workspace id errors without echoing unsafe input", () => {
    for (const invalid of [
      "/tmp/workspace-secret",
      "https://example.test/workspace?token=SECRET_TOKEN",
      "ghp_1234567890abcdefSECRET",
      "C:\\Users\\Alice\\workspace",
      "workspace\u0000control\u0001heavy",
    ]) {
      try {
        createWorkspaceId(invalid);
        assert.fail(`Expected workspace id to be rejected: ${invalid}`);
      } catch (error) {
        const thrown = error as Error;
        assert.match(thrown.message, /Workspace id must be/);
        assert.doesNotMatch(thrown.message, /Received|\/tmp\/workspace-secret|example\.test|SECRET_TOKEN|ghp_|C:\\|Alice|workspace.*control/);
        assert.equal(thrown.message.includes(invalid), false);
        assert.equal(thrown.stack, undefined);
      }
    }
  });

  it("defines only the intended status and lifecycle vocabulary", () => {
    assert.deepEqual(WORKSPACE_STATUSES, ["active", "archived", "deleting"]);
    assert.equal(isWorkspaceStatus("active"), true);
    assert.equal(isWorkspaceStatus("deleted"), false);
    assert.equal(isWorkspaceStatus("restoring"), false);
  });

  it("defines only placeholder roles and no permission engine", () => {
    assert.deepEqual(WORKSPACE_ROLES, ["owner", "admin", "member"]);
    assert.equal(isWorkspaceRole("owner"), true);
    assert.equal(isWorkspaceRole("viewer"), false);
    assert.equal(isWorkspaceRole("super-admin"), false);
  });

  it("keeps actor refs passive, serializable, and free of auth credential fields", () => {
    assert.deepEqual(WORKSPACE_ACTOR_KINDS, [
      "local-user",
      "system",
      "external-user",
    ]);
    assertJsonSerializable(actor);
    assertNoForbiddenKeys(actor as unknown as Record<string, unknown>, [
      "email",
      "password",
      "token",
      "authToken",
      "sessionId",
      "credential",
    ]);
  });

  it("keeps member refs role/status-only and free of invite/security fields", () => {
    const member: WorkspaceMemberReference = workspaceRecord.members?.[0] as WorkspaceMemberReference;

    assert.deepEqual(WORKSPACE_MEMBER_STATUSES, ["active", "removed"]);
    assert.equal(member.role, "owner");
    assert.equal(member.status, "active");
    assertJsonSerializable(member);
    assertNoForbiddenKeys(member as unknown as Record<string, unknown>, [
      "inviteId",
      "inviteUrl",
      "inviteToken",
      "invitationToken",
      "permissionPolicy",
      "acl",
      "syncState",
      "remoteAuth",
    ]);
  });

  it("keeps storage root descriptor shape path-free", () => {
    const descriptor: WorkspaceStorageRootDescriptor = workspaceRecord.storageRoot as WorkspaceStorageRootDescriptor;

    assert.deepEqual(WORKSPACE_STORAGE_ROOT_KINDS, [
      "host-managed",
      "custom-local",
    ]);
    assert.deepEqual(Object.keys(descriptor).sort(), ["kind", "label", "storageId"]);
    assertNoForbiddenKeys(descriptor as unknown as Record<string, unknown>, [
      "path",
      "absolutePath",
      "rootPath",
      "directory",
      "dir",
      "localPath",
      "filesystemPath",
      "uri",
      "url",
    ]);
    assertDoesNotIncludeAny(descriptor, ["/tmp", "c:\\", "file://", "\\", "/"]);
    assert.doesNotMatch(descriptor.storageId ?? "", /[\\/]|^[a-zA-Z]:|file:\/\//);
    assert.doesNotMatch(descriptor.label ?? "", /[\\/]|^[a-zA-Z]:|file:\/\//);
  });

  it("does not export adapter-local workspace path helpers from contracts", () => {
    const exportedSymbols = Object.keys(workspaceContracts);

    for (const forbidden of [
      "resolveWorkspaceIndexFile",
      "resolveActiveWorkspaceSelectionFile",
      "resolveWorkspaceRecordFile",
      "resolveWorkspaceSystemPackActivationsFile",
      "resolveWorkspaceDirectory",
      "localWorkspacePersistencePaths",
    ]) {
      assert.equal(exportedSymbols.includes(forbidden), false, forbidden);
    }

    const contractIndex = readFileSync(join(process.cwd(), "modules/contracts/workspace/index.ts"), "utf8");
    assert.doesNotMatch(contractIndex, /localWorkspacePersistencePaths|resolveWorkspace.*File|node:path/);
  });

  it("can represent system.foundation@1.0.0 as a workspace system pack activation by reference", () => {
    assert.equal(systemFoundationActivation.packId, "system.foundation");
    assert.equal(systemFoundationActivation.packVersion, "1.0.0");
    assert.equal(systemFoundationActivation.sourceKind, "system");
    assert.equal(systemFoundationActivation.sourceLayer, "system-default");
    assert.equal(systemFoundationActivation.trustStatus, "system-trusted");
    assert.deepEqual(WORKSPACE_SYSTEM_PACK_ACTIVATION_STATUSES, [
      "active",
      "inactive",
      "failed",
    ]);
  });

  it("does not embed system pack manifests, assets, definitions, or install behavior in activation records", () => {
    assertNoForbiddenKeys(
      systemFoundationActivation as unknown as Record<string, unknown>,
      [
        "manifest",
        "assets",
        "definitions",
        "assetDefinitions",
        "entries",
        "overrideRules",
        "installStatus",
        "installedAt",
        "seededDefinitions",
      ],
    );
    assertDoesNotIncludeAny(systemFoundationActivation, [
      "definitionid",
      "assettype",
      "assetfamily",
      "resourcebytes",
      "executioncode",
    ]);
  });

  it("keeps activation diagnostics safe in fixtures", () => {
    assert.deepEqual(WORKSPACE_SYSTEM_PACK_ACTIVATION_DIAGNOSTIC_SEVERITIES, [
      "info",
      "warning",
      "error",
    ]);
    assertDoesNotIncludeAny(systemFoundationActivation.diagnostics, [
      "/tmp",
      "c:\\",
      "stack",
      "error:",
      "token",
      "secret",
      "providerpayload",
      "bytes",
      "base64",
      "data:",
      "process.env",
      "resourcecontent",
      "npm ",
      "bash ",
    ]);
  });

  it("defines a serializable workspace record with required identity, display name, status, and timestamps", () => {
    assert.equal(workspaceRecord.workspaceId, workspaceId);
    assert.equal(workspaceRecord.displayName, "Workspace Alpha");
    assert.equal(workspaceRecord.status, "active");
    assert.equal(workspaceRecord.createdAt, timestamp);
    assert.equal(workspaceRecord.updatedAt, timestamp);
    assertJsonSerializable(workspaceRecord);
  });

  it("keeps workspace records free of embedded resource and asset definition records", () => {
    assertNoForbiddenKeys(workspaceRecord as unknown as Record<string, unknown>, [
      "artifacts",
      "artifactRecords",
      "images",
      "imageRecords",
      "models",
      "modelRecords",
      "datasets",
      "datasetRecords",
      "resources",
      "resourceRecords",
      "assetDefinitions",
      "definitions",
      "credentials",
      "secrets",
      "permissionEngine",
    ]);
  });

  it("allows create workspace commands to request later system foundation activation without pack payloads", () => {
    const command: CreateWorkspaceCommand = {
      displayName: "Workspace Alpha",
      description: "Create command fixture.",
      includeSystemFoundationAssets: true,
      ownerActorRef: actor,
      createdByActorRef: actor,
      initialSettings: {
        defaultIncludeSystemFoundationAssets: true,
      },
    };

    assert.equal(command.includeSystemFoundationAssets, true);
    assertJsonSerializable(command);
    assertNoForbiddenKeys(command as unknown as Record<string, unknown>, [
      "workspaceId",
      "path",
      "absolutePath",
      "storagePath",
      "manifest",
      "packManifest",
      "assets",
      "definitions",
      "members",
      "inviteToken",
    ]);
  });

  it("allows empty active workspace selection", () => {
    const selection: ActiveWorkspaceSelection = {};

    assert.deepEqual(selection, {});
    assertJsonSerializable(selection);
  });

  it("allows active workspace selection to reference a valid workspace id without granting authorization", () => {
    const selection: ActiveWorkspaceSelection = {
      workspaceId,
      selectedAt: timestamp,
    };

    assert.equal(isWorkspaceId(selection.workspaceId), true);
    assertJsonSerializable(selection);
    assertNoForbiddenKeys(selection as unknown as Record<string, unknown>, [
      "authorized",
      "role",
      "token",
      "session",
      "globalState",
    ]);
  });

  it("requires request context fixtures to carry an explicit valid workspace id", () => {
    const context: WorkspaceRequestContext = { workspaceId };

    assert.equal(isWorkspaceId(context.workspaceId), true);
    assertJsonSerializable(context);
    assert.throws(() => createWorkspaceId("../not-a-workspace"));
  });

  it("keeps the combined contract fixture JSON-serializable", () => {
    assertJsonSerializable({
      workspaceRecord,
      command: {
        displayName: "Workspace Alpha",
        includeSystemFoundationAssets: true,
      } satisfies CreateWorkspaceCommand,
      selection: { workspaceId, selectedAt: timestamp } satisfies ActiveWorkspaceSelection,
      context: { workspaceId } satisfies WorkspaceRequestContext,
    });
  });

  it("exports the expected workspace contract symbols from the family barrel", () => {
    for (const symbol of [
      "WORKSPACE_ID_MAX_LENGTH",
      "WORKSPACE_STATUSES",
      "WORKSPACE_ROLES",
      "WORKSPACE_ACTOR_KINDS",
      "WORKSPACE_MEMBER_STATUSES",
      "WORKSPACE_STORAGE_ROOT_KINDS",
      "WORKSPACE_SYSTEM_PACK_ACTIVATION_STATUSES",
      "WORKSPACE_SYSTEM_PACK_ACTIVATION_DIAGNOSTIC_SEVERITIES",
      "createWorkspaceId",
      "isWorkspaceId",
      "isWorkspaceStatus",
      "isWorkspaceRole",
      "isWorkspaceActorKind",
      "isWorkspaceMemberStatus",
      "isWorkspaceStorageRootKind",
      "isWorkspaceSystemPackActivationStatus",
    ]) {
      assert.equal(symbol in workspaceContracts, true, symbol);
    }
  });

  it("does not introduce permission, invite, sync, sharing, remote-auth, or runtime collaboration contracts", () => {
    const exportedSymbols = Object.keys(workspaceContracts).join(" ").toLowerCase();

    for (const forbidden of [
      "permissionengine",
      "permissionpolicy",
      "acl",
      "invite",
      "invitation",
      "sharing",
      "sync",
      "remoteauth",
      "session",
      "organization",
      "teamadmin",
      "realtimecollaboration",
    ]) {
      assert.equal(exportedSymbols.includes(forbidden), false, forbidden);
    }
  });

  it("keeps activation pack identity typed as asset pack id and version contracts", () => {
    const packId: AssetPackId = systemFoundationActivation.packId;
    const packVersion: AssetPackVersion = systemFoundationActivation.packVersion;

    assert.equal(packId, SYSTEM_FOUNDATION_PACK_ID);
    assert.equal(packVersion, SYSTEM_FOUNDATION_PACK_VERSION);
  });
});
