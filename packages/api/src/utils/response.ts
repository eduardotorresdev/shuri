import {
  RecordNotFoundError,
  RecordValidationError,
  UnknownCollectionError,
  UnknownGlobalError,
} from "@shuri/store";
import { InvalidQueryError } from "../collections/errors.js";
import { ApiError } from "../errors.js";

function jsonHeaders(extra?: NonNullable<ResponseInit["headers"]>): Headers {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json");
  return headers;
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: jsonHeaders(init.headers),
  });
}

export function errorResponse(
  status: number,
  message: string,
  details?: Record<string, unknown>,
): Response {
  return jsonResponse({ error: message, ...details }, { status });
}

export function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

/**
 * Maps an error caught while handling a request to an HTTP `Response`. Errors this package
 * doesn't recognize are rethrown so they surface as a 500 (or crash) at the hosting engine's
 * own error boundary, instead of being silently swallowed here.
 * @param error - The error caught while handling a request.
 * @returns The HTTP `Response` mapped from `error`.
 */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof InvalidQueryError)
    return errorResponse(error.status, error.message, { issues: error.issues });
  if (error instanceof ApiError) return errorResponse(error.status, error.message);
  if (error instanceof UnknownCollectionError) return errorResponse(404, error.message);
  if (error instanceof UnknownGlobalError) return errorResponse(404, error.message);
  if (error instanceof RecordNotFoundError) return errorResponse(404, error.message);
  if (error instanceof RecordValidationError)
    return errorResponse(400, error.message, { issues: error.issues });
  throw error;
}
