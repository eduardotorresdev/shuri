# @shuri/auth

Authentication for a Shuri app: signup, login, logout and current-session by email and password, plus
sign-in through OIDC providers the host declares (Google as a preset). The three collections it needs
live in the **same** `Core`/`Store`/adapter as the app's own, so they get the same validation, the
same event bus, and work on any engine with no second port to configure.

Zero third-party dependencies, like the rest of the repo: PBKDF2, HMAC and SHA-256 come from
WebCrypto, and base64url and cookies are written here.

Scope of this round is **authentication only**. Per-collection rules/RBAC, email verification and
password reset are deliberately out (see "Deliberately absent" below).

## Tree

```
src/
  index.ts                    re-exports the public surface
  collections.ts               users / _sessions / _accounts, all internal: true
  config.ts                     AuthConfig -> AuthContext: defaults, bound collections, OIDC runtime
  create.ts                      createAuth -> AuthApi; assertNoAuthSlugCollision
  errors.ts                       every error, all extending ApiError/IssuesApiError
  types.ts                         AuthUser, AuthSession, IssuedSession, SessionMetadata, Now
  test-support.ts                   createAuthStore/createTestHasher/createClock/readSetCookie
  crypto/
    base64url.ts                 encode/decode, bytes and text
    random.ts                     randomBytes/randomToken (32 bytes -> 43 chars)
    digest.ts                     sha256/sha256Base64Url
    equal.ts                      timingSafeEqual
    hmac.ts                       hmacSha256/verifyHmacSha256
  password/
    hasher.ts                    PasswordHasher — the port
    encoding.ts                   the self-describing `$pbkdf2-sha256$i=..,dk=..$salt$digest` format
    pbkdf2.ts                     the default hasher (PBKDF2-HMAC-SHA256, 600k iterations)
    registry.ts                   createHasherRegistry: dispatch by algorithm id
  http/
    cookie.ts                    resolve/serialize/clear/parse; HttpOnly always
    bearer.ts                     readBearerToken
    body.ts                       readJsonObject (requires a JSON content type)
    redirect.ts                   safeRedirect
    routes.ts                     matchAuthRoute
  sessions/
    tokens.ts                    issueSessionToken/hashSessionToken
    store.ts                      createSessionService: create/resolve/revoke/pruneExpired
    cookie.ts                     createSessionCookies: issue/clear/read
  users/
    service.ts                   findByEmail/findById/create/update, normalizeEmail
    public.ts                     toPublicUser — whitelists from the schema
  credentials/
    validators.ts                parseCredentials
    signup.ts                     signUp + CredentialsContext
    login.ts                      signIn, with the equal-cost dummy hash
  oidc/
    types.ts                     OidcProviderConfig/ResolvedProvider/IdTokenClaims
    config.ts                     oidcProvider: validate + defaults
    discovery.ts                  createDiscovery: fetch, check, cache
    pkce.ts                       createPkcePair (S256)
    transaction.ts                the signed, short-lived transaction cookie
    authorize.ts                  buildAuthorizationUrl
    token.ts                      exchangeCode
    id-token.ts                   decodeIdToken + assertValidClaims
    link.ts                       resolveOidcUser: (provider, sub) -> local user
    presets/google.ts             googleProvider
    test-support.ts               fetch stub, id_token builder, the OIDC harness
  routes/
    handler.ts                   createAuthHandler: the falling handler
    signup.ts / login.ts / logout.ts / me.ts
    oidc-start.ts / oidc-callback.ts
    session-response.ts / metadata.ts
  test/
    password-flow.test.ts        signup -> me -> logout -> login over HTTP
    enumeration.test.ts           unknown email and wrong password are indistinguishable
    session-expiry.test.ts        lazy expiry and sliding renewal
    oidc-flow.test.ts             start -> callback against a stubbed fetch
    oidc-transaction.test.ts      every way a transaction fails, failing identically
```

## The routes

| Method | Path                            | Success                  | Errors                            |
| ------ | ------------------------------- | ------------------------ | --------------------------------- |
| POST   | `/auth/signup`                  | 201 `{ user }` + cookie  | 400 · 405 · 409 · 415             |
| POST   | `/auth/login`                   | 200 `{ user }` + cookie  | 400 · **401 generic** · 405 · 415 |
| POST   | `/auth/logout`                  | 204 + clearing cookie    | 405                               |
| GET    | `/auth/me`                      | 200 `{ user }`           | 401 · 405                         |
| GET    | `/auth/oidc/:provider`          | 302 + transaction cookie | 404 · 405 · 502                   |
| GET    | `/auth/oidc/:provider/callback` | 302 + session cookie     | 400 · 403 · 404 · 502             |

`basePath` defaults to `/auth`; anything outside it returns `undefined`, the same fall-through
contract `@shuri/api`'s handlers follow.

## What each part does, and why it is that way

- **collections.ts** — `users`, `_sessions` and `_accounts`, all `internal: true`, with
  `users.passwordHash` also `hidden`. `users` is internal **by default** because without
  per-collection rules a served `users` is an open directory of every registered address — `hidden`
  removes a _field_ from a response, it doesn't hide _rows_. The host opts out in one line:
  `create({ collections: [{ ...usersCollection, internal: false }, ...] })`. `passwordHash` is
  deliberately not `required`: a field that is both `hidden` and `required` makes a collection
  impossible to create over REST, and an OIDC-only user has no password at all. Every instant is a
  `number` (epoch ms), not an ISO string, because the memory adapter compares strings with
  `localeCompare` — locale-dependent collation — while numbers take the exact `a - b` branch.
  Exported individually so a host can extend one (`{ ...usersCollection, fields: [...] }`) instead of
  forking the package.
- **password/** — PBKDF2-HMAC-SHA256 at 600k iterations behind a `PasswordHasher` port, so a Node
  host can plug argon2 in. The stored format is self-describing, and `verify` reads iterations, salt
  and key length **from the stored hash**, never from the current config: raising the cost next year
  keeps every existing hash verifiable, and `needsRehash` lets a successful login rewrite the row
  silently. The parser caps `iterations` at 10M — a corrupted row claiming `i=2000000000` would pin a
  core for minutes on every attempt against it — and returns `undefined` (never throws) for anything
  it can't read, so `verify` answers `false` instead of 500ing.
- **sessions/** — an opaque 32-byte token, stored only as `base64url(SHA-256(token))`: a database
  dump can't be replayed as valid sessions, and revocation is a row delete rather than a token
  blacklist. No salt and no stretching on that digest — 256 uniform bits have no dictionary, and
  stretching would add latency to _every authenticated request_. Lookup is one `findMany` with an
  `eq` filter, deliberately: in the memory adapter `eq` is strict `===` and never reaches `compare`,
  which answers "equal" for anything that isn't a number/string/boolean. Expiry is checked in memory
  and the dead row deleted on the way through, as is a row whose user is gone. `resolve` **may
  write**: sliding renewal (30-day TTL, 15-day window; `renewWithinMs: 0` disables it) is applied on
  read. Nothing in this package ever calls `setInterval` — `pruneExpiredSessions()` is offered for a
  host's cron, because a live interval holds the event loop (and every `vitest run`) open.
- **http/cookie.ts** — `shuri_session`; `HttpOnly` **always, not configurable** (a session cookie
  readable from JS turns every XSS into an account takeover); `Secure` defaults to `true` but is
  flippable, or `http://localhost` never stores it; `SameSite=Lax`, not `Strict`, because `Strict` is
  withheld on any top-level navigation from another site — and the OIDC callback _is_ one, so
  `Strict` would fail 100% of OIDC logins. Lifetime travels as `Max-Age`, so a skewed client clock
  can't extend it. The parser is deliberately tolerant (the `Cookie` header is a shared bus): first
  `=` only, `;;` skipped, quotes stripped, first occurrence wins, and a `URIError` from a malformed
  escape falls back to the raw value — a junk third-party cookie must never 500 a request.
  `clearSessionCookie` is built from the **same resolved options** as the one it clears, since a
  browser matches for replacement by name+domain+path.
- **credentials/login.ts** — one `AuthenticationFailedError` for all three failures (unknown email,
  account with no password, wrong password), after the _same_ amount of work: a dummy hash is
  verified when there is no real one. Without it an unknown address answers in ~1ms and a wrong
  password in ~300ms, an enumeration oracle readable with a stopwatch. The dummy is derived at
  runtime from the current parameters (a hardcoded constant stops matching the real cost the day the
  iteration count goes up) and computed once per process. The OIDC-only case burns a derivation too —
  returning early there would leak "this address exists and signs in with Google".
- **oidc/discovery.ts** — three non-optional checks on the fetched document: `issuer` identical to
  the configured one (RFC 8414 §3.3), every endpoint `https:`, and **every endpoint's origin equal to
  the issuer's**. The last is the mix-up defense: a document pointing `token_endpoint` at another
  host is how a hostile discovery steals authorization codes. Success is cached for an hour behind a
  single-flight promise; failure is never cached. Every outbound call carries
  `AbortSignal.timeout(10s)`.
- **oidc/transaction.ts** — `state`, `nonce` and the PKCE verifier ride in a signed cookie
  (`shuri_oidc_tx`, `Path` scoped to the OIDC subtree, `Max-Age=600`), not a store row: the
  transaction is per-browser and single-use, it works in serverless with no affinity, and abandoned
  consent screens need no cleanup job. Format `<payloadB64url>.<hmacB64url>`; **the HMAC is verified
  before anything is parsed**. Absent, tampered, malformed, expired, wrong provider and non-matching
  `state` all raise the _same_ `OAuthTransactionError` with the same message. The `state` echo exists
  on top of the cookie because the cookie only proves "this browser started _a_ sign-in"; the echo
  proves "this callback belongs to _that_ one", which is what blocks login-CSRF. The cookie is
  cleared on **every** exit path, success or failure.
- **oidc/id-token.ts** — **the id_token's signature is not verified, and that is sanctioned.** OIDC
  Core 3.1.3.7 item 6 lets a client that received the token straight from the token endpoint, over
  TLS with the server authenticated by certificate validation, use that validation _instead of_ the
  signature check. Every precondition holds here: we hold the code and make the POST ourselves, to a
  URL whose origin was checked against the issuer's, with `fetch` validating the certificate. So
  there is no JWKS fetcher, key cache, `kid` selector or RS256 verifier. In exchange, claim
  validation is strict and is the whole defense: `iss` identical, `aud` containing our `clientId`
  with `azp` matching when present, `exp`/`iat` inside a 60s skew and no older than 10 minutes,
  non-empty `sub`, and `nonce` equal to the transaction's, compared in constant time. **This holds
  only under direct exchange** — the day an implicit/hybrid flow or a front-end-posted id_token
  appears, JWKS becomes mandatory. Decoding and validation are separate functions precisely so that
  is one new file and one new call site.
- **oidc/link.ts** — in order: an existing `(provider, sub)` link wins (the email is not consulted —
  `sub` is the stable identity); a **verified** claim matching an existing user links to it **only
  when that user's own `emailVerified` is already true too** — otherwise a generic 403 that says
  nothing about the account existing. Requiring both sides closes federated-merge pre-hijacking: with
  no email-verification flow, `POST /auth/signup` lets anyone plant `victim@example.com` (unverified,
  attacker's password) ahead of the real owner, and a check that trusted the incoming claim alone
  would let the victim's later "Sign in with Google" merge straight into that planted row. No email
  claim is a 400 asking for the scope; otherwise a new user plus link.
- **http/redirect.ts** — `?redirectTo=` is honored only for a path starting with exactly one `/`
  (never `//` or `/\`, both protocol-relative), free of control characters, or an absolute URL whose
  origin the host listed. A callback reflecting an attacker-chosen `Location` is a
  credential-phishing primitive.
- **errors.ts** — every error extends `ApiError` or `IssuesApiError`, which is why `@shuri/api`'s
  `toErrorResponse` needed no change: it branches on those base classes, not on a registry of
  concrete ones. The import edge points one way only, `auth -> api`.

## CSRF posture

`SameSite=Lax` plus a required `content-type: application/json` on every mutating route (a
cross-origin `<form>` can only send three content types, none of them JSON, and `fetch` with a JSON
type triggers a preflight the browser blocks). Logout is `POST`, never `GET` — a `GET` logout fires
from any `<img src>`, and from link scanners and prefetchers. No double-submit token this round.
A request authenticated by `Authorization: Bearer` is immune to all of this by construction, which is
why the bearer header takes precedence over the cookie.

## Role in the monorepo

`@shuri/sdk`'s `create()` merges `authCollections` into the schema _before_ `createCore`, then builds
the service with `createAuth({ store, ...config.auth })` and prepends `auth.handler` to
`createHandler`'s chain. That works because this package is two separable things: a **static
constant** of schemas that depends on nothing, and a **service** bound to a store. `createAuth` takes
`Pick<Store, "collection">` — the same minimal structural shape `@shuri/api`'s handlers take — so
nothing here depends on `@shuri/sdk`, and the dependency order stays
`validate -> core -> store -> (store-memory, api) -> auth -> sdk -> demo`.

## Deliberately absent

- **RBAC / per-collection rules** — separate work. It is what will let `users` be served again.
- **Email verification and password reset** — both need an email-sending port. Their absence is why
  signup's 409 still reveals that an address is registered: closing that leak means always answering
  201 and mailing a notice.
- **Sign out everywhere** — cheap when wanted:
  `findMany({ where: { user: { op: "eq", value: userId } } })` and delete.
- **`/auth/*` in the OpenAPI document** — `buildOpenApiDocument` only knows the core and the three
  base paths, so the auth routes don't appear in `/openapi.json`. That weakens the documented
  invariant that the document describes the routes actually served; the fix (auth exports a paths
  fragment, `createOpenApiHandler` gains a `paths?` to merge) is purely additive.
- **JWKS / RS256 verification** — unnecessary under direct exchange, as above.
