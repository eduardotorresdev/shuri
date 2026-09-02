import type { Issue } from "./types.js";

export function formatIssue(issue: Issue): string {
  return `${issue.path}: ${issue.message}`;
}

export function formatIssues(issues: Issue[]): string {
  if (issues.length === 1) return formatIssue(issues[0]);
  return `Invalid schema:\n${issues.map((issue) => `  - ${formatIssue(issue)}`).join("\n")}`;
}

export class ValidationError extends Error {
  constructor(public readonly issues: Issue[]) {
    super(formatIssues(issues));
    this.name = "ValidationError";
  }
}
