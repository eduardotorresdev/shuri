import { describe, expect, it } from "vitest";
import {
  apiKeyFrom,
  createApiKeyResolver,
  permissionsToScopes,
  toApiKeyPrincipal,
} from "./api-key.js";

const universe = ["posts:list", "posts:view", "posts:create", "site:read", "site:update"];

describe("permissionsToScopes", () => {
  it("maps `{ resource: [action] }` onto `resource:action`, one to one", () => {
    expect([...permissionsToScopes({ posts: ["list", "view"] }, universe)]).toEqual([
      "posts:list",
      "posts:view",
    ]);
  });

  it("expands a `*` on either side against the schema", () => {
    expect([...permissionsToScopes({ posts: ["*"] }, universe)]).toEqual([
      "posts:list",
      "posts:view",
      "posts:create",
    ]);
    expect([...permissionsToScopes({ "*": ["list", "read"] }, universe)]).toEqual([
      "posts:list",
      "site:read",
    ]);
    expect(permissionsToScopes({ "*": ["*"] }, universe).size).toBe(universe.length);
  });

  it("grants nothing for a resource or action the schema doesn't have", () => {
    expect(permissionsToScopes({ users: ["*"], posts: ["fly"] }, universe).size).toBe(0);
    expect(permissionsToScopes(null, universe).size).toBe(0);
  });
});

const request = (headers: Record<string, string>) =>
  new Request("http://localhost/x", { headers });

describe("apiKeyFrom", () => {
  it("reads the configured headers in order, then a bearer", () => {
    expect(apiKeyFrom(request({ "x-api-key": "k1" }))).toBe("k1");
    expect(
      apiKeyFrom(request({ "x-api-key": "k1", "x-shuri-key": "k2" }), [
        "x-shuri-key",
        "x-api-key",
      ]),
    ).toBe("k2");
    expect(apiKeyFrom(request({ authorization: "Bearer  k3 " }))).toBe("k3");
  });

  it("is nothing for a blank header, a non-bearer Authorization, or no header at all", () => {
    expect(apiKeyFrom(request({ "x-api-key": "  " }))).toBeUndefined();
    expect(apiKeyFrom(request({ authorization: "Basic abc" }))).toBeUndefined();
    expect(apiKeyFrom(request({}))).toBeUndefined();
  });
});

describe("toApiKeyPrincipal", () => {
  it("is a client carrying the key's identity and expanded scopes, never a user", () => {
    const principal = toApiKeyPrincipal(
      {
        id: "k",
        name: null,
        referenceId: "u1",
        permissions: { posts: ["list"] },
        metadata: { env: "ci" },
      },
      universe,
    );

    expect(principal).toMatchObject({
      kind: "client",
      client: { id: "k", name: "k", referenceId: "u1", metadata: { env: "ci" } },
    });
    expect(principal.kind === "client" && [...principal.scopes]).toEqual(["posts:list"]);
  });
});

describe("createApiKeyResolver", () => {
  it("is a constant nothing without the plugin, so the session resolution runs", async () => {
    const resolve = createApiKeyResolver({ api: {} }, { universe });
    expect(
      await resolve(new Request("http://localhost/x", { headers: { "x-api-key": "k" } })),
    ).toBeUndefined();
  });

  it("answers nothing when verification fails or throws", async () => {
    const refused = createApiKeyResolver(
      { api: { verifyApiKey: async () => ({ valid: false, key: null }) } },
      { universe },
    );
    const broken = createApiKeyResolver(
      {
        api: {
          verifyApiKey: async () => {
            throw new Error("boom");
          },
        },
      },
      { universe },
    );
    const withKey = new Request("http://localhost/x", { headers: { "x-api-key": "k" } });

    expect(await refused(withKey)).toBeUndefined();
    expect(await broken(withKey)).toBeUndefined();
  });

  it("never calls out for a request carrying no key", async () => {
    let calls = 0;
    const resolve = createApiKeyResolver(
      {
        api: {
          verifyApiKey: async () => {
            calls += 1;
            return { valid: false, key: null };
          },
        },
      },
      { universe },
    );

    expect(await resolve(new Request("http://localhost/x"))).toBeUndefined();
    expect(calls).toBe(0);
  });
});
