import { MethodNotAllowedError } from "@shuri/api";
import type { AuthContext, OidcRuntime } from "../config.js";
import { randomToken } from "../crypto/random.js";
import { UnknownProviderError } from "../errors.js";
import { serializeCookie } from "../http/cookie.js";
import { buildAuthorizationUrl } from "../oidc/authorize.js";
import { resolveProviderSlot } from "../oidc/credentials.js";
import { createPkcePair } from "../oidc/pkce.js";
import {
  signTransaction,
  TRANSACTION_TTL_MS,
  type OidcTransaction,
} from "../oidc/transaction.js";
import type { ResolvedProvider } from "../oidc/types.js";

/**
 * Resolves `providerId` against the OIDC runtime, treating "no such provider" and "a declared slot
 * with no `_oidc_credentials` row yet" as the same 404.
 *
 * A static provider was already validated and resolved at boot; a slot is completed from its
 * `_oidc_credentials` row on every call — deliberately not cached alongside the statics, since an
 * admin editing that row should take effect on the very next sign-in.
 * @param oidc - The OIDC runtime.
 * @param providerId - The provider id taken off the path.
 * @param oidcCredentials - The `_oidc_credentials` collection a slot is completed from.
 * @returns The resolved provider.
 */
export async function resolveProvider(
  oidc: OidcRuntime,
  providerId: string,
  oidcCredentials: AuthContext["oidcCredentials"],
): Promise<ResolvedProvider> {
  const provider = oidc.providers.get(providerId);
  if (provider) return provider;

  const slot = oidc.slots.get(providerId);
  if (!slot) throw new UnknownProviderError(providerId);

  return resolveProviderSlot(slot, oidcCredentials);
}

/**
 * `resolveProvider`, plus the "no OIDC configured at all" 404 it can't cover on its own since it
 * takes the runtime, not the context. Used by the start route, which has no transaction cookie to
 * clear yet either way, so resolving eagerly costs nothing.
 * @param context - The resolved auth context.
 * @param providerId - The provider id taken off the path.
 * @returns The OIDC runtime and the resolved provider.
 */
export async function requireProvider(
  context: AuthContext,
  providerId: string,
): Promise<{ oidc: OidcRuntime; provider: ResolvedProvider }> {
  const oidc = context.oidc;
  if (!oidc) throw new UnknownProviderError(providerId);
  return { oidc, provider: await resolveProvider(oidc, providerId, context.oidcCredentials) };
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

  const { oidc, provider } = await requireProvider(context, providerId);
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
