import type { CollectionSchema } from "@shuri/core";
import { describe, expect, it } from "vitest";
import { RecordValidationError } from "./errors.js";
import { assertValidRecord } from "./validate-record.js";

const services: CollectionSchema = {
  slug: "services",
  title: "Services",
  singular: "Service",
  plural: "Services",
  fields: [{ type: "text", name: "name", required: true }],
};

describe("assertValidRecord", () => {
  it("does not throw for a record satisfying the collection's fields", () => {
    expect(() => assertValidRecord(services, { name: "Haircut" })).not.toThrow();
  });

  it("throws RecordValidationError carrying the field issues", () => {
    try {
      assertValidRecord(services, {});
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RecordValidationError);
      const validationError = error as RecordValidationError;
      expect(validationError.collection).toBe("services");
      expect(validationError.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ message: '"name" is required' })]),
      );
    }
  });

  it("skips required checks when partial", () => {
    expect(() => assertValidRecord(services, {}, { partial: true })).not.toThrow();
  });
});
