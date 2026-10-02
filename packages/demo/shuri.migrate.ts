import { resolveSchema } from "@shuri/sdk";
import { defineMigrateConfig } from "@shuri/migrate/node";
import { appConfig } from "./src/app-config.ts";

// Loaded by `shuri-migrate` with Node's native TypeScript support: erasable syntax and `.ts` imports only.
export default defineMigrateConfig({
  schema: () => resolveSchema(appConfig),
  adapter: () => appConfig.adapter,
  // Migrations already on this ref are never rebased by `reconcile`.
  frozenRef: "origin/main",
});
