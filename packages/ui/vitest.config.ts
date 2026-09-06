import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    // The same alias `svelte.config.js` declares, so the browser-side helpers under `src/lib` can be
    // tested here as the plain TypeScript they are — no Svelte, no DOM, no SvelteKit runtime.
    alias: {
      $shared: fileURLToPath(new URL("./src/shared", import.meta.url)),
    },
  },
});
