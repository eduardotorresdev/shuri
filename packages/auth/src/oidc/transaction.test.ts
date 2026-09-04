import { describe, expect, it } from "vitest";
import { OAuthTransactionError } from "../errors.js";
import { encodeBase64UrlText } from "../crypto/base64url.js";
import { hmacSha256 } from "../crypto/hmac.js";
import {
  signTransaction,
  TRANSACTION_TTL_MS,
  verifyTransaction,
  type OidcTransaction,
} from "./transaction.js";

const secret = "a-secret-of-at-least-thirty-two-chars";
const now = 1_700_000_000_000;

function transaction(overrides: Partial<OidcTransaction> = {}): OidcTransaction {
  return {
    p: "acme",
    s: "state-value",
    n: "nonce-value",
    v: "verifier-value",
    e: now + TRANSACTION_TTL_MS,
    ...overrides,
  };
}

describe("signTransaction / verifyTransaction", () => {
  it("round-trips a transaction", async () => {
    const value = await signTransaction(secret, transaction({ r: "/dashboard" }));
    expect(await verifyTransaction(secret, value, now)).toEqual(
      transaction({ r: "/dashboard" }),
    );
  });

  it("writes payload and signature, and nothing readable in between", async () => {
    const value = await signTransaction(secret, transaction());
    expect(value.split(".")).toHaveLength(2);
    expect(value).not.toContain("verifier-value");
  });

  it("gives one identical error for every way it can fail", async () => {
    const value = await signTransaction(secret, transaction());
    const tampered = `${encodeBase64UrlText(JSON.stringify(transaction({ p: "evil" })))}.${value.split(".")[1]}`;

    const failures = await Promise.all(
      [
        verifyTransaction(secret, undefined, now),
        verifyTransaction(secret, "not-a-transaction", now),
        verifyTransaction(secret, tampered, now),
        verifyTransaction("another-secret-of-32-characters-x", value, now),
        verifyTransaction(secret, value, now + TRANSACTION_TTL_MS + 1),
      ].map((promise) => promise.catch((error: unknown) => error)),
    );

    for (const failure of failures) {
      expect(failure).toBeInstanceOf(OAuthTransactionError);
      expect((failure as OAuthTransactionError).status).toBe(400);
      expect((failure as OAuthTransactionError).message).toBe(
        "Invalid or expired sign-in transaction",
      );
    }
  });

  it("refuses a correctly signed payload of the wrong shape, without letting the parser decide", async () => {
    const payload = encodeBase64UrlText(JSON.stringify({ p: "acme" }));
    const value = `${payload}.${await hmacSha256(secret, payload)}`;
    await expect(verifyTransaction(secret, value, now)).rejects.toThrow(
      OAuthTransactionError,
    );
  });

  it("refuses a signed payload that isn't JSON at all", async () => {
    const payload = encodeBase64UrlText("not json");
    const value = `${payload}.${await hmacSha256(secret, payload)}`;
    await expect(verifyTransaction(secret, value, now)).rejects.toThrow(
      OAuthTransactionError,
    );
  });
});
