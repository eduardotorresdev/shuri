import type { Issue } from "@shuri/validate";

/**
 * A non-2xx answer from the app's REST routes, carrying whatever the server put in the body:
 * `error` as the message and, for a validation failure, the `issues` array — which is what lets a
 * form show `"title" is required` next to the title input rather than in a banner.
 */
export class AdminRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly issues: readonly Issue[] = [],
  ) {
    super(message);
    this.name = "AdminRequestError";
  }
}

/**
 * Maps the issues of an error to `field name -> first message`, ready for a form to read per input.
 *
 * Issue paths are rooted at the record (`"title"`, `"tags.0"`), so the first segment is the field
 * name; a deeper path collapses onto its field, which is the level the admin renders errors at.
 * Only the first issue per field is kept — the rest describe the same input.
 * @param error - The error whose issues to index, or any other thrown value.
 * @returns One message per field named by the issues, empty when there are none.
 */
export function issuesByField(error: unknown): Record<string, string> {
  if (!(error instanceof AdminRequestError)) return {};

  const byField: Record<string, string> = {};
  for (const issue of error.issues) {
    const [field] = issue.path.split(".");
    if (field && byField[field] === undefined) byField[field] = issue.message;
  }
  return byField;
}
