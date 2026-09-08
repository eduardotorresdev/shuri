import type { OpenApiSecurity, SecurityRequirement } from "@shuri/api";
import type { AuthContext } from "../config.js";

/** What this package contributes to the OpenAPI document: its routes, and how requests authenticate. */
export interface AuthOpenApi {
  /** Path items for every auth route, to merge through `BuildOpenApiDocumentOptions.paths`. */
  paths: Record<string, Record<string, unknown>>;
  /** The three ways a request authenticates, for `BuildOpenApiDocumentOptions.security`. */
  security: OpenApiSecurity;
}

const credentialsBody = {
  required: true,
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 8, maxLength: 256 },
          name: { type: "string", maxLength: 200 },
        },
      },
    },
  },
};

const userResponse = (description: string) => ({
  description,
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: { user: { type: "object", additionalProperties: true } },
      },
    },
  },
});

function oidcPaths(
  basePath: string,
  ids: readonly string[],
): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const id of ids) {
    paths[`${basePath}/oidc/${id}`] = {
      get: {
        tags: ["Auth"],
        summary: `Sign in with ${id}`,
        parameters: [{ name: "redirectTo", in: "query", schema: { type: "string" } }],
        responses: {
          "302": { description: "Redirect to the identity provider" },
          "404": { description: "Unknown provider" },
        },
      },
    };
    paths[`${basePath}/oidc/${id}/callback`] = {
      get: {
        tags: ["Auth"],
        summary: `${id} sign-in callback`,
        responses: {
          "302": { description: "Signed in; redirect with the session cookie" },
          "400": { description: "Invalid or expired sign-in transaction" },
          "403": { description: "This identity cannot be used to sign in" },
        },
      },
    };
  }
  return paths;
}

/**
 * Describes this package's routes and security in OpenAPI terms, so `@shuri/sdk` can hand them to
 * `createOpenApiHandler` and the document keeps describing every route actually served.
 *
 * Three schemes: the session cookie (`apiKey` in `cookie`), the same session as a bearer, and the
 * OAuth2 client-credentials flow pointing at `{basePath}/token` with every scope the schema derives.
 * `requirements(scope)` lists all three as alternatives, the OAuth2 one carrying `scope` — which is
 * exactly what a client token needs to hold for that operation.
 * @param context - The resolved auth context.
 * @returns The paths and security fragment.
 */
export function authOpenApi(context: AuthContext): AuthOpenApi {
  const { basePath } = context;
  const providerIds = context.oidc
    ? [...context.oidc.providers.keys(), ...context.oidc.slots.keys()]
    : [];

  const paths: Record<string, Record<string, unknown>> = {
    [`${basePath}/signup`]: {
      post: {
        tags: ["Auth"],
        summary: "Sign up with email and password",
        security: [],
        requestBody: credentialsBody,
        responses: {
          "201": userResponse("Created; the session cookie is set"),
          "400": { description: "Validation error" },
          "409": { description: "Email already registered" },
          "415": { description: "Expected content-type: application/json" },
        },
      },
    },
    [`${basePath}/login`]: {
      post: {
        tags: ["Auth"],
        summary: "Sign in with email and password",
        security: [],
        requestBody: credentialsBody,
        responses: {
          "200": userResponse("OK; the session cookie is set"),
          "400": { description: "Validation error" },
          "401": { description: "Invalid email or password" },
          "415": { description: "Expected content-type: application/json" },
        },
      },
    },
    [`${basePath}/logout`]: {
      post: {
        tags: ["Auth"],
        summary: "Sign out",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: { "204": { description: "Signed out; the cookie is cleared" } },
      },
    },
    [`${basePath}/me`]: {
      get: {
        tags: ["Auth"],
        summary: "The current user",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: {
          "200": userResponse("OK"),
          "401": { description: "Not authenticated" },
        },
      },
    },
    [`${basePath}/token`]: {
      post: {
        tags: ["Auth"],
        summary: "Obtain a client-credentials token (RFC 6749 §4.4)",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/x-www-form-urlencoded": {
              schema: {
                type: "object",
                required: ["grant_type"],
                properties: {
                  grant_type: { type: "string", enum: ["client_credentials"] },
                  scope: {
                    type: "string",
                    description: "Space-separated scopes or patterns",
                  },
                  client_id: { type: "string" },
                  client_secret: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    access_token: { type: "string" },
                    token_type: { type: "string", enum: ["Bearer"] },
                    expires_in: { type: "integer" },
                    scope: { type: "string" },
                  },
                },
              },
            },
          },
          "400": {
            description: "invalid_request, unsupported_grant_type or invalid_scope",
          },
          "401": { description: "invalid_client" },
        },
      },
    },
    ...oidcPaths(basePath, providerIds),
  };

  const scopes: Record<string, string> = {};
  for (const scope of context.scopes) {
    const [slug, op] = scope.split(":");
    scopes[scope] = `${op} on ${slug}`;
  }

  return {
    paths,
    security: {
      schemes: {
        cookieAuth: { type: "apiKey", in: "cookie", name: context.cookieOptions.name },
        bearerAuth: { type: "http", scheme: "bearer" },
        clientCredentials: {
          type: "oauth2",
          flows: { clientCredentials: { tokenUrl: `${basePath}/token`, scopes } },
        },
      },
      requirements: (scope): SecurityRequirement[] => [
        { cookieAuth: [] },
        { bearerAuth: [] },
        { clientCredentials: scope ? [scope] : [] },
      ],
    },
  };
}
