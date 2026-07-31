import type {
  AssetMutationOperation,
  AssetMutationResult,
} from "../../../../contracts/asset";
import {
  API_ASSET_FINALIZE_GENERATED_OUTPUT_OPERATION,
  API_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_OPERATION,
  API_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_OPERATION,
  API_ASSET_MUTATION_ROUTES,
  API_ASSET_REGISTER_RESOURCE_BACKED_VIEW_OPERATION,
  createApiAssetMutationFailureResponse,
  createApiAssetMutationSuccessResponse,
} from "../../../../contracts/api";
import {
  executeAssetMutationUseCase,
  mutationFailureContractCode,
  mutationFailureDetails,
  mutationFailureHttpStatus,
  mutationFailureMessage,
  mutationSuccessStatus,
  parseAssetMutationCommand,
  type AssetMutationUseCase,
} from "../../asset-registry/assetMutationTransport";

interface ExpressRequestLike {
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface ExpressResponseLike {
  status: (code: number) => ExpressResponseLike;
  json: (body: unknown) => void;
}

export interface ExpressAssetMutationRoutePort {
  post: (path: string, handler: (request: ExpressRequestLike, response: ExpressResponseLike) => Promise<void>) => void;
}

export interface RegisterAssetMutationApiRoutesDependencies {
  readonly app: ExpressAssetMutationRoutePort;
  readonly registerResourceBackedViewAsAsset: AssetMutationUseCase<"asset.register-resource-backed-view">;
  readonly finalizeGeneratedOutputAsAsset: AssetMutationUseCase<"asset.finalize-generated-output">;
  readonly importExternalRepositoryObjectAsAsset: AssetMutationUseCase<"asset.import-external-repository-object">;
  readonly localizeExternalRepositoryObjectAsAsset: AssetMutationUseCase<"asset.localize-external-repository-object">;
}

const getHeader = (headers: ExpressRequestLike["headers"], key: string) => {
  const direct = headers?.[key];
  const lower = headers?.[key.toLowerCase()];
  const value = direct ?? lower;
  return Array.isArray(value) ? value[0] : value;
};

function contextFrom(request: ExpressRequestLike) {
  return {
    requestId: getHeader(request.headers, "x-request-id"),
    correlationId: getHeader(request.headers, "x-correlation-id"),
    idempotencyKey: getHeader(request.headers, "x-idempotency-key"),
  };
}

export function registerAssetMutationApiRoutes(dependencies: RegisterAssetMutationApiRoutesDependencies): void {
  dependencies.app.post(API_ASSET_MUTATION_ROUTES.registerResourceBackedView.path, async (request, response) => {
    await handleMutationRoute(
      request,
      response,
      API_ASSET_REGISTER_RESOURCE_BACKED_VIEW_OPERATION,
      dependencies.registerResourceBackedViewAsAsset,
    );
  });

  dependencies.app.post(API_ASSET_MUTATION_ROUTES.finalizeGeneratedOutput.path, async (request, response) => {
    await handleMutationRoute(
      request,
      response,
      API_ASSET_FINALIZE_GENERATED_OUTPUT_OPERATION,
      dependencies.finalizeGeneratedOutputAsAsset,
    );
  });

  dependencies.app.post(API_ASSET_MUTATION_ROUTES.importExternalRepositoryObject.path, async (request, response) => {
    await handleMutationRoute(
      request,
      response,
      API_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_OPERATION,
      dependencies.importExternalRepositoryObjectAsAsset,
    );
  });

  dependencies.app.post(API_ASSET_MUTATION_ROUTES.localizeExternalRepositoryObject.path, async (request, response) => {
    await handleMutationRoute(
      request,
      response,
      API_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_OPERATION,
      dependencies.localizeExternalRepositoryObjectAsAsset,
    );
  });
}

async function handleMutationRoute<TOperation extends AssetMutationOperation>(
  request: ExpressRequestLike,
  response: ExpressResponseLike,
  operation: TOperation,
  useCase: AssetMutationUseCase<TOperation>,
): Promise<void> {
  const parsed = parseAssetMutationCommand(request.body, operation, contextFrom(request));
  if (!parsed.ok) {
    writeMutationResult(response, parsed.result, parsed.context);
    return;
  }

  const result = await executeAssetMutationUseCase(useCase, parsed.command);
  writeMutationResult(response, result, parsed.context);
}

function writeMutationResult(
  response: ExpressResponseLike,
  result: AssetMutationResult,
  context: { requestId?: string; correlationId?: string },
): void {
  if (result.ok) {
    response.status(mutationSuccessStatus(result)).json(createApiAssetMutationSuccessResponse(result.operation, result, context));
    return;
  }

  response
    .status(mutationFailureHttpStatus(result.failure?.code))
    .json(createApiAssetMutationFailureResponse(
      result.operation,
      mutationFailureContractCode(result.failure?.code) as "validation" | "internal" | "not-found" | "unavailable" | "forbidden" | "conflict",
      mutationFailureMessage(result),
      {
        ...context,
        details: mutationFailureDetails(result),
      },
    ));
}
