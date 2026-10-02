import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The integration tests hash real passwords (scrypt, CPU-bound by design); under a parallel
    // turbo run the default 5s budget is exceeded intermittently.
    testTimeout: 20_000,
  },
});
