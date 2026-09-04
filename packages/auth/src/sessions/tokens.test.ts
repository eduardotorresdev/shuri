import { describe, expect, it } from "vitest";
import { hashSessionToken, issueSessionToken } from "./tokens.js";

describe("issueSessionToken", () => {
  it("mints a 43-character token with its digest", async () => {
    const { token, tokenHash } = await issueSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).not.toBe(token);
  });

  it("never mints the same token twice", async () => {
    const tokens = await Promise.all(
      Array.from({ length: 100 }, () => issueSessionToken()),
    );
    expect(new Set(tokens.map((issued) => issued.token)).size).toBe(100);
  });

  it("stores only the digest, so a dump can't be replayed as sessions", async () => {
    const { token, tokenHash } = await issueSessionToken();
    expect(await hashSessionToken(token)).toBe(tokenHash);
  });
});

describe("hashSessionToken", () => {
  it("is deterministic, which is what makes the lookup a single eq query", async () => {
    expect(await hashSessionToken("abc")).toBe(await hashSessionToken("abc"));
    expect(await hashSessionToken("abc")).not.toBe(await hashSessionToken("abd"));
  });
});
