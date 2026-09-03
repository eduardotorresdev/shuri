/**
 * References a schema by slug in `components.schemas`, where `buildOpenApiDocument` puts one entry
 * per collection and global.
 * @param slug - The collection or global slug to reference.
 * @returns The JSON Schema `$ref` to that entry.
 */
export function schemaRef(slug: string): { $ref: string } {
  return { $ref: `#/components/schemas/${slug}` };
}
