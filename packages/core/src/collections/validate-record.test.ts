import { describe, expect, it } from "vitest";
import type { CollectionSchema } from "./types.js";
import { validateRecord } from "./validate-record.js";

const services: CollectionSchema = {
  slug: "services",
  title: "Services",
  singular: "Service",
  plural: "Services",
  fields: [
    { type: "text", name: "name", required: true, minLength: 2, maxLength: 20 },
    { type: "email", name: "contact" },
    { type: "number", name: "price", kind: "float", sign: "positive" },
    { type: "boolean", name: "active" },
    {
      type: "select",
      name: "category",
      options: [
        { label: "Hair", value: "hair" },
        { label: "Spa", value: "spa" },
      ],
    },
    { type: "relation", name: "provider", collection: "providers" },
    { type: "relation", name: "addons", collection: "addons", multiple: true },
  ],
};

describe("validateRecord", () => {
  it("accepts a fully valid record", () => {
    const issues = validateRecord(services, {
      name: "Haircut",
      contact: "shop@example.com",
      price: 40,
      active: true,
      category: "hair",
      provider: "prov-1",
      addons: ["addon-1", "addon-2"],
    });
    expect(issues).toEqual([]);
  });

  it("requires a required field", () => {
    const issues = validateRecord(services, {});
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ message: '"name" is required' })]));
  });

  it("does not require optional fields", () => {
    expect(validateRecord(services, { name: "Haircut" })).toEqual([]);
  });

  it("enforces text minLength/maxLength", () => {
    expect(validateRecord(services, { name: "H" })).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: '"name" must be at least 2 characters' })]),
    );
    expect(validateRecord(services, { name: "H".repeat(21) })).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: '"name" must be at most 20 characters' })]),
    );
  });

  it("rejects a malformed email", () => {
    const issues = validateRecord(services, { name: "Haircut", contact: "not-an-email" });
    expect(issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: '"contact" must be a valid email' })]),
    );
  });

  it("rejects a negative price when sign is positive", () => {
    const issues = validateRecord(services, { name: "Haircut", price: -10 });
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ message: '"price" must be positive' })]));
  });

  it("rejects a non-integer value for an integer number field", () => {
    const integerField: CollectionSchema = {
      ...services,
      fields: [{ type: "number", name: "quantity", kind: "integer" }],
    };
    const issues = validateRecord(integerField, { quantity: 1.5 });
    expect(issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: '"quantity" must be an integer' })]),
    );
  });

  it("rejects a value outside a select field's options", () => {
    const issues = validateRecord(services, { name: "Haircut", category: "unknown" });
    expect(issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: '"category" is not a valid option' })]),
    );
  });

  it("rejects a non-boolean value for a boolean field", () => {
    const issues = validateRecord(services, { name: "Haircut", active: "yes" });
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ message: '"active" must be a boolean' })]));
  });

  it("requires a single relation value to be a string id", () => {
    const issues = validateRecord(services, { name: "Haircut", provider: 123 });
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: '"provider" must reference record id(s) as string' }),
      ]),
    );
  });

  it("requires a multiple relation value to be an array of string ids", () => {
    const issues = validateRecord(services, { name: "Haircut", addons: "addon-1" });
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: '"addons" must reference record id(s) as strings' }),
      ]),
    );
  });

  it("skips required checks in partial mode", () => {
    expect(validateRecord(services, { price: 50 }, { partial: true })).toEqual([]);
  });

  it("still validates provided fields in partial mode", () => {
    const issues = validateRecord(services, { price: -50 }, { partial: true });
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ message: '"price" must be positive' })]));
  });
});
