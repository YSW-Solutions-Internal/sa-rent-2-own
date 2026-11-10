import type { ContractFormValues } from "./schema";

/** Auto-generated deal-number scheme per contract type: fixed prefix plus a
 * fixed suffix letter (MAD numbers have always carried one — item 40 — the
 * client wants new ones to always get "S", regardless of what suffix any
 * existing MAD number happens to have). "other" has no scheme and keeps
 * `deal_number` blank unless set by hand on the (edit-only) form field. */
export const DEAL_NUMBER_SCHEMES: Partial<
  Record<ContractFormValues["contractType"], { prefix: string; suffix: string }>
> = {
  rent_to_own: { prefix: "MAD", suffix: "S" },
  short_term_rental: { prefix: "STR", suffix: "" },
  rental: { prefix: "LTR", suffix: "" },
};

/** Pure part of deal-number generation (no database, no "use server" —
 * keeps it plainly unit-testable): the largest existing number for the
 * scheme's prefix (any trailing letter, any padding — same normalisation
 * as the legacy MAD-number backfills), +1, zero-padded to 7 digits
 * (matching the existing MAD/STR convention), with the scheme's own fixed
 * suffix appended. */
export function nextDealNumber(
  existingDealNumbers: (string | null)[],
  scheme: { prefix: string; suffix: string }
): string {
  const pattern = new RegExp(`^${scheme.prefix}0*(\\d+)[A-Za-z]*$`, "i");
  let max = 0;
  for (const dealNumber of existingDealNumbers) {
    const match = dealNumber?.match(pattern);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${scheme.prefix}${String(max + 1).padStart(7, "0")}${scheme.suffix}`;
}
