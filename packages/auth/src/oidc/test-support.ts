import { encodeBase64UrlText } from "../crypto/base64url.js";
import { createAuth, type AuthApi } from "../create.js";
import {
  createAuthStore,
  createClock,
  createTestHasher,
  readSetCookie,
} from "../test-support.js";
import { TRANSACTION_COOKIE_NAME } from "./transaction.js";
import type { IdTokenClaims } from "./types.js";

export const ISSUER = "https://idp.example.com";
export const CLIENT_ID = "client-123";

/**
 * The discovery document a well-behaved provider serves.
 * @param [overrides] - Fields to replace, for the checks a hostile document would fail.
 * @returns The discovery document body.
 */
export function discoveryDocument(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    userinfo_endpoint: `${ISSUER}/userinfo`,
    ...overrides,
  };
}

/**
 * Builds an unsigned compact JWS carrying `claims`. The signature is a placeholder because this
 * package verifies claims, not signatures (see `id-token.ts` for why that is sanctioned here).
 * @param claims - The claims to encode.
 * @returns The compact id_token.
 */
export function idToken(claims: Partial<IdTokenClaims>): string {
  const header = encodeBase64UrlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = encodeBase64UrlText(JSON.stringify(claims));
  return `${header}.${payload}.signature-not-checked`;
}

/**
 * Claims a provider would return for a verified Google-style identity.
 * @param nowMs - The current time, epoch milliseconds, that `exp`/`iat` are derived from.
 * @param [overrides] - Claims to replace.
 * @returns The claims.
 */
export function baseClaims(
  nowMs: number,
  overrides: Partial<IdTokenClaims> = {},
): IdTokenClaims {
  return {
    iss: ISSUER,
    aud: CLIENT_ID,
    sub: "subject-1",
    exp: Math.floor(nowMs / 1000) + 300,
    iat: Math.floor(nowMs / 1000),
    email: "ada@example.com",
    email_verified: true,
    name: "Ada Lovelace",
    ...overrides,
  };
}

export interface FetchStub {
  fetch: typeof fetch;
  /** Every request the stub answered, in order. */
  calls: { url: string; body?: string }[];
  /** Replaces the discovery document served for the next call. */
  setDiscovery(document: Record<string, unknown> | undefined): void;
  /** Replaces the token response served for the next call. */
  setTokens(tokens: Record<string, unknown> | undefined): void;
}

/**
 * A `fetch` answering the two endpoints an OIDC sign-in touches, so the flow is exercised end to
 * end without a network.
 * @param [tokens] - The initial token response.
 * @returns The stub, with the calls it recorded.
 */
export function createFetchStub(tokens: Record<string, unknown> = {}): FetchStub {
  const stub: FetchStub = {
    calls: [],
    setDiscovery(document) {
      discovery = document;
    },
    setTokens(next) {
      tokenResponse = next;
    },
    fetch: (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      stub.calls.push({ url, body: init?.body ? String(init.body) : undefined });

      if (url.includes("/.well-known/openid-configuration")) {
        return jsonOrFailure(discovery);
      }
      if (url.endsWith("/token")) return jsonOrFailure(tokenResponse);
      return new Response(null, { status: 404 });
    }) as typeof fetch,
  } as FetchStub;

  let discovery: Record<string, unknown> | undefined = discoveryDocument();
  let tokenResponse: Record<string, unknown> | undefined = tokens;
  return stub;
}

function jsonOrFailure(body: Record<string, unknown> | undefined): Response {
  if (!body) return new Response(null, { status: 500 });
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

/** One started sign-in, as a test carries it from the start route to the callback. */
export interface StartedSignIn {
  txCookie: string;
  state: string;
  nonce: string;
}

/** Everything the two OIDC route suites drive the flow through. */
export interface OidcHarness {
  auth: AuthApi;
  stub: FetchStub;
  clock: ReturnType<typeof createClock>;
  /** Answers a request through the auth handler, failing if it declines to. */
  answer(request: Request): Promise<Response>;
  /** Runs the start route and returns what the callback needs. */
  start(query?: string): Promise<StartedSignIn>;
  /** Builds a callback request carrying the transaction cookie. */
  callback(started: StartedSignIn, params: Record<string, string>): Request;
  /** Stubs the token response for the next exchange, echoing the current nonce. */
  withTokens(claims?: Record<string, unknown>): void;
}

/** The signing secret the OIDC suites configure. */
export const TEST_SECRET = "a-signing-secret-of-32-characters";
export const TEST_REDIRECT_URI = "https://app.example.com/auth/oidc/acme/callback";

/**
 * An app with one OIDC provider ("acme") over a stubbed `fetch` and a controllable clock, plus the
 * helpers to drive a sign-in from start to callback.
 * @returns The harness.
 */
export function createOidcHarness(): OidcHarness {
  const clock = createClock();
  const stub = createFetchStub();
  const auth = createAuth({
    store: createAuthStore(),
    hasher: createTestHasher(),
    cookie: { secure: false },
    secret: TEST_SECRET,
    now: clock,
    fetch: stub.fetch,
    providers: [
      {
        id: "acme",
        issuer: ISSUER,
        clientId: CLIENT_ID,
        clientSecret: "s3cret",
        redirectUri: TEST_REDIRECT_URI,
      },
    ],
  });

  let nonce = "";

  const harness: OidcHarness = {
    auth,
    stub,
    clock,

    async answer(request) {
      const response = await auth.handler(request);
      if (!response)
        throw new Error(`expected the auth handler to answer ${request.url}`);
      return response;
    },

    async start(query = "") {
      const response = await harness.answer(
        new Request(`http://localhost/auth/oidc/acme${query}`),
      );
      const location = new URL(response.headers.get("location") as string);
      nonce = location.searchParams.get("nonce") as string;
      return {
        txCookie: readSetCookie(response, TRANSACTION_COOKIE_NAME) as string,
        state: location.searchParams.get("state") as string,
        nonce,
      };
    },

    callback(started, params) {
      const url = new URL("http://localhost/auth/oidc/acme/callback");
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      return new Request(url, {
        headers: { cookie: `${TRANSACTION_COOKIE_NAME}=${started.txCookie}` },
      });
    },

    withTokens(claims = {}) {
      stub.setTokens({
        id_token: idToken({ ...baseClaims(clock()), nonce, ...claims }),
        token_type: "Bearer",
      });
    },
  };

  return harness;
}
