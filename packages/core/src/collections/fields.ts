export interface FieldBase {
  name: string;
  label?: string;
  required?: boolean;
}

export interface TextField extends FieldBase {
  type: "text";
  minLength?: number;
  maxLength?: number;
}

export interface TextareaField extends FieldBase {
  type: "textarea";
  minLength?: number;
  maxLength?: number;
}

/** Spec of `text` with email format enforced. */
export interface EmailField extends FieldBase {
  type: "email";
}

export interface SelectOption {
  label: string;
  value: string;
}

export interface SelectField extends FieldBase {
  type: "select";
  options: readonly SelectOption[];
  multiple?: boolean;
}

export type NumberKind = "integer" | "float";
export type NumberSign = "any" | "positive" | "negative";

export interface NumberField extends FieldBase {
  type: "number";
  kind: NumberKind;
  sign?: NumberSign;
  min?: number;
  max?: number;
}

export interface BooleanField extends FieldBase {
  type: "boolean";
}

/** Spec of `select` where options come from another collection's records. */
export interface RelationField extends FieldBase {
  type: "relation";
  collection: string;
  multiple?: boolean;
}

export type Field =
  | TextField
  | TextareaField
  | EmailField
  | SelectField
  | NumberField
  | BooleanField
  | RelationField;

export type FieldType = Field["type"];
