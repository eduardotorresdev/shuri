import { IssuesApiError } from "../errors.js";

/**
 * A request tried to write or query a field declared `hidden`. A 400 rather than a silent drop: a
 * caller who believes it changed a password and didn't has an incident with no log line, and
 * `PATCH {"passwordHash": ...}` succeeding quietly would be an authentication bypass.
 */
export class HiddenFieldError extends IssuesApiError {
  constructor(
    public readonly fields: readonly string[],
    where = "body",
  ) {
    super(
      400,
      fields.map((field) => ({
        path: `${where}.${field}`,
        message: `"${field}" is not writable over HTTP`,
      })),
    );
    this.name = "HiddenFieldError";
  }
}
