import type { SessionMetadata } from "../types.js";

/**
 * Reads the client metadata recorded on a session. `x-forwarded-for` is only as trustworthy as the
 * proxy in front of the app, so this is auditing information, never an authorization input.
 * @param request - The incoming request.
 * @returns The user agent and client IP, when the request carries them.
 */
export function requestMetadata(request: Request): SessionMetadata {
  const userAgent = request.headers.get("user-agent") ?? undefined;
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0].trim() || undefined;
  return { ...(userAgent ? { userAgent } : {}), ...(ip ? { ip } : {}) };
}
