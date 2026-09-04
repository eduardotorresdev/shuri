import type { RecordId } from "@shuri/store";

/** A user as it leaves this package: every declared non-`hidden` field, plus `id`. See `users/public.ts`. */
export interface AuthUser {
  id: RecordId;
  email: string;
  name?: string;
  emailVerified?: boolean;
  createdAt: number;
  [field: string]: unknown;
}

/** A live session, resolved from a request's cookie or bearer token. */
export interface AuthSession {
  id: RecordId;
  user: AuthUser;
  /** Epoch milliseconds, possibly further out than when the session was read: see the sliding renewal in `sessions/store.ts`. */
  expiresAt: number;
  /** Whether reading this session slid its expiry forward, so the caller knows to re-emit the cookie. */
  renewed: boolean;
}

/** A session that was just created, with the one and only copy of its plaintext token. */
export interface IssuedSession {
  session: AuthSession;
  /** The plaintext token. Never stored, never recoverable — only its SHA-256 lives in the store. */
  token: string;
  user: AuthUser;
}

/** Client metadata recorded on a session, purely for the host's own auditing. */
export interface SessionMetadata {
  userAgent?: string;
  ip?: string;
}

/** Returns the current time in epoch milliseconds. Injectable so expiry has a testable clock. */
export type Now = () => number;

export type { Credentials } from "./credentials/validators.js";
