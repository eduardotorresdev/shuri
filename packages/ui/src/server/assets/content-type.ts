const CONTENT_TYPES: Readonly<Record<string, string>> = {
  css: "text/css; charset=utf-8",
  html: "text/html; charset=utf-8",
  ico: "image/x-icon",
  javascript: "text/javascript; charset=utf-8",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  otf: "font/otf",
  png: "image/png",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  txt: "text/plain; charset=utf-8",
  webmanifest: "application/manifest+json",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
};

/**
 * The content type to serve a built file as, chosen by extension.
 *
 * A closed table rather than a lookup library: the input is this package's own `vite build` output,
 * so the set of extensions is small, known, and changes only when we change it. Anything unlisted
 * gets `application/octet-stream`, which a browser downloads rather than mis-renders.
 * @param path - The asset's root-relative path.
 * @returns The `content-type` header value for `path`.
 */
export function contentTypeOf(path: string): string {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}
