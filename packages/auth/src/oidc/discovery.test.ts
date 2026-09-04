import { describe, expect, it } from "vitest";
import { OidcProviderError } from "../errors.js";
import { createClock } from "../test-support.js";
import { oidcProvider } from "./config.js";
import { createDiscovery, DISCOVERY_TTL_MS } from "./discovery.js";
import { createFetchStub, discoveryDocument, ISSUER } from "./test-support.js";

const provider = oidcProvider({
  id: "acme",
  issuer: ISSUER,
  clientId: "client-123",
  redirectUri: "https://app.example.com/cb",
});

describe("createDiscovery", () => {
  it("resolves the endpoints off the well-known document", async () => {
    const stub = createFetchStub();
    const discovery = createDiscovery(stub.fetch, createClock());

    expect(await discovery.endpoints(provider)).toEqual({
      authorization: `${ISSUER}/authorize`,
      token: `${ISSUER}/token`,
      userinfo: `${ISSUER}/userinfo`,
    });
    expect(stub.calls[0].url).toBe(`${ISSUER}/.well-known/openid-configuration`);
  });

  it("returns declared endpoints without fetching anything", async () => {
    const stub = createFetchStub();
    const discovery = createDiscovery(stub.fetch, createClock());
    const inline = oidcProvider({
      id: "inline",
      clientId: "client-123",
      redirectUri: "https://app.example.com/cb",
      endpoints: {
        authorization: `${ISSUER}/authorize`,
        token: `${ISSUER}/token`,
      },
    });

    await discovery.endpoints(inline);
    expect(stub.calls).toEqual([]);
  });

  it("caches for an hour, and single-flights concurrent callers", async () => {
    const stub = createFetchStub();
    const clock = createClock();
    const discovery = createDiscovery(stub.fetch, clock);

    await Promise.all([discovery.endpoints(provider), discovery.endpoints(provider)]);
    await discovery.endpoints(provider);
    expect(stub.calls).toHaveLength(1);

    clock.advance(DISCOVERY_TTL_MS + 1);
    await discovery.endpoints(provider);
    expect(stub.calls).toHaveLength(2);
  });

  it("never caches a failure, so one bad minute doesn't lock sign-in out for an hour", async () => {
    const stub = createFetchStub();
    const discovery = createDiscovery(stub.fetch, createClock());
    stub.setDiscovery(undefined);

    await expect(discovery.endpoints(provider)).rejects.toThrow(OidcProviderError);

    stub.setDiscovery(discoveryDocument());
    await expect(discovery.endpoints(provider)).resolves.toBeTruthy();
  });

  it("refuses a document whose issuer isn't the configured one", async () => {
    const stub = createFetchStub();
    stub.setDiscovery(discoveryDocument({ issuer: "https://other.example.com" }));

    await expect(
      createDiscovery(stub.fetch, createClock()).endpoints(provider),
    ).rejects.toThrow(/issuer does not match/);
  });

  it("refuses an endpoint pointing outside the issuer's origin: the mix-up attack", async () => {
    const stub = createFetchStub();
    stub.setDiscovery(
      discoveryDocument({ token_endpoint: "https://evil.example.com/token" }),
    );

    await expect(
      createDiscovery(stub.fetch, createClock()).endpoints(provider),
    ).rejects.toThrow(/outside the issuer's origin/);
  });

  it("refuses a non-https endpoint", async () => {
    const stub = createFetchStub();
    stub.setDiscovery(
      discoveryDocument({ authorization_endpoint: "http://idp.example.com/authorize" }),
    );

    await expect(
      createDiscovery(stub.fetch, createClock()).endpoints(provider),
    ).rejects.toThrow(OidcProviderError);
  });

  it("refuses a document missing an endpoint", async () => {
    const stub = createFetchStub();
    stub.setDiscovery({ issuer: ISSUER });

    await expect(
      createDiscovery(stub.fetch, createClock()).endpoints(provider),
    ).rejects.toThrow(/malformed/);
  });
});
