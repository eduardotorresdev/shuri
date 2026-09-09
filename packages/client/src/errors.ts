/** One validation issue as the server reports it, path and message. */
export interface ClientIssue {
  path: string;
  message: string;
}

/**
 * Thrown for every non-2xx response. `status` is the HTTP status, `message` the server's `error`
 * (or better-auth's `message`), and `issues` the validation issues a 400 carries, when it does.
 */
export class ClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly issues?: ClientIssue[],
  ) {
    super(message);
    this.name = "ClientError";
  }
}

/**
 * Builds the `ClientError` for a failed response, reading the JSON error body the server writes
 * (`{ error, issues? }` from `@shuri/api`, `{ code, message }` from better-auth) and falling back
 * to the status text for anything else.
 * @param response - The non-2xx response.
 * @returns The error to throw.
 */
export async function toClientError(response: Response): Promise<ClientError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const details =
    typeof body === "object" && body !== null
      ? (body as { error?: unknown; message?: unknown; issues?: unknown })
      : {};
  const message =
    (typeof details.error === "string" && details.error) ||
    (typeof details.message === "string" && details.message) ||
    response.statusText ||
    `Request failed with status ${response.status}`;
  const issues = Array.isArray(details.issues)
    ? (details.issues as ClientIssue[])
    : undefined;
  return new ClientError(response.status, message, issues);
}
