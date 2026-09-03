import type { Issue, ValidationContext } from "./types.js";

export function createContext(rootPath: string): {
  context: ValidationContext;
  issues: Issue[];
} {
  const issues: Issue[] = [];

  function build(path: string): ValidationContext {
    return {
      path,
      addIssue(message: string) {
        issues.push({ path, message });
      },
      at(segment: string | number) {
        return build(path ? `${path}.${segment}` : String(segment));
      },
    };
  }

  return { context: build(rootPath), issues };
}
