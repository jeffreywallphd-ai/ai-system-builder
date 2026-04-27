import type { StructuredLogEvent } from "../../contracts/logging";
import { createContractError } from "../../contracts/shared";
import { ARTIFACT_UPLOAD_OPERATION } from "../../contracts/artifact-upload";
import type { ArtifactUploadAcceptedTypePolicy } from "../../contracts/artifact-upload";
import { createStoreArtifactRequest } from "../../contracts/storage";
import {
  classifyArtifactIntakeCandidate,
  createArtifactIntakeCandidate,
  createDefaultAcceptedArtifactUploadPolicy,
  type AcceptedArtifactUploadPolicy,
} from "../../domain";
import type { LoggingPort } from "../ports/logging";
import type { ArtifactStoragePort } from "../ports/storage";
import type {
  StoreArtifactUploadCommand,
  StoreArtifactUploadCommandContext,
  StoreArtifactUploadUseCaseResult,
} from "./store-artifact-upload.types";
import { mapStoreArtifactUploadToRegisterStagedArtifactResult } from "./artifact-upload/mapStoreArtifactUploadToRegisterStagedArtifactResult";
import { mapAcceptedArtifactUploadPolicyToContract } from "./artifact-upload/mapAcceptedArtifactUploadPolicyToContract";

export interface StoreArtifactUploadUseCaseDependencies {
  storage: ArtifactStoragePort;
  logging: LoggingPort;
  acceptedUploadPolicy?: AcceptedArtifactUploadPolicy;
  now?: () => string;
}

const STORE_ARTIFACT_UPLOAD_USE_CASE = "StoreArtifactUploadUseCase";

function getNow(now: (() => string) | undefined): string {
  return (now ?? (() => new Date().toISOString()))();
}

function toFailureResult(
  code: "validation" | "internal",
  message: string,
  context: {
    requestId?: string;
    correlationId?: string;
  },
): StoreArtifactUploadUseCaseResult {
  return mapStoreArtifactUploadToRegisterStagedArtifactResult(
    {
      ok: false,
      error: createContractError(code, message, {
        requestId: context.requestId,
        correlationId: context.correlationId,
      }),
    },
    context,
  );
}

function createBaseLogEvent(
  timestamp: string,
  level: StructuredLogEvent["level"],
  event: string,
  message: string,
  context: {
    requestId?: string;
    correlationId?: string;
  },
): StructuredLogEvent {
  return {
    timestamp,
    level,
    verbosity: "normal",
    event,
    message,
    component: "application.use-cases",
    operation: ARTIFACT_UPLOAD_OPERATION,
    useCase: STORE_ARTIFACT_UPLOAD_USE_CASE,
    requestId: context.requestId,
    correlationId: context.correlationId,
  };
}

export class StoreArtifactUploadUseCase {
  private readonly storage: ArtifactStoragePort;
  private readonly logging: LoggingPort;
  private readonly now: () => string;
  private readonly acceptedUploadPolicy: AcceptedArtifactUploadPolicy;

  public constructor(dependencies: StoreArtifactUploadUseCaseDependencies) {
    this.storage = dependencies.storage;
    this.logging = dependencies.logging;
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.acceptedUploadPolicy = dependencies.acceptedUploadPolicy ?? createDefaultAcceptedArtifactUploadPolicy();
  }

  public getAcceptedUploadPolicy(): ArtifactUploadAcceptedTypePolicy {
    return mapAcceptedArtifactUploadPolicyToContract(this.acceptedUploadPolicy);
  }

  public async execute(
    command: StoreArtifactUploadCommand,
    commandContext: StoreArtifactUploadCommandContext,
    context: {
      requestId?: string;
      correlationId?: string;
    } = {},
  ): Promise<StoreArtifactUploadUseCaseResult> {
    const startedAt = Date.now();
    const candidate = createArtifactIntakeCandidate({
      fileName: command.fileName,
      mediaType: command.mediaType,
      bytesLength: command.bytes.length,
    });

    await this.logging.log({
      ...createBaseLogEvent(
        getNow(this.now),
        "info",
        "application.artifact-upload.store.started",
        "Starting artifact upload storage flow",
        context,
      ),
      data: {
        fileName: candidate.fileName,
        mediaType: candidate.mediaType,
        bytesLength: candidate.bytesLength,
        source: commandContext.source,
      },
    });

    const classification = classifyArtifactIntakeCandidate(candidate, this.acceptedUploadPolicy);
    if (!classification.accepted) {
      const failure = toFailureResult("validation", classification.reason ?? "Artifact upload rejected.", context);
      if (!failure.ok) {
        await this.logging.log({
          ...createBaseLogEvent(
            getNow(this.now),
            "warn",
            "application.artifact-upload.store.failed",
            "Artifact upload validation failed",
            context,
          ),
          outcome: "failure",
          durationMs: Date.now() - startedAt,
          error: {
            errorType: "validation",
            errorCode: failure.error.code,
            errorMessage: failure.error.message,
          },
        });
      }
      return failure;
    }

    try {
      const storeResult = await this.storage.storeArtifact(
        createStoreArtifactRequest(command.bytes, {
          descriptor: {
            mediaType: candidate.mediaType,
            metadata: {
              originalFileName: candidate.fileName,
              artifactFamily: classification.artifactFamily,
            },
          },
        }),
        context,
      );

      if (!storeResult.ok) {
        const failure = mapStoreArtifactUploadToRegisterStagedArtifactResult({ ok: false, error: storeResult.error }, context);
        await this.logging.log({
          ...createBaseLogEvent(
            getNow(this.now),
            "error",
            "application.artifact-upload.store.failed",
            "Artifact upload storage failed",
            context,
          ),
          outcome: "failure",
          durationMs: Date.now() - startedAt,
          error: {
            errorType: "storage",
            errorCode: storeResult.error.code,
            errorMessage: storeResult.error.message,
            details: storeResult.error.details,
          },
        });
        return failure;
      }

      const result = mapStoreArtifactUploadToRegisterStagedArtifactResult(
        {
          ok: true,
          descriptor: storeResult.value,
          sourceKind: "upload",
          originalName: candidate.fileName,
        },
        context,
      );

      await this.logging.log({
        ...createBaseLogEvent(
          getNow(this.now),
          "info",
          "application.artifact-upload.store.succeeded",
          "Artifact upload stored successfully",
          context,
        ),
        outcome: "success",
        durationMs: Date.now() - startedAt,
        data: {
          key: storeResult.value.key,
          mediaType: storeResult.value.mediaType,
          sizeBytes: storeResult.value.sizeBytes,
          artifactFamily: classification.artifactFamily,
        },
      });

      return result;
    } catch (error) {
      const failure = toFailureResult("internal", "Unexpected storage failure.", context);
      await this.logging.log({
        ...createBaseLogEvent(
          getNow(this.now),
          "error",
          "application.artifact-upload.store.failed",
          "Unexpected artifact upload storage failure",
          context,
        ),
        outcome: "failure",
        durationMs: Date.now() - startedAt,
        error: {
          errorType: "internal",
          errorCode: failure.ok ? "internal" : failure.error.code,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
      return failure;
    }
  }
}
