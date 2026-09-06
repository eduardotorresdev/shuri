import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/**
 * The path the admin is mounted at. Baked in at build time because `adapter-static` emits one
 * `index.html` that has to work at every depth of the client router: with a base of `/admin`, the
 * asset URLs inside it are root-absolute (`/admin/_app/...`), so the same file is correct whether
 * the browser asked for `/admin` or `/admin/collections/posts/abc`. Relative URLs would resolve
 * against the requested depth and 404 on every deep link.
 *
 * It must match `createAdminHandler`'s `basePath` — rebuild with `SHURI_ADMIN_BASE` set to serve
 * the admin somewhere else.
 */
const base = process.env.SHURI_ADMIN_BASE ?? "/admin";

/** @type {import("@sveltejs/kit").Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    // `fallback` (rather than prerendering) because every page is driven by the schema the running
    // app serves at runtime: there is no page whose content is known at build time.
    adapter: adapter({ fallback: "index.html", precompress: false, strict: false }),
    paths: { base },
    alias: { $shared: "src/shared" },
    prerender: { entries: [] },
    typescript: {
      config: (config) => ({
        ...config,
        include: [...(config.include ?? []), "../src/shared/**/*.ts"],
      }),
    },
  },
};
