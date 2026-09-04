import { beforeEach, describe, expect, it } from "vitest";
import type { CollectionStore, RecordInput, Store } from "@shuri/store";
import { createAuthStore } from "../test-support.js";
import { resolveProviderSlot } from "./credentials.js";
import { IncompleteOidcCredentialsError, UnknownProviderError } from "../errors.js";
import type { OidcProviderSlot } from "./types.js";

let store: Store;
let credentials: CollectionStore<RecordInput>;

beforeEach(() => {
  store = createAuthStore();
  credentials = store.collection("_oidc_credentials" as never) as CollectionStore<RecordInput>;
});

describe("resolveProviderSlot", () => {
  it("completes a google slot from its _oidc_credentials row", async () => {
    await credentials.insert({
      provider: "google",
      clientId: "client-123",
      clientSecret: "s3cret",
      redirectUri: "https://app.example.com/auth/oidc/google/callback",
    });

    const slot: OidcProviderSlot = { id: "google", preset: "google" };
    const resolved = await resolveProviderSlot(slot, credentials);

    expect(resolved).toMatchObject({
      id: "google",
      issuer: "https://accounts.google.com",
      clientId: "client-123",
      tokenAuthMethod: "client_secret_basic",
    });
  });

  it("completes a microsoft slot, tenant included", async () => {
    await credentials.insert({
      provider: "ms",
      clientId: "client-456",
      clientSecret: "s3cret",
      redirectUri: "https://app.example.com/auth/oidc/ms/callback",
      tenant: "contoso.onmicrosoft.com",
    });

    const slot: OidcProviderSlot = { id: "ms", preset: "microsoft" };
    const resolved = await resolveProviderSlot(slot, credentials);

    expect(resolved.issuer).toBe(
      "https://login.microsoftonline.com/contoso.onmicrosoft.com/v2.0",
    );
  });

  it("carries the slot's own behavior, not just the row's credentials", async () => {
    await credentials.insert({
      provider: "google",
      clientId: "client-123",
      redirectUri: "https://app.example.com/auth/oidc/google/callback",
    });

    const slot: OidcProviderSlot = {
      id: "google",
      preset: "google",
      scopes: ["openid", "email"],
      fetchUserInfo: true,
    };
    const resolved = await resolveProviderSlot(slot, credentials);

    expect(resolved.scopes).toEqual(["openid", "email"]);
    expect(resolved.fetchUserInfo).toBe(true);
  });

  it("throws UnknownProviderError when no row matches the slot's id", async () => {
    const slot: OidcProviderSlot = { id: "google", preset: "google" };
    await expect(resolveProviderSlot(slot, credentials)).rejects.toThrow(
      UnknownProviderError,
    );
  });

  it("throws IncompleteOidcCredentialsError for a microsoft row without a tenant", async () => {
    await credentials.insert({
      provider: "ms",
      clientId: "client-456",
      redirectUri: "https://app.example.com/auth/oidc/ms/callback",
    });

    const slot: OidcProviderSlot = { id: "ms", preset: "microsoft" };
    await expect(resolveProviderSlot(slot, credentials)).rejects.toThrow(
      IncompleteOidcCredentialsError,
    );
  });
});
