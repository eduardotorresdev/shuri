import {
  servableCollections,
  visibleFields,
  type CollectionSchema,
  type Field,
  type GlobalSchema,
} from "@shuri/core";
import type {
  AdminApiPaths,
  AdminAuth,
  AdminCollection,
  AdminGlobal,
  AdminSchema,
} from "../../shared/schema.js";

/** The declared schema the admin describes — the same two arrays a consumer hands `create()`. */
export interface AdminSchemaSource {
  collections: readonly CollectionSchema[];
  globals?: readonly GlobalSchema[];
}

export interface BuildAdminSchemaOptions {
  /** Name shown in the admin's header. Defaults to "Shuri Admin". */
  title?: string;
  /** The path the admin is mounted at. Defaults to "/admin". */
  basePath?: string;
  /** Where the app's REST routes live, when they aren't at their own defaults. */
  api?: Partial<AdminApiPaths>;
  /** Advertised to the admin so it can draw a login form. Omitted leaves the admin open. */
  auth?: AdminAuth;
}

const LABEL_FIELD_TYPES: ReadonlySet<Field["type"]> = new Set(["text", "email"]);

/**
 * Picks the field whose value stands in for a record in a list column or a relation picker.
 *
 * The first `text`/`email` field, by declaration order: the field an author put first is the one
 * they think of the record by, which beats any heuristic over names. `textarea` is excluded — a
 * body paragraph is not a label. Returns `undefined` when there is no such field, leaving the
 * caller to fall back to the record's `id`.
 * @param fields - The collection's visible fields, in declaration order.
 * @returns The name of the labelling field, or `undefined` when the collection has none.
 */
export function labelFieldOf(fields: readonly Field[]): string | undefined {
  return fields.find((field) => LABEL_FIELD_TYPES.has(field.type))?.name;
}

/**
 * Projects a collection onto what the admin is allowed to show. `visibleFields` applies `hidden`,
 * for the same reason `@shuri/api` applies it to responses: the admin drives itself entirely off
 * this document, so a hidden field left in would be rendered as a form input, and writing it back
 * is a 400 the author can do nothing about.
 * @param collection - The declared collection to project.
 * @returns The admin's view of `collection`.
 */
function toAdminCollection(collection: CollectionSchema): AdminCollection {
  const fields = visibleFields(collection);
  const labelField = labelFieldOf(fields);

  return {
    slug: collection.slug,
    title: collection.title,
    singular: collection.singular,
    plural: collection.plural,
    ...(collection.orderable === undefined ? {} : { orderable: collection.orderable }),
    fields,
    ...(labelField === undefined ? {} : { labelField }),
  };
}

/**
 * Projects a global onto what the admin shows, flattening `category` to its title — the sidebar
 * groups by it and has nothing else to do with the object.
 * @param global - The declared global to project.
 * @returns The admin's view of `global`.
 */
function toAdminGlobal(global: GlobalSchema): AdminGlobal {
  return {
    slug: global.slug,
    title: global.title,
    category: global.category.title,
    fields: visibleFields(global),
  };
}

/**
 * Builds the document the admin generates its whole UI from: every collection HTTP serves and every
 * declared global, each carrying only the fields that may leave the app.
 *
 * `internal` collections are dropped through `servableCollections`, exactly as the OpenAPI document
 * drops them — listing one would give the admin a nav entry whose every request 404s, and would
 * disclose that the slug exists at all.
 *
 * This builds the **full** document. When auth is on, the handler serves it only to a signed-in
 * caller and serves `shellSchema(...)` to everyone else; see `schema/handler.ts`.
 * @param source - The declared collections and globals to describe.
 * @param [options] - The title, mount path, and REST base paths to advertise.
 * @returns The admin schema document.
 */
export function buildAdminSchema(
  source: AdminSchemaSource,
  options: BuildAdminSchemaOptions = {},
): AdminSchema {
  return {
    title: options.title ?? "Shuri Admin",
    basePath: options.basePath ?? "/admin",
    api: {
      collections: options.api?.collections ?? "/collections",
      globals: options.api?.globals ?? "/globals",
      events: options.api?.events ?? "/events",
    },
    ...(options.auth ? { auth: options.auth } : {}),
    collections: servableCollections(source.collections).map(toAdminCollection),
    globals: (source.globals ?? []).map(toAdminGlobal),
  };
}

/**
 * The same document with every collection and global stripped out — what a signed-out visitor gets.
 *
 * The shell has to be public: the login form is generated from `auth`, so a visitor with no session
 * still needs to be told where to post one. Everything that describes the app's content is what gets
 * withheld, so all an anonymous request learns is that an admin exists and how to sign in.
 * @param schema - The full document.
 * @returns The document without `collections` and `globals`.
 */
export function shellSchema(schema: AdminSchema): AdminSchema {
  return { ...schema, collections: [], globals: [] };
}
