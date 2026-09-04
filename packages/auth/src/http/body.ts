import { InvalidJsonBodyError } from "@shuri/api";
import type { RecordInput } from "@shuri/store";
import { UnsupportedMediaTypeError } from "../errors.js";

/**
 * Reads a JSON object off a mutating request, requiring `content-type: application/json`.
 *
 * That requirement is this round's CSRF defense, alongside `SameSite=Lax`: an HTML `<form>` can only
 * send `application/x-www-form-urlencoded`, `multipart/form-data` or `text/plain`, so a cross-origin
 * form cannot reach these routes at all, and `fetch` with a JSON content type triggers a preflight
 * the browser blocks.
 * @param request - The incoming request.
 * @returns The parsed body object.
 */
export async function readJsonObject(request: Request): Promise<RecordInput> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.split(";")[0].trim().toLowerCase().endsWith("json")) {
    throw new UnsupportedMediaTypeError();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new InvalidJsonBodyError();
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new InvalidJsonBodyError();
  }
  return body as RecordInput;
}
