import { oidcProvider } from "../config.js";
import type { OidcProviderConfig, ResolvedProvider } from "../types.js";

export interface GoogleProviderOptions extends Omit<OidcProviderConfig, "id" | "issuer"> {
  /** Overridable, so two Google tenants can be configured side by side. Defaults to "google". */
  id?: string;
}

/**
 * Google as a preset: the issuer filled in, everything else the host's.
 * @param options - The client credentials and redirect URI, plus any override.
 * @returns The resolved Google provider.
 */
export function googleProvider(options: GoogleProviderOptions): ResolvedProvider {
  return oidcProvider({
    id: options.id ?? "google",
    issuer: "https://accounts.google.com",
    ...options,
  });
}
