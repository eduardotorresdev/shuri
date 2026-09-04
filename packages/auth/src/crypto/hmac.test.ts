import { describe, expect, it } from "vitest";
import { hmacSha256, verifyHmacSha256 } from "./hmac.js";

const secret = "a-secret-long-enough-for-the-config-check";

describe("hmacSha256", () => {
  it("is deterministic for the same key and message", async () => {
    expect(await hmacSha256(secret, "payload")).toBe(await hmacSha256(secret, "payload"));
  });

  it("changes with the message and with the key", async () => {
    expect(await hmacSha256(secret, "a")).not.toBe(await hmacSha256(secret, "b"));
    expect(await hmacSha256(secret, "a")).not.toBe(await hmacSha256("other", "a"));
  });
});

describe("verifyHmacSha256", () => {
  it("accepts a signature it produced", async () => {
    const signature = await hmacSha256(secret, "payload");
    expect(await verifyHmacSha256(secret, "payload", signature)).toBe(true);
  });

  it("rejects a tampered payload, a wrong key and a garbage signature", async () => {
    const signature = await hmacSha256(secret, "payload");
    expect(await verifyHmacSha256(secret, "payload!", signature)).toBe(false);
    expect(await verifyHmacSha256("other", "payload", signature)).toBe(false);
    expect(await verifyHmacSha256(secret, "payload", "nope")).toBe(false);
  });
});
