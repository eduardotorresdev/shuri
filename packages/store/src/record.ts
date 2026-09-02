import type { Prettify } from "@shuri/core";

export type RecordId = string;

export type RecordInput = Record<string, unknown>;

export type StoreRecord<R = RecordInput> = Prettify<R & { id: RecordId }>;
