import type {
  AssetStudioAssetDraftWorkflowUseCase,
  ListAssetStudioWorkflowsUseCase,
  ProposeAssetStudioChangeUseCase,
  ReadAssetStudioProposalUseCase,
  ReviewAssetStudioProposalUseCase,
  StartAssetStudioUseCase,
} from "../../../../application/use-cases/asset-studio";
import {
  API_ASSET_STUDIO_OPERATIONS,
  createApiError,
  createApiFailureResponse,
  createApiSuccessResponse,
} from "../../../../contracts/api";
import type {
  CreateAssetStudioAssetDraftCommand,
  ListAssetStudioAssetDraftsQuery,
  ProposeAssetStudioChangeCommand,
  ReviewAssetStudioProposalCommand,
  StartAssetStudioCommand,
  TransitionAssetStudioAssetDraftCommand,
  UpdateAssetStudioAssetDraftCommand,
} from "../../../../contracts/asset-studio";
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
export interface AssetStudioExpressPort {
  get(
    path: string,
    handler: (request: RequestLike, response: ResponseLike) => Promise<void>,
  ): void;
  post(
    path: string,
    handler: (request: RequestLike, response: ResponseLike) => Promise<void>,
  ): void;
}
export interface RegisterAssetStudioApiRoutesDependencies {
  app: AssetStudioExpressPort;
  start: Pick<StartAssetStudioUseCase, "execute">;
  propose: Pick<ProposeAssetStudioChangeUseCase, "execute">;
  review: Pick<ReviewAssetStudioProposalUseCase, "execute">;
  read: Pick<ReadAssetStudioProposalUseCase, "execute">;
  list: Pick<ListAssetStudioWorkflowsUseCase, "execute">;
  assetDrafts: Pick<
    AssetStudioAssetDraftWorkflowUseCase,
    "create" | "update" | "read" | "list" | "review" | "publish" | "abandon"
  >;
}

export function registerAssetStudioApiRoutes(
  d: RegisterAssetStudioApiRoutesDependencies,
): void {
  d.app.post("/api/asset-studio/start", async (req, res) => {
    try {
      const body = record(req.body);
      result(
        res,
        "start",
        await d.start.execute({
          ...body,
          workspaceId: createWorkspaceId(required(body.workspaceId)),
          actorId: actor(req),
        } as unknown as StartAssetStudioCommand),
      );
    } catch {
      failure(
        res,
        "start",
        "validation",
        "The Asset Studio start request is invalid.",
      );
    }
  });
  d.app.get("/api/asset-studio/workflows", async (req, res) => {
    try {
      res
        .status(200)
        .json(
          createApiSuccessResponse(
            API_ASSET_STUDIO_OPERATIONS.list,
            await d.list.execute(
              createWorkspaceId(required(req.query?.workspaceId)),
            ),
          ),
        );
    } catch {
      failure(res, "list", "validation", "workspaceId is required.");
    }
  });
  d.app.get("/api/asset-studio/proposal", async (req, res) => {
    try {
      result(
        res,
        "read",
        await d.read.execute(
          createWorkspaceId(required(req.query?.workspaceId)),
          required(req.query?.workflowId),
        ),
      );
    } catch {
      failure(
        res,
        "read",
        "validation",
        "workspaceId and workflowId are required.",
      );
    }
  });
  d.app.post("/api/asset-studio/propose", async (req, res) => {
    try {
      const body = record(req.body);
      result(
        res,
        "propose",
        await d.propose.execute({
          ...body,
          workspaceId: createWorkspaceId(required(body.workspaceId)),
          actorId: actor(req),
        } as unknown as ProposeAssetStudioChangeCommand),
      );
    } catch {
      failure(
        res,
        "propose",
        "validation",
        "The Asset Studio proposal request is invalid.",
      );
    }
  });
  d.app.post("/api/asset-studio/review", async (req, res) => {
    try {
      const body = record(req.body);
      result(
        res,
        "review",
        await d.review.execute({
          ...body,
          workspaceId: createWorkspaceId(required(body.workspaceId)),
          actorId: actor(req),
        } as unknown as ReviewAssetStudioProposalCommand),
      );
    } catch {
      failure(
        res,
        "review",
        "validation",
        "The Asset Studio review request is invalid.",
      );
    }
  });
  d.app.post("/api/asset-studio/asset-drafts", async (req, res) => {
    try {
      const body = record(req.body);
      result(
        res,
        "createAssetDraft",
        await d.assetDrafts.create({
          ...body,
          workspaceId: createWorkspaceId(required(body.workspaceId)),
          actorId: actor(req),
        } as unknown as CreateAssetStudioAssetDraftCommand),
      );
    } catch {
      failure(
        res,
        "createAssetDraft",
        "validation",
        "The Studio asset draft create request is invalid.",
      );
    }
  });
  d.app.post("/api/asset-studio/asset-drafts/update", async (req, res) => {
    try {
      const body = record(req.body);
      result(
        res,
        "updateAssetDraft",
        await d.assetDrafts.update({
          ...body,
          workspaceId: createWorkspaceId(required(body.workspaceId)),
          actorId: actor(req),
        } as unknown as UpdateAssetStudioAssetDraftCommand),
      );
    } catch {
      failure(
        res,
        "updateAssetDraft",
        "validation",
        "The Studio asset draft update request is invalid.",
      );
    }
  });
  d.app.get("/api/asset-studio/asset-drafts", async (req, res) => {
    try {
      const query = req.query ?? {};
      result(
        res,
        "listAssetDrafts",
        await d.assetDrafts.list({
          ...query,
          workspaceId: createWorkspaceId(required(query.workspaceId)),
          unpublishedOnly: optionalBoolean(query.unpublishedOnly),
        } as unknown as ListAssetStudioAssetDraftsQuery),
      );
    } catch {
      failure(
        res,
        "listAssetDrafts",
        "validation",
        "The Studio asset draft list request is invalid.",
      );
    }
  });
  d.app.get("/api/asset-studio/asset-draft", async (req, res) => {
    try {
      const query = req.query ?? {};
      result(
        res,
        "readAssetDraft",
        await d.assetDrafts.read({
          workspaceId: createWorkspaceId(required(query.workspaceId)),
          draftId: required(query.draftId) as never,
        }),
      );
    } catch {
      failure(
        res,
        "readAssetDraft",
        "validation",
        "workspaceId and draftId are required.",
      );
    }
  });
  const transition = (
    path: string,
    operation: "reviewAssetDraft" | "publishAssetDraft" | "abandonAssetDraft",
    execute: (
      command: TransitionAssetStudioAssetDraftCommand,
    ) => Promise<unknown>,
  ) =>
    d.app.post(path, async (req, res) => {
      try {
        const body = record(req.body);
        result(
          res,
          operation,
          await execute({
            ...body,
            workspaceId: createWorkspaceId(required(body.workspaceId)),
            actorId: actor(req),
          } as unknown as TransitionAssetStudioAssetDraftCommand),
        );
      } catch {
        failure(
          res,
          operation,
          "validation",
          "The Studio asset draft transition request is invalid.",
        );
      }
    });
  transition(
    "/api/asset-studio/asset-drafts/review",
    "reviewAssetDraft",
    (command) => d.assetDrafts.review(command),
  );
  transition(
    "/api/asset-studio/asset-drafts/publish",
    "publishAssetDraft",
    (command) => d.assetDrafts.publish(command),
  );
  transition(
    "/api/asset-studio/asset-drafts/abandon",
    "abandonAssetDraft",
    (command) => d.assetDrafts.abandon(command),
  );
}

function result(
  res: ResponseLike,
  operation: keyof typeof API_ASSET_STUDIO_OPERATIONS,
  value: any,
): void {
  value.ok
    ? res
        .status(200)
        .json(
          createApiSuccessResponse(
            API_ASSET_STUDIO_OPERATIONS[operation],
            value.value,
          ),
        )
    : failure(
        res,
        operation,
        failureCode(value.error?.code),
        value.error.message,
      );
}
function failure(
  res: ResponseLike,
  operation: keyof typeof API_ASSET_STUDIO_OPERATIONS,
  code: "validation" | "conflict" | "not-found" | "unavailable",
  message: string,
): void {
  res
    .status(
      code === "validation"
        ? 400
        : code === "not-found"
          ? 404
          : code === "unavailable"
            ? 503
            : 409,
    )
    .json(
      createApiFailureResponse(
        createApiError(API_ASSET_STUDIO_OPERATIONS[operation], code, message),
      ),
    );
}
const failureCode = (
  code: unknown,
): "validation" | "conflict" | "not-found" | "unavailable" => {
  const value = String(code);
  return value.includes("not-found")
    ? "not-found"
    : value.includes("invalid") || value.includes("validation")
      ? "validation"
      : value.includes("unavailable")
        ? "unavailable"
        : "conflict";
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error();
  return value as Record<string, unknown>;
};
const required = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error();
  return value.trim();
};
const optionalBoolean = (value: unknown): boolean | undefined =>
  value === undefined
    ? undefined
    : value === true || value === "true"
      ? true
      : value === false || value === "false"
        ? false
        : (() => {
            throw new Error();
          })();
const actor = (request: RequestLike) =>
  request.securityContext?.principal?.id?.trim() || "authenticated-user";
