import { describe, expect, it } from "vitest";

import { checkDevEnv, ensureDevEnv } from "./dev-check.mjs";

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

  it("blocks a deleted preview database", async () => {
    const result = await checkDevEnv({ url: PREVIEW_URL, anonKey: "k", fetchImpl: previewGone });
    expect(result.level).toBe("block");
    expect(result.message).toMatch(/no longer exists/);
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

describe("ensureDevEnv", () => {
  const ok = { level: "ok", message: "" };
  const block = { level: "block", message: "stale" };
  const pointed = { url: PREVIEW_URL, anonKey: "new", projectRef: "abcdefghijklmnopqrst", changed: true };
  const noPreview = async () => {
    throw new Error("No Supabase preview branch found");
  };

  it("follows the git branch: switches to its preview database and checks the new values", async () => {
    const checked = [];
    const result = await ensureDevEnv({
      env: { url: "https://otherbranchotherbran.supabase.co", anonKey: "k" },
      check: async (env) => (checked.push(env.anonKey), ok),
      point: async () => pointed,
    });
    expect(checked).toEqual(["new"]);
    expect(result.level).toBe("ok");
    expect(result.message).toMatch(/now points at/);
  });

  it("says nothing when the file already matched the git branch", async () => {
    const result = await ensureDevEnv({
      env: { url: PREVIEW_URL, anonKey: "new" },
      check: async () => ok,
      point: async () => ({ ...pointed, changed: false }),
    });
    expect(result).toEqual(ok);
  });

  it("starts on the database already configured, with a warning, when the branch has no preview", async () => {
    const result = await ensureDevEnv({
      env: { url: PREVIEW_URL, anonKey: "k" },
      check: async () => ok,
      point: noPreview,
    });
    expect(result.level).toBe("warn");
    expect(result.message).toMatch(/No Supabase preview branch found/);
  });

  it("stays blocked, with both reasons, when it cannot switch and the configured database is unusable", async () => {
    const result = await ensureDevEnv({
      env: { url: PROD_URL, anonKey: "k" },
      check: async () => block,
      point: noPreview,
    });
    expect(result.level).toBe("block");
    expect(result.message).toMatch(/stale/);
    expect(result.message).toMatch(/No Supabase preview branch found/);
  });
});
