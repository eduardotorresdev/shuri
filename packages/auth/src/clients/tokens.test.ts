import { beforeEach, describe, expect, it } from "vitest";
import { InvalidScopeError } from "../errors.js";
import { createAuthStore, createClock } from "../test-support.js";
import { createClientService, type AuthClient, type ClientService } from "./service.js";
import {
  CLIENT_TOKEN_PREFIX,
  createClientTokenService,
  type ClientTokenService,
} from "./tokens.js";

const scopes = ["posts:list", "posts:view", "posts:create", "site:read"];
let clients: ClientService;
let tokens: ClientTokenService;
let clock: ReturnType<typeof createClock>;
let reader: AuthClient;

beforeEach(async () => {
  const store = createAuthStore();
  clock = createClock();
  clients = createClientService({
    clients: store.collection("_clients"),
    tokens: store.collection("_client_tokens"),
    roles: { reader: ["posts:list", "posts:view"] },
    scopes,
    now: clock,
  });
  tokens = createClientTokenService({
    tokens: store.collection("_client_tokens"),
    clients,
    scopes,
    now: clock,
    ttlMs: 1000,
  });
  reader = (await clients.create({ name: "bot", roles: ["reader"] })).client;
});

describe("createClientTokenService", () => {
  it("issues a prefixed token carrying every granted scope by default", async () => {
    const issued = await tokens.issue(reader);
    expect(issued.token.startsWith(CLIENT_TOKEN_PREFIX)).toBe(true);
    expect(issued.scope).toEqual(["posts:list", "posts:view"]);
    expect(issued.expiresAt).toBe(clock() + 1000);
  });

  it("narrows to the requested scopes, patterns included", async () => {
    expect((await tokens.issue(reader, ["posts:list"])).scope).toEqual(["posts:list"]);
    expect((await tokens.issue(reader, ["*:view"])).scope).toEqual(["posts:view"]);
  });

  it("refuses a scope outside the roles, or one the schema doesn't define", async () => {
    await expect(tokens.issue(reader, ["posts:create"])).rejects.toThrow(
      InvalidScopeError,
    );
    await expect(tokens.issue(reader, ["nope:list"])).rejects.toThrow(InvalidScopeError);
    await expect(tokens.issue(reader, ["posts:*"])).rejects.toThrow(InvalidScopeError);
  });

  it("resolves to a client principal, and to undefined once expired or revoked", async () => {
    const { token } = await tokens.issue(reader, ["posts:list"]);
    expect(await tokens.resolve(token)).toEqual({
      kind: "client",
      client: { id: reader.id, name: "bot", clientId: reader.clientId },
      scopes: new Set(["posts:list"]),
    });
    expect(await tokens.resolve("sct_nope")).toBeUndefined();

    clock.advance(1000);
    expect(await tokens.resolve(token)).toBeUndefined();

    const fresh = await tokens.issue(reader);
    await clients.revoke(reader.id);
    expect(await tokens.resolve(fresh.token)).toBeUndefined();
  });

  it("prunes expired rows and reports how many", async () => {
    await tokens.issue(reader);
    await tokens.issue(reader);
    clock.advance(999);
    expect(await tokens.pruneExpired()).toBe(0);
    clock.advance(2);
    expect(await tokens.pruneExpired()).toBe(2);
  });
});

describe("scope re-expansion", () => {
  it("follows the current schema and the client's current roles, with no reissue", async () => {
    const store = createAuthStore();
    const build = (universe: string[], roles: Record<string, readonly string[]>) => {
      const service = createClientService({
        clients: store.collection("_clients"),
        tokens: store.collection("_client_tokens"),
        roles,
        scopes: universe,
        now: createClock(),
      });
      return {
        clients: service,
        tokens: createClientTokenService({
          tokens: store.collection("_client_tokens"),
          clients: service,
          scopes: universe,
          now: createClock(),
          ttlMs: 1000,
        }),
      };
    };

    const before = build(["posts:list", "posts:view"], {
      integrator: ["posts:*"],
      admin: ["*"],
    });
    const client = (
      await before.clients.create({ name: "bot", roles: ["integrator", "admin"] })
    ).client;
    const pattern = await before.tokens.issue(client, ["posts:*"]);
    const everything = await before.tokens.issue(client);
    expect(pattern.scope).toEqual(["posts:list", "posts:view"]);

    // A collection op added to the schema is covered by the pattern token at once...
    const after = build(["posts:list", "posts:view", "posts:delete", "site:read"], {
      integrator: ["posts:list"],
      admin: ["*"],
    });
    expect(await after.tokens.resolve(pattern.token)).toMatchObject({
      scopes: new Set(["posts:list", "posts:view", "posts:delete"]),
    });
    // ...and so is a global for the "everything" token.
    expect(await after.tokens.resolve(everything.token)).toMatchObject({
      scopes: new Set(["posts:list", "posts:view", "posts:delete", "site:read"]),
    });

    // A role trimmed in config shrinks every live token.
    const trimmed = build(["posts:list", "posts:view", "posts:delete"], {
      integrator: ["posts:list"],
      admin: [],
    });
    expect(await trimmed.tokens.resolve(pattern.token)).toMatchObject({
      scopes: new Set(["posts:list"]),
    });
  });
});
