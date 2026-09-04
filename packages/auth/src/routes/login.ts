import { MethodNotAllowedError } from "@shuri/api";
import type { AuthContext } from "../config.js";
import { signIn } from "../credentials/login.js";
import { parseCredentials } from "../credentials/validators.js";
import { readJsonObject } from "../http/body.js";
import { requestMetadata } from "./metadata.js";
import { issuedSessionResponse } from "./session-response.js";

/**
 * `POST {basePath}/login` — answers 200 with `{ user }` and the session cookie, or the one generic
 * 401 every credential failure shares.
 * @param context - The resolved auth context.
 * @param request - The incoming request.
 * @returns The 200 response, or throws for anything the router maps to an error.
 */
export async function handleLogin(
  context: AuthContext,
  request: Request,
): Promise<Response> {
  if (request.method !== "POST") throw new MethodNotAllowedError(request.method);

  const credentials = parseCredentials(await readJsonObject(request));
  const issued = await signIn(context.credentials, credentials, requestMetadata(request));
  return issuedSessionResponse(context, issued);
}
