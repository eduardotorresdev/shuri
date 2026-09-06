/**
 * The admin's icon set: a name to the paths that draw it, on a 24×24 grid.
 *
 * Hand-drawn and inlined rather than pulled from an icon font or a package. There are seven of them,
 * they never change, and an icon font would be a second webfont download plus a build step for the
 * sake of glyphs a `<path>` already covers. Every path is stroked in `currentColor`, so an icon
 * takes its colour from whatever it sits in.
 */
export const ICONS = {
  /** The index — where the sidebar's first entry goes. */
  home: ["M3 10.6 12 3.2l9 7.4", "M5.6 9.6V20.4h12.8V9.6"],
  /** A collection: many records, stacked. */
  collection: ["M4 7.6 12 3.2l8 4.4-8 4.4z", "m4 12 8 4.4 8-4.4", "m4 16.4 8 4.4 8-4.4"],
  /** A global: one record, on its own. */
  global: [
    "M6.5 3.2h7l4.5 4.4v13.2H6.5z",
    "M13.5 3.2v4.4H18",
    "M9.8 13h5.4",
    "M9.8 17h5.4",
  ],
  plus: ["M12 5.2v13.6", "M5.2 12h13.6"],
  chevronLeft: ["m15 5.5-7 6.5 7 6.5"],
  chevronRight: ["m9 5.5 7 6.5-7 6.5"],
  chevronUp: ["m5.5 15 6.5-6.5 6.5 6.5"],
  chevronDown: ["m5.5 9 6.5 6.5L18.5 9"],
} as const;

/** The name of an icon in {@link ICONS}. */
export type IconName = keyof typeof ICONS;
