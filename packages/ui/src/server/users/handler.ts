import {
  ApiError,
  MethodNotAllowedError,
  UnauthenticatedError,
  jsonResponse,
  noContentResponse,
  parseQuery,
  readJsonBody,
  toErrorResponse,
  type FallingHandler,
} from "@shuri/api";
import type { AdminAccess, ResolvedAdminAuth } from "../auth/access.js";
import { AdminForbiddenError } from "../auth/guard.js";
import { matchUsersRoute } from "./routes.js";
import type { UserAdminApi } from "./types.js";
import { parseNewUser, parseUserPatch } from "./validate.js";

/**
 * An operator tried to delete their own account.
 *
 * Refused rather than allowed-with-a-warning: it signs you out mid-request, and on an app whose
 * `authorize` names one address it locks the admin for good, with the setup flow — if the host wired
 * one — as the only way back in.
 */
export class SelfDeletionError extends ApiError {
  constructor() {
    super(409, "You cannot delete the account you are signed in as");
    this.name = "SelfDeletionError";
  }
}

/**
 * Serves user administration at `path`, and declines every other request:
 *
 *   GET    {path}      list (limit, offset, where, orderBy — as everywhere else)
 *   POST   {path}      create
 *   GET    {path}/:id  read one
 *   PATCH  {path}/:id  update, including setting a password
 *   DELETE {path}/:id  delete, with the user's sessions and identity links
 *
 * `path` is `{basePath}/api/users`, deliberately **not** `{basePath}/users`: that one is a page of
 * the admin, and the client router owns it. Two things cannot answer one URL — the browser asking
 * for the Users screen would get this JSON instead of the app.
 *
 * **Inside the admin's own mount path, not on the REST surface** — which is the whole point. The
 * auth implementation's user table is `internal`, because with no per-collection rules a served
 * one is an open directory of every registered address (`hidden` redacts a field, it doesn't hide
 * rows). These routes leave that exactly as it is: the table stays unserved, and the one door into
 * it is this one, behind the admin's own gate.
 *
 * That gate is checked **here**, not by `createAdminGuard`: the guard protects the app's REST base
 * paths, and these routes are deliberately outside them. Every method, reads included, requires an
 * `allowed` session — the default `protect` leaves REST reads open because a headless CMS's content
 * is meant to be read, and a list of email addresses is not content.
 *
 * Bodies are validated here, against the admin's own contract (`NewAdminUser`/`AdminUserPatch`),
 * so every `UserAdminApi` behind these routes receives the same already-checked shape.
 * @param users - The user administration API, e.g. `ba.sessionSource.users`.
 * @param auth - The resolved admin auth, for resolving who is asking.
 * @param path - The path the routes are mounted at, as the schema document advertises it.
 * @returns A handler answering the users routes, `undefined` for anything else.
 */
export function createAdminUsersHandler(
  users: UserAdminApi,
  auth: ResolvedAdminAuth,
  path: string,
): FallingHandler {
  /**
   * Resolves the caller, refusing anyone the admin would not let in.
   * @param request - The request being served.
   * @returns The access, always `allowed`.
   */
  async function requireOperator(request: Request): Promise<AdminAccess> {
    const access = await auth.resolve(request);
    // `setup` is refused like `anonymous`, as the guard does: an app with no account has no
    // administrator either, and the first-run window must not be one where users can be minted.
    if (access.status === "setup" || access.status === "anonymous") {
      throw new UnauthenticatedError();
    }
    if (access.status === "forbidden") throw new AdminForbiddenError();
    return access;
  }

  async function handleCollection(request: Request, url: URL): Promise<Response> {
    switch (request.method) {
      case "GET":
        return jsonResponse(await users.list(parseQuery(url.searchParams)));
      case "POST":
        return jsonResponse(
          await users.create(parseNewUser(await readJsonBody(request))),
          {
            status: 201,
          },
        );
      default:
        throw new MethodNotAllowedError(request.method);
    }
  }

  async function handleUser(
    request: Request,
    id: string,
    access: AdminAccess,
  ): Promise<Response> {
    switch (request.method) {
      case "GET":
        return jsonResponse(await users.get(id));
      case "PATCH":
        return jsonResponse(
          await users.update(id, parseUserPatch(await readJsonBody(request))),
        );
      case "DELETE": {
        const self = access.status === "allowed" && access.session.user.id === id;
        if (self) throw new SelfDeletionError();
        await users.remove(id);
        return noContentResponse();
      }
      default:
        throw new MethodNotAllowedError(request.method);
    }
  }

  return async function handleRequest(request) {
    const url = new URL(request.url);
    const route = matchUsersRoute(url.pathname, path);
    if (!route) return undefined;

    try {
      const access = await requireOperator(request);
      return route.id === undefined
        ? await handleCollection(request, url)
        : await handleUser(request, route.id, access);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}
