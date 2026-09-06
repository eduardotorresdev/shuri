import type { FallingHandler } from "@shuri/api";
import type { AdminSchema } from "../../shared/schema.js";
import { toViewer, type ResolvedAdminAuth } from "../auth/access.js";
import { shellSchema } from "./build.js";

/** JSON, and never cached: a document that varies by session must not be held by a shared proxy. */
const HEADERS: Readonly<Record<string, string>> = {
  "content-type": "application/json",
  "cache-control": "no-store",
};

/**
 * Serves the admin schema document at `{basePath}/schema.json`, and declines every other request.
 *
 * With no `auth`, the document is one constant, serialized once: it comes from schema literals that
 * cannot change while the process runs.
 *
 * With `auth`, it varies by caller — the full document for an authorized session, and the shell (no
 * collections, no globals) for anyone else. Only the `viewer` is built per request; both bodies are
 * still assembled from constants.
 *
 * `no-store` either way. Without auth, a copy cached across a deploy would render the previous
 * release's forms against the new one's validation; with auth, a shared cache could hand one
 * session's document to the next visitor.
 * @param schema - The full document.
 * @param [auth] - The resolved auth, when the host wired any in.
 * @returns A handler answering the schema route, `undefined` for anything else.
 */
export function createAdminSchemaHandler(
  schema: AdminSchema,
  auth?: ResolvedAdminAuth,
): FallingHandler {
  const path = `${schema.basePath}/schema.json`;
  const openBody = JSON.stringify(schema);
  const shell = auth ? shellSchema(schema) : undefined;

  return async function handleRequest(request) {
    if (request.method !== "GET") return undefined;
    if (new URL(request.url).pathname !== path) return undefined;

    if (!auth || !shell) return new Response(openBody, { headers: HEADERS });

    const [access, advertised] = await Promise.all([
      auth.resolve(request),
      auth.advertised(),
    ]);
    const viewer = toViewer(access);
    const body = access.status === "allowed" ? schema : shell;

    // `auth` is re-read per request rather than taken from `schema`: its `setup` block is what tells
    // the browser the first-account form exists, and that has to disappear the moment it does not.
    return new Response(JSON.stringify({ ...body, auth: advertised, viewer }), {
      headers: HEADERS,
    });
  };
}
