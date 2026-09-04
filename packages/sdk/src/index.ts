export * from "./create.js";
export type {
  AuthApi,
  AuthConfig,
  AuthSession,
  AuthUser,
  IssuedSession,
  OidcProviderConfig,
  SessionMetadata,
} from "@shuri/auth";
export {
  AccountLinkRefusedError,
  AuthConfigError,
  AuthenticationFailedError,
  AuthSlugCollisionError,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  MissingEmailClaimError,
  OAuthTransactionError,
  OidcProviderError,
  UnauthenticatedError,
  UnknownProviderError,
  UnsupportedMediaTypeError,
  googleProvider,
  oidcProvider,
  usersCollection,
} from "@shuri/auth";
