import { MethodNotAllowedError, toErrorResponse } from "@shuri/api";
import type { AuthContext } from "../config.js";
import { timingSafeEqual } from "../crypto/equal.js";
import { OAuthTransactionError, OidcProviderError } from "../errors.js";
import { clearCookie, readCookie } from "../http/cookie.js";
import { safeRedirect } from "../http/redirect.js";
import { assertValidClaims, decodeIdToken } from "../oidc/id-token.js";
import { resolveOidcUser } from "../oidc/link.js";
import { exchangeCode } from "../oidc/token.js";
import { verifyTransaction } from "../oidc/transaction.js";
import { requestMetadata } from "./metadata.js";
import { requireProvider } from "./oidc-start.js";

/**
 * `GET {basePath}/oidc/:provider/callback` — completes a sign-in: 302 to the app, with the session
 * cookie set and the transaction cookie cleared.
 *
 * The checks run in a fixed order, and the order is part of the security:
 * 1. the transaction cookie must be there,
 * 2. its HMAC is verified **before** anything is parsed,
 * 3. its payload's shape is validated,
 * 4. it must not have expired,
 * 5. its provider must be the one in the path — otherwise a transaction started at one provider
 *    could be replayed against another's callback,
 * 6. the `state` in the payload must equal the one echoed in the query, compared in constant time.
 *
 * All six raise the *same* generic error with the *same* message. The `state` echo exists on top of
 * the cookie because the cookie alone only proves "this browser started *a* sign-in"; the echo
 * proves "this callback belongs to *that* sign-in", which is what stops login-CSRF.
 *
 * The transaction cookie is cleared on **every** exit path, success or failure — a single-use value
 * that survives its use isn't single-use.
 * @param context - The resolved auth context.
 * @param request - The incoming request.
 * @param providerId - The provider id taken off the path.
 * @returns The 302 response, or the mapped error response; both clear the transaction cookie.
 */
export async function handleOidcCallback(
  context: AuthContext,
  request: Request,
  providerId: string,
): Promise<Response> {
  if (request.method !== "GET") throw new MethodNotAllowedError(request.method);

  const { oidc, provider } = requireProvider(context, providerId);
  const clear = clearCookie(oidc.transactionCookie);

  try {
    const url = new URL(request.url);
    const transaction = await verifyTransaction(
      oidc.secret,
      readCookie(request, oidc.transactionCookie.name),
      context.now(),
    );

    if (transaction.p !== providerId) throw new OAuthTransactionError();
    const state = url.searchParams.get("state") ?? "";
    if (!timingSafeEqual(transaction.s, state)) throw new OAuthTransactionError();

    if (url.searchParams.get("error")) {
      // The provider's `error_description` is never read: reflecting attacker-influenced text is how
      // an error page becomes a phishing page.
      throw new OidcProviderError("The identity provider refused the sign-in");
    }

    const code = url.searchParams.get("code");
    if (!code) throw new OidcProviderError("The callback carried no authorization code");

    const endpoints = await oidc.discovery.endpoints(provider);
    const tokens = await exchangeCode(
      context.fetch,
      endpoints,
      provider,
      code,
      transaction.v,
    );

    const claims = decodeIdToken(tokens.id_token as string);
    assertValidClaims(claims, {
      issuer: oidc.discovery.issuer(provider),
      clientId: provider.clientId,
      nonce: transaction.n,
      now: context.now(),
    });

    const user = await resolveOidcUser(
      { accounts: context.accounts, users: context.users, now: context.now },
      provider,
      claims,
    );
    const issued = await context.sessions.create(user.id, requestMetadata(request));

    const headers = new Headers({
      location: safeRedirect(transaction.r, {
        fallback: context.redirects.afterSignIn,
        allowedOrigins: context.redirects.allowedOrigins,
      }),
    });
    headers.append(
      "set-cookie",
      context.cookies.issue(issued.token, issued.session.expiresAt),
    );
    headers.append("set-cookie", clear);
    return new Response(null, { status: 302, headers });
  } catch (error) {
    const response = toErrorResponse(error);
    response.headers.append("set-cookie", clear);
    return response;
  }
}
