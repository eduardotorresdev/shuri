import { describe, expect, it } from "vitest";
import type { PasswordHasher } from "./hasher.js";
import { createPbkdf2Hasher } from "./pbkdf2.js";
import { createHasherRegistry } from "./registry.js";

const legacy: PasswordHasher = {
  id: "legacy",
  async hash(password) {
    return `$legacy$i=1000,dk=32$c2FsdA$${password}`;
  },
  async verify(password, stored) {
    return stored === `$legacy$i=1000,dk=32$c2FsdA$${password}`;
  },
};

const pbkdf2 = createPbkdf2Hasher({ iterations: 1_000 });
const registry = createHasherRegistry({
  hashers: [pbkdf2, legacy],
  preferred: pbkdf2.id,
});

describe("createHasherRegistry", () => {
  it("writes new hashes with the preferred algorithm", async () => {
    expect(await registry.hash("pw")).toContain("$pbkdf2-sha256$");
  });

  it("verifies a hash written by any registered algorithm", async () => {
    expect(await registry.verify("pw", await legacy.hash("pw"))).toBe(true);
    expect(await registry.verify("pw", await pbkdf2.hash("pw"))).toBe(true);
  });

  it("rejects a hash from an algorithm nobody registered", async () => {
    expect(await registry.verify("pw", "$argon2id$i=1,dk=32$c2FsdA$ZGln")).toBe(false);
  });

  it("reports every hash not written by the preferred algorithm as needing a rehash", async () => {
    expect(registry.needsRehash?.(await legacy.hash("pw"))).toBe(true);
    expect(registry.needsRehash?.(await pbkdf2.hash("pw"))).toBe(false);
  });

  it("refuses a preferred id nobody registered", () => {
    expect(() =>
      createHasherRegistry({ hashers: [pbkdf2], preferred: "argon2id" }),
    ).toThrow('Unknown preferred password hasher "argon2id"');
  });
});
