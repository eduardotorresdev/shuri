import type { FieldShape, FieldSpec } from "../schema/snapshot.js";

export type TargetKind = "collection" | "global";

export interface TargetRef {
  kind: TargetKind;
  slug: string;
}

export type MigrationOp =
  | { op: "createEntity"; target: TargetRef; fields: Record<string, FieldSpec> }
  | { op: "dropEntity"; target: TargetRef }
  | { op: "renameEntity"; target: TargetRef; to: string }
  | { op: "addField"; target: TargetRef; name: string; spec: FieldSpec }
  | { op: "dropField"; target: TargetRef; name: string }
  | { op: "renameField"; target: TargetRef; from: string; to: string }
  | {
      op: "alterField";
      target: TargetRef;
      name: string;
      from: FieldShape;
      to: FieldShape;
    }
  | { op: "setIndex"; target: TargetRef; name: string; index: boolean };

export type OpName = MigrationOp["op"];

export const OP_NAMES: readonly OpName[] = [
  "createEntity",
  "dropEntity",
  "renameEntity",
  "addField",
  "dropField",
  "renameField",
  "alterField",
  "setIndex",
];
