import { createCore } from "@shuri/core";
import { createStore, type Store } from "@shuri/store";
import { createMemoryAdapter } from "@shuri/store-memory";
import { authCollections } from "./collections.js";
import { createPbkdf2Hasher } from "./password/pbkdf2.js";
import type { PasswordHasher } from "./password/hasher.js";

/**
 * A real `Store` over the four auth collections, backed by `@shuri/store-memory`. Real schema, real
 * validation, real event bus — nothing about auth is worth testing against a fake store.
 * @returns A store declaring `users`, `_sessions`, `_accounts` and `_oidc_credentials`.
 */
export function createAuthStore(): Store {
  return createStore(
    createCore({ collections: [...authCollections] }),
    createMemoryAdapter(),
  );
}

/**
 * A PBKDF2 hasher turned down to 1000 iterations. Same format and same code path as the 600k
 * default; the only difference is that a suite deriving dozens of keys finishes in milliseconds.
 * @returns A fast `PasswordHasher` for tests.
 */
export function createTestHasher(): PasswordHasher {
  return createPbkdf2Hasher({ iterations: 1_000 });
}

/**
 * A clock a test can move by hand, so session expiry and renewal are exercised without waiting.
 * @param [start] - The initial epoch-milliseconds value.
 * @returns The clock function, with `advance` to move it forward.
 */
export function createClock(start = 1_700_000_000_000): (() => number) & {
  advance: (ms: number) => void;
} {
  let current = start;
  const now = () => current;
  return Object.assign(now, {
    advance(ms: number) {
      current += ms;
    },
  });
}

/**
 * Reads the `Set-Cookie` of a response and returns the value of one cookie, the way a browser (or
 * the demo walkthrough) would carry it to the next request.
 * @param response - The response to read.
 * @param [name] - The cookie name to extract.
 * @returns The cookie value, or `undefined` when the response didn't set it.
 */
export function readSetCookie(
  response: Response,
  name = "shuri_session",
): string | undefined {
  const header = response.headers.get("set-cookie");
  const match = header?.match(new RegExp(`(?:^|, )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}
