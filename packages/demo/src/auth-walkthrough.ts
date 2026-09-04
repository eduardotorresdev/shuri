/** The one credential pair the walkthrough registers, printed alongside the `curl` equivalents. */
const CREDENTIALS = { email: "ada@example.com", password: "correct-horse-battery" };

/**
 * Reads the session cookie off a `Set-Cookie`, exactly as a browser (or `curl -c jar`) would.
 * @param response - The response to read.
 * @returns The session token, or `undefined` when the response didn't set one.
 */
function sessionCookie(response: Response): string | undefined {
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("shuri_session="));
  return cookie
    ? decodeURIComponent(cookie.slice("shuri_session=".length).split(";")[0])
    : undefined;
}

/**
 * The `RequestInit` every mutating auth route needs: `POST` with a JSON content type, which is what
 * the routes require (and what a cross-origin form can't produce).
 * @param body - The body to send.
 * @returns The request init.
 */
function jsonPost(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/**
 * Drives signup -> me -> logout -> login against `app.handler`, carrying the cookie by hand, so
 * booting the demo already proves the whole flow works over plain `Request`/`Response`.
 * @param app - The app to drive; only its `handler` is needed, so this stays schema-agnostic.
 * @param port - The port the demo is served on, for the printed `curl` commands.
 * @returns Nothing; resolves once the walkthrough has run.
 */
export async function runAuthWalkthrough(
  app: { handler: (request: Request) => Promise<Response> },
  port: number,
): Promise<void> {
  const signup = await app.handler(
    new Request("http://localhost/auth/signup", jsonPost(CREDENTIALS)),
  );
  const token = sessionCookie(signup) ?? "";
  console.log(`  [auth] signup -> ${signup.status}`);

  const me = await app.handler(
    new Request("http://localhost/auth/me", {
      headers: { cookie: `shuri_session=${token}` },
    }),
  );
  const { user } = (await me.json()) as { user: { email: string } };
  console.log(`  [auth] me     -> ${me.status} ${user.email}`);

  const logout = await app.handler(
    new Request("http://localhost/auth/logout", {
      method: "POST",
      headers: { cookie: `shuri_session=${token}` },
    }),
  );
  console.log(`  [auth] logout -> ${logout.status}`);

  const login = await app.handler(
    new Request("http://localhost/auth/login", jsonPost(CREDENTIALS)),
  );
  console.log(`  [auth] login  -> ${login.status}`);

  const base = `http://localhost:${port}`;
  console.log(`  Auth:        curl -c jar -X POST ${base}/auth/signup \\`);
  console.log(`                 -H 'content-type: application/json' \\`);
  console.log(
    `                 -d '{"email":"you@example.com","password":"correct-horse-battery"}'`,
  );
  console.log(`               curl -b jar ${base}/auth/me`);
  console.log(`               curl -b jar -X POST ${base}/auth/logout`);
}
