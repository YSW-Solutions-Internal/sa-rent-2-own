import { describe, expect, it } from "vitest";

import { DEAL_NUMBER_SCHEMES, nextDealNumber } from "./deal-number";

const MAD = DEAL_NUMBER_SCHEMES.rent_to_own!;
const STR = DEAL_NUMBER_SCHEMES.short_term_rental!;

describe("nextDealNumber", () => {
  it("starts at 1 when nothing exists yet", () => {
    expect(nextDealNumber([], STR)).toBe("STR0000001");
  });

  it("increments past the largest existing number, padded zero-leading digits included", () => {
    expect(nextDealNumber(["STR0000001", "STR0000013", "STR0000002"], STR)).toBe("STR0000014");
  });

  it("always applies the scheme's own suffix, regardless of legacy suffix letters", () => {
    expect(nextDealNumber(["MAD6226S", "MAD7055T", "MAD0004309"], MAD)).toBe("MAD0007056S");
  });

  it("ignores rows for a different prefix", () => {
    expect(nextDealNumber(["STR0000050", "LTR0000099"], STR)).toBe("STR0000051");
  });

  it("ignores null and non-matching deal numbers", () => {
    expect(nextDealNumber([null, "not-a-deal-number", "STR0000005"], STR)).toBe("STR0000006");
  });

  it("matches case-insensitively", () => {
    expect(nextDealNumber(["str0000009"], STR)).toBe("STR0000010");
  });
});
