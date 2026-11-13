import { describe, expect, it } from "vitest";

import { upsertEnv } from "./env-file.mjs";

describe("upsertEnv", () => {
  it("replaces existing values and leaves every other line alone", () => {
    const before = "# comment\nA=old\nKEEP=1\n\nB=old\n";
    expect(upsertEnv(before, { A: "new", B: "new2" })).toBe("# comment\nA=new\nKEEP=1\n\nB=new2\n");
  });

  it("appends keys that are missing", () => {
    expect(upsertEnv("KEEP=1\n", { A: "x" })).toBe("KEEP=1\nA=x\n");
  });

  it("works on an empty file and keeps Windows line endings", () => {
    expect(upsertEnv("", { A: "x" })).toBe("A=x\n");
    expect(upsertEnv("KEEP=1\r\nA=old\r\n", { A: "x" })).toBe("KEEP=1\r\nA=x\r\n");
  });

  it("does not treat a longer key with the same prefix as a match", () => {
    expect(upsertEnv("A_B=1\n", { A: "x" })).toBe("A_B=1\nA=x\n");
  });
});
