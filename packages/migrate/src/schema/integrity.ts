import type { ReplayErrorReason } from "../errors.js";
import { compareCodePoints } from "./canonical-json.js";
import type { EntitySnapshot, SchemaSnapshot } from "./snapshot.js";

export interface IntegrityIssue {
  reason: Extract<ReplayErrorReason, "dangling-relation" | "global-index">;
  /** `<kind>:<slug>.<field>` of the offending field. */
  slot: string;
  message: string;
}

function* fieldsOf(
  kind: "collection" | "global",
  entities: Record<string, EntitySnapshot>,
): Generator<[string, EntitySnapshot["fields"][string]]> {
  for (const slug of Object.keys(entities).toSorted(compareCodePoints)) {
    const { fields } = entities[slug] as EntitySnapshot;
    for (const name of Object.keys(fields).toSorted(compareCodePoints)) {
      yield [`${kind}:${slug}.${name}`, fields[name] as EntitySnapshot["fields"][string]];
    }
  }
}

/**
 * Structured form of `checkIntegrity`.
 * @param snapshot - The snapshot to inspect.
 * @returns Every violation, in a deterministic order.
 */
export function integrityIssues(snapshot: SchemaSnapshot): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  for (const [slot, spec] of fieldsOf("collection", snapshot.collections)) {
    if (
      spec.type === "relation" &&
      !Object.hasOwn(snapshot.collections, spec.collection)
    ) {
      issues.push({
        reason: "dangling-relation",
        slot,
        message: `${slot} references unknown collection "${spec.collection}"`,
      });
    }
  }
  for (const [slot, spec] of fieldsOf("global", snapshot.globals)) {
    if (
      spec.type === "relation" &&
      !Object.hasOwn(snapshot.collections, spec.collection)
    ) {
      issues.push({
        reason: "dangling-relation",
        slot,
        message: `${slot} references unknown collection "${spec.collection}"`,
      });
    }
    if (spec.index) {
      issues.push({
        reason: "global-index",
        slot,
        message: `${slot} is indexed, but a global has no index`,
      });
    }
  }
  return issues;
}

/**
 * Cross-reference checks a snapshot must satisfy: every relation points to an existing collection,
 * and no global field is indexed.
 * @param snapshot - The snapshot to inspect.
 * @returns A message per violation; empty when sound.
 */
export function checkIntegrity(snapshot: SchemaSnapshot): string[] {
  return integrityIssues(snapshot).map((issue) => issue.message);
}
