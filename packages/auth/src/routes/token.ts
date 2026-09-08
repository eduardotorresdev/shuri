import { jsonResponse, MethodNotAllowedError } from "@shuri/api";
import type { RecordInput } from "@shuri/store";
import {
  all,
  object,
  optional,
  required,
  string,
  validate,
  type Validator,
} from "@shuri/validate";
import type { AuthContext } from "../config.js";
import { OAuthTokenError } from "../errors.js";
import { readJsonObject } from "../http/body.js";

interface TokenParams {
  grant_type?: unknown;
  scope?: unknown;
  client_id?: unknown;
  client_secret?: unknown;
}

const tokenParamsValidator: Validator<TokenParams> = object<TokenParams>({
  grant_type: all(
    required('"grant_type" is required'),
    string('"grant_type" must be a string'),
  ),
  scope: optional(string('"scope" must be a string')),
  client_id: optional(string('"client_id" must be a string')),
  client_secret: optional(string('"client_secret" must be a string')),
});

/**
 * Reads the grant parameters off the body: `application/x-www-form-urlencoded` as the RFC
 * prescribes, or JSON as a convenience. Anything else is `invalid_request`.
 * @param request - The incoming request.
 * @returns The parameters, validated for shape.
 */
async function readTokenParams(request: Request): Promise<TokenParams> {
  const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim();
  let raw: RecordInput;
  if (contentType === "application/x-www-form-urlencoded") {
    raw = Object.fromEntries(new URLSearchParams(await request.text()));
  } else if (contentType.endsWith("json")) {
    raw = await readJsonObject(request);
  } else {
    throw new OAuthTokenError(400, "invalid_request", "Unsupported content type");
  }

  const issues = validate(raw as TokenParams, tokenParamsValidator, "body");
  if (issues.length > 0) {
    throw new OAuthTokenError(400, "invalid_request", issues[0].message);
  }
  return raw as TokenParams;
}

/**
 * The client's credentials: `Authorization: Basic` (RFC 6749 §2.3.1, each half URL-encoded) takes
 * precedence over `client_id`/`client_secret` in the body.
 * @param request - The incoming request.
 * @param params - The body parameters.
 * @returns The credentials, or `undefined` when none were sent.
 */
function readClientCredentials(
  request: Request,
  params: TokenParams,
): { clientId: string; clientSecret: string } | undefined {
  const header = request.headers.get("authorization");
  if (header && /^basic\s/i.test(header)) {
    try {
      const decoded = atob(header.slice("basic ".length).trim());
      const separator = decoded.indexOf(":");
      if (separator < 0) return undefined;
      return {
        clientId: decodeURIComponent(decoded.slice(0, separator)),
        clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
      };
    } catch {
      return undefined;
    }
  }
  if (typeof params.client_id === "string" && typeof params.client_secret === "string") {
    return { clientId: params.client_id, clientSecret: params.client_secret };
  }
  return undefined;
}

/**
 * The error body RFC 6749 §5.2 prescribes. `invalid_client` is a 401 carrying `WWW-Authenticate`,
 * as §5.2 requires when the client authenticated through the header.
 * @param error - The token-endpoint error.
 * @returns The response.
 */
function oauthErrorResponse(error: OAuthTokenError): Response {
  return jsonResponse(
    {
      error: error.code,
      ...(error.description ? { error_description: error.description } : {}),
    },
    {
      status: error.status,
      headers: {
        "cache-control": "no-store",
        ...(error.status === 401 ? { "www-authenticate": 'Basic realm="shuri"' } : {}),
      },
    },
  );
}

/**
 * `POST {basePath}/token` — the OAuth2 client-credentials grant (RFC 6749 §4.4). Answers 200
 * `{ access_token, token_type: "Bearer", expires_in, scope }` with `Cache-Control: no-store`, or an
 * RFC-shaped error: `invalid_request` (400), `unsupported_grant_type` (400), `invalid_scope` (400)
 * and `invalid_client` (401) — the last one for an unknown id, a revoked client and a wrong secret
 * alike, so the endpoint never says which clients exist.
 * @param context - The resolved auth context.
 * @param request - The incoming request.
 * @returns The token response, or the RFC error response.
 */
export async function handleToken(
  context: AuthContext,
  request: Request,
): Promise<Response> {
  if (request.method !== "POST") throw new MethodNotAllowedError(request.method);

  try {
    const params = await readTokenParams(request);
    if (params.grant_type !== "client_credentials") {
      throw new OAuthTokenError(400, "unsupported_grant_type");
    }

    const credentials = readClientCredentials(request, params);
    const client = credentials
      ? await context.clients.verify(credentials.clientId, credentials.clientSecret)
      : undefined;
    if (!client) throw new OAuthTokenError(401, "invalid_client");

    const scope = typeof params.scope === "string" ? params.scope.trim() : "";
    const issued = await context.clientTokens.issue(
      client,
      scope ? scope.split(/\s+/) : undefined,
    );

    return jsonResponse(
      {
        access_token: issued.token,
        token_type: "Bearer",
        expires_in: Math.floor((issued.expiresAt - context.now()) / 1000),
        scope: issued.scope.join(" "),
      },
      { headers: { "cache-control": "no-store", pragma: "no-cache" } },
    );
  } catch (error) {
    if (error instanceof OAuthTokenError) return oauthErrorResponse(error);
    throw error;
  }
}
