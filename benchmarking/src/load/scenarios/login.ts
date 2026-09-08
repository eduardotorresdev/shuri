import { httpScenario } from "./index.ts";

/** The CPU-bound route: one PBKDF2-SHA256 with 600k iterations per request, on the libuv threadpool. */
export const login = httpScenario({
  id: "login",
  sut: "auth",
  connections: [1, 4, 16],
  description:
    "`POST /auth/login` with the seeded credentials. PBKDF2-SHA256, 600k iterations, per request: c=1 is the ceiling of logins/s on the core; c=4 and c=16 show the threadpool (4 threads by default) queueing behind it.",
  requests: ({ login: credentials }) => [
    {
      method: "POST",
      path: "/auth/login",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(credentials),
    },
  ],
});
