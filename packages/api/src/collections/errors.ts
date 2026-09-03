import { formatIssues, type Issue } from "@shuri/validate";
import { ApiError } from "../errors.js";

/** Only thrown by the collections handler: `createGlobalsApiHandler`/`createOpenApiHandler` fall through instead. */
export class UnknownRouteError extends ApiError {
  constructor() {
    super(404, "Not found");
    this.name = "UnknownRouteError";
  }
}

/** The query string doesn't satisfy the `Query` AST shape (see `@shuri/store`'s `Query`). Globals have no query string. */
export class InvalidQueryError extends ApiError {
  constructor(public readonly issues: Issue[]) {
    super(400, formatIssues(issues));
    this.name = "InvalidQueryError";
  }
}
