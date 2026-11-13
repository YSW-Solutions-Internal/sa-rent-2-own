/** SPEC.md §2.1 brand palette, the subset usable for a print document.
 * brand-grey is reserved for borders/fills (too low-contrast for text on
 * white — see SPEC); body text uses mutedForeground instead. */
export const BRAND = {
  blueDark: "#0F6B93",
  blue: "#007FA3",
  red: "#FF5252",
  grey: "#9E9E9E",
  greyLight: "#D6D6D6",
  mutedForeground: "#757575",
  ink: "#1A1A1A",
} as const;
