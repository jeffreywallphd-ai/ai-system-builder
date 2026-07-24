import type {
  ArchiveSystemBuilderSystemUseCase,
  CloneSystemBuilderSystemUseCase,
  CreateSystemBuilderSystemUseCase,
  CreateSystemBuilderFromTemplateUseCase,
  ListSystemBuilderRevisionsUseCase,
  ListSystemBuilderSystemsUseCase,
  ListSystemBuilderManagementUseCase,
  ListSystemBuilderTemplatesUseCase,
  ListSystemBuilderComposerAssetsUseCase,
  ReadSystemBuilderRevisionUseCase,
  ReadSystemBuilderSystemUseCase,
  RenameSystemBuilderSystemUseCase,
  RestoreSystemBuilderSystemUseCase,
  SaveSystemBuilderRevisionUseCase,
  PreviewSystemBuilderLayoutChangeUseCase,
  PreviewSystemBuilderFoundationUpgradeUseCase,
  UpgradeSystemBuilderFoundationUseCase,
} from "../../../../application/use-cases/system-builder";
import {
  API_SYSTEM_BUILDER_OPERATIONS,
  createApiError,
  createApiFailureResponse,
  createApiSuccessResponse,
} from "../../../../contracts/api";
import type {
  ChangeSystemBuilderArchiveStateCommand,
  CloneSystemBuilderSystemCommand,
  CreateSystemBuilderSystemCommand,
  RenameSystemBuilderSystemCommand,
  SaveSystemBuilderRevisionCommand,
  CreateSystemBuilderFromTemplateCommand,
  ListSystemBuilderManagementQuery,
  PreviewSystemBuilderLayoutChangeCommand,
  PreviewSystemBuilderFoundationUpgradeCommand,
  UpgradeSystemBuilderFoundationCommand,
} from "../../../../contracts/system-builder";
import {
  normalizeSystemBuilderRevisionId,
  normalizeSystemBuilderSystemId,
  normalizeSystemBuilderTemplateId,
} from "../../../../contracts/system-builder";
import {
  SYSTEM_BUILDER_MANAGEMENT_SORTS,
  SYSTEM_BUILDER_MANAGEMENT_VIEWS,
} from "../../../../contracts/system-builder";
import {
  normalizeAssetId,
  normalizeAssetSlotId,
} from "../../../../contracts/asset";
import { createWorkspaceId } from "../../../../contracts/workspace";

interface RequestLike {
  body?: unknown;
  query?: Record<string, unknown>;
  securityContext?: { principal?: { id?: string } };
}
interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): void;
}
export interface SystemBuilderExpressPort {
  get(
    path: string,
    handler: (request: RequestLike, response: ResponseLike) => Promise<void>,
  ): void;
  post(
    path: string,
    handler: (request: RequestLike, response: ResponseLike) => Promise<void>,
  ): void;
}
export interface RegisterSystemBuilderApiRoutesDependencies {
  app: SystemBuilderExpressPort;
  create: Pick<CreateSystemBuilderSystemUseCase, "execute">;
  list: Pick<ListSystemBuilderSystemsUseCase, "execute">;
  listManagement: Pick<ListSystemBuilderManagementUseCase, "execute">;
  listTemplates: Pick<ListSystemBuilderTemplatesUseCase, "execute">;
  createFromTemplate: Pick<CreateSystemBuilderFromTemplateUseCase, "execute">;
  read: Pick<ReadSystemBuilderSystemUseCase, "execute">;
  rename: Pick<RenameSystemBuilderSystemUseCase, "execute">;
  archive: Pick<ArchiveSystemBuilderSystemUseCase, "execute">;
  restore: Pick<RestoreSystemBuilderSystemUseCase, "execute">;
  clone: Pick<CloneSystemBuilderSystemUseCase, "execute">;
  saveRevision: Pick<SaveSystemBuilderRevisionUseCase, "execute">;
  readRevision: Pick<ReadSystemBuilderRevisionUseCase, "execute">;
  listRevisions: Pick<ListSystemBuilderRevisionsUseCase, "execute">;
  listComposerAssets: Pick<ListSystemBuilderComposerAssetsUseCase, "execute">;
  previewLayoutChange: Pick<PreviewSystemBuilderLayoutChangeUseCase, "execute">;
  previewFoundationUpgrade: Pick<
    PreviewSystemBuilderFoundationUpgradeUseCase,
    "execute"
  >;
  upgradeFoundation: Pick<UpgradeSystemBuilderFoundationUseCase, "execute">;
}

export function registerSystemBuilderApiRoutes(
  d: RegisterSystemBuilderApiRoutesDependencies,
): void {
  d.app.post("/api/systems/create", async (req, res) =>
    command(req, res, "create", d.create, parseCreate),
  );
  d.app.get("/api/systems/templates", async (_req, res) =>
    success(res, "listTemplates", await d.listTemplates.execute()),
  );
  d.app.post("/api/systems/create-from-template", async (req, res) =>
    command(
      req,
      res,
      "createFromTemplate",
      d.createFromTemplate,
      parseCreateFromTemplate,
    ),
  );
  d.app.get("/api/systems", async (req, res) => {
    try {
      success(
        res,
        "list",
        await d.list.execute({
          workspaceId: createWorkspaceId(required(req.query?.workspaceId)),
          includeArchived: req.query?.includeArchived === "true",
        }),
      );
    } catch {
      invalid(res, "list", "workspaceId is required.");
    }
  });
  d.app.get("/api/systems/manage", async (req, res) => {
    try {
      result(
        res,
        "listManagement",
        await d.listManagement.execute(parseManagementQuery(req.query ?? {})),
      );
    } catch {
      invalid(res, "listManagement", "The system management query is invalid.");
    }
  });
  d.app.get("/api/systems/system", async (req, res) =>
    queryResult(req, res, "read", d.read, false),
  );
  d.app.post("/api/systems/rename", async (req, res) =>
    command(req, res, "rename", d.rename, parseRename),
  );
  d.app.post("/api/systems/archive", async (req, res) =>
    command(req, res, "archive", d.archive, parseArchive),
  );
  d.app.post("/api/systems/restore", async (req, res) =>
    command(req, res, "restore", d.restore, parseArchive),
  );
  d.app.post("/api/systems/clone", async (req, res) =>
    command(req, res, "clone", d.clone, parseClone),
  );
  d.app.post("/api/systems/revisions/save", async (req, res) =>
    command(req, res, "saveRevision", d.saveRevision, parseSave),
  );
  d.app.get("/api/systems/revision", async (req, res) =>
    queryResult(req, res, "readRevision", d.readRevision, true),
  );
  d.app.get("/api/systems/revisions", async (req, res) => {
    try {
      success(
        res,
        "listRevisions",
        await d.listRevisions.execute({
          workspaceId: createWorkspaceId(required(req.query?.workspaceId)),
          systemId: normalizeSystemBuilderSystemId(
            required(req.query?.systemId),
          ),
        }),
      );
    } catch {
      invalid(res, "listRevisions", "workspaceId and systemId are required.");
    }
  });
  d.app.get("/api/systems/composer/assets", async (req, res) => {
    try {
      result(
        res,
        "listComposerAssets",
        await d.listComposerAssets.execute(parseComposerQuery(req.query ?? {})),
      );
    } catch {
      invalid(
        res,
        "listComposerAssets",
        "The composer asset query is invalid.",
      );
    }
  });
  d.app.post("/api/systems/layout-change/preview", async (req, res) =>
    command(
      req,
      res,
      "previewLayoutChange",
      d.previewLayoutChange,
      parsePreviewLayoutChange,
    ),
  );
  d.app.post("/api/systems/foundation-upgrade/preview", async (req, res) =>
    command(
      req,
      res,
      "previewFoundationUpgrade",
      d.previewFoundationUpgrade,
      parsePreviewFoundationUpgrade,
    ),
  );
  d.app.post("/api/systems/foundation-upgrade", async (req, res) =>
    command(
      req,
      res,
      "upgradeFoundation",
      d.upgradeFoundation,
      parseFoundationUpgrade,
    ),
  );
}
function parseManagementQuery(
  query: Record<string, unknown>,
): ListSystemBuilderManagementQuery {
  const searchText = optional(query.searchText);
  const view = optional(query.view);
  const sort = optional(query.sort);
  const cursor = optional(query.cursor);
  const limitText = optional(query.limit);
  const limit = limitText === undefined ? undefined : Number(limitText);
  if (
    (view !== undefined &&
      !SYSTEM_BUILDER_MANAGEMENT_VIEWS.includes(view as any)) ||
    (sort !== undefined &&
      !SYSTEM_BUILDER_MANAGEMENT_SORTS.includes(sort as any)) ||
    (limit !== undefined && !Number.isInteger(limit))
  ) {
    throw new Error();
  }
  return {
    workspaceId: createWorkspaceId(required(query.workspaceId)),
    ...(searchText ? { searchText } : {}),
    ...(view ? { view } : {}),
    ...(sort ? { sort } : {}),
    ...(cursor ? { cursor } : {}),
    ...(limit !== undefined ? { limit } : {}),
  } as ListSystemBuilderManagementQuery;
}

function parseComposerQuery(query: Record<string, unknown>) {
  const parentDefinitionId = optional(query.parentDefinitionId);
  const parentVersion = optional(query.parentVersion);
  const slotId = optional(query.slotId);
  if (
    Boolean(parentDefinitionId) !== Boolean(parentVersion) ||
    Boolean(parentDefinitionId) !== Boolean(slotId)
  ) {
    throw new Error();
  }
  const limitText = optional(query.limit);
  const limit = limitText === undefined ? undefined : Number(limitText);
  if (limit !== undefined && !Number.isInteger(limit)) throw new Error();
  return {
    workspaceId: createWorkspaceId(required(query.workspaceId)),
    ...(optional(query.searchText)
      ? { searchText: optional(query.searchText) }
      : {}),
    ...(optional(query.cursor) ? { cursor: optional(query.cursor) } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(parentDefinitionId && parentVersion
      ? {
          parentDefinitionRef: {
            kind: "asset-definition-version" as const,
            id: normalizeAssetId(parentDefinitionId),
            version: parentVersion,
          },
        }
      : {}),
    ...(slotId ? { slotId: normalizeAssetSlotId(slotId) } : {}),
    ...(query.compatibleOnly === "true" ? { compatibleOnly: true } : {}),
  };
}

async function command(
  req: RequestLike,
  res: ResponseLike,
  operation: keyof typeof API_SYSTEM_BUILDER_OPERATIONS,
  useCase: { execute(value: any): Promise<any> },
  parse: (body: Record<string, unknown>, actorId: string) => any,
): Promise<void> {
  try {
    result(
      res,
      operation,
      await useCase.execute(parse(record(req.body), actor(req))),
    );
  } catch {
    invalid(res, operation, "The System Builder request is invalid.");
  }
}
async function queryResult(
  req: RequestLike,
  res: ResponseLike,
  operation: "read" | "readRevision",
  useCase: { execute(value: any): Promise<any> },
  includeRevision: boolean,
): Promise<void> {
  try {
    const query = {
      workspaceId: createWorkspaceId(required(req.query?.workspaceId)),
      systemId: normalizeSystemBuilderSystemId(required(req.query?.systemId)),
      ...(includeRevision && req.query?.revisionId
        ? {
            revisionId: normalizeSystemBuilderRevisionId(
              required(req.query.revisionId),
            ),
          }
        : {}),
    };
    result(res, operation, await useCase.execute(query));
  } catch {
    invalid(res, operation, "workspaceId and systemId are required.");
  }
}
function parseCreate(
  body: Record<string, unknown>,
  actorId: string,
): CreateSystemBuilderSystemCommand {
  return {
    ...body,
    workspaceId: createWorkspaceId(required(body.workspaceId)),
    actorId,
  } as unknown as CreateSystemBuilderSystemCommand;
}
function parseRename(
  body: Record<string, unknown>,
  actorId: string,
): RenameSystemBuilderSystemCommand {
  return {
    ...body,
    workspaceId: createWorkspaceId(required(body.workspaceId)),
    systemId: normalizeSystemBuilderSystemId(required(body.systemId)),
    actorId,
  } as unknown as RenameSystemBuilderSystemCommand;
}
function parseArchive(
  body: Record<string, unknown>,
  actorId: string,
): ChangeSystemBuilderArchiveStateCommand {
  return {
    ...body,
    workspaceId: createWorkspaceId(required(body.workspaceId)),
    systemId: normalizeSystemBuilderSystemId(required(body.systemId)),
    actorId,
  } as unknown as ChangeSystemBuilderArchiveStateCommand;
}
function parseCreateFromTemplate(
  body: Record<string, unknown>,
  actorId: string,
): CreateSystemBuilderFromTemplateCommand {
  return {
    workspaceId: createWorkspaceId(required(body.workspaceId)),
    templateId: normalizeSystemBuilderTemplateId(required(body.templateId)),
    ...(typeof body.name === "string" ? { name: body.name } : {}),
    actorId,
  };
}
function parseClone(
  body: Record<string, unknown>,
  actorId: string,
): CloneSystemBuilderSystemCommand {
  return {
    ...body,
    workspaceId: createWorkspaceId(required(body.workspaceId)),
    sourceSystemId: normalizeSystemBuilderSystemId(
      required(body.sourceSystemId),
    ),
    actorId,
  } as unknown as CloneSystemBuilderSystemCommand;
}
function parseSave(
  body: Record<string, unknown>,
  actorId: string,
): SaveSystemBuilderRevisionCommand {
  return {
    ...body,
    workspaceId: createWorkspaceId(required(body.workspaceId)),
    systemId: normalizeSystemBuilderSystemId(required(body.systemId)),
    actorId,
  } as unknown as SaveSystemBuilderRevisionCommand;
}
function parsePreviewLayoutChange(
  body: Record<string, unknown>,
  actorId: string,
): PreviewSystemBuilderLayoutChangeCommand {
  return {
    ...body,
    workspaceId: createWorkspaceId(required(body.workspaceId)),
    systemId: normalizeSystemBuilderSystemId(required(body.systemId)),
    actorId,
  } as unknown as PreviewSystemBuilderLayoutChangeCommand;
}
function parsePreviewFoundationUpgrade(
  body: Record<string, unknown>,
  actorId: string,
): PreviewSystemBuilderFoundationUpgradeCommand {
  return {
    ...body,
    workspaceId: createWorkspaceId(required(body.workspaceId)),
    systemId: normalizeSystemBuilderSystemId(required(body.systemId)),
    actorId,
  } as unknown as PreviewSystemBuilderFoundationUpgradeCommand;
}
function parseFoundationUpgrade(
  body: Record<string, unknown>,
  actorId: string,
): UpgradeSystemBuilderFoundationCommand {
  return {
    ...body,
    workspaceId: createWorkspaceId(required(body.workspaceId)),
    systemId: normalizeSystemBuilderSystemId(required(body.systemId)),
    sourceRevisionId: normalizeSystemBuilderRevisionId(
      required(body.sourceRevisionId),
    ),
    actorId,
  } as unknown as UpgradeSystemBuilderFoundationCommand;
}
function result(
  res: ResponseLike,
  operation: keyof typeof API_SYSTEM_BUILDER_OPERATIONS,
  value: any,
): void {
  value.ok
    ? success(res, operation, value.value)
    : failure(res, operation, value.error.code, value.error.message);
}
function success(
  res: ResponseLike,
  operation: keyof typeof API_SYSTEM_BUILDER_OPERATIONS,
  value: unknown,
): void {
  res
    .status(200)
    .json(
      createApiSuccessResponse(API_SYSTEM_BUILDER_OPERATIONS[operation], value),
    );
}
function invalid(
  res: ResponseLike,
  operation: keyof typeof API_SYSTEM_BUILDER_OPERATIONS,
  message: string,
): void {
  failure(res, operation, "validation", message);
}
function failure(
  res: ResponseLike,
  operation: keyof typeof API_SYSTEM_BUILDER_OPERATIONS,
  code: string,
  message: string,
): void {
  const kind = code.includes("not-found")
    ? "not-found"
    : code.includes("stale") || code.includes("conflict")
      ? "conflict"
      : "validation";
  res
    .status(kind === "not-found" ? 404 : kind === "conflict" ? 409 : 400)
    .json(
      createApiFailureResponse(
        createApiError(API_SYSTEM_BUILDER_OPERATIONS[operation], kind, message),
      ),
    );
}
const actor = (request: RequestLike): string =>
  request.securityContext?.principal?.id?.trim() || "authenticated-user";
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error();
  return value as Record<string, unknown>;
};
const required = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error();
  return value.trim();
};
const optional = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
