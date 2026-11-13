import { afterEach, describe, expect, it, vi } from "vitest";

import { getSupabaseUrl } from "./env";

const PROD_URL = "https://srxleeenohgazegtyujb.supabase.co";
const PREVIEW_URL = "https://abcdefghijklmnopqrst.supabase.co";

describe("getSupabaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses the prod database outside a production build", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", PROD_URL);
    expect(() => getSupabaseUrl()).toThrow(/PROD database/);
  });

  it("allows a preview branch database in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", PREVIEW_URL);
    expect(getSupabaseUrl()).toBe(PREVIEW_URL);
  });

  it("allows the prod database in a production build", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", PROD_URL);
    expect(getSupabaseUrl()).toBe(PROD_URL);
  });
});
