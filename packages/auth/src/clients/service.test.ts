import { beforeEach, describe, expect, it } from "vitest";
import { UnknownRoleError } from "../errors.js";
import { createAuthStore, createClock } from "../test-support.js";
import {
  CLIENT_SECRET_PREFIX,
  createClientService,
  type ClientService,
} from "./service.js";

const scopes = ["posts:list", "posts:view", "posts:create", "site:read"];
let clients: ClientService;
let clock: ReturnType<typeof createClock>;
let tokens: ReturnType<ReturnType<typeof createAuthStore>["collection"]>;

beforeEach(() => {
  const store = createAuthStore();
  clock = createClock();
  tokens = store.collection("_client_tokens");
  clients = createClientService({
    clients: store.collection("_clients"),
    tokens,
    roles: { reader: ["posts:list", "posts:view"], admin: ["*"] },
    scopes,
    now: clock,
  });
});

describe("createClientService", () => {
  it("creates a client, returning the secret once and never the hash", async () => {
    const { client, clientSecret } = await clients.create({
      name: "bot",
      roles: ["reader"],
    });
    expect(clientSecret.startsWith(CLIENT_SECRET_PREFIX)).toBe(true);
    expect(client).toEqual({
      id: expect.any(String),
      name: "bot",
      clientId: expect.any(String),
      roles: ["reader"],
      createdAt: clock(),
    });
    expect(JSON.stringify(await clients.list())).not.toContain("secretHash");
  });

  it("refuses a role the config doesn't declare", async () => {
    await expect(clients.create({ name: "x", roles: ["writer"] })).rejects.toThrow(
      UnknownRoleError,
    );
  });

  it("verifies the pair, and answers undefined for a wrong secret, an unknown id and a revoked client", async () => {
    const { client, clientSecret } = await clients.create({ name: "bot" });
    expect(await clients.verify(client.clientId, clientSecret)).toEqual(client);
    expect(await clients.verify(client.clientId, "scs_wrong")).toBeUndefined();
    expect(await clients.verify("nope", clientSecret)).toBeUndefined();

    await clients.revoke(client.id);
    expect(await clients.verify(client.clientId, clientSecret)).toBeUndefined();
    expect((await clients.get(client.id))?.revokedAt).toBe(clock());
  });

  it("rotates the secret, invalidating the old one", async () => {
    const { client, clientSecret } = await clients.create({ name: "bot" });
    const rotated = await clients.rotateSecret(client.id);
    expect(rotated.clientSecret).not.toBe(clientSecret);
    expect(await clients.verify(client.clientId, clientSecret)).toBeUndefined();
    expect(await clients.verify(client.clientId, rotated.clientSecret)).toMatchObject({
      id: client.id,
    });
  });

  it("deletes the client's tokens on revoke", async () => {
    const { client } = await clients.create({ name: "bot" });
    await tokens.insert({
      tokenHash: "x".repeat(43),
      client: client.id,
      createdAt: 1,
      expiresAt: 2,
    });
    await clients.revoke(client.id);
    expect(await tokens.count()).toBe(0);
  });

  it("expands roles into the concrete scopes the schema defines", async () => {
    const { client } = await clients.create({ name: "bot", roles: ["reader"] });
    expect([...clients.allowedScopes(client)]).toEqual(["posts:list", "posts:view"]);
    const { client: admin } = await clients.create({ name: "root", roles: ["admin"] });
    expect([...clients.allowedScopes(admin)]).toEqual(scopes);
    const { client: none } = await clients.create({ name: "idle" });
    expect(clients.allowedScopes(none).size).toBe(0);
  });
});
