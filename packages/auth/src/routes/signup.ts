import { MethodNotAllowedError } from "@shuri/api";
import type { AuthContext } from "../config.js";
import { signUp } from "../credentials/signup.js";
import { parseCredentials } from "../credentials/validators.js";
import { readJsonObject } from "../http/body.js";
import { requestMetadata } from "./metadata.js";
import { issuedSessionResponse } from "./session-response.js";

/**
 * `POST {basePath}/signup` — registers a user and signs them in, answering 201 with `{ user }` and
 * the session cookie.
 * @param context - The resolved auth context.
 * @param request - The incoming request.
 * @returns The 201 response, or throws for anything the router maps to an error.
 */
export async function handleSignup(
  context: AuthContext,
  request: Request,
): Promise<Response> {
  if (request.method !== "POST") throw new MethodNotAllowedError(request.method);

  const credentials = parseCredentials(await readJsonObject(request));
  const issued = await signUp(context.credentials, credentials, requestMetadata(request));
  return issuedSessionResponse(context, issued, 201);
}
