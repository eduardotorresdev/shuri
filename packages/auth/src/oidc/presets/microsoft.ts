import { oidcProvider } from "../config.js";
import type { OidcProviderConfig, ResolvedProvider } from "../types.js";

export interface MicrosoftProviderOptions extends Omit<OidcProviderConfig, "id" | "issuer"> {
  /** Overridable, so two tenants can be configured side by side. Defaults to "microsoft". */
  id?: string;
  /** The Azure AD tenant: a GUID, a verified domain, or "common"/"organizations"/"consumers". */
  tenant: string;
}

/**
 * Microsoft (Azure AD / Entra ID) as a preset: the issuer built from the tenant, everything else the
 * host's. Unlike Google, the issuer isn't a constant — every tenant gets its own — so `tenant` is
 * required rather than defaulted.
 * @param options - The client credentials, redirect URI and tenant, plus any override.
 * @returns The resolved Microsoft provider.
 */
export function microsoftProvider(options: MicrosoftProviderOptions): ResolvedProvider {
  const { tenant, id, ...rest } = options;
  return oidcProvider({
    id: id ?? "microsoft",
    issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
    ...rest,
  });
}
