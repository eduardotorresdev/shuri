import { MethodNotAllowedError } from "@shuri/api";
import type { AuthContext, OidcRuntime } from "../config.js";
import { randomToken } from "../crypto/random.js";
import { UnknownProviderError } from "../errors.js";
import { serializeCookie } from "../http/cookie.js";
import { buildAuthorizationUrl } from "../oidc/authorize.js";
import { createPkcePair } from "../oidc/pkce.js";
import {
  signTransaction,
  TRANSACTION_TTL_MS,
  type OidcTransaction,
} from "../oidc/transaction.js";
import type { ResolvedProvider } from "../oidc/types.js";

/**
 * Resolves the provider named in the path, treating "no OIDC configured at all" and "no such
 * provider" as the same 404.
 * @param context - The resolved auth context.
 * @param providerId - The provider id taken off the path.
 * @returns The OIDC runtime and the resolved provider.
 */
export function requireProvider(
  context: AuthContext,
  providerId: string,
): { oidc: OidcRuntime; provider: ResolvedProvider } {
  const oidc = context.oidc;
  const provider = oidc?.providers.get(providerId);
  if (!oidc || !provider) throw new UnknownProviderError(providerId);
  return { oidc, provider };
}

/**
 * `GET {basePath}/oidc/:provider` — starts a sign-in: 302 to the provider's authorization endpoint,
 * with `state`, `nonce` and a PKCE challenge, and the signed transaction cookie carrying their
 * counterparts.
 * @param context - The resolved auth context.
 * @param request - The incoming request.
 * @param providerId - The provider id taken off the path.
 * @returns The 302 response.
 */
export async function handleOidcStart(
  context: AuthContext,
  request: Request,
  providerId: string,
): Promise<Response> {
  if (request.method !== "GET") throw new MethodNotAllowedError(request.method);

  const { oidc, provider } = requireProvider(context, providerId);
  const endpoints = await oidc.discovery.endpoints(provider);

  const state = randomToken();
  const nonce = randomToken();
  const { verifier, challenge } = await createPkcePair();

  const transaction: OidcTransaction = {
    p: provider.id,
    s: state,
    n: nonce,
    v: verifier,
    e: context.now() + TRANSACTION_TTL_MS,
    // Kept raw: it is checked by `safeRedirect` when it is actually used, so a value that stops
    // being allowed between start and callback is still rejected.
    ...(new URL(request.url).searchParams.get("redirectTo")
      ? { r: new URL(request.url).searchParams.get("redirectTo") as string }
      : {}),
  };

  return new Response(null, {
    status: 302,
    headers: {
      location: buildAuthorizationUrl(endpoints, provider, { state, nonce, challenge }),
      "set-cookie": serializeCookie(
        oidc.transactionCookie,
        await signTransaction(oidc.secret, transaction),
        TRANSACTION_TTL_MS / 1000,
      ),
    },
  });
}
