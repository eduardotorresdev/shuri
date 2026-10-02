import type { Validator } from "./types.js";

/**
 * Validates a tagged union of unknown shape: reads `tag` from the object, picks the matching
 * variant and delegates to it with the same context, so the variant's issues keep their paths.
 * A non-object is reported at the current path; a missing or unknown tag is reported at the tag's
 * own path and no variant runs.
 * @param tag - The property that names the variant.
 * @param variants - The validator of each variant, keyed by tag value.
 * @param [message] - The issue message for an unknown tag, or a function producing one from the tag value.
 * @returns A validator that dispatches on `tag`.
 */
export function discriminated(
  tag: string,
  variants: Readonly<Record<string, Validator<unknown>>>,
  message?: string | ((tagValue: unknown) => string),
): Validator<unknown> {
  const names = Object.keys(variants);
  return (value, ctx) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      ctx.addIssue("must be an object");
      return;
    }
    const tagValue = (value as Record<string, unknown>)[tag];
    const variant =
      typeof tagValue === "string" && Object.hasOwn(variants, tagValue)
        ? variants[tagValue]
        : undefined;
    if (!variant) {
      const fallback = `must be one of ${names.join(", ")}`;
      ctx
        .at(tag)
        .addIssue(
          typeof message === "function" ? message(tagValue) : (message ?? fallback),
        );
      return;
    }
    variant(value, ctx);
  };
}
