import { httpScenario } from "./index.ts";

/** The CPU-bound route: one scrypt derivation per request (better-auth's default hasher). */
export const login = httpScenario({
  id: "login",
  sut: "auth",
  connections: [1, 4, 16],
  description:
    "`POST /api/auth/sign-in/email` with the seeded credentials. One scrypt derivation per request: c=1 is the ceiling of logins/s on the core; c=4 and c=16 show the threadpool (4 threads by default) queueing behind it.",
  requests: ({ login: credentials }) => [
    {
      method: "POST",
      path: "/api/auth/sign-in/email",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify(credentials),
    },
  ],
});
