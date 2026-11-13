import { describe, expect, it } from "vitest";

import { clean, round2 } from "./format";

describe("clean", () => {
  it("strips everything except letters, digits and spaces", () => {
    expect(clean("KX97-TC;GP!")).toBe("KX97TCGP");
  });

  it("trims surrounding whitespace", () => {
    expect(clean("  white Polo 2019  ")).toBe("white Polo 2019");
  });

  it("can never produce PostgREST filter-string syntax from user text", () => {
    expect(clean("a,b).or(x.eq.1")).toBe("aborxeq1");
  });
});

describe("round2", () => {
  it("rounds to 2 decimal places", () => {
    expect(round2(12.3456)).toBe(12.35);
  });

  it("fixes floating-point sums like 0.1 + 0.2", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });

  it("passes whole numbers through unchanged", () => {
    expect(round2(100)).toBe(100);
  });
});
