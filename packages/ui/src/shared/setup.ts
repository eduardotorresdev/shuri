import { AdminRequestError } from "./errors.js";
import type { AdminClientOptions, FetchLike } from "./client.js";
import type { AdminSetup } from "./schema.js";

/** What the first-account form collects. */
export interface AdminSetupInput {
  email: string;
  password: string;
  name?: string;
  /** The one-time token, when the host requires one. */
  token?: string;
}

/**
 * Creates the app's first account and signs in as it, in one request.
 *
 * One request rather than "create, then log in": the two would be a window in which the account
 * exists and nobody holds it, and a second visitor finishing setup at the same moment would find the
 * form gone and no session to show for it. The route answers with the session cookie directly.
 * @param setup - The `setup` block of the admin schema.
 * @param input - The credentials to create the account with.
 * @param [options] - The `fetch` to use and the origin to resolve against.
 * @returns Nothing; a refused setup throws `AdminRequestError`.
 */
export async function runAdminSetup(
  setup: AdminSetup,
  input: AdminSetupInput,
  options: AdminClientOptions = {},
): Promise<void> {
  const doFetch: FetchLike = options.fetch ?? globalThis.fetch;

  const response = await doFetch(`${options.origin ?? ""}${setup.path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.ok) return;

  let body: { error?: unknown; issues?: unknown } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Falls through to the status-only message.
  }
  throw new AdminRequestError(
    response.status,
    typeof body.error === "string" ? body.error : `Request failed (${response.status})`,
    Array.isArray(body.issues) ? (body.issues as never) : [],
  );
}
