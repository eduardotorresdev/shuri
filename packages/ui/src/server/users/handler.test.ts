import { describe, expect, it } from "vitest";
import type { UserAdminApi } from "@shuri/auth";
import { resolveAdminAuth } from "../auth/access.js";
import { asUser, stubSessions } from "../auth/test-support.js";
import { createAdminUsersHandler } from "./handler.js";

const api = { collections: "/collections", globals: "/globals", events: "/events" };

/**
 * A `UserAdminApi` over a list, recording what it was asked so a test can assert on the call.
 * @returns The stub, with the calls it recorded.
 */
function stubUsers(): UserAdminApi & { calls: string[] } {
  const calls: string[] = [];
  const rows = [
    { id: "u1", email: "ada@example.com", createdAt: 1 },
    { id: "u2", email: "alan@example.com", createdAt: 2 },
  ];

  return {
    calls,
    async list(query) {
      calls.push(`list ${JSON.stringify(query ?? {})}`);
      return rows;
    },
    async get(id) {
      calls.push(`get ${id}`);
      return rows[0];
    },
    async create(input) {
      calls.push(`create ${input.email}`);
      return { id: "u3", email: input.email, createdAt: 3 };
    },
    async update(id, patch) {
      calls.push(`update ${id} ${Object.keys(patch).join(",")}`);
      return rows[0];
    },
    async remove(id) {
      calls.push(`remove ${id}`);
    },
  };
}

const sessions = stubSessions({
  ada: { id: "u1", role: "editor" },
  bob: { id: "u2", role: "reader" },
});

function handlerFor(users: UserAdminApi, strict = false) {
  const auth = resolveAdminAuth(
    {
      auth: sessions,
      ...(strict ? { authorize: (s) => s.user["role"] === "editor" } : {}),
    },
    api,
  );
  return createAdminUsersHandler(users, auth, "/admin/api/users");
}

const get = (token?: string, path = "/admin/api/users") =>
  asUser(token, new Request(`http://x${path}`));

const send = (token: string | undefined, method: string, path: string, body?: unknown) =>
  asUser(
    token,
    new Request(`http://x${path}`, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    }),
  );

describe("access", () => {
  it("refuses an anonymous read with 401 — a list of addresses is not public content", async () => {
    const response = await handlerFor(stubUsers())(get());

    expect(response?.status).toBe(401);
  });

  it("answers 403 for a session the host's authorize turns away", async () => {
    expect((await handlerFor(stubUsers(), true)(get("bob")))?.status).toBe(403);
  });

  it("serves an authorized session", async () => {
    const response = await handlerFor(stubUsers(), true)(get("ada"));

    expect(response?.status).toBe(200);
    expect(await response?.json()).toHaveLength(2);
  });

  it("declines everything outside its own path, so other handlers get their turn", async () => {
    const handler = handlerFor(stubUsers());

    expect(await handler(get("ada", "/admin/schema.json"))).toBeUndefined();
    expect(await handler(get("ada", "/admin/api/users/u1/sessions"))).toBeUndefined();
    expect(await handler(get("ada", "/collections/posts"))).toBeUndefined();
  });
});

describe("routes", () => {
  it("passes the list query through, the same one every other list speaks", async () => {
    const users = stubUsers();
    await handlerFor(users)(
      get(
        "ada",
        '/admin/api/users?limit=10&where={"email":{"op":"contains","value":"ada"}}',
      ),
    );

    expect(users.calls[0]).toContain('"op":"contains"');
    expect(users.calls[0]).toContain('"limit":10');
  });

  it("answers 201 on create", async () => {
    const users = stubUsers();
    const response = await handlerFor(users)(
      send("ada", "POST", "/admin/api/users", { email: "grace@example.com" }),
    );

    expect(response?.status).toBe(201);
    expect(users.calls).toEqual(["create grace@example.com"]);
  });

  it("passes a patch through as it came, password included", async () => {
    const users = stubUsers();
    await handlerFor(users)(
      send("ada", "PATCH", "/admin/api/users/u2", { password: "a long enough one" }),
    );

    expect(users.calls).toEqual(["update u2 password"]);
  });

  it("answers 204 on delete", async () => {
    const users = stubUsers();
    const response = await handlerFor(users)(
      send("ada", "DELETE", "/admin/api/users/u2"),
    );

    expect(response?.status).toBe(204);
    expect(users.calls).toEqual(["remove u2"]);
  });

  it("refuses deleting the account the caller is signed in as", async () => {
    const users = stubUsers();
    const response = await handlerFor(users)(
      send("ada", "DELETE", "/admin/api/users/u1"),
    );

    expect(response?.status).toBe(409);
    expect(users.calls).toEqual([]);
  });

  it("answers 405 for a method the route doesn't have", async () => {
    const response = await handlerFor(stubUsers())(
      send("ada", "PUT", "/admin/api/users/u2"),
    );

    expect(response?.status).toBe(405);
  });
});
