import { describe, expect, it } from "vitest";
import {
  formatPbkdf2Hash,
  hashAlgorithm,
  MAX_ITERATIONS,
  parsePbkdf2Hash,
} from "./encoding.js";

const hash = {
  iterations: 600_000,
  keyLength: 32,
  salt: "c2FsdA",
  digest: "ZGlnZXN0",
};

describe("formatPbkdf2Hash", () => {
  it("writes the self-describing PHC-like layout", () => {
    expect(formatPbkdf2Hash("pbkdf2-sha256", hash)).toBe(
      "$pbkdf2-sha256$i=600000,dk=32$c2FsdA$ZGlnZXN0",
    );
  });
});

describe("parsePbkdf2Hash", () => {
  it("round-trips what formatPbkdf2Hash wrote", () => {
    expect(parsePbkdf2Hash(formatPbkdf2Hash("pbkdf2-sha256", hash))).toEqual(hash);
  });

  it.each([
    ["empty", ""],
    ["not ours", "plaintext"],
    ["too few fields", "$pbkdf2-sha256$i=600000$c2FsdA"],
    ["no iterations", "$pbkdf2-sha256$dk=32$c2FsdA$ZGlnZXN0"],
    ["non-numeric iterations", "$pbkdf2-sha256$i=lots,dk=32$c2FsdA$ZGlnZXN0"],
    ["empty salt", "$pbkdf2-sha256$i=600000,dk=32$$ZGlnZXN0"],
    ["non base64url digest", "$pbkdf2-sha256$i=600000,dk=32$c2FsdA$dig est"],
  ])("returns undefined for a %s hash rather than throwing", (_name, stored) => {
    expect(parsePbkdf2Hash(stored)).toBeUndefined();
  });

  it("refuses an iteration count that would pin a CPU on every login attempt", () => {
    expect(
      parsePbkdf2Hash(`$pbkdf2-sha256$i=${MAX_ITERATIONS + 1},dk=32$c2FsdA$ZGlnZXN0`),
    ).toBeUndefined();
  });

  it("refuses an implausibly low iteration count", () => {
    expect(parsePbkdf2Hash("$pbkdf2-sha256$i=1,dk=32$c2FsdA$ZGlnZXN0")).toBeUndefined();
  });
});

describe("hashAlgorithm", () => {
  it("reads the algorithm id back for routing", () => {
    expect(hashAlgorithm("$pbkdf2-sha256$i=600000,dk=32$c2FsdA$ZGlnZXN0")).toBe(
      "pbkdf2-sha256",
    );
  });

  it("is undefined for anything not shaped like one of ours", () => {
    expect(hashAlgorithm("plaintext")).toBeUndefined();
  });
});
