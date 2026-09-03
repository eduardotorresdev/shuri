/** `Store.global(slug)` was called with a slug no global declares. */
export class UnknownGlobalError extends Error {
  constructor(public readonly slug: string) {
    super(`Unknown global "${slug}"`);
    this.name = "UnknownGlobalError";
  }
}
