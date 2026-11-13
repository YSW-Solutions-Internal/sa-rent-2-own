import { describe, expect, it } from "vitest";

import { checkDevEnv } from "./dev-check.mjs";

const PROD_URL = "https://srxleeenohgazegtyujb.supabase.co";
const PREVIEW_URL = "https://abcdefghijklmnopqrst.supabase.co";

const respond = (status) => async () => ({ ok: status >= 200 && status < 300, status });
const unreachable = async () => {
  throw new TypeError("fetch failed");
};
// Preview host is gone, but the internet works.
const previewGone = async (url) => {
  if (url.startsWith(PREVIEW_URL)) throw new TypeError("fetch failed");
  return { ok: true, status: 200 };
};

describe("checkDevEnv", () => {
  it("passes for a live preview database", async () => {
    const result = await checkDevEnv({ url: PREVIEW_URL, anonKey: "k", fetchImpl: respond(200) });
    expect(result.level).toBe("ok");
  });

  it("blocks when the Supabase values are missing", async () => {
    const result = await checkDevEnv({ url: undefined, anonKey: undefined, fetchImpl: respond(200) });
    expect(result.level).toBe("block");
    expect(result.message).toMatch(/npm run env:preview/);
  });

  it("blocks prod without making any request", async () => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
      return { ok: true, status: 200 };
    };
    const result = await checkDevEnv({ url: PROD_URL, anonKey: "k", fetchImpl });
    expect(result.level).toBe("block");
    expect(result.message).toMatch(/PROD database/);
    expect(called).toBe(false);
  });

  it("blocks a deleted preview database and mentions the token", async () => {
    const result = await checkDevEnv({ url: PREVIEW_URL, anonKey: "k", fetchImpl: previewGone });
    expect(result.level).toBe("block");
    expect(result.message).toMatch(/no longer exists/);
    expect(result.message).toMatch(/SUPABASE_ACCESS_TOKEN/);
  });

  it("blocks when the keys are rejected", async () => {
    const result = await checkDevEnv({ url: PREVIEW_URL, anonKey: "k", fetchImpl: respond(401) });
    expect(result.level).toBe("block");
    expect(result.message).toMatch(/keys/);
  });

  it("only warns when offline", async () => {
    const result = await checkDevEnv({ url: PREVIEW_URL, anonKey: "k", fetchImpl: unreachable });
    expect(result.level).toBe("warn");
  });

  it("only warns on an unexpected status, e.g. a branch still starting up", async () => {
    const result = await checkDevEnv({ url: PREVIEW_URL, anonKey: "k", fetchImpl: respond(503) });
    expect(result.level).toBe("warn");
  });
});
