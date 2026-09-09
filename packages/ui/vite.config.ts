import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

/**
 * The origin `vite dev` proxies the REST routes to, so the admin can run on Vite's dev server
 * (hot reload, source maps) while talking to a real Shuri app — `pnpm --filter @shuri/demo start`
 * on port 3000 by default.
 */
const apiOrigin = process.env.SHURI_API_ORIGIN ?? "http://localhost:3000";

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    proxy: {
      "/collections": apiOrigin,
      "/globals": apiOrigin,
      "/events": apiOrigin,
      "/admin/schema.json": apiOrigin,
    },
  },
});
