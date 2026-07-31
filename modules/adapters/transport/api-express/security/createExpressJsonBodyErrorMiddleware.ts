import type { ErrorRequestHandler } from "express";

import { createApiError, createApiFailureResponse } from "../../../../contracts/api";

const API_REQUEST_BODY_OPERATION = "api.request-body";
const CLIENT_BODY_ERROR_TYPES = new Set([
  "encoding.unsupported",
  "entity.parse.failed",
  "entity.too.large",
  "entity.verify.failed",
  "request.aborted",
  "request.size.invalid",
]);

interface ExpressBodyParserError {
  status?: unknown;
  statusCode?: unknown;
  type?: unknown;
}

function asClientBodyParserError(error: unknown): ExpressBodyParserError | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as ExpressBodyParserError;
  return typeof candidate.type === "string" && CLIENT_BODY_ERROR_TYPES.has(candidate.type)
    ? candidate
    : undefined;
}

function resolveStatus(error: ExpressBodyParserError): number {
  const candidate = Number.isInteger(error.status)
    ? error.status
    : Number.isInteger(error.statusCode)
      ? error.statusCode
      : 400;
  return typeof candidate === "number" && candidate >= 400 && candidate < 500 ? candidate : 400;
}

function resolveSafeMessage(error: ExpressBodyParserError): string {
  if (error.type === "entity.too.large") return "Request body exceeds the configured size limit.";
  if (error.type === "encoding.unsupported") return "Request body encoding is not supported.";
  return "Request body could not be parsed.";
}

export function createExpressJsonBodyErrorMiddleware(): ErrorRequestHandler {
  return (error, request, response, next) => {
    const bodyError = asClientBodyParserError(error);
    if (!bodyError) {
      next(error);
      return;
    }
    const requestId = request.header("x-request-id") ?? undefined;
    const correlationId = request.header("x-correlation-id") ?? undefined;
    response.status(resolveStatus(bodyError)).json(createApiFailureResponse(
      createApiError(API_REQUEST_BODY_OPERATION, "validation", resolveSafeMessage(bodyError), {
        requestId,
        correlationId,
      }),
      { requestId, correlationId },
    ));
  };
}
