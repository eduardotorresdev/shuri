import type { CollectionStore, RecordInput } from "@shuri/store";
import { IncompleteOidcCredentialsError, UnknownProviderError } from "../errors.js";
import { googleProvider } from "./presets/google.js";
import { microsoftProvider } from "./presets/microsoft.js";
import type { OidcProviderSlot, ResolvedProvider } from "./types.js";

/**
 * Completes a `OidcProviderSlot` into a `ResolvedProvider`, reading its `clientId`/`clientSecret`/
 * `redirectUri` — and, for the `microsoft` preset, `tenant` — off the matching `_oidc_credentials`
 * row.
 *
 * Reads the store fresh on every call, deliberately uncached: an admin editing a `clientSecret` takes
 * effect on the very next sign-in, no TTL to wait out and no invalidation to wire up. Unlike
 * `discovery.ts`'s cache, which exists to spare a *network* round trip to another host, this is one
 * local store read on a route that already makes one (a session row is about to be written on the
 * very same request).
 * @param slot - The slot's code-level declaration: id, preset and behavior.
 * @param credentials - The `_oidc_credentials` collection.
 * @returns The resolved provider.
 */
export async function resolveProviderSlot(
  slot: OidcProviderSlot,
  credentials: CollectionStore<RecordInput>,
): Promise<ResolvedProvider> {
  const [row] = await credentials.findMany({
    where: { provider: { op: "eq", value: slot.id } },
    limit: 1,
  });
  if (!row) throw new UnknownProviderError(slot.id);

  const clientId = row["clientId"] as string;
  const clientSecret = row["clientSecret"] as string | undefined;
  const redirectUri = row["redirectUri"] as string;
  const behavior = {
    scopes: slot.scopes,
    tokenAuthMethod: slot.tokenAuthMethod,
    authorizationParams: slot.authorizationParams,
    allowLinkingByVerifiedEmail: slot.allowLinkingByVerifiedEmail,
    fetchUserInfo: slot.fetchUserInfo,
  };

  switch (slot.preset) {
    case "google":
      return googleProvider({ id: slot.id, clientId, clientSecret, redirectUri, ...behavior });

    case "microsoft": {
      const tenant = row["tenant"] as string | undefined;
      if (!tenant) {
        throw new IncompleteOidcCredentialsError(
          slot.id,
          '"tenant" is required for the "microsoft" preset',
        );
      }
      return microsoftProvider({
        id: slot.id,
        clientId,
        clientSecret,
        redirectUri,
        tenant,
        ...behavior,
      });
    }
  }
}
