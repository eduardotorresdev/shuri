import type { Issue } from "@shuri/validate";
import { IssuesApiError } from "../errors.js";

/** The event stream's query string is invalid: an unknown event name, an empty selector, ... */
export class InvalidEventQueryError extends IssuesApiError {
  constructor(issues: Issue[]) {
    super(400, issues);
    this.name = "InvalidEventQueryError";
  }
}
