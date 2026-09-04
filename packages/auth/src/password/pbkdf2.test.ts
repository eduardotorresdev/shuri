import { describe, expect, it } from "vitest";
import { parsePbkdf2Hash } from "./encoding.js";
import { createPbkdf2Hasher } from "./pbkdf2.js";

// Every test here derives at least one key, so the cost is turned down to keep the suite fast; the
// format and the logic under test are identical at 600k.
const hasher = createPbkdf2Hasher({ iterations: 1_000 });

describe("createPbkdf2Hasher", () => {
  it("verifies the password it hashed", async () => {
    const stored = await hasher.hash("correct-horse-battery");
    expect(await hasher.verify("correct-horse-battery", stored)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const stored = await hasher.hash("correct-horse-battery");
    expect(await hasher.verify("correct-horse-batteru", stored)).toBe(false);
  });

  it("salts every hash, so the same password never produces the same row twice", async () => {
    const [first, second] = await Promise.all([hasher.hash("same"), hasher.hash("same")]);
    expect(first).not.toBe(second);
    expect(await hasher.verify("same", first)).toBe(true);
    expect(await hasher.verify("same", second)).toBe(true);
  });

  it("writes the parameters into the hash, so verify never reads them from config", async () => {
    const stored = await hasher.hash("pw");
    expect(parsePbkdf2Hash(stored)).toMatchObject({ iterations: 1_000, keyLength: 32 });
  });

  it("verifies a hash written with different parameters than the current ones", async () => {
    const old = await createPbkdf2Hasher({ iterations: 2_000 }).hash("pw");
    expect(await hasher.verify("pw", old)).toBe(true);
  });

  it("answers false, never throws, for a hash it can't parse", async () => {
    expect(await hasher.verify("pw", "plaintext")).toBe(false);
    expect(await hasher.verify("pw", "")).toBe(false);
  });

  it("reports a weaker hash as needing a rehash, and its own as not", async () => {
    const weaker = await createPbkdf2Hasher({ iterations: 1_000 }).hash("pw");
    const stronger = await createPbkdf2Hasher({ iterations: 2_000 }).hash("pw");
    const strict = createPbkdf2Hasher({ iterations: 2_000 });

    expect(strict.needsRehash?.(weaker)).toBe(true);
    expect(strict.needsRehash?.(stronger)).toBe(false);
    expect(strict.needsRehash?.("garbage")).toBe(true);
  });
});
